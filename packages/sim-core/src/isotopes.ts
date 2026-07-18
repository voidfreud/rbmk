import {
  GAMMA_I,
  GAMMA_XE,
  LAMBDA_I,
  LAMBDA_XE,
  NU,
  PHI_REF,
  SIGMA_F,
  SIGMA_XE,
  DECAY_HEAT_FRACTIONS,
  DECAY_HEAT_LAMBDA,
  DECAY_FRACTION_TOTAL,
} from "./constants";

/**
 * I-135 -> Xe-135 chain, integrated per node with a semi-implicit step that
 * stays stable at large dt (the chain's timescales are hours).
 *
 * dI/dt  = gamma_I * Sigma_f * phi              - lambda_I * I
 * dXe/dt = gamma_Xe * Sigma_f * phi + lambda_I*I - (lambda_Xe + sigma_Xe*phi) * Xe
 *
 * phi here is ABSOLUTE flux [n/cm^2/s] = relativeFlux * PHI_REF.
 */
export function stepIodineXenon(
  iodine: number,
  xenon: number,
  relativeFlux: number,
  dt: number,
): { iodine: number; xenon: number } {
  const phi = Math.max(0, relativeFlux) * PHI_REF;
  const fissionRate = SIGMA_F * phi;

  const iNew = (iodine + dt * GAMMA_I * fissionRate) / (1 + dt * LAMBDA_I);
  const xeNew =
    (xenon + dt * (GAMMA_XE * fissionRate + LAMBDA_I * iNew)) /
    (1 + dt * (LAMBDA_XE + SIGMA_XE * phi));

  return { iodine: iNew, xenon: xeNew };
}

/** Equilibrium I-135 and Xe-135 densities at a constant relative flux. */
export function equilibriumIodineXenon(relativeFlux: number): {
  iodine: number;
  xenon: number;
} {
  const phi = Math.max(0, relativeFlux) * PHI_REF;
  const fissionRate = SIGMA_F * phi;
  const iodine = (GAMMA_I * fissionRate) / LAMBDA_I;
  const xenon =
    ((GAMMA_I + GAMMA_XE) * fissionRate) / (LAMBDA_XE + SIGMA_XE * phi);
  return { iodine, xenon };
}

/**
 * Node-local xenon reactivity [absolute reactivity, negative].
 * Standard large-thermal-reactor poisoning estimate:
 *   rho_Xe = -sigma_Xe * N_Xe / (nu * Sigma_f)
 * Gives ~ -0.025 at equilibrium for phi ~ 1e14, consistent with the
 * textbook -2000..-3000 pcm.
 */
export function xenonReactivity(xenon: number): number {
  return (-SIGMA_XE * xenon) / (NU * SIGMA_F);
}

/**
 * Decay heat groups: each group j accumulates toward f_j * P_fission with
 * its own decay constant and releases its stored power after shutdown.
 * Semi-implicit step; returns new group powers [W].
 */
export function stepDecayHeat(
  groups: number[],
  fissionPower: number,
  dt: number,
): number[] {
  return groups.map((h, j) => {
    const lam = DECAY_HEAT_LAMBDA[j]!;
    const frac = DECAY_HEAT_FRACTIONS[j]!;
    return (h + dt * lam * frac * fissionPower) / (1 + dt * lam);
  });
}

/** Equilibrium decay-heat group powers at a given steady fission power. */
export function equilibriumDecayHeat(fissionPower: number): number[] {
  return DECAY_HEAT_FRACTIONS.map((f) => f * fissionPower);
}

/** Total thermal power = prompt fission share + released decay heat. */
export function thermalPower(fissionPower: number, groups: number[]): number {
  const released = groups.reduce((a, b) => a + b, 0);
  return fissionPower * (1 - DECAY_FRACTION_TOTAL) + released;
}
