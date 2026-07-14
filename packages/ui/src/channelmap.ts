import type { NodeState, RodState } from "@rbmk/sim-core";
import { CORE_RADIUS, P_RATED, RadialField, ROD_PITCH } from "@rbmk/sim-core";

export type ChannelView = "power" | "temp";

/**
 * Fuel-channel cartogram: every fuel channel colored by local power (or an
 * outlet-temperature estimate), CPS rod channels drawn as dark cells on top.
 * The radial field is a quasi-static reconstruction (see sim-core/field.ts).
 */
export class ChannelMap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w: number;
  private readonly field: RadialField;
  view: ChannelView = "power";

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
  }

  /** Meters -> canvas px. */
  private px(m: number): number {
    return this.w / 2 + (m / (CORE_RADIUS + 0.35)) * (this.w / 2 - 6);
  }

  update(nodes: NodeState[]): void {
    this.field.update(nodes);
  }

  /** Channel info under a client point (for tooltips), or null. */
  hit(clientX: number, clientY: number, powerFraction: number): string | null {
    const r = this.canvas.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    let best = -1;
    let bestD = 6;
    for (let c = 0; c < this.field.channels.length; c++) {
      const ch = this.field.channels[c]!;
      const d = Math.hypot(this.px(ch.x) - sx, this.px(ch.y) - sy);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best < 0) return null;
    const rel = this.field.rel[best]!;
    const mw = (powerFraction * P_RATED * rel) / this.field.channels.length / 1e6;
    return `channel ${best} — ${mw.toFixed(2)} MW (${rel.toFixed(2)}× mean)`;
  }

  draw(nodes: NodeState[], powerFraction: number): void {
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.w);

    // Core barrel.
    g.beginPath();
    g.arc(this.w / 2, this.w / 2, this.px(CORE_RADIUS) - this.px(0), 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,255,255,0.10)";
    g.lineWidth = 2;
    g.stroke();

    const cell = Math.max(2, (this.px(0.256) - this.px(0)) * 0.9);

    // Relative field (as SKALA displayed it): normalize to the current max
    // channel so the SHAPE is readable at any power; overall brightness
    // still breathes with the power level so a dead core reads dim.
    let maxRel = 0.001;
    for (let c = 0; c < this.field.rel.length; c++) {
      maxRel = Math.max(maxRel, this.field.rel[c]!);
    }
    const glow = 0.3 + 0.7 * Math.min(1, Math.max(0, powerFraction));

    // Mean coolant/fuel scale for the temp view.
    const avgFuel =
      nodes.reduce((a, n) => a + n.fuelTemp, 0) / Math.max(1, nodes.length);

    for (let c = 0; c < this.field.channels.length; c++) {
      const ch = this.field.channels[c]!;
      const rel = this.field.rel[c]!;
      const x = this.px(ch.x);
      const y = this.px(ch.y);
      if (this.view === "power") {
        const v = (rel / maxRel) * glow;
        g.fillStyle = `rgba(217, 89, 38, ${0.05 + 0.92 * Math.min(1, v)})`;
      } else {
        // Channel-average fuel temperature estimate: scales with local power.
        const t = 270 + (avgFuel - 270) * rel * Math.max(0.02, powerFraction);
        const v = Math.min(1, Math.max(0, (t - 270) / 500));
        g.fillStyle = `rgba(201, 133, 0, ${0.05 + 0.92 * v})`;
      }
      g.fillRect(x - cell / 2, y - cell / 2, cell, cell);
    }

    // CPS channels on top: dark cells, brighter as the rod is inserted.
    for (const rod of this.rods) {
      const x = this.px(rod.x * ROD_PITCH);
      const y = this.px(rod.y * ROD_PITCH);
      g.fillStyle = "#0d0d0d";
      g.fillRect(x - cell * 0.8, y - cell * 0.8, cell * 1.6, cell * 1.6);
      g.strokeStyle = `rgba(158, 197, 244, ${0.25 + 0.6 * rod.insertion})`;
      g.lineWidth = 1;
      g.strokeRect(x - cell * 0.8, y - cell * 0.8, cell * 1.6, cell * 1.6);
    }
  }
}
