import {
  CORE_HEIGHT,
  N_AXIAL,
  N_FUEL_CHANNELS,
  NODE_HEIGHT,
} from "./constants";
import { absorberInterval, displacerInterval, overlapWithNode } from "./rods";
import type { NodeState, RodState } from "./types";

/**
 * Quasi-static radial power reconstruction.
 *
 * The kinetics model is 1D axial; radially we reconstruct a plausible
 * channel-by-channel power field the way the plant's own PRIZMA program
 * reconstructed it from sparse detectors: a fundamental-mode dome, locally
 * depressed around inserted absorbers and slightly enhanced around graphite
 * displacers, via a diffusion-length kernel. Deterministic, cheap, and
 * consistent with the axial model's rod positions.
 */

/** Core physical radius [m]. */
export const CORE_RADIUS = 5.9;
/** Rod lattice pitch [m] (17-ish rod positions across the 11.8 m core). */
export const ROD_PITCH = 0.686;
/** Diffusion kernel width [m]. */
const KERNEL_SIGMA = 0.9;
/** Kernel cutoff distance [m]. */
const KERNEL_CUTOFF = 2.3;
/** Local worth of a fully effective absorber at zero distance. */
const A_ABS = 0.5;
/** Local flux enhancement of a displacer at zero distance. */
const A_DISP = 0.12;

export interface ChannelPoint {
  /** Physical position [m from core center]. */
  x: number;
  y: number;
}

/** Deterministic fuel-channel lattice: 0.25 m pitch grid clipped to the core. */
export function buildFuelChannels(count = N_FUEL_CHANNELS): ChannelPoint[] {
  const pitch = 0.256;
  const pts: (ChannelPoint & { d: number; a: number })[] = [];
  const n = Math.ceil(CORE_RADIUS / pitch);
  for (let iy = -n; iy <= n; iy++) {
    for (let ix = -n; ix <= n; ix++) {
      const x = ix * pitch;
      const y = iy * pitch;
      const d = Math.hypot(x, y);
      if (d <= CORE_RADIUS) pts.push({ x, y, d, a: Math.atan2(y, x) });
    }
  }
  pts.sort((p, q) => p.d - q.d || p.a - q.a);
  return pts.slice(0, count).map(({ x, y }) => ({ x, y }));
}

/** Axially flux-weighted absorber / displacer presence of one rod (0..1). */
export function rodAxialEffect(
  rod: RodState,
  nodes: NodeState[],
): { abs: number; disp: number } {
  const absIv = absorberInterval(rod);
  const dispIv = displacerInterval(rod);
  let absW = 0;
  let dispW = 0;
  let fluxSum = 0;
  for (let k = 0; k < N_AXIAL; k++) {
    const flux = nodes[k]!.flux;
    fluxSum += flux;
    const ov = (iv: [number, number] | null) =>
      overlapWithNode(iv, k) / NODE_HEIGHT;
    absW += ov(absIv) * flux;
    dispW += ov(dispIv) * flux;
  }
  if (fluxSum < 1e-9) {
    // Dead core: fall back to geometric fractions.
    const geo = (iv: [number, number] | null) =>
      iv ? (iv[1] - iv[0]) / CORE_HEIGHT : 0;
    return { abs: geo(absIv), disp: geo(dispIv) };
  }
  return { abs: absW / fluxSum, disp: dispW / fluxSum };
}

export class RadialField {
  readonly channels: ChannelPoint[];
  /** Per-channel neighbor rods and precomputed kernel weights. */
  private readonly neighborRods: Int32Array[];
  private readonly neighborW: Float32Array[];
  /** Fundamental-mode dome per channel. */
  private readonly dome: Float32Array;
  /** Cached per-rod axial absorber/displacer effects for this update call. */
  private readonly rodAbs: Float32Array;
  private readonly rodDisp: Float32Array;
  /** Last computed relative power per channel (mean 1 over channels). */
  readonly rel: Float32Array;

  constructor(
    private readonly rods: RodState[],
    channels = buildFuelChannels(),
  ) {
    this.channels = channels;
    this.rodAbs = new Float32Array(this.rods.length);
    this.rodDisp = new Float32Array(this.rods.length);
    this.rel = new Float32Array(channels.length).fill(1);
    this.dome = new Float32Array(channels.length);
    this.neighborRods = [];
    this.neighborW = [];

    const rExtrap = CORE_RADIUS + 0.4;
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c]!;
      this.dome[c] = Math.cos(
        (Math.PI / 2) * (Math.hypot(ch.x, ch.y) / rExtrap),
      );
      const ids: number[] = [];
      const ws: number[] = [];
      for (const rod of rods) {
        const d = Math.hypot(ch.x - rod.x * ROD_PITCH, ch.y - rod.y * ROD_PITCH);
        if (d <= KERNEL_CUTOFF) {
          ids.push(rod.id);
          ws.push(Math.exp(-(d * d) / (2 * KERNEL_SIGMA * KERNEL_SIGMA)));
        }
      }
      this.neighborRods.push(Int32Array.from(ids));
      this.neighborW.push(Float32Array.from(ws));
    }
  }

  /** Recompute the field from current rod positions and axial flux shape. */
  update(nodes: NodeState[]): void {
    for (const rod of this.rods) {
      const e = rodAxialEffect(rod, nodes);
      this.rodAbs[rod.id] = e.abs;
      this.rodDisp[rod.id] = e.disp;
    }
    let sum = 0;
    for (let c = 0; c < this.channels.length; c++) {
      let f = this.dome[c]!;
      const ids = this.neighborRods[c]!;
      const ws = this.neighborW[c]!;
      let mod = 0;
      for (let i = 0; i < ids.length; i++) {
        const rid = ids[i];
        if (rid === undefined) continue;
        const w = ws[i];
        if (w === undefined) continue;
        mod += w * (A_DISP * this.rodDisp[rid]! - A_ABS * this.rodAbs[rid]!);
      }
      f *= Math.max(0.02, 1 + mod);
      this.rel[c] = f;
      sum += f;
    }
    const inv = this.channels.length / Math.max(1e-9, sum);
    for (let c = 0; c < this.rel.length; c++) this.rel[c]! *= inv;
  }
}
