import type { NodeState, RodState } from "@rbmk/sim-core";
import { CORE_RADIUS, P_RATED, RadialField, ROD_PITCH } from "@rbmk/sim-core";

/**
 * Fuel-channel cartogram: every fuel channel colored by local power, with CPS
 * rod channels drawn as dark cells on top.
 * The radial field is a quasi-static reconstruction (see sim-core/field.ts).
 */
export class ChannelMap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w: number;
  private readonly field: RadialField;
  private readonly chPxX: Float32Array;
  private readonly chPxY: Float32Array;
  private readonly rodPxX: Float32Array;
  private readonly rodPxY: Float32Array;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly rods: RodState[],
  ) {
    const dpr = window.devicePixelRatio || 1;
    this.w = canvas.width;
    canvas.style.width = `${this.w}px`;
    canvas.style.height = `${this.w}px`;
    canvas.width = this.w * dpr;
    canvas.height = this.w * dpr;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.scale(dpr, dpr);
    this.field = new RadialField(rods);
    const chs = this.field.channels;
    this.chPxX = new Float32Array(chs.length);
    this.chPxY = new Float32Array(chs.length);
    for (let c = 0; c < chs.length; c++) {
      this.chPxX[c] = this.px(chs[c]!.x);
      this.chPxY[c] = this.px(chs[c]!.y);
    }
    this.rodPxX = new Float32Array(this.rods.length);
    this.rodPxY = new Float32Array(this.rods.length);
    for (let i = 0; i < this.rods.length; i++) {
      this.rodPxX[i] = this.px(this.rods[i]!.x * ROD_PITCH);
      this.rodPxY[i] = this.px(this.rods[i]!.y * ROD_PITCH);
    }
  }

  /** Meters -> canvas px. */
  private px(m: number): number {
    return this.w / 2 + (m / (CORE_RADIUS + 0.35)) * (this.w / 2 - 6);
  }

  update(nodes: NodeState[]): void {
    this.field.update(nodes);
  }

  /**
   * Radial field symmetry: mean relative power per quadrant (NW, NE, SW, SE),
   * normalized so 1.00 = perfectly balanced. The real plant watched this to
   * catch azimuthal field tilts.
   */
  quadrants(): { nw: number; ne: number; sw: number; se: number } {
    const sum = { nw: 0, ne: 0, sw: 0, se: 0 };
    const n = { nw: 0, ne: 0, sw: 0, se: 0 };
    for (let c = 0; c < this.field.channels.length; c++) {
      const ch = this.field.channels[c]!;
      const key =
        ch.y < 0
          ? ch.x < 0
            ? "nw"
            : "ne"
          : ch.x < 0
            ? "sw"
            : "se";
      sum[key] += this.field.rel[c]!;
      n[key]++;
    }
    const means = {
      nw: sum.nw / Math.max(1, n.nw),
      ne: sum.ne / Math.max(1, n.ne),
      sw: sum.sw / Math.max(1, n.sw),
      se: sum.se / Math.max(1, n.se),
    };
    const avg = (means.nw + means.ne + means.sw + means.se) / 4;
    return {
      nw: means.nw / avg,
      ne: means.ne / avg,
      sw: means.sw / avg,
      se: means.se / avg,
    };
  }

  /** Plain-language summary values for the readout below the map. */
  summary(): {
    hottest: number;
    coolest: number;
    highQuadrant: string;
    highOffsetPct: number;
    spreadPct: number;
  } {
    let hottest = 0;
    let coolest = Infinity;
    for (const rel of this.field.rel) {
      hottest = Math.max(hottest, rel);
      coolest = Math.min(coolest, rel);
    }
    const q = this.quadrants();
    const entries = Object.entries(q) as ["nw" | "ne" | "sw" | "se", number][];
    entries.sort((a, b) => b[1] - a[1]);
    const high = entries[0]!;
    const low = entries[entries.length - 1]!;
    return {
      hottest,
      coolest,
      highQuadrant: high[0].toUpperCase(),
      highOffsetPct: (high[1] - 1) * 100,
      spreadPct: (high[1] - low[1]) * 100,
    };
  }

  /** Channel info under a client point (for tooltips), or null. */
  hit(
    clientX: number,
    clientY: number,
    powerFraction: number,
  ): string | null {
    const r = this.canvas.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    let best = -1;
    let bestD = 6;
    for (let c = 0; c < this.field.channels.length; c++) {
      const d = Math.hypot(this.chPxX[c]! - sx, this.chPxY[c]! - sy);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best < 0) return null;
    const rel = this.field.rel[best]!;
    const mw =
      (powerFraction * P_RATED * rel) / this.field.channels.length / 1e6;
    return `channel ${best} — ${mw.toFixed(2)} MW (${rel.toFixed(2)}× mean)`;
  }

  draw(powerFraction: number, time = 0): void {
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.w);

    // Detector counting statistics: relative noise ~ 1/sqrt(count rate),
    // so the field shimmers faintly at power and visibly breathes in the
    // startup range - like the real readouts. Deterministic per-channel
    // phases (golden-angle spread), no randomness.
    const sigma = Math.min(0.15, 0.004 / Math.sqrt(Math.max(1e-3, powerFraction)));

    // Core barrel.
    g.beginPath();
    g.arc(this.w / 2, this.w / 2, this.px(CORE_RADIUS) - this.px(0), 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,255,255,0.10)";
    g.lineWidth = 2;
    g.stroke();

    // Orientation belongs on the map, not in an external cryptic quadrant
    // table. These labels make local hot/cold areas immediately locatable.
    const radius = this.px(CORE_RADIUS) - this.px(0);
    g.fillStyle = "#898781";
    g.font = "600 10px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("N", this.w / 2, this.w / 2 - radius - 7);
    g.fillText("S", this.w / 2, this.w / 2 + radius + 14);
    g.textAlign = "right";
    g.fillText("W", this.w / 2 - radius - 7, this.w / 2 + 3);
    g.textAlign = "left";
    g.fillText("E", this.w / 2 + radius + 7, this.w / 2 + 3);

    const cell = Math.max(2, (this.px(0.256) - this.px(0)) * 0.9);

    // Relative field (as SKALA displayed it): normalize to the current max
    // channel so the SHAPE is readable at any power; overall brightness
    // still breathes with the power level so a dead core reads dim.
    let maxRel = 0.001;
    for (let c = 0; c < this.field.rel.length; c++) {
      maxRel = Math.max(maxRel, this.field.rel[c]!);
    }
    const glow = 0.3 + 0.7 * Math.min(1, Math.max(0, powerFraction));

    for (let c = 0; c < this.field.channels.length; c++) {
      const rel = this.field.rel[c]!;
      const x = this.chPxX[c]!;
      const y = this.chPxY[c]!;
      const phase = c * 2.399963; // golden angle: uncorrelated neighbors
      const flicker =
        1 +
        sigma *
          (Math.sin(time * 1.7 + phase) + 0.6 * Math.sin(time * 4.3 + 2.1 * phase));
      const v = (rel / maxRel) * glow * flicker;
      g.fillStyle = `rgba(217, 89, 38, ${0.05 + 0.92 * Math.max(0, Math.min(1, v))})`;
      g.fillRect(x - cell / 2, y - cell / 2, cell, cell);
    }

    // CPS channels on top: dark cells, brighter as the rod is inserted.
    for (let i = 0; i < this.rods.length; i++) {
      const rod = this.rods[i]!;
      const x = this.rodPxX[i]!;
      const y = this.rodPxY[i]!;
      g.fillStyle = "#0d0d0d";
      g.fillRect(x - cell * 0.8, y - cell * 0.8, cell * 1.6, cell * 1.6);
      g.strokeStyle = `rgba(158, 197, 244, ${0.25 + 0.6 * rod.insertion})`;
      g.lineWidth = 1;
      g.strokeRect(x - cell * 0.8, y - cell * 0.8, cell * 1.6, cell * 1.6);
    }
  }
}
