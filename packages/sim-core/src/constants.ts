/**
 * Physical constants for the RBMK-1000 simulation.
 *
 * Values marked PRELIMINARY are textbook/commonly-cited numbers pending
 * verification against primary literature (INSAG-7, IAEA TECDOCs, NUREG).
 * Sources are noted inline; see docs/physics.md for the reconciled set.
 */

// ---------------------------------------------------------------------------
// Point/nodal kinetics
// ---------------------------------------------------------------------------

/**
 * Effective delayed neutron fraction. Fresh U-235 thermal fission gives
 * ~0.0065 (Keepin), but RBMK at equilibrium burnup runs a significant Pu-239
 * inventory (beta_Pu ~ 0.0021), pulling beta_eff down. INSAG-7-era analyses
 * cite ~0.0047-0.0050 for Chernobyl unit 4 at the time of the accident.
 * PRELIMINARY: 0.0050
 */
export const BETA_EFF = 0.005;

/**
 * Six-group delayed neutron data, Keepin thermal U-235 group structure,
 * with fractions rescaled so they sum to BETA_EFF.
 */
const KEEPIN_BETA = [0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273];
const KEEPIN_SUM = KEEPIN_BETA.reduce((a, b) => a + b, 0);
export const DELAYED_BETA: readonly number[] = KEEPIN_BETA.map(
  (b) => (b * BETA_EFF) / KEEPIN_SUM,
);
/** Precursor decay constants [1/s], Keepin thermal U-235. */
export const DELAYED_LAMBDA: readonly number[] = [
  0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01,
];
export const N_DELAYED_GROUPS = 6;

/**
 * Prompt neutron generation time [s]. Graphite-moderated cores have long
 * lifetimes; RBMK commonly cited around 1e-3 s. PRELIMINARY.
 */
export const GEN_TIME = 1.0e-3;

// ---------------------------------------------------------------------------
// Core geometry and operating point (RBMK-1000, Chernobyl unit 4 era)
// ---------------------------------------------------------------------------

/** Active core height [m]. */
export const CORE_HEIGHT = 7.0;
/** Number of axial nodes in the 1D nodal model. */
export const N_AXIAL = 14;
/** Axial node height [m]. */
export const NODE_HEIGHT = CORE_HEIGHT / N_AXIAL;

/** Rated thermal power [W]. */
export const P_RATED = 3200e6;
/** Number of control/protection rods (all groups combined, RBMK-1000). */
export const N_RODS = 211;
/** Number of fuel channels. */
export const N_FUEL_CHANNELS = 1661;

/** Core-average thermal neutron flux at rated power [n/cm^2/s]. PRELIMINARY. */
export const PHI_REF = 5e13;

/**
 * Effective macroscopic fission cross-section [1/cm] of the lattice.
 * Sets the fission-rate scale for the isotope chain; equilibrium xenon
 * REACTIVITY is insensitive to it (it cancels), only number densities scale.
 */
export const SIGMA_F = 0.003;
/** Neutrons per thermal fission of U-235. */
export const NU = 2.43;

// ---------------------------------------------------------------------------
// Iodine / xenon chain (thermal fission of U-235)
// ---------------------------------------------------------------------------

/** Cumulative fission yield of the I-135 chain. */
export const GAMMA_I = 0.0639;
/** Direct fission yield of Xe-135. */
export const GAMMA_XE = 0.00237;
/** I-135 decay constant [1/s] (half-life 6.57 h). */
export const LAMBDA_I = 2.93e-5;
/** Xe-135 decay constant [1/s] (half-life 9.14 h). */
export const LAMBDA_XE = 2.11e-5;
/** Xe-135 thermal absorption cross-section [cm^2] (~2.65e6 barn). */
export const SIGMA_XE = 2.65e-18;

// ---------------------------------------------------------------------------
// Reactivity feedback coefficients
// ---------------------------------------------------------------------------

/**
 * Void coefficient: reactivity per unit void fraction (0..1) applied
 * node-locally. Full voiding of the core at the accident configuration is
 * cited around +4 to +5 beta (~ +0.020 to +0.025). PRELIMINARY: +0.022.
 */
export const VOID_COEFF = 0.020;

/** Fuel (Doppler) temperature coefficient [1/K]. Negative. PRELIMINARY. */
export const FUEL_TEMP_COEFF = -1.5e-5;

/** Graphite temperature coefficient [1/K]. Positive, slow. PRELIMINARY. */
export const GRAPHITE_TEMP_COEFF = 6.0e-6;

// ---------------------------------------------------------------------------
// Control rods (pre-1986 modernization design, manual rod geometry)
// ---------------------------------------------------------------------------

