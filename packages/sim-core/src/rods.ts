import {
  CORE_HEIGHT,
  DISPLACER_LENGTH,
  N_AXIAL,
  NODE_HEIGHT,
  ROD_ABS_WORTH_PER_M,
  ROD_DISP_WORTH_PER_M,
  ROD_SPEED,
  USP_ABS_LENGTH,
  WATER_GAP,
} from "./constants";
import type { RodGroup, RodState } from "./types";

/**
 * Rod geometry, axis measured as DEPTH FROM CORE TOP (0 = top of active
 * core, CORE_HEIGHT = bottom).
 *
 * Standard rods (RR/AR/LAR/AZ), pre-1986 two-section design: boron carbide
 * absorber enters from the TOP; a 4.5 m graphite displacer hangs below it
 * with 1.25 m water columns above and below when fully withdrawn. As the
 * rod drives in, the displacer moves down and out through the core bottom.
 *
 * USP shortened absorbers: 3.05 m of absorber entering from the BOTTOM,
 * no displacer (used to trim the axial field). Pre-1986 they were NOT
 * driven in by AZ-5 - a named contributing factor to the accident.
 */

/** Absorber-occupied interval [top, bottom] in core depth coords, or null. */
export function absorberInterval(rod: {
  group: RodGroup;
  insertion: number;
}): [number, number] | null {
  if (rod.group === "USP") {
    const len = rod.insertion * USP_ABS_LENGTH;
    if (len <= 0) return null;
    return [CORE_HEIGHT - len, CORE_HEIGHT];
  }
  const tip = rod.insertion * CORE_HEIGHT;
  if (tip <= 0) return null;
  return [0, Math.min(tip, CORE_HEIGHT)];
}

/** Displacer-occupied interval in core depth coords, clipped to core. */
export function displacerInterval(rod: {
  group: RodGroup;
  insertion: number;
}): [number, number] | null {
  if (rod.group === "USP") return null;
  const shift = rod.insertion * CORE_HEIGHT;
  const top = WATER_GAP + shift;
  const bottom = WATER_GAP + DISPLACER_LENGTH + shift;
  const a = Math.max(0, top);
  const b = Math.min(CORE_HEIGHT, bottom);
  return b > a ? [a, b] : null;
}

function overlapWithNode(
  interval: [number, number] | null,
  nodeIndex: number,
): number {
  if (!interval) return 0;
  const nodeTop = nodeIndex * NODE_HEIGHT;
  const nodeBottom = nodeTop + NODE_HEIGHT;
  const a = Math.max(interval[0], nodeTop);
  const b = Math.min(interval[1], nodeBottom);
  return Math.max(0, b - a);
}

/**
 * Node-local reactivity contribution [absolute reactivity] of all rods.
 * Node index 0 is the TOP of the core. Returns array of length N_AXIAL.
 */
export function rodReactivityByNode(rods: RodState[]): number[] {
  const rho = new Array<number>(N_AXIAL).fill(0);
  for (const rod of rods) {
    const abs = absorberInterval(rod);
    const disp = displacerInterval(rod);
    for (let k = 0; k < N_AXIAL; k++) {
      const absM = overlapWithNode(abs, k);
      const dispM = overlapWithNode(disp, k);
      // Water in the rod channel is the reference state: absorber is worse
      // than water (negative), graphite displacer is better (positive).
      rho[k]! +=
        -ROD_ABS_WORTH_PER_M * absM + ROD_DISP_WORTH_PER_M * dispM;
    }
  }
  return rho;
}

/** Advance every rod drive toward its target at ROD_SPEED. */
export function stepRodDrives(rods: RodState[], dt: number): void {
  const maxStep = (ROD_SPEED * dt) / CORE_HEIGHT;
  for (const rod of rods) {
    const delta = rod.target - rod.insertion;
    if (Math.abs(delta) <= maxStep) {
      rod.insertion = rod.target;
    } else {
      rod.insertion += Math.sign(delta) * maxStep;
    }
  }
}

/**
 * Build the real 2nd-generation rod complement (NIKIET textbook breakdown):
 * 131 RR + 12 AR (3 subgroups x 4) + 12 LAR + 24 AZ + 32 USP = 211.
 * Groups are scattered deterministically over the lattice via a coprime
 * permutation; positions come from a radially sorted grid clipped to the
 * core circle.
 */
export function buildRods(count = 211): RodState[] {
  const points: { x: number; y: number; d: number; a: number }[] = [];
  for (let y = -8; y <= 8; y++) {
    for (let x = -8; x <= 8; x++) {
      const d = Math.hypot(x, y);
      if (d <= 8.6) points.push({ x, y, d, a: Math.atan2(y, x) });
    }
  }
  points.sort((p, q) => p.d - q.d || p.a - q.a);

  // Group cutoffs as fractions of the real 211-rod complement.
  const nAR = Math.round((12 / 211) * count);
  const nLAR = Math.round((12 / 211) * count);
  const nAZ = Math.round((24 / 211) * count);
  const nUSP = Math.round((32 / 211) * count);

  const rods: RodState[] = [];
  for (let i = 0; i < count; i++) {
    // Coprime scatter so classes are spread over the whole core.
    const s = (i * 89) % count;
    let group: RodGroup;
    let arSubgroup: 1 | 2 | 3 | undefined;
    if (s < nAR) {
      group = "AR";
      arSubgroup = (Math.floor(s / Math.max(1, nAR / 3)) + 1) as 1 | 2 | 3;
      if (arSubgroup > 3) arSubgroup = 3;
    } else if (s < nAR + nLAR) group = "LAR";
    else if (s < nAR + nLAR + nAZ) group = "AZ";
    else if (s < nAR + nLAR + nAZ + nUSP) group = "USP";
    else group = "RR";

    const p = points[i] ?? { x: 0, y: 0 };
    rods.push({
      id: i,
      group,
      arSubgroup,
      autoControlled: group === "AR" || group === "LAR",
      insertion: 1,
      target: 1,
      x: p.x,
      y: p.y,
    });
  }
  return rods;
}
