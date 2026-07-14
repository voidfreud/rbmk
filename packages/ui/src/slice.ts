import type { NodeState, RodGroup, RodState } from "@rbmk/sim-core";
import {
  CORE_HEIGHT,
  N_AXIAL,
  absorberInterval,
  displacerInterval,
} from "@rbmk/sim-core";

const GROUPS: RodGroup[] = ["RR", "AR", "LAR", "AZ", "USP"];
const GROUP_SHORT: Record<RodGroup, string> = {
  RR: "RR",
  AR: "AR",
  LAR: "LAR",
  AZ: "AZ",
  USP: "USP",
};

/**
 * Axial cutaway: flux glow bands with a void overlay on the left,
 * per-group schematic rods (absorber / displacer / water) on the right.
 */
export class Slice {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w: number;
  private readonly h: number;

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

  draw(nodes: NodeState[], rods: RodState[]): void {
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);

    const top = 18;
    const coreH = this.h - top - 26;
    const bandH = coreH / N_AXIAL;
    const fluxW = 116;
    const fluxX = 34;

    // Depth scale (meters from top).
    g.fillStyle = "#898781";
    g.font = "10px system-ui, sans-serif";
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (let m = 0; m <= 7; m++) {
      const y = top + (m / CORE_HEIGHT) * coreH;
      g.fillText(`${m}`, fluxX - 6, y);
      g.strokeStyle = "#2c2c2a";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(fluxX - 3, y);
      g.lineTo(fluxX, y);
      g.stroke();
    }
    g.textAlign = "left";
    g.fillText("m", fluxX - 14, top - 9);

    // Flux glow: orange, alpha by node flux (node 0 = top).
    const maxFlux = Math.max(0.001, ...nodes.map((n) => n.flux));
    for (let k = 0; k < N_AXIAL; k++) {
      const y = top + k * bandH;
      const f = nodes[k]!.flux;
      const rel = f / maxFlux;
      g.fillStyle = `rgba(217, 89, 38, ${0.06 + 0.82 * rel * rel})`;
      g.fillRect(fluxX, y, fluxW * (0.35 + 0.65 * rel), bandH - 1);

      // Void overlay: pale dots, density by void fraction.
      const v = nodes[k]!.voidFrac;
      if (v > 0.01) {
        g.fillStyle = "rgba(158, 197, 244, 0.85)";
        const dots = Math.round(v * 22);
        for (let d = 0; d < dots; d++) {
          // Deterministic pseudo-positions (no randomness in render).
          const px = fluxX + 6 + ((d * 37 + k * 13) % (fluxW - 16));
          const py = y + 2 + ((d * 23 + k * 7) % (bandH - 5));
          g.fillRect(px, py, 2, 2);
        }
      }
    }
    g.strokeStyle = "rgba(255,255,255,0.10)";
    g.strokeRect(fluxX, top, fluxW, coreH);

    // Group rods: mean insertion per group, drawn with true geometry.
    const rodW = 20;
    const gap = 11;
    let x = fluxX + fluxW + 16;
    g.textAlign = "center";
    for (const group of GROUPS) {
      const members = rods.filter((r) => r.group === group);
      const ins =
        members.reduce((a, r) => a + r.insertion, 0) / Math.max(1, members.length);

      const yAt = (meters: number) => top + (meters / CORE_HEIGHT) * coreH;

      // Channel filled with water.
      g.fillStyle = "rgba(57, 135, 229, 0.18)";
      g.fillRect(x, top, rodW, coreH);

      // True geometry from sim-core: displacer (standard rods) and absorber
      // (from the top for RR/AR/LAR/AZ, from the BOTTOM for USP).
      const fake = { group, insertion: ins };
      const disp = displacerInterval(fake);
      if (disp) {
        g.fillStyle = "#52514e";
        g.fillRect(x, yAt(disp[0]), rodW, yAt(disp[1]) - yAt(disp[0]));
      }
      const abs = absorberInterval(fake);
      if (abs) {
        g.fillStyle = "#c3c2b7";
        g.fillRect(x, yAt(abs[0]), rodW, yAt(abs[1]) - yAt(abs[0]));
      }

      g.strokeStyle = "rgba(255,255,255,0.14)";
      g.strokeRect(x, top, rodW, coreH);

      g.fillStyle = "#898781";
      g.font = "10px system-ui, sans-serif";
      g.textBaseline = "alphabetic";
      g.fillText(GROUP_SHORT[group], x + rodW / 2, this.h - 12);
      g.fillStyle = "#c3c2b7";
      g.fillText(`${(ins * CORE_HEIGHT).toFixed(1)}m`, x + rodW / 2, this.h - 1);

      x += rodW + gap;
    }
  }
}
