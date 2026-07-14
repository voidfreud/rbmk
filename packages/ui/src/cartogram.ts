import type { RodState } from "@rbmk/sim-core";
import { CORE_HEIGHT } from "@rbmk/sim-core";

/** Sequential blue ramp (palette steps 650..250): withdrawn -> inserted. */
const RAMP = [
  "#104281", "#184f95", "#1c5cab", "#256abf", "#2a78d6",
  "#3987e5", "#5598e7", "#6da7ec", "#86b6ef", "#9ec5f4",
];

const GROUP_GLYPH: Record<string, string> = {
  AR: "A",
  LAR: "L",
  AZ: "Z",
  USP: "S",
  RR: "",
};

/** Top-down core map: one square per rod, colored by insertion depth. */
export class Cartogram {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scale: number;
  private readonly cx: number;
  private readonly cy: number;
  private readonly cell: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly rods: RodState[],
  ) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${canvas.height}px`;
    canvas.width = w * dpr;
    canvas.height = canvas.height * dpr;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.scale(dpr, dpr);
    this.cx = w / 2;
    this.cy = w / 2;
    this.scale = w / 19; // lattice spans roughly -8.6..8.6
    this.cell = this.scale * 0.82;
  }

  rodCenter(rod: RodState): [number, number] {
    return [this.cx + rod.x * this.scale, this.cy + rod.y * this.scale];
  }

  /** Rod under a client-space point, or null. */
  hit(clientX: number, clientY: number): RodState | null {
    const r = this.canvas.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    let best: RodState | null = null;
    let bestD = this.cell; // generous hit target
    for (const rod of this.rods) {
      const [x, y] = this.rodCenter(rod);
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) {
        bestD = d;
        best = rod;
      }
    }
    return best;
  }

  rodsInRect(ax: number, ay: number, bx: number, by: number): RodState[] {
    const r = this.canvas.getBoundingClientRect();
    const x0 = Math.min(ax, bx) - r.left;
    const x1 = Math.max(ax, bx) - r.left;
    const y0 = Math.min(ay, by) - r.top;
    const y1 = Math.max(ay, by) - r.top;
    return this.rods.filter((rod) => {
      const [x, y] = this.rodCenter(rod);
      return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    });
  }

  draw(selected: Set<number>, dragRect: [number, number, number, number] | null): void {
    const g = this.ctx;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    g.clearRect(0, 0, w, w);

    // Core barrel.
    g.beginPath();
    g.arc(this.cx, this.cy, this.scale * 9.15, 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,255,255,0.10)";
    g.lineWidth = 2;
    g.stroke();

    for (const rod of this.rods) {
      const [x, y] = this.rodCenter(rod);
      const c = this.cell;
      const idx = Math.max(0, Math.min(RAMP.length - 1, Math.round(rod.insertion * (RAMP.length - 1))));

      // Selsyn-style level indicator: the cell is the 7 m channel, the fill
      // is the absorber depth - from the top for standard rods, from the
      // BOTTOM for USP shortened absorbers.
      g.fillStyle = "#1f1f1e";
      g.beginPath();
      g.roundRect(x - c / 2, y - c / 2, c, c, 3);
      g.fill();
      const fillH = c * rod.insertion;
      if (fillH > 0.5) {
        g.fillStyle = RAMP[idx]!;
        if (rod.group === "USP") {
          g.fillRect(x - c / 2, y + c / 2 - fillH, c, fillH);
        } else {
          g.fillRect(x - c / 2, y - c / 2, c, fillH);
        }
      }
      g.strokeStyle = "rgba(255,255,255,0.13)";
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(x - c / 2, y - c / 2, c, c, 3);
      g.stroke();

      if (rod.target !== rod.insertion) {
        // Drive in motion: small moving tick on the edge.
        g.fillStyle = "#ffffff";
        g.fillRect(x - 1.5, y - c / 2 - 3, 3, 3);
      }

      const glyph = GROUP_GLYPH[rod.group]!;
      if (glyph) {
        g.fillStyle = "#c3c2b7";
        g.font = "8px system-ui, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(glyph, x + c / 2 - 4, y - c / 2 + 4.5);
      }

      if (selected.has(rod.id)) {
        g.strokeStyle = "#ffffff";
        g.lineWidth = 2;
        g.beginPath();
        g.roundRect(x - c / 2 - 1.5, y - c / 2 - 1.5, c + 3, c + 3, 4);
        g.stroke();
      }
    }

    if (dragRect) {
      const r = this.canvas.getBoundingClientRect();
      const [ax, ay, bx, by] = dragRect;
      g.strokeStyle = "#3987e5";
      g.setLineDash([4, 3]);
      g.lineWidth = 1;
      g.strokeRect(
        Math.min(ax, bx) - r.left,
        Math.min(ay, by) - r.top,
        Math.abs(bx - ax),
        Math.abs(by - ay),
      );
      g.setLineDash([]);
    }
  }
}

/** Real-style rod coordinate name, column-row on the lattice (e.g. "33-27"). */
export function rodCoord(rod: RodState): string {
  const col = (rod.x + 9) * 3;
  const row = (rod.y + 9) * 3;
  return `${String(col).padStart(2, "0")}-${String(row).padStart(2, "0")}`;
}

export function depthLabel(rod: RodState): string {
  const m = (rod.insertion * CORE_HEIGHT).toFixed(2);
  return `${rodCoord(rod)} ${rod.group} — inserted ${m} m (${Math.round(rod.insertion * 100)}%)`;
}
