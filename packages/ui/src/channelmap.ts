import type { NodeState, RodState } from "@rbmk/sim-core";
import { CORE_RADIUS, P_RATED, RadialField, ROD_PITCH } from "@rbmk/sim-core";

export type ChannelView = "power" | "temp";

/** Fixed color scale for the fuel-temp estimate view [°C]. */
const T_SCALE_LO = 270;
const T_SCALE_HI = 800;

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

  /**
   * Core-average fuel / coolant temps from the axial nodes. RadialField is
   * radial-only (rel power), so the temp view scales the axial average by
   * each channel's relative power (mean rel = 1 by construction).
   */
  private coreAvgs(nodes: NodeState[]): { avgFuel: number; avgCool: number } {
    const n = Math.max(1, nodes.length);
    let avgFuel = 0;
    let avgCool = 0;
    for (const node of nodes) {
      avgFuel += node.fuelTemp;
      avgCool += node.coolantTemp;
    }
    return { avgFuel: avgFuel / n, avgCool: avgCool / n };
  }

  /**
   * Per-channel fuel-temperature estimate [°C]:
   *   T_est = T_cool_avg + (T_fuel_avg - T_cool_avg) * rel
   * (rel is mean-1, so core-average estimate recovers avgFuel).
   */
  private fuelTempEst(
    rel: number,
    avgFuel: number,
    avgCool: number,
  ): number {
    return avgCool + (avgFuel - avgCool) * rel;
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

  /** Channel info under a client point (for tooltips), or null. */
  hit(
    clientX: number,
    clientY: number,
    powerFraction: number,
    nodes: NodeState[],
  ): string | null {
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
    const mw =
      (powerFraction * P_RATED * rel) / this.field.channels.length / 1e6;
    if (this.view === "temp") {
      const { avgFuel, avgCool } = this.coreAvgs(nodes);
      const tEst = this.fuelTempEst(rel, avgFuel, avgCool);
      return (
        `channel ${best} — fuel ~${Math.round(tEst)}°C (est.)` +
        ` · ${rel.toFixed(2)}× mean · ${mw.toFixed(2)} MW`
      );
    }
    return `channel ${best} — ${mw.toFixed(2)} MW (${rel.toFixed(2)}× mean)`;
  }

  draw(nodes: NodeState[], powerFraction: number, time = 0): void {
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

    const cell = Math.max(2, (this.px(0.256) - this.px(0)) * 0.9);

    // Relative field (as SKALA displayed it): normalize to the current max
    // channel so the SHAPE is readable at any power; overall brightness
    // still breathes with the power level so a dead core reads dim.
    let maxRel = 0.001;
    for (let c = 0; c < this.field.rel.length; c++) {
      maxRel = Math.max(maxRel, this.field.rel[c]!);
    }
    const glow = 0.3 + 0.7 * Math.min(1, Math.max(0, powerFraction));

    // Mean coolant/fuel scale for the temp view (fixed °C color scale so a
    // scram visibly cools the map as fuel temperatures fall).
    const { avgFuel, avgCool } = this.coreAvgs(nodes);
    const tSpan = T_SCALE_HI - T_SCALE_LO;

    for (let c = 0; c < this.field.channels.length; c++) {
      const ch = this.field.channels[c]!;
      const rel = this.field.rel[c]!;
      const x = this.px(ch.x);
      const y = this.px(ch.y);
      const phase = c * 2.399963; // golden angle: uncorrelated neighbors
      const flicker =
        1 +
        sigma *
          (Math.sin(time * 1.7 + phase) + 0.6 * Math.sin(time * 4.3 + 2.1 * phase));
      if (this.view === "power") {
        const v = (rel / maxRel) * glow * flicker;
        g.fillStyle = `rgba(217, 89, 38, ${0.05 + 0.92 * Math.max(0, Math.min(1, v))})`;
      } else {
        // Fuel-temp estimate from core-average axial temps scaled by relative
        // channel power. Fixed 270–800°C scale — not power-shape recoloring.
        // Thermal signal is slow; no counting noise on this view.
        const tEst = this.fuelTempEst(rel, avgFuel, avgCool);
        const v = Math.max(0, Math.min(1, (tEst - T_SCALE_LO) / tSpan));
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
