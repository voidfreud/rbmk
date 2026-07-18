import type { NodeState, RodGroup, RodState } from "@rbmk/sim-core";
import {
  CORE_HEIGHT,
  N_AXIAL,
  T_INLET,
  T_SAT,
} from "@rbmk/sim-core";

const GROUPS: RodGroup[] = ["RR", "AR", "LAR", "AZ", "USP"];

/** Layout constants (logical px). */
const TOP = 34;
const BOTTOM_PAD = 30;
const SCALE_X = 30; // depth scale gutter
const FLUX_W = 150; // layered power/void/xenon profile
const TEMP_W = 16; // coolant temperature strip
const BANK_W = 30; // per-bank channel width
const BANK_GAP = 10;
const ABSORBER_COLOR = "#d55181";

/**
 * Axial cutaway of the core, top of core at the top of the plot:
 * flux profile (filled area) + void curve + coolant temperature strip +
 * one unambiguous absorber-tip position track per rod bank.
 */
export class Slice {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w: number;
  private readonly h: number;
  private lastNodes: NodeState[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const dpr = window.devicePixelRatio || 1;
    this.w = canvas.width;
    this.h = canvas.height;
    canvas.style.width = `${this.w}px`;
    canvas.style.height = `${this.h}px`;
    canvas.width = this.w * dpr;
    canvas.height = this.h * dpr;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.scale(dpr, dpr);
  }

  private coreH(): number {
    return this.h - TOP - BOTTOM_PAD;
  }

  private yAt(meters: number): number {
    return TOP + (meters / CORE_HEIGHT) * this.coreH();
  }

  private lastRods: RodState[] = [];

  /** Node or bank data under a client point, for the shared tooltip. */
  hit(clientX: number, clientY: number): string | null {
    const r = this.canvas.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    if (py < TOP || py > TOP + this.coreH()) return null;
    const depth = ((py - TOP) / this.coreH()) * CORE_HEIGHT;

    // Bank columns: report the bank's geometry at this depth.
    const banksX = SCALE_X + FLUX_W + TEMP_W + 16;
    if (px >= banksX) {
      const slot = Math.floor((px - banksX) / (BANK_W + BANK_GAP));
      const within = (px - banksX) % (BANK_W + BANK_GAP) <= BANK_W;
      const group = GROUPS[slot];
      if (!within || !group) return null;
      const members = this.lastRods.filter((rod) => rod.group === group);
      if (members.length === 0) return null;
      const ins =
        members.reduce((a, rod) => a + rod.insertion, 0) / members.length;
      const moving = members.some(
        (rod) => Math.abs(rod.target - rod.insertion) > 1e-6,
      );
      return (
        `${group} bank (${members.length} rods) — absorber tip position · ` +
        `${(ins * (group === "USP" ? 3.05 : CORE_HEIGHT)).toFixed(2)} m inserted · ` +
        `${group === "USP" ? "enters upward from BOTTOM" : "enters downward from TOP · same standard design"}` +
        `${moving ? " · MOVING" : ""}`
      );
    }

    if (px < SCALE_X || px > SCALE_X + FLUX_W + TEMP_W + 6) return null;
    const k = Math.min(N_AXIAL - 1, Math.floor((depth / CORE_HEIGHT) * N_AXIAL));
    const n = this.lastNodes[k];
    if (!n) return null;
    return (
      `depth ${depth.toFixed(1)} m from top — power ${n.flux.toFixed(2)}× · ` +
      `steam void ${(n.voidFrac * 100).toFixed(0)}% · xenon ` +
      `${(n.xenon / Math.max(1e-12, this.lastNodes.reduce((a, node) => a + node.xenon, 0) / N_AXIAL)).toFixed(2)}× core avg · ` +
      `fuel ${Math.round(n.fuelTemp)}°C · coolant ${n.coolantTemp.toFixed(1)}°C`
    );
  }

