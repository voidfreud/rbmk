import {
  BETA_EFF,
  CORE_HEIGHT,
  DECAY_FRACTION_TOTAL,
  DELAYED_BETA,
  DELAYED_LAMBDA,
  FUEL_TEMP_COEFF,
  GEN_TIME,
  NEUTRON_SOURCE,
  ORM_MIN_RODS,
  PHOTO_BETA,
  PHOTO_LAMBDA,
  PRIZMA_PERIOD,
  ROD_SPEED,
  STATE_INTERVAL,
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
  createKineticsWorkspace,
  equilibriumPrecursor,
  equilibriumPrecursors,
  globalReactivity,
  powerFraction,
  stepKinetics,
  stepPrecursor,
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
function requireFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
  return value;
}

function requireUnitInterval(value: number, name: string): number {
  requireFiniteNumber(value, name);
  if (value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
  return value;
}


export interface ReactorOptions {
  rodCount?: number;
  log?: EventLog;
}

export class Reactor {
  readonly state: CoreState;
  readonly log: EventLog;

  /** Long-term flux shape (normalized, sums to 1) for decay-heat placement. */
  private decayShape: number[];
  /** Hot-loop workspaces are instance-owned: no garbage and no cross-reactor state. */
  private readonly kineticsWorkspace = createKineticsWorkspace();
  private readonly rodRhoScratch = new Array<number>(N_AXIAL);
  private readonly feedbackScratch = new Array<number>(N_AXIAL);
  private readonly rhoScratch = new Array<number>(N_AXIAL);
  private readonly nodePowerScratch = new Array<number>(N_AXIAL);
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
   *
   * Prefer {@link setArMode} over assigning this field directly so the PI
   * state re-seeds from the newly owned bank (avoids a huge step). Left
   * assignable for tests that only need the mode flag.
   */
  arMode: "ARM" | "AR" | "LAR" = "AR";
  /** Active AR subgroup (1..3); standby groups take over on saturation. */
  arActiveGroup: 1 | 2 | 3 = 1;
  private arSaturatedFor = 0;
  private arErrPrev = 0;
  private arTarget = 0.5;
  private lastArNoAuthT = -Infinity;

  /**
   * Inverse-point-kinetics reactimeter (the ZRT-A principle): global
   * precursor and photoneutron states integrated from the measured power,
   * so the meter solves rho from flux history + source. Reads true
   * subcriticality at shutdown and zero at criticality by construction.
   */
  private ipkC = new Array<number>(6).fill(0);
  private ipkPhoto = new Array<number>(PHOTO_BETA.length).fill(0);
  private lastRhoIpk = 0;

  /**
   * Protection enables. The real plant allowed operators to block certain
   * automatic trips (a practice INSAG-7 documents on the accident night);
   * blocked trips log a warning instead of acting.
   */
  protection = { overpower: true, period: true };
  /**
   * Arm or disarm a protection channel. The real panel allowed operators to
   * block AZS (period) and AZM (overpower) trips; blocked trips log a warning
   * instead of acting (see {@link warnBlocked}). Direct field assignment is
   * still available for tests.
   */
  setProtection(channel: "overpower" | "period", armed: boolean): void {
    const prev = this.protection[channel];
    this.protection[channel] = armed;
    if (armed !== prev) {
      const pProt = powerFraction(this.state.nodes);
      this.log.info(
        this.state.time,
        "PROTECTION",
        `${channel === "overpower" ? "AZM (overpower)" : "AZS (period)"} protection ${armed ? "armed" : "blocked"}`,
        {
          channel,
          armed,
          power: Number(pProt.toExponential(4)),
          orm: Number(this.ormRods().toFixed(1)),
        },
      );
    }
  }

  /** Engage or disengage the automatic regulator. Logs AR_ENABLED on change. */
  setArEnabled(enabled: boolean): void {
    if (enabled === this.arEnabled) return;
    const prev = this.arEnabled;
    this.arEnabled = enabled;
    const pAr = powerFraction(this.state.nodes);
    this.log.info(
      this.state.time,
      "AR_ENABLED",
      `automatic regulator ${enabled ? "engaged" : "disengaged"} (was ${prev ? "engaged" : "disengaged"})`,
      { enabled, power: Number(pAr.toExponential(4)), orm: Number(this.ormRods().toFixed(1)), arMode: this.arMode, arSetpoint: this.arSetpoint },
    );
  }

  /** Set power setpoint [fraction of rated]. Logs AR_SETPOINT on change. */
  setArSetpoint(sp: number): void {
    const clamped = Math.min(1, Math.max(0, requireFiniteNumber(sp, "setpoint")));
    if (Math.abs(clamped - this.arSetpoint) < 1e-9) return;
    const prev = this.arSetpoint;
    this.arSetpoint = clamped;
    const pSp = powerFraction(this.state.nodes);
    this.log.info(
      this.state.time,
      "AR_SETPOINT",
      `setpoint changed from ${(prev * 100).toFixed(1)}% to ${(clamped * 100).toFixed(1)}%`,
      { setpoint: clamped, prevSetpoint: prev, power: Number(pSp.toExponential(4)), orm: Number(this.ormRods().toFixed(1)) },
    );
  }

  /** Set AR gradient [fraction/s]. Logs AR_GRADIENT on change. */
  setArGradient(g: number): void {
    const clamped = Math.min(0.01, Math.max(0, requireFiniteNumber(g, "gradient")));
    if (Math.abs(clamped - this.arGradient) < 1e-12) return;
    const prev = this.arGradient;
    this.arGradient = clamped;
    this.log.info(
      this.state.time,
      "AR_GRADIENT",
      `gradient changed from ${(prev * 1e4).toFixed(1)}e-4 to ${(clamped * 1e4).toFixed(1)}e-4 Δk/k·s`,
      { gradient: clamped, prevGradient: prev },
    );
  }
  private lastBlockedWarnT = -Infinity;
  private lastPeriodBlockWarnT = -Infinity;
  private lastRodAutoWarnT = -Infinity;
  private lastScramHoldT = -Infinity;
  private lastSilBlokT = -Infinity;
  private lastBandWarnT = -Infinity;
  private lastAzCockT = -Infinity;
  private lastArAzBlockT = -Infinity;
  /** Last PRIZMA ORM printout {t, orm}; pre-1986 ORM was NOT live. */
  private lastPrizma = { t: 0, orm: 0 };
  private nextPrizmaT = 0;
  /** Next sim-time for a periodic STATE snapshot. */
  private nextStateT = 0;
  /** Power thresholds for milestone logging (fraction of rated). */
  private static readonly POWER_MILESTONES = [
    1e-4, 3e-4, 1e-3, 3e-3, 0.01, 0.03, 0.05, 0.10, 0.25, 0.50, 0.75,
    1.0, 1.10, 1.20,
  ] as const;
  /** Index into POWER_MILESTONES of the highest threshold already logged. */
  private lastPowerBin = -1;

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
    const requestedPower = requireUnitInterval(fraction, "fraction");
    const s = this.state;
    const manual = requireUnitInterval(opts.manualInsertion ?? 0.45, "manualInsertion");
    const auto = requireUnitInterval(opts.autoInsertion ?? 0.5, "autoInsertion");
    // USP absorbers ride partway in from the bottom to trim the axial field.
    const usp = requireUnitInterval(opts.uspInsertion ?? 0.2, "uspInsertion");
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
      // Reclaim AR/LAR ownership so a prior manual override cannot leave
      // "engaged" regulation with an empty bank after re-init.
      if (rod.group === "AR" || rod.group === "LAR") {
        rod.autoControlled = true;
      }
    }

    // Chopped cosine with extrapolation length, normalized to `requestedPower`.
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
      node.flux = (requestedPower * shape[k]!) / avg;
      const eq = equilibriumIodineXenon(node.flux);
      node.iodine = eq.iodine;
      node.xenon = eq.xenon;
    }
    equilibriumPrecursors(s.nodes);
    s.decayHeat.groups = equilibriumDecayHeat(requestedPower * P_RATED);
    this.refreshDecayShape(1);
    // Clean plant defaults: full flow, protections armed (UI may have blocked).
    s.flowFraction = 1;
    this.lastPowerBin = -1;
    this.protection.overpower = true;
    this.protection.period = true;
    equilibriumThermal(s.nodes, this.nodePowers(), s.flowFraction);
    s.scrammed = false;
    // Re-enable AR before the settle loop so cold-start → start-at-power is
    // regulated (initShutdown leaves arEnabled = false). Reset mode so a
    // prior ARM session cannot leave full-power outside the ARM band.
    this.arEnabled = true;
    this.arMode = "AR";
    this.arSetpoint = requestedPower;
    this.arSetpointActive = requestedPower;
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
        Math.abs(powerFraction(s.nodes) - requestedPower) < 0.002 &&
        Math.abs(this.smoothedRate) < 2e-4
      ) {
        break;
      }
    }
    this.calibrateCritical();
    this.tick(8);
    this.initializing = false;
    this.smoothedRate = 0;
    this.resetIpk();
    s.time = 0;
    this.resetAlarmState();
    this.nextPrizmaT = 0;
    this.lastPrizma = { t: 0, orm: this.ormRods() };
    const pInit = powerFraction(s.nodes);
    this.lastPowerBin = -1;
    while (
      this.lastPowerBin + 1 < Reactor.POWER_MILESTONES.length &&
      pInit >= Reactor.POWER_MILESTONES[this.lastPowerBin + 1]!
    ) {
      this.lastPowerBin++;
    }
    this.log.info(s.time, "INIT", `initialized at ${Math.round(requestedPower * 100)}% power`, {
      rhoBase: s.rhoBase,
      power: Number(pInit.toExponential(4)),
      orm: Number(this.ormRods().toFixed(1)),
      arMode: this.arMode,
      arSetpoint: this.arSetpoint,
      autoInsertion: auto,
      manualInsertion: manual,
      rodCount: s.rods.length,
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
    this.resetIpk();
    s.time = 0;
    this.resetAlarmState();
    this.nextPrizmaT = 0;
    this.lastPrizma = { t: 0, orm: this.ormRods() };
    const pShutdown = powerFraction(s.nodes);
    this.log.info(
      s.time,
      "INIT",
      "shutdown hot standby: all rods in (211/211), fresh core, source-level flux",
      {
        fluxRel: Number(pShutdown.toExponential(2)),
        power: Number(pShutdown.toExponential(4)),
        orm: Number(this.ormRods().toFixed(1)),
        flowFraction: s.flowFraction,
        arEnabled: this.arEnabled,
      },
    );
  }

  /** Clear latched period alarm, re-arm all alarm cooldowns, reset power milestone tracker. */
  private resetAlarmState(): void {
    this.lastSilBlokT = -Infinity;
    this.lastBandWarnT = -Infinity;
    this.lastAzCockT = -Infinity;
    this.lastArAzBlockT = -Infinity;
    this.lastBlockedWarnT = -Infinity;
    this.lastPeriodBlockWarnT = -Infinity;
    this.lastRodAutoWarnT = -Infinity;
    this.lastScramHoldT = -Infinity;
    this.lastPeriodAlarmT = -Infinity;
    this.lastArNoAuthT = -Infinity;
    this.periodAlarmLatched = false;
    this.lastPowerBin = -1;
    this.nextStateT = 0;
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
        photoneutrons: [...n.photoneutrons],
      }));
      // Include rhoExtra so a boron/perturbation hook stays critical after
      // calibration (substep applies the same terms).
      const rho = rodRho.map(
        (r, k) => rhoBase + s.rhoExtra + r + frozenFeedback[k]!,
      );
      const steps = 400;
      const dt = 0.005;
      // Renormalize every step and accumulate log growth so strongly
      // supercritical trials cannot overflow to Infinity.
      let logGrowth = 0;
      for (let i = 0; i < steps; i++) {
        stepKinetics(trial, rho, dt, this.kineticsWorkspace);
        const p = powerFraction(trial);
        if (!(p > 0) || !Number.isFinite(p)) return 1e3;
        if (i >= steps / 2) logGrowth += Math.log(p);
        const inv = 1 / p;
        for (const node of trial) {
          node.flux *= inv;
          for (let g = 0; g < node.precursors.length; g++)
            node.precursors[g]! *= inv;
          for (let g = 0; g < node.photoneutrons.length; g++)
            node.photoneutrons[g]! *= inv;
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
  }

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  /** Rule 3.1.7: positive-reactivity drives wait until AZ is cocked. */
  private azBankCocked(): boolean {
    for (const rod of this.state.rods) {
      if (rod.group === "AZ" && rod.insertion > 0.05) return false;
    }
    return true;
  }

  /**
   * Command a rod group, AR subgroup ("AR1".."AR3"), single rod id, or every
   * rod to a target insertion 0..1. Manual commands to a rod owned by the
   * engaged automatic regulator are refused (switch its group to manual
   * first), like the real machine.
   */
  setRodTarget(selector: RodSelector, target: number): void {
    const t = Math.min(1, Math.max(0, target));
    for (const rod of this.rodsFor(selector)) {
      // Scram latch: refuse withdrawals while scrammed (drives stay in).
      if (this.state.scrammed && t < rod.insertion) {
        if (this.state.time - this.lastScramHoldT > 5) {
          this.lastScramHoldT = this.state.time;
          const pBlock = powerFraction(this.state.nodes);
          this.log.warn(
            this.state.time,
            "SCRAM_HOLD",
            `rod ${rod.id} withdrawal refused while scrammed (target ${t.toFixed(3)} vs insertion ${rod.insertion.toFixed(3)})`,
            {
              selector: String(selector),
              rodId: rod.id,
              target: Number(t.toFixed(4)),
              insertion: rod.insertion,
              power: Number(pBlock.toExponential(4)),
              scrammed: true,
            },
          );
        }
        continue;
      }
      // Refuse operator drive of any regulator-owned rod, whether addressed
      // by numeric id or by group selector ("AR1", "AR", "LAR", "all", ...).
      if (
        rod.autoControlled &&
        this.arEnabled &&
        this.regulatorOwns(rod)
      ) {
        if (this.state.time - this.lastRodAutoWarnT > 5) {
          this.lastRodAutoWarnT = this.state.time;
          const pAuto = powerFraction(this.state.nodes);
          const perAuto = this.period();
          this.log.warn(
            this.state.time,
            "ROD_AUTO",
            `rod ${rod.id} (${rod.group}${rod.arSubgroup ? "-" + rod.arSubgroup : ""}) under automatic control - switch to manual first`,
            {
              rodId: rod.id,
              group: rod.group,
              subgroup: rod.arSubgroup,
              power: Number(pAuto.toExponential(4)),
              period: Number(perAuto.toFixed(1)),
              orm: Number(this.ormRods().toFixed(1)),
              arMode: this.arMode,
              arSetpoint: this.arSetpoint,
              arEnabled: this.arEnabled,
            },
          );
        }
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
            const pBlock2 = powerFraction(this.state.nodes);
            this.log.warn(
              this.state.time,
              "PERIOD_BLOCK",
              `withdrawal of rod ${rod.id} blocked: period ${period.toFixed(1)} s below 60 s (power ${(pBlock2 * 100).toFixed(2)}%)`,
              {
                rodId: rod.id,
                selector: String(selector),
                period: Number(period.toFixed(1)),
                power: Number(pBlock2.toExponential(4)),
                powerPct: Number((pBlock2 * 100).toFixed(2)),
              },
            );
          }
          continue;
        }
      }
      // Rule 3.1.7: no positive reactivity (withdrawal of non-AZ rods) until
      // the AZ bank is cocked (essentially fully withdrawn). AZ rods may
      // still withdraw so the bank can be cocked. Insertions always ok.
      if (
        t < rod.insertion &&
        rod.group !== "AZ" &&
        !this.initializing &&
        !this.azBankCocked()
      ) {
        if (this.state.time - this.lastAzCockT > 5) {
          this.lastAzCockT = this.state.time;
          const pAz = powerFraction(this.state.nodes);
          this.log.warn(
            this.state.time,
            "AZ_COCK",
            `withdrawal of rod ${rod.id} refused: AZ bank not cocked (Rule 3.1.7)`,
            {
              rodId: rod.id,
              group: rod.group,
              selector: String(selector),
              power: Number(pAz.toExponential(4)),
              period: Number(this.period().toFixed(1)),
              orm: Number(this.ormRods().toFixed(1)),
            },
          );
        }
        continue;
      }
      rod.target = t;
    }
    // ROD_CMD: one log per batch command with summary of affected rods.
    if (!this.initializing) {
      const affected = this.rodsFor(selector).filter(
        (r) => Math.abs(r.target - r.insertion) > 1e-9,
      );
      if (affected.length > 0) {
        const cmdPower = powerFraction(this.state.nodes);
        const cmdPeriod = this.period();
        const delta =
          affected.reduce((sum, rod) => sum + (t - rod.insertion), 0) /
          affected.length;
        this.log.info(
          this.state.time,
          "ROD_CMD",
          `${selector}: ${affected.length} rod(s) commanded to ${t.toFixed(3)} (mean delta ${(delta * 100).toFixed(1)}% insertion)`,
          {
            selector: String(selector),
            target: Number(t.toFixed(4)),
            count: affected.length,
            meanDelta: Number(delta.toFixed(4)),
            power: Number(cmdPower.toExponential(4)),
            period: Number(cmdPeriod.toFixed(1)),
            orm: Number(this.ormRods().toFixed(1)),
          },
        );
      }
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
      const pArOv = powerFraction(this.state.nodes);
      const groups: string[] = [];
      for (const id of affected) {
        const group = this.state.rods[id]!.group;
        if (!groups.includes(group)) groups.push(group);
      }
      const groupLabel =
        groups.length === 1
          ? `${groups[0]} rods`
          : `automatic regulator rods (${groups.join("/")})`;
      const insertions = affected.map((id) => this.state.rods[id]!.insertion);
      const meanIns = insertions.reduce((a, b) => a + b, 0) / insertions.length;
      this.log.info(
        this.state.time,
        "AR_OVERRIDE",
        auto
          ? `rods returned to automatic control (${affected.length})`
          : `manual override of ${affected.length} ${groupLabel}`,
        {
          ids: affected,
          count: affected.length,
          groups,
          auto,
          insertions: insertions.map((v) => Number(v.toFixed(4))),
          meanInsertion: Number(meanIns.toFixed(4)),
          power: Number(pArOv.toExponential(4)),
          arMode: this.arMode,
          arSetpoint: this.arSetpoint,
          orm: Number(this.ormRods().toFixed(1)),
        },
      );
    }
  }
  /** True if the engaged regulator currently drives this rod. */
  regulatorOwns(rod: RodState): boolean {
    if (!rod.autoControlled) return false;
    if (this.arMode === "LAR") return rod.group === "LAR";
    // ARM and AR both drive the active AR subgroup.
    return rod.group === "AR" && rod.arSubgroup === this.arActiveGroup;
  }
  
  setArMode(mode: "ARM" | "AR" | "LAR"): void {
    const prevMode = this.arMode;
    this.arMode = mode;
    let bankSum = 0;
    let bankCount = 0;
    for (const rod of this.state.rods) {
      if (this.regulatorOwns(rod)) {
        bankSum += rod.insertion;
        bankCount += 1;
      }
    }
    this.arTarget = bankCount > 0 ? bankSum / bankCount : 0;
    this.arErrPrev = 0;
    if (mode !== prevMode) {
      const pMode = powerFraction(this.state.nodes);
      this.log.info(
        this.state.time,
        "AR_MODE",
        `regulator mode switched from ${prevMode} to ${mode}`,
        {
          from: prevMode,
          to: mode,
          power: Number(pMode.toExponential(4)),
          orm: Number(this.ormRods().toFixed(1)),
          arSetpoint: this.arSetpoint,
          arTarget: Number(this.arTarget.toFixed(4)),
        },
      );
    }
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
    const prePower = this.powerFraction();
    const prePeriod = this.period();
    const preOrm = this.ormRods();
    const tipDelta = this.scramTipDelta();
    this.state.scrammed = true;
    for (const rod of this.state.rods) {
      if (rod.group !== "USP") rod.target = 1;
    }
    let uspSum = 0;
    let uspCount = 0;
    for (const r of this.state.rods) {
      if (r.group === "USP") {
        uspSum += r.insertion;
        uspCount += 1;
      }
    }
    const uspMean = uspCount > 0 ? uspSum / uspCount : 0;
    this.log.alarm(
      this.state.time,
      "AZ5",
      `SCRAM triggered by ${reason} — power ${(prePower * 100).toFixed(1)}%, period ${prePeriod.toFixed(1)} s`,
      {
        reason,
        prePower: Number(prePower.toExponential(4)),
        prePeriod: Number(prePeriod.toFixed(1)),
        preOrm: Number(preOrm.toFixed(1)),
        uspMeanInsertion: Number(uspMean.toFixed(4)),
        arSetpoint: this.arSetpoint,
        arMode: this.arMode,
        tipDeltaBeta: Number((tipDelta / BETA_EFF).toFixed(4)),
        tipEffect: tipDelta > 0 ? "positive" : tipDelta < 0 ? "negative" : "none",
        flowFraction: this.state.flowFraction,
      },
    );
  }
  /**
   * Reactivity from the first internal AZ-5 drive increment. This is a
   * diagnostic snapshot only: the actual transient still comes from normal
   * rod geometry and kinetics on the following substep.
   */
  private scramTipDelta(): number {
    const before = rodReactivityByNode(this.state.rods, this.rodRhoScratch);
    const oldInsertion = new Array<number>(this.state.rods.length);
    const step = (ROD_SPEED * DT_INTERNAL) / CORE_HEIGHT;
    for (const rod of this.state.rods) {
      oldInsertion[rod.id] = rod.insertion;
      if (rod.group !== "USP" && rod.insertion < 1) {
        rod.insertion = Math.min(1, rod.insertion + step);
      }
    }
    const after = rodReactivityByNode(this.state.rods, this.feedbackScratch);
    for (let k = 0; k < N_AXIAL; k++) {
      this.feedbackScratch[k] = after[k]! - before[k]!;
    }
    const delta = globalReactivity(this.state.nodes, this.feedbackScratch);
    for (const rod of this.state.rods) {
      rod.insertion = oldInsertion[rod.id]!;
    }
    return delta;
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
    const prevSetpoint = this.arSetpoint;
    this.arSetpoint = Math.min(this.arSetpoint, 0.5);
    this.arSetpointActive = Math.min(this.arSetpointActive, 0.5);
    this.log.alarm(
      this.state.time,
      "AZ1",
      `AZ-1 setback: emergency bank driving in, setpoint reduced to 50% (was ${(prevSetpoint * 100).toFixed(1)}%)`,
      {
        prevSetpoint: Number(prevSetpoint.toFixed(4)),
        power: Number(powerFraction(this.state.nodes).toExponential(4)),
        period: Number(this.period().toFixed(1)),
        orm: Number(this.ormRods().toFixed(1)),
        arMode: this.arMode,
      },
    );
  }
  /** Reset the scram latch (rods stay where they are; re-enables AR). */
  resetScram(): void {
    if (!this.state.scrammed) return;
    this.state.scrammed = false;
    for (const rod of this.state.rods) rod.target = rod.insertion;
    const p = Math.min(1, Math.max(0, this.powerFraction()));
    const [lo] = this.regulatorBand();
    if (p < lo) {
      this.arSetpoint = 0;
      this.arSetpointActive = 0;
    } else {
      this.arSetpoint = p;
      this.arSetpointActive = p;
    }
    let bankSum = 0;
    let bankCount = 0;
    for (const rod of this.state.rods) {
      if (this.regulatorOwns(rod)) {
        bankSum += rod.insertion;
        bankCount += 1;
      }
    }
    this.arTarget = bankCount > 0 ? bankSum / bankCount : 0;
    this.arErrPrev = 0;
    this.arSaturatedFor = 0;
    this.log.info(
      this.state.time,
      "AZ5_RESET",
      `scram latch reset — power ${(p * 100).toFixed(1)}%, ${bankCount} rods in AR bank`,
      {
        power: Number(p.toExponential(4)),
        orm: Number(this.ormRods().toFixed(1)),
        arSetpoint: this.arSetpoint,
        arTarget: Number(this.arTarget.toFixed(4)),
        arMode: this.arMode,
        rodsInBank: bankCount,
      },
    );
  }

  /**
   * Operating reactivity margin in equivalent rods: RR+AR+LAR insertion
   * Σ(insertion). Matches the plant sense of “equivalent rods remaining in
   * the core” (WNA / INSAG-7): low when the bank is withdrawn (accident-night
   * regime), high when deep in. AZ/USP excluded — AZ is normally cocked out;
   * USP is a short bottom bank. Not a flux-weighted PRIZMA reconstruction.
   */
  ormRods(): number {
    return this.state.rods.reduce((a, r) => {
      if (r.group !== "RR" && r.group !== "AR" && r.group !== "LAR") return a;
      return a + r.insertion;
    }, 0);
  }

  setFlowFraction(fraction: number): void {
    const prev = this.state.flowFraction;
    const clamped = Math.min(
      1.2,
      Math.max(0, requireFiniteNumber(fraction, "flowFraction")),
    );
    this.state.flowFraction = clamped;
    const pFlow = powerFraction(this.state.nodes);
    const meanVoid =
      this.state.nodes.reduce((a, n) => a + n.voidFrac, 0) /
      this.state.nodes.length;
    this.log.info(
      this.state.time,
      "FLOW",
      `pump flow set to ${Math.round(clamped * 100)}% (was ${Math.round(prev * 100)}%)`,
      {
        flowFraction: clamped,
        previousFlow: Number(prev.toFixed(4)),
        power: Number(pFlow.toExponential(4)),
        meanVoid: Number(meanVoid.toExponential(4)),
        orm: Number(this.ormRods().toFixed(1)),
      },
    );
  }

  /**
   * Extra uniform reactivity [absolute Δk/k] for experiments (boron, fresh
   * fuel, prescribed perturbations). Included in both substep and
   * {@link calibrateCritical}. Does not log; call calibrateCritical after a
   * step change if you want the core re-critical at the new value.
   */
  setRhoExtra(rho: number): void {
    const value = requireFiniteNumber(rho, "rhoExtra");
    const prev = this.state.rhoExtra;
    this.state.rhoExtra = value;
    if (Math.abs(value - prev) > 1e-12) {
      this.log.info(
        this.state.time,
        "RHO_EXTRA",
        `extra reactivity set to ${(value * 1e5).toFixed(1)}e-5 Δk/k (was ${(prev * 1e5).toFixed(1)}e-5)`,
        {
          rhoExtra: value,
          previousRhoExtra: prev,
          power: Number(powerFraction(this.state.nodes).toExponential(4)),
          orm: Number(this.ormRods().toFixed(1)),
        },
      );
    }
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
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new RangeError("dt must be finite and greater than zero");
    }
    if (!Number.isFinite(maxStep) || maxStep <= 0) {
      throw new RangeError("maxStep must be finite and greater than zero");
    }
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
    // modes warn when the plant is outside their band (low or high). Idle
    // regulator (no setpoint dialed in) has nothing to enforce. Skipped
    // during init settle so the wobble does not spam AR_BAND / LAR_DROPOUT.
    if (
      this.arEnabled &&
      !s.scrammed &&
      this.arSetpoint > 0 &&
      !this.initializing
    ) {
      const [lo, hi] = this.regulatorBand();
      if (pBefore < lo * 0.9) {
        if (this.arMode === "LAR") {
          // Automatic changeover to the standby regulator on side chambers
          // (the design behavior; the 00:28 accident-night power collapse
          // was this changeover FAILING, not being absent).
          this.arMode = "AR";
          let arBankSum = 0;
          let arBankCount = 0;
          for (const r of s.rods) {
            if (r.group === "AR" && r.arSubgroup === this.arActiveGroup) {
              arBankSum += r.insertion;
              arBankCount += 1;
            }
          }
          this.arTarget = arBankCount > 0 ? arBankSum / arBankCount : 0;
          this.arErrPrev = 0;
          this.log.alarm(
            s.time,
            "LAR_DROPOUT",
            `LAR dropped out at ${(pBefore * 100).toFixed(1)}% power — changeover to AR on side chambers`,
            {
              power: Number(pBefore.toExponential(4)),
              orm: Number(this.ormRods().toFixed(1)),
              arSetpoint: this.arSetpoint,
              arTarget: Number(this.arTarget.toFixed(4)),
            },
          );
        } else if (s.time - this.lastBandWarnT > ALARM_COOLDOWN) {
          this.lastBandWarnT = s.time;
          const [bandLo, bandHi] = this.regulatorBand();
          this.log.warn(
            s.time,
            "AR_BAND",
            `power ${(pBefore * 100).toFixed(1)}% below ${this.arMode} band [${(bandLo * 100).toFixed(1)}-${(bandHi * 100).toFixed(1)}%] — switch to a lower-range regulator`,
            {
              power: Number(pBefore.toExponential(4)),
              bandLo: bandLo,
              bandHi: bandHi,
              arMode: this.arMode,
              arSetpoint: this.arSetpoint,
              orm: Number(this.ormRods().toFixed(1)),
            },
          );
        }
      } else if (pBefore > hi * 1.05) {
        if (s.time - this.lastBandWarnT > ALARM_COOLDOWN) {
          this.lastBandWarnT = s.time;
          const [bandLo2, bandHi2] = this.regulatorBand();
          this.log.warn(
            s.time,
            "AR_BAND",
            `power ${(pBefore * 100).toFixed(1)}% above ${this.arMode} band [${(bandLo2 * 100).toFixed(1)}-${(bandHi2 * 100).toFixed(1)}%] — switch to a higher-range regulator`,
            {
              power: Number(pBefore.toExponential(4)),
              bandLo: bandLo2,
              bandHi: bandHi2,
              arMode: this.arMode,
              arSetpoint: this.arSetpoint,
              orm: Number(this.ormRods().toFixed(1)),
            },
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
      const azCocked = this.azBankCocked();
      let arWithdrawalBlocked = false;
      for (const rod of s.rods) {
        if (!this.regulatorOwns(rod)) continue;
        if (!azCocked && this.arTarget < rod.insertion - 1e-9) {
          // Automatic regulation may add negative reactivity while AZ is
          // inserted, but it cannot withdraw a rod and add positive
          // reactivity before the protection bank is cocked.
          rod.target = rod.insertion;
          arWithdrawalBlocked = true;
        } else {
          rod.target = this.arTarget;
        }
      }
      if (
        arWithdrawalBlocked &&
        s.time - this.lastArAzBlockT > 5
      ) {
        this.lastArAzBlockT = s.time;
        this.log.warn(
          s.time,
          "AR_AZ_BLOCK",
          "automatic regulator withdrawal blocked: AZ bank not cocked",
          {
            power: Number(pBefore.toExponential(4)),
            period: Number(this.period().toFixed(1)),
            arMode: this.arMode,
            arTarget: Number(this.arTarget.toFixed(4)),
            azInsertion: Number(
              s.rods.reduce(
                (max, rod) =>
                  rod.group === "AZ" ? Math.max(max, rod.insertion) : max,
                0,
              ).toFixed(4),
            ),
          },
        );
      }
      // Automatic changeover: a regulating bank that has held an end stop
      // for five seconds hands off to a standby bank. LAR is the primary
      // in-core bank at power; when its absorber is fully in (or fully out)
      // the side-chamber AR bank must take over instead of leaving the
      // regulator inert. AR/ARM retain the three-subgroup changeover ladder.
      if (this.arMode === "LAR") {
        const larInsertion = this.arInsertion();
        // The reported failure is the high-power case: LAR is fully in but
        // power is still above setpoint. Low-power dropout remains governed by
        // the detector-band handoff above.
        const atEndStop =
          this.arTarget >= 1 &&
          larInsertion >= 0.995 &&
          // Do not confuse a falling low-power run with the requested
          // high-power handoff: the LAR detector-band dropout above owns
          // that direction.
          this.smoothedRate > 0;
        if (atEndStop) {
          this.arSaturatedFor += dt;
          if (this.arSaturatedFor > 5) {
            const pLar = powerFraction(s.nodes);
            const larTarget = this.arTarget;
            this.arMode = "AR";
            let arBankSum = 0;
            let arBankCount = 0;
            for (const rod of s.rods) {
              if (rod.group === "AR" && rod.arSubgroup === this.arActiveGroup) {
                arBankSum += rod.insertion;
                arBankCount += 1;
              }
            }
            this.arTarget = arBankCount > 0 ? arBankSum / arBankCount : 0;
            this.arErrPrev = 0;
            if (!this.initializing) {
              this.log.warn(
                s.time,
                "AR_CHANGEOVER",
                `LAR out of authority - changeover to AR-${this.arActiveGroup}`,
                {
                  fromMode: "LAR",
                  toMode: "AR",
                  toGroup: this.arActiveGroup,
                  power: Number(pLar.toExponential(4)),
                  period: Number(this.period().toFixed(1)),
                  orm: Number(this.ormRods().toFixed(1)),
                  larTarget: Number(larTarget.toFixed(4)),
                  arTarget: Number(this.arTarget.toFixed(4)),
                  arSetpoint: this.arSetpoint,
                },
              );
            }
            this.arSaturatedFor = 0;
          }
        } else {
          this.arSaturatedFor = 0;
        }
      } else {
        if (this.arTarget <= 0 || this.arTarget >= 1) {
          this.arSaturatedFor += dt;
          if (this.arSaturatedFor > 5) {
            const needWithdraw = this.arTarget <= 0;
            let nextWithAuth: 1 | 2 | 3 | null = null;
            for (let step = 1; step <= 2; step++) {
              const cand = ((((this.arActiveGroup - 1 + step) % 3) + 1) as
                | 1
                | 2
                | 3);
              let bankSum = 0;
              let bankCount = 0;
              for (const r of s.rods) {
                if (r.group === "AR" && r.arSubgroup === cand) {
                  bankSum += r.insertion;
                  bankCount += 1;
                }
              }
              const mean = bankCount > 0 ? bankSum / bankCount : 0;
              // Withdraw authority = room to go further out; insert = room in.
              if (needWithdraw ? mean > 0.05 : mean < 0.95) {
                nextWithAuth = cand;
                break;
              }
            }
            if (nextWithAuth !== null) {
              if (!this.initializing) {
                this.log.warn(
                  s.time,
                  "AR_CHANGEOVER",
                  `AR-${this.arActiveGroup} out of authority - changeover to AR-${nextWithAuth}`,
                  {
                    fromGroup: this.arActiveGroup,
                    toGroup: nextWithAuth,
                    power: Number(pBefore.toExponential(4)),
                    period: Number(this.period().toFixed(1)),
                    orm: Number(this.ormRods().toFixed(1)),
                    arTarget: Number(this.arTarget.toFixed(4)),
                    arSetpoint: this.arSetpoint,
                    arMode: this.arMode,
                  },
                );
              }
              this.arActiveGroup = nextWithAuth;
              let nextArSum = 0;
              let nextArCount = 0;
              for (const r of s.rods) {
                if (r.group === "AR" && r.arSubgroup === nextWithAuth) {
                  nextArSum += r.insertion;
                  nextArCount += 1;
                }
              }
              this.arTarget = nextArCount > 0 ? nextArSum / nextArCount : 0;
            } else if (s.time - this.lastArNoAuthT > ALARM_COOLDOWN) {
              this.lastArNoAuthT = s.time;
              const perNoAuth = this.period();
              if (!this.initializing) {
                this.log.warn(
                  s.time,
                  "AR_NO_AUTH",
                  `AR out of authority — all subgroups saturated. Power ${(pBefore * 100).toFixed(1)}%, release with manual rods`,
                  {
                    power: Number(pBefore.toExponential(4)),
                    period: Number(perNoAuth.toFixed(1)),
                    orm: Number(this.ormRods().toFixed(1)),
                    arTarget: Number(this.arTarget.toFixed(4)),
                    arSetpoint: this.arSetpoint,
                    activeGroup: this.arActiveGroup,
                  },
                );
              }
            }
            this.arSaturatedFor = 0;
          }
        } else {
          this.arSaturatedFor = 0;
        }
      }
    }

    // "Silovaya blokirovka": if 8 or more non-regulator rods are being
    // withdrawn simultaneously, the power interlock halts those operator
    // withdrawals and annunciates (AZ excluded; regulator-owned rods are
    // not frozen so LAR/AR can still trim).
    if (!this.initializing) {
      let withdrawingCount = 0;
      for (const rod of s.rods) {
        if (
          rod.group !== "AZ" &&
          rod.target < rod.insertion - 1e-6 &&
          !this.regulatorOwns(rod)
        ) {
          withdrawingCount += 1;
        }
      }
      if (withdrawingCount >= 8) {
        const withdrawing: number[] = [];
        for (const rod of s.rods) {
          if (
            rod.group !== "AZ" &&
            rod.target < rod.insertion - 1e-6 &&
            !this.regulatorOwns(rod)
          ) {
            rod.target = rod.insertion;
            withdrawing.push(rod.id);
          }
        }
        if (s.time - this.lastSilBlokT > ALARM_COOLDOWN) {
          this.lastSilBlokT = s.time;
          const pSil = powerFraction(s.nodes);
          this.log.alarm(
            s.time,
            "SIL_BLOK",
            `power interlock: ${withdrawingCount} rods withdrawing - all operator withdrawals halted`,
            {
              withdrawingCount,
              withdrawingIds: withdrawing,
              power: Number(pSil.toExponential(4)),
              period: Number(this.period().toFixed(1)),
              orm: Number(this.ormRods().toFixed(1)),
              protectionPeriod: this.protection.period,
              protectionOverpower: this.protection.overpower,
            },
          );
        }
      }
    }

    // Continuous startup-range period block: freeze any rod still commanded
    // out while period is short (setRodTarget alone is not enough once a
    // target is already latched).
    if (!this.initializing && pBefore < 0.05) {
      const period = this.period();
      if (period > 0 && period < 60) {
        let blocked = false;
        for (const rod of s.rods) {
          if (rod.target < rod.insertion) {
            rod.target = rod.insertion;
            blocked = true;
          }
        }
        if (blocked && s.time - this.lastPeriodBlockWarnT > 10) {
          this.lastPeriodBlockWarnT = s.time;
          const pPer = powerFraction(s.nodes);
          this.log.warn(
            s.time,
            "PERIOD_BLOCK",
            "withdrawal blocked: period below 60 s - wait for it to recover",
            {
              power: Number(pPer.toExponential(4)),
              period: Number(period.toFixed(1)),
              protectionPeriod: this.protection.period,
              protectionOverpower: this.protection.overpower,
            },
          );
        }
      }
    }

    // Scram latch holds drives in: re-assert full insertion for non-USP rods
    // every substep so nothing can walk them out while the latch is set.
    if (s.scrammed) {
      for (const rod of s.rods) {
        if (rod.group !== "USP") rod.target = 1;
      }
    }

    stepRodDrives(s.rods, dt);

    const rodRho = rodReactivityByNode(s.rods, this.rodRhoScratch);
    const feedback = this.feedbackRhoByNode(this.feedbackScratch);
    const rhoByNode = this.rhoScratch;
    for (let k = 0; k < N_AXIAL; k++) {
      rhoByNode[k] = s.rhoBase + s.rhoExtra + rodRho[k]! + feedback[k]!;
    }

    // Subdivide kinetics when any node is strongly prompt-supercritical so
    // a large maxStep (e.g. 0.1 s fast-forward) cannot pole the implicit
    // Thomas solve. Cap dt_kin * max_k((rho_k - beta)/L) ≲ 0.5.
    let maxPromptRate = 0;
    for (let k = 0; k < N_AXIAL; k++) {
      const rate = (rhoByNode[k]! - BETA_EFF) / GEN_TIME;
      if (rate > maxPromptRate) maxPromptRate = rate;
    }
    const maxKinDt =
      maxPromptRate > 1e-9 ? Math.min(dt, 0.5 / maxPromptRate) : dt;
    let kinLeft = dt;
    while (kinLeft > 1e-12) {
      const kdt = Math.min(maxKinDt, kinLeft);
      stepKinetics(s.nodes, rhoByNode, kdt, this.kineticsWorkspace);
      kinLeft -= kdt;
    }

    const fissionPower = powerFraction(s.nodes) * P_RATED;
    for (const node of s.nodes) {
      const ix = stepIodineXenon(node.iodine, node.xenon, node.flux, dt);
      node.iodine = ix.iodine;
      node.xenon = ix.xenon;
    }
    stepDecayHeat(
      s.decayHeat.groups,
      fissionPower,
      dt,
      s.decayHeat.groups,
    );
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

    // Reactimeter (inverse point kinetics): advance the instrument's own
    // precursor/photoneutron trackers from measured power, then solve
    //   rho = beta + L*(dn/dt)/n - (L/n)(sum lambda*c + S).
    // Uses the same stepPrecursor formula as the core kinetics.
    const n = Math.max(pAfter, 1e-12);
    let delayed = 0;
    for (let i = 0; i < 6; i++) {
      const lam = DELAYED_LAMBDA[i]!;
      this.ipkC[i] = stepPrecursor(
        this.ipkC[i]!,
        DELAYED_BETA[i]!,
        lam,
        n,
        dt,
      );
      delayed += lam * this.ipkC[i]!;
    }
    for (let i = 0; i < PHOTO_BETA.length; i++) {
      const lam = PHOTO_LAMBDA[i]!;
      this.ipkPhoto[i] = stepPrecursor(
        this.ipkPhoto[i]!,
        PHOTO_BETA[i]!,
        lam,
        n,
        dt,
      );
      delayed += lam * this.ipkPhoto[i]!;
    }
    this.lastRhoIpk =
      BETA_EFF +
      GEN_TIME * this.smoothedRate -
      (GEN_TIME / n) * (delayed + NEUTRON_SOURCE);

    // Power milestone logging: record when thermal power crosses a new
    // higher threshold (upward direction only; reset on re-init).
    if (!this.initializing) {
      const milestones = Reactor.POWER_MILESTONES;
      let newBin = this.lastPowerBin;
      while (newBin < milestones.length - 1 && pAfter >= milestones[newBin + 1]!) {
        newBin++;
      }
      if (newBin > this.lastPowerBin) {
        const perMil = this.period();
        const ormMil = this.ormRods();
        for (let b = this.lastPowerBin + 1; b <= newBin; b++) {
          this.log.info(
            s.time,
            "POWER",
            `power reached ${(milestones[b]! * 100).toFixed(3)}% of rated`,
            {
              milestone: milestones[b],
              power: Number(pAfter.toExponential(4)),
              period: Number(perMil.toFixed(1)),
              orm: Number(ormMil.toFixed(1)),
            },
          );
        }
        this.lastPowerBin = newBin;
      }
    }
    // Periodic STATE snapshot: full plant state for diagnostic narrative.
    if (!this.initializing && s.time >= this.nextStateT) {
      this.nextStateT = s.time + STATE_INTERVAL;
      const perSt = this.period();
      const ormSt = this.ormRods();
      let voidSum = 0;
      let xeSum = 0;
      let fuelSum = 0;
      let coolantSum = 0;
      for (const n of s.nodes) {
        voidSum += n.voidFrac;
        xeSum += n.xenon;
        fuelSum += n.fuelTemp;
        coolantSum += n.coolantTemp;
      }
      const avgVoid = voidSum / N_AXIAL;
      const avgXe = xeSum / N_AXIAL;
      const avgFuel = fuelSum / N_AXIAL;
      const avgCoolant = coolantSum / N_AXIAL;
      const dhTotal = s.decayHeat.groups.reduce((a, g) => a + g, 0);
      let rrSum = 0;
      let rrCount = 0;
      let arSum = 0;
      let arCount = 0;
      let larSum = 0;
      let larCount = 0;
      let azSum = 0;
      let azCount = 0;
      let uspSum = 0;
      let uspCount = 0;
      for (const rod of s.rods) {
        if (rod.group === "RR") {
          rrSum += rod.insertion;
          rrCount += 1;
        } else if (rod.group === "AR") {
          arSum += rod.insertion;
          arCount += 1;
        } else if (rod.group === "LAR") {
          larSum += rod.insertion;
          larCount += 1;
        } else if (rod.group === "AZ") {
          azSum += rod.insertion;
          azCount += 1;
        } else {
          uspSum += rod.insertion;
          uspCount += 1;
        }
      }
      const rodIns: Record<string, number> = {
        RR: rrCount > 0 ? Number((rrSum / rrCount).toFixed(4)) : 0,
        AR: arCount > 0 ? Number((arSum / arCount).toFixed(4)) : 0,
        LAR: larCount > 0 ? Number((larSum / larCount).toFixed(4)) : 0,
        AZ: azCount > 0 ? Number((azSum / azCount).toFixed(4)) : 0,
        USP: uspCount > 0 ? Number((uspSum / uspCount).toFixed(4)) : 0,
      };
      this.log.info(s.time, "STATE", "periodic plant state snapshot", {
        power: Number(pAfter.toExponential(4)),
        period: Number(perSt.toFixed(1)),
        rho: Number((this.lastRhoIpk / BETA_EFF).toFixed(4)),
        orm: Number(ormSt.toFixed(1)),
        voidAvg: Number(avgVoid.toExponential(4)),
        xenon: Number(avgXe.toExponential(4)),
        fuelTempAvg: Number(avgFuel.toFixed(1)),
        coolantTempAvg: Number(avgCoolant.toFixed(1)),
        decayHeat: Number(dhTotal.toExponential(4)),
        flowFraction: s.flowFraction,
        scrammed: s.scrammed,
        arEnabled: this.arEnabled,
        arMode: this.arMode,
        arActiveGroup: this.arActiveGroup,
        arSetpoint: this.arSetpoint,
        arSetpointActive: Number(this.arSetpointActive.toFixed(4)),
        arTarget: Number(this.arTarget.toFixed(4)),
        rodIns,
        protectionPeriod: this.protection.period,
        protectionOverpower: this.protection.overpower,
      });
    }
    this.checkAlarms(pAfter);
  }

  private checkAlarms(power: number): void {
    if (this.initializing) return;
    const s = this.state;
    const period = this.period();
    // PERIOD warning at 15 s (AZS trip remains 10 s). Latch clears above ~25 s.
    if (period > 0 && period < 15 && power > 0.001) {
      if (
        !this.periodAlarmLatched &&
        s.time - this.lastPeriodAlarmT > ALARM_COOLDOWN
      ) {
        this.periodAlarmLatched = true;
        this.lastPeriodAlarmT = s.time;
        this.log.alarm(
          s.time,
          "PERIOD",
          `reactor period ${period.toFixed(1)} s below 15 s threshold — power ${(power * 100).toFixed(2)}%`,
          {
            period: Number(period.toFixed(1)),
            power: Number(power.toExponential(4)),
            orm: Number(this.ormRods().toFixed(1)),
            arMode: this.arMode,
          },
        );
      }
    } else if (this.periodAlarmLatched && (period < 0 || period > 25)) {
      this.periodAlarmLatched = false;
    }

    // AZS: emergency protection by reactor period.
    // Power floor ~1e-4 (was 0.005) so AZS still covers low-power startups
    // rather than leaving a blind band between source level and 0.5%.
    if (period > 0 && period < 10 && power > 1e-4 && !s.scrammed) {
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
          {
            orm: Number(orm.toFixed(1)),
            power: Number(power.toExponential(4)),
            period: Number(period.toFixed(1)),
          },
        );
      } else {
        this.log.info(
          s.time,
          "PRIZMA",
          `printout: ORM ${orm.toFixed(1)} equivalent rods`,
          {
            orm: Number(orm.toFixed(1)),
            power: Number(power.toExponential(4)),
            period: Number(period.toFixed(1)),
          },
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
    const pBlocked = powerFraction(this.state.nodes);
    this.log.warn(
      this.state.time,
      "RPS_BLOCKED",
      `${what} - BLOCKED by operator`,
      {
        reason: what,
        power: Number(pBlocked.toExponential(4)),
        period: Number(this.period().toFixed(1)),
        orm: Number(this.ormRods().toFixed(1)),
        protectionPeriod: this.protection.period,
        protectionOverpower: this.protection.overpower,
        arMode: this.arMode,
      },
    );
  }

  // -------------------------------------------------------------------------
  // Derived quantities / instruments
  // -------------------------------------------------------------------------

  /** Feedback reactivity per node: void + Doppler + graphite + xenon. */
  private feedbackRhoByNode(
    out = new Array<number>(N_AXIAL),
  ): number[] {
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
  /**
   * Instantaneous flux-weighted core reactivity [beta]. Unlike
   * {@link reactivityBeta}, this is not an inverse-kinetics instrument and is
   * intentionally unsmoothed so rod-drive transients remain visible.
   */
  netReactivityBeta(): number {
    const rodRho = rodReactivityByNode(this.state.rods, this.rodRhoScratch);
    const feedback = this.feedbackRhoByNode(this.feedbackScratch);
    for (let k = 0; k < N_AXIAL; k++) {
      this.rhoScratch[k] =
        this.state.rhoBase +
        this.state.rhoExtra +
        rodRho[k]! +
        feedback[k]!;
    }
    return globalReactivity(this.state.nodes, this.rhoScratch) / BETA_EFF;
  }


  /** Thermal power deposited per node [W], including decay heat. */
  private nodePowers(out = this.nodePowerScratch): number[] {
    const s = this.state;
    const fission = powerFraction(s.nodes) * P_RATED;
    const total = thermalPower(fission, s.decayHeat.groups);
    const promptShare = fission * (1 - DECAY_FRACTION_TOTAL);
    const decayShare = total - promptShare;
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
    let ownedSum = 0;
    let ownedCount = 0;
    for (const rod of this.state.rods) {
      if (this.regulatorOwns(rod)) {
        ownedSum += rod.insertion;
        ownedCount += 1;
      }
    }
    if (ownedCount === 0) return this.arTarget;
    return ownedSum / ownedCount;
  }

  /** Smoothed reactor period [s] (clamped to +-1e6 for display). */
  period(): number {
    const r = this.smoothedRate;
    if (Math.abs(r) < 1e-6) return 1e6;
    return Math.max(-1e6, Math.min(1e6, 1 / r));
  }

  /**
   * Reactimeter reading in units of beta: inverse point kinetics from the
   * measured flux history (the ZRT-A principle). Exact 0 at steady
   * criticality; true negative subcriticality at shutdown (n = S*L/-rho).
   */
  reactivityBeta(): number {
    return this.lastRhoIpk / BETA_EFF;
  }

  /**
   * PRIZMA-style rod worth estimate [beta]: global reactivity change if
   * this rod drove fully out / fully in from its current position, using
   * first-order perturbation weighting on the current flux shape.
   */
  rodWorthBeta(id: number): { toOut: number; toIn: number } | null {
    const rod = this.state.rods[id];
    if (!rod) return null;
    const saved = rod.insertion;
    try {
      const cur = rodReactivityByNode([rod]);
      rod.insertion = 0;
      const out = rodReactivityByNode([rod]);
      rod.insertion = 1;
      const inn = rodReactivityByNode([rod]);
      const weigh = (a: number[], b: number[]) =>
        globalReactivity(
          this.state.nodes,
          a.map((v, k) => v - b[k]!),
        ) / BETA_EFF;
      return { toOut: weigh(out, cur), toIn: weigh(inn, cur) };
    } finally {
      rod.insertion = saved;
    }
  }

  /** Seed the reactimeter's trackers to equilibrium with current power. */
  private resetIpk(): void {
    const n = Math.max(powerFraction(this.state.nodes), 1e-12);
    for (let i = 0; i < 6; i++) {
      this.ipkC[i] = equilibriumPrecursor(
        DELAYED_BETA[i]!,
        DELAYED_LAMBDA[i]!,
        n,
      );
    }
    for (let i = 0; i < PHOTO_BETA.length; i++) {
      this.ipkPhoto[i] = equilibriumPrecursor(
        PHOTO_BETA[i]!,
        PHOTO_LAMBDA[i]!,
        n,
      );
    }
    this.lastRhoIpk = -(GEN_TIME * NEUTRON_SOURCE) / n;
  }

}
