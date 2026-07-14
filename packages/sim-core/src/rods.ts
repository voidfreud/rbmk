import {
  CORE_HEIGHT,
  DISPLACER_LENGTH,
  N_AXIAL,
  NODE_HEIGHT,
  ROD_ABS_WORTH_PER_M,
  ROD_DISP_WORTH_PER_M,
  ROD_SPEED,
  WATER_GAP,
} from "./constants";
import type { RodGroup, RodState } from "./types";

/**
 * Pre-1986 RBMK manual rod geometry, axis measured as DEPTH FROM CORE TOP
 * (0 = top of active core, CORE_HEIGHT = bottom).
 *
 * Fully withdrawn (insertion = 0):
 *   [0, WATER_GAP)                          water
 *   [WATER_GAP, WATER_GAP+DISPLACER_LENGTH) graphite displacer
 *   [.., CORE_HEIGHT]                       water   <- the infamous bottom gap
 * Absorber sits entirely above the core.
 *
 * As the rod drives in (insertion s in 0..1, i.e. absorber tip at depth
 * s*CORE_HEIGHT), the displacer moves down by the same distance and its
 * lower section leaves the core through the bottom.
 */

/** Absorber-occupied interval [top, bottom] in core depth coords, or null. */
export function absorberInterval(insertion: number): [number, number] | null {
  const tip = insertion * CORE_HEIGHT;
  if (tip <= 0) return null;
  return [0, Math.min(tip, CORE_HEIGHT)];
}

/** Displacer-occupied interval in core depth coords, clipped to core. */
export function displacerInterval(insertion: number): [number, number] | null {
  const shift = insertion * CORE_HEIGHT;
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
    const abs = absorberInterval(rod.insertion);
    const disp = displacerInterval(rod.insertion);
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

/** Build the standard rod set: mostly manual, one auto group, emergency set. */
export function buildRods(count: number): RodState[] {
  const rods: RodState[] = [];
  for (let i = 0; i < count; i++) {
    let group: RodGroup = "manual";
    if (i % 9 === 0) group = "auto";
    else if (i % 11 === 0) group = "emergency";
    else if (i % 7 === 0) group = "shortened";
    rods.push({ id: i, group, insertion: 1, target: 1 });
  }
  return rods;
}