  draw(nodes: NodeState[], rods: RodState[]): void {
    this.lastNodes = nodes;
    this.lastRods = rods;
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    const coreH = this.coreH();

    // Layered axial shape (the visually compact original presentation) plus a
    // materially explicit rod-channel schematic beside it.
    g.fillStyle = "#898781";
    g.font = "600 10px system-ui, sans-serif";
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    g.fillText("AXIAL CONDITIONS", SCALE_X, TOP - 17);
    g.fillText("TEMP", SCALE_X + FLUX_W - 1, TOP - 17);
    const banksX = SCALE_X + FLUX_W + TEMP_W + 16;
    g.textAlign = "center";
    g.fillText("ABSORBER TIP POSITION", banksX + 2.5 * BANK_W + 2 * BANK_GAP, TOP - 17);
    g.font = "8px system-ui, sans-serif";
    g.fillStyle = "#898781";
    g.fillText("↓ same standard rod     USP ↑", banksX + 2.5 * BANK_W + 2 * BANK_GAP, TOP - 6);

    // Depth scale.
    g.textAlign = "right";
    g.font = "10px system-ui, sans-serif";
    for (let m = 0; m <= 7; m++) {
      const y = this.yAt(m);
      g.fillStyle = "#898781";
      g.fillText(`${m}m`, SCALE_X - 5, y + 3);
      g.strokeStyle = "#2c2c2a";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(SCALE_X, y);
      g.lineTo(SCALE_X + FLUX_W, y);
      g.stroke();
    }
    g.textAlign = "left";
    g.fillStyle = "#52514e";
    g.font = "9px system-ui, sans-serif";
    g.fillText("TOP · coolant outlet ↑", SCALE_X + 2, TOP + 10);
    g.fillText("BOTTOM · coolant inlet ↑", SCALE_X + 2, TOP + coreH - 3);

    // Power profile as a filled area, normalized to its current axial peak.
    const maxFlux = Math.max(1e-12, ...nodes.map((n) => n.flux));
    const fx = (f: number) => SCALE_X + (f / maxFlux) * (FLUX_W - 8);
    g.fillStyle = "#898781";
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "right";
    g.fillText(
      `power peak ${maxFlux >= 0.01 ? maxFlux.toFixed(2) + "×" : maxFlux.toExponential(1) + "×"}`,
      SCALE_X + FLUX_W - 2,
      TOP - 2,
    );
    g.textAlign = "left";
    g.beginPath();
    g.moveTo(SCALE_X, this.yAt(0));
    for (let k = 0; k < N_AXIAL; k++) {
      const y = this.yAt(((k + 0.5) / N_AXIAL) * CORE_HEIGHT);
      g.lineTo(fx(nodes[k]!.flux), y);
    }
    g.lineTo(SCALE_X, this.yAt(CORE_HEIGHT));
    g.closePath();
    const grad = g.createLinearGradient(SCALE_X, 0, SCALE_X + FLUX_W, 0);
    grad.addColorStop(0, "rgba(217, 89, 38, 0.12)");
    grad.addColorStop(1, "rgba(217, 89, 38, 0.55)");
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = "#d95926";
    g.lineWidth = 2;
    g.stroke();

    const label = (text: string, x: number, y: number, color: string): void => {
      g.font = "600 9px system-ui, sans-serif";
      const tw = g.measureText(text).width;
      g.fillStyle = "rgba(13,13,13,0.82)";
      g.fillRect(x - 2, y - 9, tw + 4, 12);
      g.fillStyle = color;
      g.fillText(text, x, y);
    };
    const peakK = nodes.reduce(
      (best, node, k) => node.flux > nodes[best]!.flux ? k : best,
      0,
    );
    label(
      "POWER",
      Math.min(SCALE_X + FLUX_W - 36, fx(nodes[peakK]!.flux) + 4),
      this.yAt(((peakK + 0.5) / N_AXIAL) * CORE_HEIGHT) - 4,
      "#f0713d",
    );

    // Steam void fraction: dashed blue, absolute 0..100% across the width.
    g.beginPath();
    for (let k = 0; k < N_AXIAL; k++) {
      const y = this.yAt(((k + 0.5) / N_AXIAL) * CORE_HEIGHT);
      const x = SCALE_X + nodes[k]!.voidFrac * (FLUX_W - 8);
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = "rgba(13,13,13,0.9)";
    g.lineWidth = 4;
    g.setLineDash([4, 3]);
    g.stroke();
    g.strokeStyle = "#9ec5f4";
    g.lineWidth = 2.5;
    g.setLineDash([4, 3]);
    g.stroke();
    const steamK = 2;
    label(
      "STEAM",
      Math.min(SCALE_X + FLUX_W - 37, SCALE_X + nodes[steamK]!.voidFrac * (FLUX_W - 8) + 5),
      this.yAt(((steamK + 0.5) / N_AXIAL) * CORE_HEIGHT) - 3,
      "#9ec5f4",
    );

    // Xenon poison: dotted amber, 0..2x the core average across the width.
    const xeMean =
      nodes.reduce((a, n) => a + n.xenon, 0) / N_AXIAL || 1;
    if (xeMean > 1e-6) {
      g.beginPath();
      for (let k = 0; k < N_AXIAL; k++) {
        const y = this.yAt(((k + 0.5) / N_AXIAL) * CORE_HEIGHT);
        const relXe = nodes[k]!.xenon / xeMean; // ~1 when flat
        const x = SCALE_X + Math.min(1, relXe / 2) * (FLUX_W - 8);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = "rgba(13,13,13,0.9)";
      g.lineWidth = 4;
      g.setLineDash([2, 3]);
      g.stroke();
      g.strokeStyle = "#fab219";
      g.lineWidth = 2.5;
      g.setLineDash([2, 3]);
      g.stroke();
      const xenonK = 6;
      const relXe = nodes[xenonK]!.xenon / xeMean;
      label(
        "XENON",
        Math.min(SCALE_X + FLUX_W - 38, SCALE_X + Math.min(1, relXe / 2) * (FLUX_W - 8) + 5),
        this.yAt(((xenonK + 0.5) / N_AXIAL) * CORE_HEIGHT) - 3,
        "#fab219",
      );
    }
    g.setLineDash([]);

    // Coolant temperature strip (inlet blue -> saturation amber).
    const tx = SCALE_X + FLUX_W + 4;
    for (let k = 0; k < N_AXIAL; k++) {
      const y0 = this.yAt((k / N_AXIAL) * CORE_HEIGHT);
      const y1 = this.yAt(((k + 1) / N_AXIAL) * CORE_HEIGHT);
      const t = Math.min(
        1,
        Math.max(0, (nodes[k]!.coolantTemp - T_INLET) / (T_SAT - T_INLET)),
      );
      g.fillStyle = `rgba(${Math.round(60 + 141 * t)}, ${Math.round(120 + 13 * t)}, ${Math.round(220 - 220 * t + 0)}, 0.85)`;
      g.fillRect(tx, y0, TEMP_W - 4, y1 - y0 + 0.5);
    }
    g.strokeStyle = "rgba(255,255,255,0.12)";
    g.strokeRect(tx, TOP, TEMP_W - 4, coreH);
    g.fillStyle = "#deddd5";
    g.font = "600 8px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText(`${Math.round(nodes[0]!.coolantTemp)}°`, tx + (TEMP_W - 4) / 2, TOP + 10);
    g.fillText(`${Math.round(nodes[N_AXIAL - 1]!.coolantTemp)}°`, tx + (TEMP_W - 4) / 2, TOP + coreH - 3);

    // Bank-position tracks deliberately avoid drawing clipped material
    // intervals. A single marker answers the operator's useful question:
    // where is this bank's absorber tip? Standard banks share one design.
    let x = banksX;
    g.textAlign = "center";
    for (const group of GROUPS) {
      const members = rods.filter((r) => r.group === group);
      const ins =
        members.reduce((a, r) => a + r.insertion, 0) / Math.max(1, members.length);
      const moving = members.some((r) => Math.abs(r.target - r.insertion) > 1e-6);
      const dirIn =
        members.reduce((a, r) => a + (r.target - r.insertion), 0) > 0;

      g.fillStyle = "rgba(32,63,99,0.35)";
      g.fillRect(x + 9, TOP, 12, coreH);
      g.strokeStyle = "rgba(158,197,244,0.35)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + BANK_W / 2, TOP);
      g.lineTo(x + BANK_W / 2, TOP + coreH);
      g.stroke();

      const markerDepth = group === "USP"
        ? CORE_HEIGHT - ins * 3.05
        : ins * CORE_HEIGHT;
      const markerY = this.yAt(markerDepth);
      g.strokeStyle = ABSORBER_COLOR;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x + BANK_W / 2, group === "USP" ? TOP + coreH : TOP);
      g.lineTo(x + BANK_W / 2, markerY);
      g.stroke();
      g.fillStyle = ABSORBER_COLOR;
      g.beginPath();
      g.arc(x + BANK_W / 2, markerY, 5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1.5;
      g.stroke();

      // Labels: group, depth, motion arrow.
      g.font = "600 10px system-ui, sans-serif";
      g.fillStyle = "#ffffff";
      g.fillText(group, x + BANK_W / 2, this.h - 18);
      g.font = "10px system-ui, sans-serif";
      g.fillStyle = ABSORBER_COLOR;
      const stroke = group === "USP" ? 3.05 : CORE_HEIGHT;
      g.fillText(`${(ins * stroke).toFixed(1)}m`, x + BANK_W / 2, this.h - 6);
      if (moving) {
        g.fillStyle = "#ffffff";
        g.fillText(dirIn ? "▼" : "▲", x + BANK_W / 2, TOP - 2);
      }

      x += BANK_W + BANK_GAP;
    }
  }
}