/** Rod drive speed [m/s] (AZ-5 emergency insertion, pre-1986). */
export const ROD_SPEED = 0.4;
/** Graphite displacer length [m]. */
export const DISPLACER_LENGTH = 4.5;
/** Water column above/below displacer with rod fully withdrawn [m]. */
export const WATER_GAP = 1.25;
/**
 * Absorber worth density per rod [reactivity / m of absorber in core,
 * before flux-shape weighting]. Chosen so a full scram of all 211 rods
 * from an operating configuration is worth several percent negative.
 * PRELIMINARY, tuned in tests.
 */
export const ROD_ABS_WORTH_PER_M = 5.2e-4;
/**
 * Graphite displacer worth density per rod [reactivity / m]: positive,
 * because graphite displaces absorbing water in the rod channel.
 */
export const ROD_DISP_WORTH_PER_M = 2.0e-4;

// ---------------------------------------------------------------------------
// Thermal hydraulics (lumped, per axial node, whole core as one bundle)
// ---------------------------------------------------------------------------

/** Coolant inlet temperature [degC]. */
export const T_INLET = 270;
/** Primary circuit pressure [MPa]. */
export const PRESSURE = 7.0;
/** Saturation temperature at 7 MPa [degC]. */
export const T_SAT = 285.8;
/** Liquid enthalpy at inlet (270 degC, 7 MPa) [J/kg]. */
export const H_INLET = 1185e3;
/** Saturated liquid enthalpy at 7 MPa [J/kg]. */
export const H_F = 1267e3;
/** Latent heat at 7 MPa [J/kg]. */
export const H_FG = 1505e3;
/** Saturated liquid density at 7 MPa [kg/m^3]. */
export const RHO_F = 740;
/** Saturated vapor density at 7 MPa [kg/m^3]. */
export const RHO_G = 36.5;
/** Slip ratio for the drift/slip void correlation. */
export const SLIP = 1.5;
/** Total core coolant mass flow at 100% pump speed [kg/s] (~48000 t/h). */
export const FLOW_RATED = 13333;
/** Liquid specific heat near operating point [J/kg/K]. */
export const CP_LIQUID = 5400;
/** Void fraction relaxation time constant [s]. */
export const TAU_VOID = 3.0;

/** Fuel heat capacity per axial node [J/K] (~190 t UO2 total, cp~300). */
export const FUEL_HEAT_CAP = (190000 * 300) / N_AXIAL;
/** Fuel-to-coolant conductance per node [W/K] (gives tau_fuel ~ 5 s). */
export const FUEL_UA = 8.5e5;
/** Fraction of fission power deposited directly in graphite. */
export const GRAPHITE_POWER_FRACTION = 0.055;
/** Graphite heat capacity per node [J/K] (~1700 t, cp~1400 hot). */
export const GRAPHITE_HEAT_CAP = (1.7e6 * 1400) / N_AXIAL;
/** Graphite-to-coolant conductance per node [W/K] (tau ~ 1.6 h). */
export const GRAPHITE_UA = 3.0e4;
/** Reference fuel temperature at zero power [degC]. */
export const T_FUEL_REF = T_INLET;
/** Reference graphite temperature at zero power [degC]. */
export const T_GRAPHITE_REF = T_INLET;

// ---------------------------------------------------------------------------
// Decay heat: 3-group exponential fit (coarse). At equilibrium the groups
// carry ~6.6% of fission power; released with their own decay constants
// after shutdown. PRELIMINARY - replace with ANS-5.1-style fit later.
// ---------------------------------------------------------------------------
export const DECAY_HEAT_FRACTIONS: readonly number[] = [0.028, 0.018, 0.020];
export const DECAY_HEAT_LAMBDA: readonly number[] = [1e-1, 2e-3, 2e-5];
/** Total decay-heat fraction of fission power at equilibrium. */
export const DECAY_FRACTION_TOTAL = DECAY_HEAT_FRACTIONS.reduce(
  (a, b) => a + b,
  0,
);

// ---------------------------------------------------------------------------
// Nodal coupling
// ---------------------------------------------------------------------------

/**
 * Inter-node neutronic coupling coefficient [dimensionless reactivity scale,
 * applied as (COUPLING/GEN_TIME) * discrete Laplacian of flux]. Sized so the
 * fundamental-mode leakage reactivity ~ M^2 B^2 ~ 6e-3 for a 7 m graphite
 * core: COUPLING * (pi/(N+1))^2 ~ 6e-3. Larger = stiffer flux shape; smaller
 * = looser coupling and more spatial squirm (RBMK is famously loose).
 */
export const NODE_COUPLING = 0.12;
