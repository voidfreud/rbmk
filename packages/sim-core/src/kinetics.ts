import {
  DELAYED_BETA,
  DELAYED_LAMBDA,
  BETA_EFF,
  GEN_TIME,
  N_AXIAL,
  N_DELAYED_GROUPS,
  NODE_COUPLING,
} from "./constants";
import type { NodeState } from "./types";

/**
 * 1D axial nodal kinetics: each node follows point-kinetics-like equations
 * plus diffusive coupling to its axial neighbours, with absorbing (zero-flux)
 * boundaries outside the core representing axial leakage.
 *
 *  dphi_k/dt = ((rho_k - beta)/L) phi_k + sum_i lambda_i C_ik + w * Lap(phi)_k
 *  dC_ik/dt  = (beta_i/L) phi_k - lambda_i C_ik
 *
 * Operator-split, both halves implicit:
 *  1. per-node prompt + delayed update (implicit in the prompt term),
 *  2. implicit diffusion solve (Thomas algorithm on the tridiagonal system),
 * so the step is stable at dt ~ 10 ms even though w ~ 100 /s.
 */

const W = NODE_COUPLING / GEN_TIME;

/** Kinetics state subset needed for a flux step (trial copies use this). */
export interface FluxNode {
  flux: number;
  precursors: number[];
}

export function stepKinetics(
  nodes: FluxNode[] | NodeState[],
  rhoByNode: number[],
  dt: number,
): void {
  // Precursors: implicit decay, source from the old flux.
  const rhs = new Array<number>(N_AXIAL);
  for (let k = 0; k < N_AXIAL; k++) {
    const node = nodes[k]!;
    const fluxOld = node.flux;
    let delayedSource = 0;
    for (let i = 0; i < N_DELAYED_GROUPS; i++) {
      const lam = DELAYED_LAMBDA[i]!;
      const beta = DELAYED_BETA[i]!;
      const c =
        (node.precursors[i]! + (dt * beta * fluxOld) / GEN_TIME) /
        (1 + dt * lam);
      node.precursors[i] = c;
      delayedSource += lam * c;
    }
    rhs[k] = fluxOld + dt * delayedSource;
  }

  // Flux: single backward-Euler solve of the coupled prompt + diffusion
  // operator, (I - dt*(diag((rho_k - beta)/L) + w*Lap)) phi_new = rhs.
  // One tridiagonal Thomas sweep; stable even with strongly heterogeneous
  // node reactivities and large dt (fast-forward).
  const a = dt * W;
  const cPrime = new Array<number>(N_AXIAL);
  const dPrime = new Array<number>(N_AXIAL);
  const diag0 =
    1 - (dt * (rhoByNode[0]! - BETA_EFF)) / GEN_TIME + 2 * a;
  cPrime[0] = -a / diag0;
  dPrime[0] = rhs[0]! / diag0;
  for (let k = 1; k < N_AXIAL; k++) {
    const diag = 1 - (dt * (rhoByNode[k]! - BETA_EFF)) / GEN_TIME + 2 * a;
    const m = diag + a * cPrime[k - 1]!;
    cPrime[k] = -a / m;
    dPrime[k] = (rhs[k]! + a * dPrime[k - 1]!) / m;
  }
  nodes[N_AXIAL - 1]!.flux = Math.max(0, dPrime[N_AXIAL - 1]!);
  for (let k = N_AXIAL - 2; k >= 0; k--) {
    const f = dPrime[k]! - cPrime[k]! * nodes[k + 1]!.flux;
    nodes[k]!.flux = Math.max(0, f);
  }
}

/** Set precursors to equilibrium with the current flux (steady operation). */
export function equilibriumPrecursors(nodes: NodeState[]): void {
  for (const node of nodes) {
    for (let i = 0; i < N_DELAYED_GROUPS; i++) {
      node.precursors[i] =
        (DELAYED_BETA[i]! * node.flux) / (GEN_TIME * DELAYED_LAMBDA[i]!);
    }
  }
}

/** Core power fraction: average relative flux over nodes. */
export function powerFraction(nodes: FluxNode[] | NodeState[]): number {
  let sum = 0;
  for (const n of nodes) sum += n.flux;
  return sum / N_AXIAL;
}

/**
 * Global reactivity as seen by instruments: flux-squared weighted average of
 * node reactivities (first-order perturbation weighting).
 */
export function globalReactivity(
  nodes: NodeState[],
  rhoByNode: number[],
): number {
  let num = 0;
  let den = 0;
  for (let k = 0; k < N_AXIAL; k++) {
    const w = nodes[k]!.flux * nodes[k]!.flux;
    num += w * rhoByNode[k]!;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

/**
 * Instantaneous reactor period [s] estimated from flux growth; large values
 * clamped to +-1e6 for display. Positive = power rising.
 */
export function estimatePeriod(
  powerBefore: number,
  powerAfter: number,
  dt: number,
): number {
  if (powerBefore <= 0 || powerAfter <= 0) return 1e6;
  const rate = Math.log(powerAfter / powerBefore) / dt;
  if (Math.abs(rate) < 1e-6) return Math.sign(rate || 1) * 1e6;
  return 1 / rate;
}
