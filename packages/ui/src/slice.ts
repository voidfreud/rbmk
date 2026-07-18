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
const TOP = 34;
const BOTTOM_PAD = 30;
const SCALE_X = 30; // depth scale gutter
const FLUX_W = 150; // layered power/void/xenon profile
const TEMP_W = 16; // coolant temperature strip
const BANK_W = 30; // per-bank channel width
const BANK_GAP = 10;
const ABSORBER_COLOR = "#d55181";
const GRAPHITE_COLOR = "#686762";
const WATER_COLOR = "#203f63";

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
      const material = (() => {
        const fake = { group, insertion: ins };
        const abs = absorberInterval(fake);
        if (abs && depth >= abs[0] && depth <= abs[1]) return "ABSORBER — suppresses fission";
        const disp = displacerInterval(fake);
        if (disp && depth >= disp[0] && depth <= disp[1]) return "GRAPHITE DISPLACER";
        return "WATER-FILLED CHANNEL";
      })();
      return (
        `${group} bank (${members.length} rods) — ${material} at ${depth.toFixed(1)} m · ` +
        `bank ${(ins * CORE_HEIGHT).toFixed(2)} m inserted${moving ? " · MOVING" : ""}`
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
    g.fillText("POWER + STEAM + XENON", SCALE_X, TOP - 17);
    g.fillText("T", SCALE_X + FLUX_W + 4, TOP - 17);
    const banksX = SCALE_X + FLUX_W + TEMP_W + 16;
    g.textAlign = "center";
    g.fillText("ROD BANKS · CHANNEL CONTENTS", banksX + 2.5 * BANK_W + 2 * BANK_GAP, TOP - 17);
    g.font = "8px system-ui, sans-serif";
    g.fillStyle = "#898781";
    g.fillText("0 m OUT ↓ INSERT ↓ 7 m IN", banksX + 2.5 * BANK_W + 2 * BANK_GAP, TOP - 6);

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

    // Steam void fraction: dashed blue, absolute 0..100% across the width.
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
    let x = banksX;
    g.textAlign = "center";
    for (const group of GROUPS) {
      const members = rods.filter((r) => r.group === group);
      const ins =
        members.reduce((a, r) => a + r.insertion, 0) / Math.max(1, members.length);
      const moving = members.some((r) => Math.abs(r.target - r.insertion) > 1e-6);
      const dirIn =
        members.reduce((a, r) => a + (r.target - r.insertion), 0) > 0;

      // Physical channel contents. Strong semantic colors make the geometry
      // legible at a glance: pink absorbs neutrons, gray is graphite, blue is
      // the water-filled gap left by the moving assembly.
      g.fillStyle = WATER_COLOR;
      g.fillRect(x, TOP, BANK_W, coreH);

      const fake = { group, insertion: ins };
      const disp = displacerInterval(fake);
      if (disp) {
        const y0 = this.yAt(disp[0]);
        const dh = this.yAt(disp[1]) - y0;
        g.fillStyle = GRAPHITE_COLOR;
        g.fillRect(x, y0, BANK_W, dh);
        if (dh > 22) {
          g.fillStyle = "#deddd5";
          g.font = "600 7px system-ui, sans-serif";
          g.fillText("GR", x + BANK_W / 2, y0 + dh / 2 + 2);
        }
      }
      const abs = absorberInterval(fake);
      if (abs) {
        const y0 = this.yAt(abs[0]);
        const ah = this.yAt(abs[1]) - y0;
        g.fillStyle = ABSORBER_COLOR;
        g.fillRect(x, y0, BANK_W, ah);
        if (ah > 22) {
          g.fillStyle = "#ffffff";
          g.font = "600 7px system-ui, sans-serif";
          g.fillText("ABS", x + BANK_W / 2, y0 + ah / 2 + 2);
        }
      }
      g.strokeStyle = "rgba(255,255,255,0.25)";
      g.strokeRect(x, TOP, BANK_W, coreH);

      // Commanded insertion reference: 0 m is the top/fully-out end and 7 m
      // is the bottom/fully-in end. The colored material remains the physical
      // truth (especially for bottom-entering USP rods).
      const markerY = this.yAt(ins * CORE_HEIGHT);
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x - 2, markerY);
      g.lineTo(x + BANK_W + 2, markerY);
      g.stroke();

      // Labels: group, depth, motion arrow.
      g.font = "600 10px system-ui, sans-serif";
      g.fillStyle = "#ffffff";
      g.fillText(group, x + BANK_W / 2, this.h - 18);
      g.font = "10px system-ui, sans-serif";
      g.fillStyle = ABSORBER_COLOR;
      g.fillText(`${(ins * CORE_HEIGHT).toFixed(1)}m in`, x + BANK_W / 2, this.h - 6);
      if (moving) {
        g.fillStyle = "#ffffff";
        g.fillText(dirIn ? "▼" : "▲", x + BANK_W / 2, TOP - 2);
      }

      x += BANK_W + BANK_GAP;
    }
  }
}
