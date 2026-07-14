import {
  BETA_EFF,
  CORE_HEIGHT,
  DECAY_FRACTION_TOTAL,
  FUEL_TEMP_COEFF,
  ORM_MIN_RODS,
  PRIZMA_PERIOD,
  GRAPHITE_TEMP_COEFF,
  N_AXIAL,
  N_RODS,
  NODE_HEIGHT,
  P_RATED,
  T_FUEL_REF,
  T_GRAPHITE_REF,
  T_INLET,
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
  RodSelector,
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

  /** Automatic regulator (AR): PI controller trimming the active bank. */
  arEnabled = true;
  /** Target power setpoint (fraction of rated) the operator dialed in. */
  arSetpoint = 0;
  /**
   * Setpoint gradient limit [fraction/s]: the ACTIVE setpoint ramps toward
   * the target at this rate (the real panel had a settable 0-0.35 %/s
   * gradient), so maneuvers never step-saturate the small AR bank.
   */
  arGradient = 0.0003;
  private arSetpointActive = 0;
  /**
   * Regulation source and its valid power band (fractions of rated):
   * ARM 0.0025-0.06 (low-power regulator, drives the active AR subgroup),
   * AR 0.05-1.05 (main range, side chambers),
   * LAR 0.10-1.0 (in-core chambers; BLIND below ~10% - it drops out).
   */
  arMode: "ARM" | "AR" | "LAR" = "AR";
  /** Active AR subgroup (1..3); standby groups take over on saturation. */
  arActiveGroup: 1 | 2 | 3 = 1;
  private arSaturatedFor = 0;
  private arErrPrev = 0;
  private arTarget = 0.5;
  private rhoInstrumentZero = 0;

  /**
   * Protection enables. The real plant allowed operators to block certain
   * automatic trips (a practice INSAG-7 documents on the accident night);
   * blocked trips log a warning instead of acting.
   */
  protection = { overpower: true, period: true };
  private lastBlockedWarnT = -Infinity;
  private lastPeriodBlockWarnT = -Infinity;
  private lastSilBlokT = -Infinity;
  private lastBandWarnT = -Infinity;
  /** Last PRIZMA ORM printout {t, orm}; pre-1986 ORM was NOT live. */
  private lastPrizma = { t: 0, orm: 0 };
  private nextPrizmaT = 0;

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
    opts: {
      manualInsertion?: number;
      autoInsertion?: number;
      uspInsertion?: number;
    } = {},
  ): void {
    const s = this.state;
    const manual = opts.manualInsertion ?? 0.45;
    const auto = opts.autoInsertion ?? 0.5;
    // USP absorbers ride partway in from the bottom to trim the axial field.
    const usp = opts.uspInsertion ?? 0.2;
    for (const rod of s.rods) {
      const ins =
        rod.group === "AR" || rod.group === "LAR"
          ? auto
          : rod.group === "AZ"
            ? 0
            : rod.group === "USP"
              ? usp
              : manual;
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
    this.arSetpointActive = fraction;
    this.arTarget = auto;
    this.arErrPrev = 0;
    this.arActiveGroup = 1;
    this.arSaturatedFor = 0;
    // Settle to a converged critical state: re-center the regulating bank
    // mid-range (so it keeps authority in both directions), recalibrate,
    // let flux shape and feedbacks relax, and repeat until power drift dies.
    // Protection is bypassed while settling: the wobble is numerical.
    this.initializing = true;
    for (let i = 0; i < 8; i++) {
      for (const rod of s.rods) {
        if (this.regulatorOwns(rod)) {
          rod.insertion = auto;
          rod.target = auto;
        }
      }
      this.arTarget = auto;
      this.arErrPrev = 0;
      this.calibrateCritical();
      this.tick(12);
      if (
        Math.abs(powerFraction(s.nodes) - fraction) < 0.002 &&
        Math.abs(this.smoothedRate) < 2e-4
      ) {
        break;
      }
    }
    this.calibrateCritical();
    this.tick(8);
    this.initializing = false;
    this.smoothedRate = 0;
    s.time = 0;
    this.nextPrizmaT = 0;
    this.lastPrizma = { t: 0, orm: this.ormRods() };
    this.log.info(s.time, "INIT", `initialized at ${Math.round(fraction * 100)}% power`, {
      rhoBase: s.rhoBase,
    });
  }

  /**
   * Shut-down hot standby: all rods in, fresh (xenon-free) core at inlet
   * temperature, flux at the intrinsic-source level. From here the reactor
   * can be STARTED: withdraw AZ first, then RR squads, watch subcritical
   * multiplication (1/M), reach criticality, and raise power gently.
   * rhoBase is taken from a reference full-power calibration so the core's
   * physical worth bookkeeping matches operating conditions.
   */
  initShutdown(): void {
    const s = this.state;
    // Reference calibration (also produces a physically consistent rhoBase).
    this.initAtPower(1.0);
    for (const rod of s.rods) {
      rod.insertion = 1;
      rod.target = 1;
    }
    for (const node of s.nodes) {
      node.flux = 1e-6;
      node.iodine = 0;
      node.xenon = 0;
      node.fuelTemp = T_INLET;
      node.graphiteTemp = T_INLET;
      node.coolantTemp = T_INLET;
      node.quality = 0;
      node.voidFrac = 0;
    }
    equilibriumPrecursors(s.nodes);
    s.decayHeat.groups = [0, 0, 0];
    s.scrammed = false;
    this.arEnabled = false;
    this.arSetpoint = 0;
    this.arSetpointActive = 0;
    this.smoothedRate = 0;
    // Let the flux settle to the true source-multiplication level.
    this.initializing = true;
    this.tick(60, 0.1);
    this.initializing = false;
    this.smoothedRate = 0;
    s.time = 0;
    this.nextPrizmaT = 0;
    this.lastPrizma = { t: 0, orm: this.ormRods() };
    this.log.info(
      s.time,
      "INIT",
      "shutdown hot standby: all rods in, fresh core, source-level flux",
      { fluxRel: Number(powerFraction(s.nodes).toExponential(2)) },
    );
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

  /**
   * Command a rod group, AR subgroup ("AR1".."AR3"), single rod id, or every
   * rod to a target insertion 0..1. Manual commands to a rod owned by the
   * engaged automatic regulator are refused (switch its group to manual
   * first), like the real machine.
   */
  setRodTarget(selector: RodSelector, target: number): void {
    const t = Math.min(1, Math.max(0, target));
    for (const rod of this.rodsFor(selector)) {
      if (
        typeof selector === "number" &&
        rod.autoControlled &&
        this.arEnabled &&
        this.regulatorOwns(rod)
      ) {
        this.log.warn(
          this.state.time,
          "ROD_AUTO",
          `rod ${rod.id} is under automatic control - switch it to manual first`,
        );
        continue;
      }
      // Startup rule: rod withdrawal is blocked while the period is short
      // (< 60 s) in the startup range - wait for the period to recover.
      if (
        t < rod.insertion &&
        powerFraction(this.state.nodes) < 0.05 &&
        !this.initializing
      ) {
        const period = this.period();
        if (period > 0 && period < 60) {
          if (this.state.time - this.lastPeriodBlockWarnT > 10) {
            this.lastPeriodBlockWarnT = this.state.time;
            this.log.warn(
              this.state.time,
              "PERIOD_BLOCK",
              "withdrawal blocked: period below 60 s - wait for it to recover",
            );
          }
          continue;
        }
      }
      rod.target = t;
    }
  }

  /**
   * Manual override of automatic rods: take AR/LAR rods out of (or return
   * them to) automatic control. While overridden the operator drives them;
   * on return the regulator reclaims them and drives them back to its bank
   * target - the classic release-and-reclaim reactivity swing.
   */
  setAutoControl(ids: number[], auto: boolean): void {
    const affected: number[] = [];
    for (const id of ids) {
      const rod = this.state.rods[id];
      if (!rod || (rod.group !== "AR" && rod.group !== "LAR")) continue;
      if (rod.autoControlled !== auto) affected.push(id);
      rod.autoControlled = auto;
      if (!auto) rod.target = rod.insertion;
    }
    if (affected.length > 0) {
      this.log.info(
        this.state.time,
        "AR_OVERRIDE",
        auto
          ? `rods returned to automatic control (${affected.length})`
          : `manual override of automatic rods (${affected.length})`,
      );
    }
  }

  /** True if the engaged regulator currently drives this rod. */
  private regulatorOwns(rod: RodState): boolean {
    if (!rod.autoControlled) return false;
    if (this.arMode === "LAR") return rod.group === "LAR";
    // ARM and AR both drive the active AR subgroup.
    return rod.group === "AR" && rod.arSubgroup === this.arActiveGroup;
  }

  /** Valid power band [lo, hi] (fraction of rated) for the current mode. */
  private regulatorBand(): [number, number] {
    if (this.arMode === "ARM") return [0.0025, 0.06];
    if (this.arMode === "LAR") return [0.1, 1.0];
    return [0.05, 1.05];
  }

  /**
   * AZ-5: latch scram, drive rods to full insertion. Pre-1986 behavior:
   * USP shortened absorbers are NOT driven by AZ-5 - they stay where they
   * are (a named contributing factor to the accident).
   */
  scram(reason = "AZ-5 button"): void {
    if (this.state.scrammed) return;
    this.state.scrammed = true;
    for (const rod of this.state.rods) {
      if (rod.group !== "USP") rod.target = 1;
    }
    this.log.alarm(this.state.time, "AZ5", `SCRAM: ${reason} (USP rods hold position)`);
  }

  /**
   * AZ-1 power setback: drive the AZ emergency bank in (non-latching) to
   * knock power down without a full shutdown. Naming of the graduated
   * protection modes varies by source; this models the documented
   * "insert only the AZ complement" step.
   */
  azSetback(): void {
    for (const rod of this.state.rods) {
      if (rod.group === "AZ") rod.target = 1;
    }
    // Graduated protection also lowers the regulation setpoint so the AR
    // does not fight the setback.
    this.arSetpoint = Math.min(this.arSetpoint, 0.5);
    this.log.alarm(
      this.state.time,
      "AZ1",
      "AZ-1 setback: emergency bank driving in, setpoint reduced to 50%",
    );
  }

  /** Reset the scram latch (rods stay where they are; re-enables AR). */
  resetScram(): void {
    if (!this.state.scrammed) return;
    this.state.scrammed = false;
    for (const rod of this.state.rods) rod.target = rod.insertion;
    this.log.info(this.state.time, "AZ5_RESET", "scram latch reset");
  }

  /** Operating reactivity margin, crudely, in equivalent inserted rods. */
  ormRods(): number {
    return this.state.rods.reduce((a, r) => a + r.insertion, 0);
  }

  setFlowFraction(fraction: number): void {
    this.state.flowFraction = Math.min(1.2, Math.max(0, fraction));
    this.log.info(this.state.time, "FLOW", `pump flow ${Math.round(fraction * 100)}%`);
  }

  private rodsFor(selector: RodSelector): RodState[] {
    if (selector === "all") return this.state.rods;
    if (typeof selector === "number") {
      const rod = this.state.rods[selector];
      return rod ? [rod] : [];
    }
    if (selector === "AR1" || selector === "AR2" || selector === "AR3") {
      const sub = Number(selector[2]) as 1 | 2 | 3;
      return this.state.rods.filter(
        (r) => r.group === "AR" && r.arSubgroup === sub,
      );
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

    // Regulator band enforcement: LAR's in-core chambers are blind below
    // ~10% - it DROPS OUT (the 00:28 accident-night failure mode). Other
    // modes warn when the plant is outside their band.
    if (this.arEnabled && !s.scrammed) {
      const [lo] = this.regulatorBand();
      if (pBefore < lo * 0.9) {
        if (this.arMode === "LAR") {
          this.arEnabled = false;
          this.log.alarm(
            s.time,
            "LAR_DROPOUT",
            "LAR dropped out: in-core chambers blind below 10% - regulation LOST",
          );
        } else if (s.time - this.lastBandWarnT > ALARM_COOLDOWN) {
          this.lastBandWarnT = s.time;
          this.log.warn(
            s.time,
            "AR_BAND",
            `power below the ${this.arMode} band - switch to a lower-range regulator`,
          );
        }
      }
    }

    if (this.arEnabled && !s.scrammed && this.arSetpoint > 0) {
      // The active setpoint ramps toward the target at the gradient limit.
      const d = this.arSetpoint - this.arSetpointActive;
      const maxD = this.arGradient * dt;
      this.arSetpointActive +=
        Math.abs(d) <= maxD ? d : Math.sign(d) * maxD;
      // PI on power error, output = active-bank insertion target. Positive
      // error (power above setpoint) drives rods IN.
      const err = pBefore - this.arSetpointActive;
      this.arTarget += 5 * (err - this.arErrPrev) + 2 * err * dt;
      this.arTarget = Math.min(1, Math.max(0, this.arTarget));
      this.arErrPrev = err;
      for (const rod of s.rods) {
        if (this.regulatorOwns(rod)) rod.target = this.arTarget;
      }
      // Automatic changeover: if the active AR subgroup sits saturated at
      // either end of its range, hand regulation to the next subgroup
      // (real behavior: standby group takes over when the active one runs
      // out of authority or fails).
      if (this.arMode !== "LAR") {
        if (this.arTarget <= 0 || this.arTarget >= 1) {
          this.arSaturatedFor += dt;
          if (this.arSaturatedFor > 5) {
            const next = ((this.arActiveGroup % 3) + 1) as 1 | 2 | 3;
            this.log.warn(
              s.time,
              "AR_CHANGEOVER",
              `AR-${this.arActiveGroup} out of authority - changeover to AR-${next}`,
            );
            this.arActiveGroup = next;
            const bank = s.rods.filter(
              (r) => r.group === "AR" && r.arSubgroup === next,
            );
            this.arTarget =
              bank.reduce((a, r) => a + r.insertion, 0) / Math.max(1, bank.length);
            this.arSaturatedFor = 0;
          }
        } else {
          this.arSaturatedFor = 0;
        }
      }
    }

    // "Silovaya blokirovka": if 8 or more RR/USP/AR/LAR rods are being
    // withdrawn simultaneously, the power interlock halts them all and
    // annunciates (real panel logic; AZ rods excluded).
    if (!this.initializing) {
      const withdrawing = s.rods.filter(
        (r) => r.group !== "AZ" && r.target < r.insertion - 1e-6,
      );
      if (withdrawing.length >= 8) {
        for (const rod of withdrawing) rod.target = rod.insertion;
        if (s.time - this.lastSilBlokT > ALARM_COOLDOWN) {
          this.lastSilBlokT = s.time;
          this.log.alarm(
            s.time,
            "SIL_BLOK",
            `power interlock: ${withdrawing.length} rods withdrawing - all halted, selection cleared`,
          );
        }
      }
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

    // AZS: emergency protection by reactor period.
    if (period > 0 && period < 10 && power > 0.005 && !s.scrammed) {
      if (this.protection.period) {
        this.scram("AZS: reactor period below 10 s");
      } else this.warnBlocked("AZS (period) trip condition met");
    }
    // AZM: emergency protection by power level.
    if (power > 1.1 && !s.scrammed) {
      if (this.protection.overpower) {
        this.scram("AZM: power above 110% rated");
      } else this.warnBlocked("AZM (overpower) trip condition met");
    }
    // PRIZMA ORM printout: pre-1986 there was NO live ORM gauge and NO
    // ORM-based protection - the operator got a printout every few minutes.
    // The 15-rod floor was purely administrative.
    if (s.time >= this.nextPrizmaT) {
      this.nextPrizmaT = s.time + PRIZMA_PERIOD;
      const orm = this.ormRods();
      this.lastPrizma = { t: s.time, orm };
      if (orm < ORM_MIN_RODS && power > 0.1) {
        this.log.warn(
          s.time,
          "PRIZMA",
          `printout: ORM ${orm.toFixed(1)} equivalent rods - BELOW the administrative floor of 15`,
        );
      } else {
        this.log.info(
          s.time,
          "PRIZMA",
          `printout: ORM ${orm.toFixed(1)} equivalent rods`,
        );
      }
    }
  }

  /** Latest PRIZMA printout {t, orm} - the only ORM the operator gets. */
  prizma(): { t: number; orm: number } {
    return this.lastPrizma;
  }

  private warnBlocked(what: string): void {
    if (this.state.time - this.lastBlockedWarnT < ALARM_COOLDOWN) return;
    this.lastBlockedWarnT = this.state.time;
    this.log.warn(this.state.time, "RPS_BLOCKED", `${what} - BLOCKED by operator`);
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

  /** The ramped ACTIVE setpoint the regulator is currently holding. */
  activeSetpoint(): number {
    return this.arSetpointActive;
  }

  /**
   * Mean insertion 0..1 of the bank the regulator currently owns. Near the
   * ends of its range the AR is out of authority and the operator should
   * "release" it by moving manual rods (standard procedure).
   */
  arInsertion(): number {
    const owned = this.state.rods.filter((r) => this.regulatorOwns(r));
    if (owned.length === 0) return this.arTarget;
    return owned.reduce((a, r) => a + r.insertion, 0) / owned.length;
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
