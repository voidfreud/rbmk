import {
  CORE_HEIGHT,
  DISPLACER_LENGTH,
  N_AXIAL,
  NODE_HEIGHT,
  ROD_ABS_WORTH_PER_M,
  ROD_DISP_WORTH_PER_M,
  ROD_SPEED,
  ROD_SPEED_LAR_OUT,
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

/** Advance every rod drive toward its target (LAR withdraws at half speed). */
export function stepRodDrives(rods: RodState[], dt: number): void {
  for (const rod of rods) {
    const delta = rod.target - rod.insertion;
    const speed =
      rod.group === "LAR" && delta < 0 ? ROD_SPEED_LAR_OUT : ROD_SPEED;
    const maxStep = (speed * dt) / CORE_HEIGHT;
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
 *
 * Layout is the ENGINEERED, symmetric pattern of a real CPS map rather than
 * a scatter: a rounded-square lattice footprint, LAR at the 12 local-zone
 * centers, AR subgroups at 4-fold rotationally symmetric positions, AZ
 * spread evenly over two rings, USP on two regular rings of their own,
 * RR everywhere else. (The exact per-cell ChNPP-4 map exists on the 00:39
 * printout; this is a faithful-pattern approximation with correct counts.)
 */
export function buildRods(count = 211): RodState[] {
  // Round footprint d <= 8.07 gives 213 lattice positions; 211 cannot be
  // 4-fold symmetric (210 is not divisible by 4 - the real map was not
  // perfectly symmetric either), so drop one 180-degree pair to get an
  // exactly 2-fold-symmetric 211-position footprint.
  const all: { x: number; y: number; d: number; a: number }[] = [];
  for (let y = -9; y <= 9; y++) {
    for (let x = -9; x <= 9; x++) {
      if (count === 211 && ((x === 8 && y === 1) || (x === -8 && y === -1)))
        continue;
      all.push({ x, y, d: Math.hypot(x, y), a: Math.atan2(y, x) });
    }
  }
  all.sort((p, q) => p.d - q.d || p.a - q.a);
  const points = all.slice(0, count);

  // Geometric group targets (radius in lattice units, angle in degrees),
  // matched to the nearest unassigned lattice position.
  const targets: { group: RodGroup; sub?: 1 | 2 | 3; r: number; deg: number }[] = [];
  for (let k = 0; k < 12; k++) {
    targets.push({ group: "LAR", r: 5.0, deg: 15 + 30 * k });
  }
  for (const [sub, r, off] of [
    [1, 2.9, 0],
    [2, 4.2, 30],
    [3, 5.6, 60],
  ] as const) {
    for (let k = 0; k < 4; k++) {
      targets.push({ group: "AR", sub, r, deg: off + 90 * k });
    }
  }
  for (let k = 0; k < 8; k++) {
    targets.push({ group: "AZ", r: 1.8, deg: 22.5 + 45 * k });
  }
  for (let k = 0; k < 16; k++) {
    targets.push({ group: "AZ", r: 7.0, deg: 11.25 + 22.5 * k });
  }
  for (let k = 0; k < 12; k++) {
    targets.push({ group: "USP", r: 3.5, deg: 30 * k });
  }
  for (let k = 0; k < 20; k++) {
    targets.push({ group: "USP", r: 6.2, deg: 9 + 18 * k });
  }

  const groups = new Array<{ group: RodGroup; sub?: 1 | 2 | 3 }>(points.length)
    .fill({ group: "RR" });
  const taken = new Array<boolean>(points.length).fill(false);
  for (const t of targets) {
    const tx = t.r * Math.cos((t.deg * Math.PI) / 180);
    const ty = t.r * Math.sin((t.deg * Math.PI) / 180);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      if (taken[i]) continue;
      const d = Math.hypot(points[i]!.x - tx, points[i]!.y - ty);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      taken[best] = true;
      groups[best] = { group: t.group, sub: t.sub };
    }
  }

  const rods: RodState[] = [];
  for (let i = 0; i < points.length; i++) {
    const g = groups[i]!;
    rods.push({
      id: i,
      group: g.group,
      arSubgroup: g.sub,
      autoControlled: g.group === "AR" || g.group === "LAR",
      insertion: 1,
      target: 1,
      x: points[i]!.x,
      y: points[i]!.y,
    });
  }
  return rods;
}
