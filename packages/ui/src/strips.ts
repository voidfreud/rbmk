/** A reference threshold drawn on the recorder (trip/warning levels). */
export interface RefLine {
  v: number;
  color: string;
  label: string;
  /** Pull the y-domain out to show this line once data comes near it. */
  stretch?: boolean;
}

/** Rolling strip-chart recorder: one series, crosshair + tooltip on hover. */
export class StripChart {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w: number;
  private readonly h: number;
  private readonly ts: number[] = [];
  private readonly vs: number[] = [];
  private hoverX: number | null = null;
  /** Log10 y-scale (for the log power channel: exponential rise = straight
   * line, slope = reactor period). Values are stored raw; this only changes
   * rendering, so it can be toggled live. */
  logMode = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly color: string,
    private readonly fmt: (v: number) => string,
    private readonly windowSamples = 360,
    private readonly clampAbs?: number,
    private readonly refLines: RefLine[] = [],
  ) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement!.getBoundingClientRect();
    this.w = Math.max(160, rect.width - 20);
    this.h = 128;
    canvas.style.width = `${this.w}px`;
    canvas.style.height = `${this.h}px`;
    canvas.width = this.w * dpr;
    canvas.height = this.h * dpr;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.scale(dpr, dpr);

    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.hoverX = e.clientX - r.left;
    });
    canvas.addEventListener("mouseleave", () => (this.hoverX = null));
  }

  push(t: number, v: number): void {
    if (this.clampAbs !== undefined) {
      v = Math.max(-this.clampAbs, Math.min(this.clampAbs, v));
    }
    this.ts.push(t);
    this.vs.push(v);
    if (this.ts.length > this.windowSamples) {
      this.ts.shift();
      this.vs.shift();
    }
  }

  /** Clear the trace (e.g. after re-init rewinds sim time to 0). */
  reset(): void {
    this.ts.length = 0;
    this.vs.length = 0;
    this.hoverX = null;
  }

  draw(): void {
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    if (this.vs.length < 2) return;

    // In log mode all y-positions run through log10; data stays raw.
    const tv = (v: number) => (this.logMode ? Math.log10(Math.max(v, 1e-7)) : v);
    const inv = (u: number) => (this.logMode ? 10 ** u : u);

    let lo = Math.min(...this.vs.map(tv));
    let hi = Math.max(...this.vs.map(tv));
    if (hi - lo < 1e-9) {
      hi += 1;
      lo -= 1;
    }
    // Stretch the domain to reveal a threshold once data approaches it.
    if (!this.logMode) {
      for (const ref of this.refLines) {
        if (!ref.stretch) continue;
        if (ref.v > 0 && hi > ref.v * 0.55) hi = Math.max(hi, ref.v * 1.06);
        if (ref.v < 0 && lo < ref.v * 0.55) lo = Math.min(lo, ref.v * 1.06);
      }
    }
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;

    const x = (i: number) => (i / (this.windowSamples - 1)) * this.w;
    const y = (v: number) => this.h - ((tv(v) - lo) / (hi - lo)) * (this.h - 18) - 4;
    const i0 = this.windowSamples - this.vs.length;

    // Hairline gridlines at min/mid/max.
    g.strokeStyle = "#2c2c2a";
    g.lineWidth = 1;
    g.font = "10px system-ui, sans-serif";
    g.textBaseline = "middle";
    g.textAlign = "left";
    for (const u of [lo + pad, (lo + hi) / 2, hi - pad]) {
      const yy = this.h - ((u - lo) / (hi - lo)) * (this.h - 18) - 4;
      g.beginPath();
      g.moveTo(0, yy);
      g.lineTo(this.w, yy);
      g.stroke();
      g.fillStyle = "#898781";
      g.fillText(this.fmt(inv(u)), 3, yy - 6);
    }

    // Zero line if in range (for reactivity; meaningless on a log scale).
    if (!this.logMode && lo < 0 && hi > 0) {
      g.strokeStyle = "#383835";
      g.beginPath();
      g.moveTo(0, y(0));
      g.lineTo(this.w, y(0));
      g.stroke();
    }

    // Threshold lines (trip / working limits), dashed in status colors.
    for (const ref of this.refLines) {
      if (tv(ref.v) <= lo || tv(ref.v) >= hi) continue;
      const yy = y(ref.v);
      g.strokeStyle = ref.color;
      g.lineWidth = 1;
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(0, yy);
      g.lineTo(this.w, yy);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = ref.color;
      g.font = "9px system-ui, sans-serif";
      g.textAlign = "right";
      g.textBaseline = "bottom";
      g.fillText(ref.label, this.w - 3, yy - 1);
    }

    // Series.
    g.strokeStyle = this.color;
    g.lineWidth = 2;
    g.lineJoin = "round";
    g.beginPath();
    for (let i = 0; i < this.vs.length; i++) {
      const px = x(i0 + i);
      const py = y(this.vs[i]!);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();

    // Current value, direct label.
    const cur = this.vs[this.vs.length - 1]!;
    g.fillStyle = "#ffffff";
    g.font = "600 13px system-ui, sans-serif";
    g.textAlign = "right";
    g.fillText(this.fmt(cur), this.w - 4, 10);

    // Time axis: sim time at the window's left edge and now at the right.
    if (this.hoverX === null) {
      g.fillStyle = "#52514e";
      g.font = "9px system-ui, sans-serif";
      g.textAlign = "left";
      g.fillText(hms(this.ts[0]!), 3, this.h - 3);
      g.textAlign = "right";
      g.fillText(hms(this.ts[this.ts.length - 1]!), this.w - 3, this.h - 3);
    }

    // Crosshair + tooltip.
    if (this.hoverX !== null) {
      const i = Math.round((this.hoverX / this.w) * (this.windowSamples - 1)) - i0;
      if (i >= 0 && i < this.vs.length) {
        const px = x(i0 + i);
        const py = y(this.vs[i]!);
        g.strokeStyle = "#898781";
        g.lineWidth = 1;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(px, 0);
        g.lineTo(px, this.h);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = this.color;
        g.beginPath();
        g.arc(px, py, 4, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "#131312";
        g.lineWidth = 2;
        g.stroke();

        const label = `${this.fmt(this.vs[i]!)} @ ${hms(this.ts[i]!)}`;
        g.font = "11px system-ui, sans-serif";
        const tw = g.measureText(label).width + 10;
        const tx = Math.min(this.w - tw, Math.max(0, px - tw / 2));
        g.fillStyle = "#1a1a19";
        g.beginPath();
        g.roundRect(tx, this.h - 18, tw, 16, 4);
        g.fill();
        g.strokeStyle = "rgba(255,255,255,0.10)";
        g.lineWidth = 1;
        g.stroke();
        g.fillStyle = "#ffffff";
        g.textAlign = "center";
        g.fillText(label, tx + tw / 2, this.h - 10);
      }
    }
  }
}

export function hms(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
