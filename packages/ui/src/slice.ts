import type { NodeState, RodGroup, RodState } from "@rbmk/sim-core";
import {
  CORE_HEIGHT,
  N_AXIAL,
  T_INLET,
  T_SAT,
  absorberInterval,
  displacerInterval,
} from "@rbmk/sim-core";

const GROUPS: RodGroup[] = ["RR", "AR", "LAR", "AZ", "USP"];

/** Layout constants (logical px). */
const TOP = 26;
const BOTTOM_PAD = 30;
const SCALE_X = 30; // depth scale gutter
const FLUX_W = 150; // flux/void plot width
const TEMP_W = 16; // coolant temperature strip
const BANK_W = 30; // per-bank column width
const BANK_GAP = 10;

/**
 * Axial cutaway of the core, top of core at the top of the plot:
 * flux profile (filled area) + void curve + coolant temperature strip +
 * one column per rod bank with true absorber/displacer geometry.
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
        `${group} bank (${members.length} rods) — mean depth ` +
        `${(ins * CORE_HEIGHT).toFixed(2)} m${moving ? " · MOVING" : ""}`
      );
    }

    if (px < SCALE_X || px > SCALE_X + FLUX_W + TEMP_W + 6) return null;
    const k = Math.min(N_AXIAL - 1, Math.floor((depth / CORE_HEIGHT) * N_AXIAL));
    const n = this.lastNodes[k];
    if (!n) return null;
    return (
      `depth ${depth.toFixed(1)} m — flux ${n.flux.toFixed(2)}× · ` +
      `void ${(n.voidFrac * 100).toFixed(0)}% · fuel ${Math.round(n.fuelTemp)}°C · ` +
      `coolant ${n.coolantTemp.toFixed(1)}°C`
    );
  }

  draw(nodes: NodeState[], rods: RodState[]): void {
    this.lastNodes = nodes;
    this.lastRods = rods;
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    const coreH = this.coreH();

    // Section headers.
    g.fillStyle = "#898781";
    g.font = "600 10px system-ui, sans-serif";
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    g.fillText("FLUX + VOID", SCALE_X, TOP - 12);
    g.fillText("T", SCALE_X + FLUX_W + 4, TOP - 12);
    g.fillText("ROD BANKS (absorber / displacer / water)", SCALE_X + FLUX_W + TEMP_W + 16, TOP - 12);

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
    g.fillText("top of core", SCALE_X + 2, TOP + 9);
    g.fillText("bottom", SCALE_X + 2, TOP + coreH - 3);

    // Flux profile as a filled area (x = flux, y = depth), normalized to its
    // own peak so the SHAPE reads at any power; the peak label carries the
    // absolute scale.
    const maxFlux = Math.max(1e-12, ...nodes.map((n) => n.flux));
    const fx = (f: number) => SCALE_X + (f / maxFlux) * (FLUX_W - 8);
    g.fillStyle = "#898781";
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "right";
    g.fillText(
      `peak ${maxFlux >= 0.01 ? maxFlux.toFixed(2) + "x" : maxFlux.toExponential(1) + "x"}`,
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

    // Void curve (0..1 across the same width).
    g.beginPath();
    for (let k = 0; k < N_AXIAL; k++) {
      const y = this.yAt(((k + 0.5) / N_AXIAL) * CORE_HEIGHT);
      const x = SCALE_X + nodes[k]!.voidFrac * (FLUX_W - 8);
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = "#9ec5f4";
    g.lineWidth = 2;
    g.setLineDash([4, 3]);
    g.stroke();

    // Xenon axial distribution (dotted amber), relative to its own mean so
    // the axial DISTORTION is what reads - watch it crawl during transients.
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
      g.strokeStyle = "#c98500";
      g.lineWidth = 1.5;
      g.setLineDash([2, 3]);
      g.stroke();
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

    // Rod banks with true geometry, one column per group.
    let x = SCALE_X + FLUX_W + TEMP_W + 16;
    g.textAlign = "center";
    for (const group of GROUPS) {
      const members = rods.filter((r) => r.group === group);
      const ins =
        members.reduce((a, r) => a + r.insertion, 0) / Math.max(1, members.length);
      const moving = members.some((r) => Math.abs(r.target - r.insertion) > 1e-6);
      const dirIn =
        members.reduce((a, r) => a + (r.target - r.insertion), 0) > 0;

      // Channel water.
      g.fillStyle = "rgba(57, 135, 229, 0.16)";
      g.fillRect(x, TOP, BANK_W, coreH);

      const fake = { group, insertion: ins };
      const disp = displacerInterval(fake);
      if (disp) {
        g.fillStyle = "#52514e";
        g.fillRect(x, this.yAt(disp[0]), BANK_W, this.yAt(disp[1]) - this.yAt(disp[0]));
      }
      const abs = absorberInterval(fake);
      if (abs) {
        g.fillStyle = "#c3c2b7";
        g.fillRect(x, this.yAt(abs[0]), BANK_W, this.yAt(abs[1]) - this.yAt(abs[0]));
      }
      g.strokeStyle = "rgba(255,255,255,0.14)";
      g.strokeRect(x, TOP, BANK_W, coreH);

      // Labels: group, depth, motion arrow.
      g.font = "600 10px system-ui, sans-serif";
      g.fillStyle = "#c3c2b7";
      g.fillText(group, x + BANK_W / 2, this.h - 18);
      g.font = "10px system-ui, sans-serif";
      g.fillStyle = "#898781";
      g.fillText(`${(ins * CORE_HEIGHT).toFixed(1)}m`, x + BANK_W / 2, this.h - 6);
      if (moving) {
        g.fillStyle = "#ffffff";
        g.fillText(dirIn ? "▼" : "▲", x + BANK_W / 2, TOP - 2);
      }

      x += BANK_W + BANK_GAP;
    }
  }
}
