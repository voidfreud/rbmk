import {
  BETA_EFF,
  CORE_HEIGHT,
  DECAY_FRACTION_TOTAL,
  FUEL_TEMP_COEFF,
  GRAPHITE_TEMP_COEFF,
  N_AXIAL,
  N_RODS,
  NODE_HEIGHT,
  P_RATED,
  T_FUEL_REF,
  T_GRAPHITE_REF,
  VOID_COEFF,
} from "./constants";
import {
  equilibriumPrecursors,
  globalReactivity,
  powerFraction,
  stepKinetics,
} from "./kinetics";
import {
  equilibriumDecayHeat,
  equilibriumIodineXenon,
  stepDecayHeat,
  stepIodineXenon,
  thermalPower,
  xenonReactivity,
} from "./isotopes";
import { EventLog } from "./logger";
import { buildRods, rodReactivityByNode, stepRodDrives } from "./rods";
import { equilibriumThermal, stepThermal } from "./thermal";
import type {
  CoreState,
  NodeState,
  ReactivityBreakdown,
  RodGroup,
  RodState,
} from "./types";
import { zeroNode } from "./types";

const DT_INTERNAL = 0.01;
/** EMA time constant for the decay-heat spatial shape [s]. */
const TAU_DECAY_SHAPE = 3600;
/** EMA time constant for the displayed reactor period [s]. */
const TAU_PERIOD = 2.0;
/** Minimum sim-time between repeated emissions of the same alarm [s]. */
const ALARM_COOLDOWN = 60;

export interface ReactorOptions {
  rodCount?: number;
  log?: EventLog;
}

export class Reactor {
  readonly state: CoreState;
  readonly log: EventLog;

  /** Long-term flux shape (normalized, sums to 1) for decay-heat placement. */
  private decayShape: number[];
  private lastRhoByNode: number[] = new Array(N_AXIAL).fill(0);
  private lastBreakdown: ReactivityBreakdown | null = null;
  /** EMA-smoothed inverse period (growth rate) [1/s]; period = 1/rate. */
  private smoothedRate = 0;
  private periodAlarmLatched = false;
  private lastPeriodAlarmT = -Infinity;
  /** True while initAtPower settles; protection and alarms are bypassed. */
  private initializing = false;

  /** Automatic regulator (AR): PI controller trimming the auto rod group. */
  arEnabled = true;
  arSetpoint = 0;
  private arErrPrev = 0;
  private arTarget = 0.5;
  private rhoInstrumentZero = 0;

