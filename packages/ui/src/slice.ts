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
const PROFILE_W = 44; // one independent condition lane
const PROFILE_GAP = 6;
const CONDITION_W = PROFILE_W * 3 + PROFILE_GAP * 2;
const TEMP_W = 12; // coolant temperature strip
const BANK_W = 28; // per-bank column width
const BANK_GAP = 7;

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
    const banksX = SCALE_X + CONDITION_W + TEMP_W + 18;
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

    if (px < SCALE_X || px > SCALE_X + CONDITION_W + TEMP_W + 6) return null;
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

    // Direct lane headers: every condition has its own honest horizontal
    // scale. Farther right always means "more" within that lane.
    g.fillStyle = "#898781";
    g.font = "600 9px system-ui, sans-serif";
    g.textBaseline = "alphabetic";
    g.textAlign = "center";
    const profileX = (lane: number) => SCALE_X + lane * (PROFILE_W + PROFILE_GAP);
    g.fillStyle = "#d95926";
    g.fillText("POWER", profileX(0) + PROFILE_W / 2, TOP - 17);
    g.fillStyle = "#9ec5f4";
    g.fillText("STEAM", profileX(1) + PROFILE_W / 2, TOP - 17);
    g.fillStyle = "#c98500";
    g.fillText("XENON", profileX(2) + PROFILE_W / 2, TOP - 17);
    g.fillStyle = "#898781";
    g.font = "8px system-ui, sans-serif";
    g.fillText("0 → peak", profileX(0) + PROFILE_W / 2, TOP - 6);
    g.fillText("0 → 100%", profileX(1) + PROFILE_W / 2, TOP - 6);
    g.fillText("0 → 2×avg", profileX(2) + PROFILE_W / 2, TOP - 6);
    const tx = SCALE_X + CONDITION_W + 4;
    g.save();
    g.translate(tx + 7, TOP - 5);
    g.rotate(-Math.PI / 2);
    g.fillText("TEMP", 0, 0);
    g.restore();
    const banksX = SCALE_X + CONDITION_W + TEMP_W + 18;
    g.font = "600 9px system-ui, sans-serif";
    g.fillText("ROD BANKS", banksX + 2.5 * BANK_W + 2 * BANK_GAP, TOP - 12);

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
      g.lineTo(SCALE_X + CONDITION_W, y);
      g.stroke();
    }
    g.textAlign = "left";
    g.fillStyle = "#52514e";
    g.font = "9px system-ui, sans-serif";
    g.fillText("TOP · coolant outlet ↑", SCALE_X + 2, TOP + 10);
    g.fillText("BOTTOM · coolant inlet ↑", SCALE_X + 2, TOP + coreH - 3);

    // Three separate condition profiles. They share depth/time but never share
    // a horizontal scale, which makes the picture readable without decoding
    // line styles or comparing unlike units.
    for (let lane = 0; lane < 3; lane++) {
      const x0 = profileX(lane);
      g.fillStyle = "rgba(255,255,255,0.025)";
      g.fillRect(x0, TOP, PROFILE_W, coreH);
      g.strokeStyle = "rgba(255,255,255,0.10)";
      g.strokeRect(x0, TOP, PROFILE_W, coreH);
      g.strokeStyle = "rgba(255,255,255,0.08)";
      g.beginPath();
      g.moveTo(x0 + PROFILE_W / 2, TOP);
      g.lineTo(x0 + PROFILE_W / 2, TOP + coreH);
      g.stroke();
    }

    // Power profile, normalized to its current axial peak.
    const maxFlux = Math.max(1e-12, ...nodes.map((n) => n.flux));
    const powerX = profileX(0);
    const fx = (f: number) => powerX + (f / maxFlux) * (PROFILE_W - 3);
    g.fillStyle = "#d95926";
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "left";
    g.fillText(
      `peak ${maxFlux >= 0.01 ? maxFlux.toFixed(2) + "×" : maxFlux.toExponential(1) + "×"}`,
      powerX,
      this.h - 5,
    );
    g.beginPath();
    g.moveTo(powerX, this.yAt(0));
    for (let k = 0; k < N_AXIAL; k++) {
      const y = this.yAt(((k + 0.5) / N_AXIAL) * CORE_HEIGHT);
      g.lineTo(fx(nodes[k]!.flux), y);
    }
    g.lineTo(powerX, this.yAt(CORE_HEIGHT));
    g.closePath();
    const grad = g.createLinearGradient(powerX, 0, powerX + PROFILE_W, 0);
    grad.addColorStop(0, "rgba(217, 89, 38, 0.12)");
    grad.addColorStop(1, "rgba(217, 89, 38, 0.55)");
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = "#d95926";
    g.lineWidth = 2;
    g.stroke();

    // Steam void fraction, honest 0..100% lane.
    const steamX = profileX(1);
    g.beginPath();
    g.moveTo(steamX, this.yAt(0));
    for (let k = 0; k < N_AXIAL; k++) {
      const y = this.yAt(((k + 0.5) / N_AXIAL) * CORE_HEIGHT);
      g.lineTo(steamX + nodes[k]!.voidFrac * (PROFILE_W - 3), y);
    }
    g.lineTo(steamX, this.yAt(CORE_HEIGHT));
    g.closePath();
    g.fillStyle = "rgba(158,197,244,0.16)";
    g.fill();
    g.strokeStyle = "#9ec5f4";
    g.lineWidth = 2;
    g.stroke();

    // Xenon poison relative to its core average, on a printed 0..2x lane.
    const xenonX = profileX(2);
    const xeMean =
      nodes.reduce((a, n) => a + n.xenon, 0) / N_AXIAL || 1;
    if (xeMean > 1e-6) {
      g.beginPath();
      g.moveTo(xenonX, this.yAt(0));
      for (let k = 0; k < N_AXIAL; k++) {
        const y = this.yAt(((k + 0.5) / N_AXIAL) * CORE_HEIGHT);
        const relXe = nodes[k]!.xenon / xeMean; // ~1 when flat
        g.lineTo(xenonX + Math.min(1, relXe / 2) * (PROFILE_W - 3), y);
      }
      g.lineTo(xenonX, this.yAt(CORE_HEIGHT));
      g.closePath();
      g.fillStyle = "rgba(201,133,0,0.13)";
      g.fill();
      g.strokeStyle = "#c98500";
      g.lineWidth = 2;
      g.stroke();
    }

    // Coolant temperature strip (inlet blue -> saturation amber).
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
      g.fillText(`${(ins * CORE_HEIGHT).toFixed(1)}m in`, x + BANK_W / 2, this.h - 6);
      if (moving) {
        g.fillStyle = "#ffffff";
        g.fillText(dirIn ? "▼" : "▲", x + BANK_W / 2, TOP - 2);
      }

      x += BANK_W + BANK_GAP;
    }
  }
}