  constructor(options: ReactorOptions = {}) {
    this.log = options.log ?? new EventLog();
    const nodes: NodeState[] = [];
    for (let k = 0; k < N_AXIAL; k++) nodes.push(zeroNode());
    this.state = {
      time: 0,
      nodes,
      rods: buildRods(options.rodCount ?? N_RODS),
      decayHeat: { groups: [0, 0, 0] },
      rhoBase: 0,
      rhoExtra: 0,
      flowFraction: 1,
      scrammed: false,
    };
    this.decayShape = new Array(N_AXIAL).fill(1 / N_AXIAL);
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /**
   * Put the reactor into steady operation at the given power fraction:
   * chopped-cosine flux shape, equilibrium precursors / iodine / xenon /
   * decay heat / thermal fields, then calibrate rhoBase for criticality.
   */
  initAtPower(
    fraction: number,
    opts: { manualInsertion?: number; autoInsertion?: number } = {},
  ): void {
    const s = this.state;
    const manual = opts.manualInsertion ?? 0.3;
    const auto = opts.autoInsertion ?? 0.5;
    for (const rod of s.rods) {
      const ins =
        rod.group === "auto" ? auto : rod.group === "emergency" ? 0 : manual;
      rod.insertion = ins;
      rod.target = ins;
    }

    // Chopped cosine with extrapolation length, normalized to `fraction`.
    const delta = 0.7;
    const shape: number[] = [];
    for (let k = 0; k < N_AXIAL; k++) {
      const z = (k + 0.5) * NODE_HEIGHT;
      shape.push(
        Math.cos((Math.PI * (z - CORE_HEIGHT / 2)) / (CORE_HEIGHT + 2 * delta)),
      );
    }
    const avg = shape.reduce((a, b) => a + b, 0) / N_AXIAL;
    for (let k = 0; k < N_AXIAL; k++) {
      const node = s.nodes[k]!;
      node.flux = (fraction * shape[k]!) / avg;
      const eq = equilibriumIodineXenon(node.flux);
      node.iodine = eq.iodine;
      node.xenon = eq.xenon;
    }
    equilibriumPrecursors(s.nodes);
    s.decayHeat.groups = equilibriumDecayHeat(fraction * P_RATED);
    this.refreshDecayShape(1);
    equilibriumThermal(s.nodes, this.nodePowers(), s.flowFraction);
    s.scrammed = false;
    this.arSetpoint = fraction;
    this.arTarget = auto;
    this.arErrPrev = 0;
    this.calibrateCritical();
    // Let the flux shape and feedbacks settle under the automatic regulator,
    // trim criticality once more, then define this as t = 0. Protection is
    // bypassed while settling: the wobble is numerical, not physical.
    this.initializing = true;
    this.tick(30);
    this.calibrateCritical();
    this.tick(10);
    this.initializing = false;
    this.smoothedRate = 0;
    s.time = 0;
    this.log.info(s.time, "INIT", `initialized at ${Math.round(fraction * 100)}% power`, {
      rhoBase: s.rhoBase,
    });
  }

  /**
   * Find rhoBase so the current configuration is exactly critical:
   * bisection on the growth rate of a kinetics-only trial integration with
   * all feedback state frozen.
   */
  calibrateCritical(): void {
    const s = this.state;
    const frozenFeedback = this.feedbackRhoByNode();
    const rodRho = rodReactivityByNode(s.rods);

    const growthFor = (rhoBase: number): number => {
      const trial = s.nodes.map((n) => ({
        flux: n.flux,
        precursors: [...n.precursors],
      }));
      const rho = rodRho.map((r, k) => rhoBase + r + frozenFeedback[k]!);
      const steps = 400;
      const dt = 0.005;
      // Renormalize every step and accumulate log growth so strongly
      // supercritical trials cannot overflow to Infinity.
      let logGrowth = 0;
      for (let i = 0; i < steps; i++) {
        stepKinetics(trial, rho, dt);
        const p = powerFraction(trial);
        if (!(p > 0) || !Number.isFinite(p)) return 1e3;
        if (i >= steps / 2) logGrowth += Math.log(p);
        const inv = 1 / p;
        for (const node of trial) {
          node.flux *= inv;
          for (let g = 0; g < node.precursors.length; g++)
            node.precursors[g]! *= inv;
        }
      }
      return logGrowth / ((steps / 2) * dt);
    };

    let lo = -0.1;
    let hi = 0.1;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (growthFor(mid) > 0) hi = mid;
      else lo = mid;
    }
    s.rhoBase = (lo + hi) / 2;

    // Zero the reactivity instrument at the calibrated critical state: the
    // flux-squared-weighted node average is nonzero even at criticality
    // (it does not see leakage), so the meter reads relative to this.
    const rho = rodReactivityByNode(s.rods).map(
      (r, k) => s.rhoBase + s.rhoExtra + r + frozenFeedback[k]!,
    );
    this.rhoInstrumentZero = globalReactivity(s.nodes, rho);
  }

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  /** Command a rod group (or every rod) to a target insertion 0..1. */
  setRodTarget(selector: RodGroup | "all" | number, target: number): void {
    const t = Math.min(1, Math.max(0, target));
    for (const rod of this.rodsFor(selector)) rod.target = t;
  }

  /** AZ-5: latch scram, drive every rod to full insertion. */
  scram(reason = "AZ-5 button"): void {
    if (this.state.scrammed) return;
    this.state.scrammed = true;
    for (const rod of this.state.rods) rod.target = 1;
    this.log.alarm(this.state.time, "AZ5", `SCRAM: ${reason}`);
  }

  setFlowFraction(fraction: number): void {
    this.state.flowFraction = Math.min(1.2, Math.max(0, fraction));
    this.log.info(this.state.time, "FLOW", `pump flow ${Math.round(fraction * 100)}%`);
  }

  private rodsFor(selector: RodGroup | "all" | number): RodState[] {
    if (selector === "all") return this.state.rods;
    if (typeof selector === "number") {
      const rod = this.state.rods[selector];
      return rod ? [rod] : [];
    }
    return this.state.rods.filter((r) => r.group === selector);
  }

  // -------------------------------------------------------------------------
  // Time stepping
  // -------------------------------------------------------------------------

  /**
   * Advance the simulation by dt seconds (substepped internally).
   * maxStep can be raised (e.g. 0.1 s) to fast-forward quiet stretches;
   * the integrators are implicit and stay stable, only losing sharpness
   * on fast transients.
   */
  tick(dt: number, maxStep = DT_INTERNAL): void {
    let remaining = dt;
    while (remaining > 1e-9) {
      const step = Math.min(maxStep, remaining);
      this.substep(step);
      remaining -= step;
    }
  }

  private substep(dt: number): void {
    const s = this.state;
    const pBefore = powerFraction(s.nodes);

    if (this.arEnabled && !s.scrammed && this.arSetpoint > 0) {
      // PI on power error, output = auto-group insertion target. Positive
      // error (power above setpoint) drives rods IN.
      const err = pBefore - this.arSetpoint;
      this.arTarget += 5 * (err - this.arErrPrev) + 2 * err * dt;
      this.arTarget = Math.min(1, Math.max(0, this.arTarget));
      this.arErrPrev = err;
      this.setRodTarget("auto", this.arTarget);
    }

    stepRodDrives(s.rods, dt);

    const rodRho = rodReactivityByNode(s.rods);
    const feedback = this.feedbackRhoByNode();
    const rhoByNode = rodRho.map(
      (r, k) => s.rhoBase + s.rhoExtra + r + feedback[k]!,
    );
    this.lastRhoByNode = rhoByNode;

    stepKinetics(s.nodes, rhoByNode, dt);

    const fissionPower = powerFraction(s.nodes) * P_RATED;
    for (const node of s.nodes) {
      const ix = stepIodineXenon(node.iodine, node.xenon, node.flux, dt);
      node.iodine = ix.iodine;
      node.xenon = ix.xenon;
    }
    s.decayHeat.groups = stepDecayHeat(s.decayHeat.groups, fissionPower, dt);
    this.refreshDecayShape(dt / TAU_DECAY_SHAPE);
    stepThermal(s.nodes, this.nodePowers(), s.flowFraction, dt);

    s.time += dt;

    const pAfter = powerFraction(s.nodes);
    // Smooth the growth RATE, not the period: alternating +/- periods from
    // regulator jiggle would otherwise average toward a false short period.
    const rate =
      pBefore > 0 && pAfter > 0 ? Math.log(pAfter / pBefore) / dt : 0;
    const alpha = Math.min(1, dt / TAU_PERIOD);
    this.smoothedRate += (rate - this.smoothedRate) * alpha;
    this.checkAlarms(pAfter);
  }

  private checkAlarms(power: number): void {
    if (this.initializing) return;
    const s = this.state;
    const period = this.period();
    if (period > 0 && period < 20 && power > 0.001) {
      if (
        !this.periodAlarmLatched &&
        s.time - this.lastPeriodAlarmT > ALARM_COOLDOWN
      ) {
        this.periodAlarmLatched = true;
        this.lastPeriodAlarmT = s.time;
        this.log.alarm(s.time, "PERIOD", "reactor period below 20 s", {
          period: Number(period.toFixed(1)),
        });
      }
    } else if (this.periodAlarmLatched && (period < 0 || period > 30)) {
      this.periodAlarmLatched = false;
    }
    if (power > 1.1 && !s.scrammed) {
      this.scram("power above 110% rated");
    }
  }

  // -------------------------------------------------------------------------
  // Derived quantities / instruments
  // -------------------------------------------------------------------------

  /** Feedback reactivity per node: void + Doppler + graphite + xenon. */
  private feedbackRhoByNode(): number[] {
    const out = new Array<number>(N_AXIAL);
    const nodes = this.state.nodes;
    for (let k = 0; k < N_AXIAL; k++) {
      const n = nodes[k]!;
      out[k] =
        VOID_COEFF * n.voidFrac +
        FUEL_TEMP_COEFF * (n.fuelTemp - T_FUEL_REF) +
        GRAPHITE_TEMP_COEFF * (n.graphiteTemp - T_GRAPHITE_REF) +
        xenonReactivity(n.xenon);
    }
    return out;
  }

  /** Thermal power deposited per node [W], including decay heat. */
  private nodePowers(): number[] {
    const s = this.state;
    const fission = powerFraction(s.nodes) * P_RATED;
    const total = thermalPower(fission, s.decayHeat.groups);
    const promptShare = fission * (1 - DECAY_FRACTION_TOTAL);
    const decayShare = total - promptShare;
    const out = new Array<number>(N_AXIAL);
    const fluxSum = s.nodes.reduce((a, n) => a + n.flux, 0);
    for (let k = 0; k < N_AXIAL; k++) {
      const fluxShare = fluxSum > 1e-9 ? s.nodes[k]!.flux / fluxSum : 0;
      out[k] = promptShare * fluxShare + decayShare * this.decayShape[k]!;
    }
    return out;
  }

  private refreshDecayShape(alpha: number): void {
    const s = this.state;
    const fluxSum = s.nodes.reduce((a, n) => a + n.flux, 0);
    if (fluxSum < 1e-9) return;
    const a = Math.min(1, alpha);
    for (let k = 0; k < N_AXIAL; k++) {
      const share = s.nodes[k]!.flux / fluxSum;
      this.decayShape[k]! += (share - this.decayShape[k]!) * a;
    }
  }

  /** Core power as fraction of rated (from fission rate). */
  powerFraction(): number {
    return powerFraction(this.state.nodes);
  }

  /** Total thermal power [W] including decay heat. */
  thermalPowerW(): number {
    return thermalPower(
      this.powerFraction() * P_RATED,
      this.state.decayHeat.groups,
    );
  }

  /**
   * Current auto-regulator bank target insertion 0..1. Near the ends of its
   * range the AR is out of authority and the operator should "release" it
   * by moving manual rods (standard procedure).
   */
  arInsertion(): number {
    return this.arTarget;
  }

  /** Smoothed reactor period [s] (clamped to +-1e6 for display). */
  period(): number {
    const r = this.smoothedRate;
    if (Math.abs(r) < 1e-6) return 1e6;
    return Math.max(-1e6, Math.min(1e6, 1 / r));
  }

  /** Global net reactivity in units of beta (dollars), zeroed at calibration. */
  reactivityDollars(): number {
    return (
      (globalReactivity(this.state.nodes, this.lastRhoByNode) -
        this.rhoInstrumentZero) /
      BETA_EFF
    );
  }

  /** Per-node reactivity contributions for instruments/UI. */
  reactivityBreakdown(): ReactivityBreakdown {
    const s = this.state;
    const rods = rodReactivityByNode(s.rods);
    const voidFeedback: number[] = [];
    const doppler: number[] = [];
    const graphite: number[] = [];
    const xenon: number[] = [];
    for (const n of s.nodes) {
      voidFeedback.push(VOID_COEFF * n.voidFrac);
      doppler.push(FUEL_TEMP_COEFF * (n.fuelTemp - T_FUEL_REF));
      graphite.push(GRAPHITE_TEMP_COEFF * (n.graphiteTemp - T_GRAPHITE_REF));
      xenon.push(xenonReactivity(n.xenon));
    }
    return {
      rods,
      voidFeedback,
      doppler,
      graphite,
      xenon,
      netGlobal: globalReactivity(s.nodes, this.lastRhoByNode),
    };
  }
}
