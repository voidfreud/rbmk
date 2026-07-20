import { hms } from "@rbmk/sim-core";

/** Re-export shared sim-time formatter (lives in sim-core). */
export { hms };

/** A reference threshold drawn on the recorder (trip/warning levels). */
export interface RefLine {
  v: number;
  color: string;
  label: string;
}

export interface TrendSeries {
  id: string;
  label: string;
  color: string;
  fmt: (v: number) => string;
  clampAbs?: number;
  refLines?: RefLine[];
}

/**
 * Shared-time recorder. Every enabled signal gets its own vertical lane and
 * scale, so unlike a multi-axis overlay the shapes align in time without
 * pretending that %, seconds, beta, and xenon share units.
 */
export class MultiTrendChart {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w: number;
  private readonly h = 180;
  private readonly ts: number[];
  private readonly values = new Map<string, number[]>();
  private head = 0;
  private count = 0;
  private shownCache: TrendSeries[];
  private readonly enabled: Set<string>;
  private hoverX: number | null = null;
  powerLogMode = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly series: TrendSeries[],
    enabled: string[],
    private readonly windowSamples = 360,
  ) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement!.getBoundingClientRect();
    this.w = Math.max(420, rect.width - 20);
    this.enabled = new Set(enabled);
    this.ts = new Array(this.windowSamples).fill(0);
    for (const s of series) {
      this.values.set(s.id, new Array(this.windowSamples).fill(0));
    }
    this.shownCache = series.filter((s) => this.enabled.has(s.id));
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

  setEnabled(id: string, enabled: boolean): void {
    if (enabled) this.enabled.add(id);
    else this.enabled.delete(id);
    this.shownCache = this.series.filter((s) => this.enabled.has(s.id));
  }

  isEnabled(id: string): boolean {
    return this.enabled.has(id);
  }

  push(t: number, frame: Record<string, number>): void {
    const idx = (this.head + this.count) % this.windowSamples;
    this.ts[idx] = t;
    for (const s of this.series) {
      let v = frame[s.id] ?? 0;
      if (s.clampAbs !== undefined) {
        v = Math.max(-s.clampAbs, Math.min(s.clampAbs, v));
      }
      this.values.get(s.id)![idx] = v;
    }
    if (this.count < this.windowSamples) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.windowSamples;
    }
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.hoverX = null;
  }

  draw(): void {
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    const shown = this.shownCache;
    if (shown.length === 0 || this.count < 2) return;

    const left = 62;
    const right = 8;
    const bottom = 14;
    const plotW = this.w - left - right;
    const laneH = (this.h - bottom) / shown.length;
    const i0 = this.windowSamples - this.count;
    const x = (i: number) => left + (i / (this.windowSamples - 1)) * plotW;

    for (let lane = 0; lane < shown.length; lane++) {
      const s = shown[lane]!;
      const raw = this.values.get(s.id)!;
      const log = s.id === "power" && this.powerLogMode;
      const tv = (v: number) => log ? Math.log10(Math.max(v, 1e-7)) : v;
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = 0; j < this.count; j++) {
        const u = tv(raw[(this.head + j) % this.windowSamples]!);
        if (u < lo) lo = u;
        if (u > hi) hi = u;
      }
      // Protection limits are part of the instrument, not decorations that
      // appear only when the plant is already close to them. Keep every
      // configured threshold in view at all times (including log power).
      for (const ref of s.refLines ?? []) {
        const u = tv(ref.v);
        if (!Number.isFinite(u)) continue;
        lo = Math.min(lo, u);
        hi = Math.max(hi, u);
      }
      if (hi - lo < 1e-9) {
        const spread = Math.max(1, Math.abs(hi) * 0.05);
        lo -= spread;
        hi += spread;
      }
      const pad = (hi - lo) * 0.1;
      lo -= pad;
      hi += pad;
      const y0 = lane * laneH;
      const y = (v: number) =>
        y0 + laneH - 5 - ((tv(v) - lo) / (hi - lo)) * (laneH - 12);

      if (lane > 0) {
        g.strokeStyle = "rgba(255,255,255,0.08)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, y0);
        g.lineTo(this.w, y0);
        g.stroke();
      }
      g.strokeStyle = "#2c2c2a";
      g.beginPath();
      g.moveTo(left, y0 + laneH / 2);
      g.lineTo(this.w - right, y0 + laneH / 2);
      g.stroke();

      for (const ref of s.refLines ?? []) {
        const u = tv(ref.v);
        if (u <= lo || u >= hi) continue;
        const yy = y(ref.v);
        g.strokeStyle = ref.color;
        g.setLineDash([5, 4]);
        g.beginPath();
        g.moveTo(left, yy);
        g.lineTo(this.w - right, yy);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = ref.color;
        g.font = "9px system-ui, sans-serif";
        g.textAlign = "right";
        g.fillText(ref.label, this.w - right - 2, yy - 2);
      }

      g.strokeStyle = s.color;
      g.lineWidth = 2;
      g.lineJoin = "round";
      g.beginPath();
      for (let j = 0; j < this.count; j++) {
        const idx = (this.head + j) % this.windowSamples;
        const px = x(i0 + j);
        const py = y(raw[idx]!);
        if (j === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();

      const hoverIndex = this.hoverX === null
        ? this.count - 1
        : Math.round(((this.hoverX - left) / plotW) * (this.windowSamples - 1)) - i0;
      const readIndex = Math.max(0, Math.min(this.count - 1, hoverIndex));
      g.fillStyle = s.color;
      g.font = "600 10px system-ui, sans-serif";
      g.textAlign = "left";
      g.fillText(s.label.toUpperCase(), 4, y0 + 13);
      g.fillStyle = "#ffffff";
      g.font = "600 11px system-ui, sans-serif";
      g.fillText(s.fmt(raw[(this.head + readIndex) % this.windowSamples]!), 4, y0 + 28);

      if (this.hoverX !== null && hoverIndex >= 0 && hoverIndex < this.count) {
        const px = x(i0 + hoverIndex);
        const py = y(raw[(this.head + hoverIndex) % this.windowSamples]!);
        g.fillStyle = s.color;
        g.beginPath();
        g.arc(px, py, 3.5, 0, Math.PI * 2);
        g.fill();
      }
    }

    if (this.hoverX !== null) {
      const hx = Math.max(left, Math.min(this.w - right, this.hoverX));
      g.strokeStyle = "#898781";
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(hx, 0);
      g.lineTo(hx, this.h - bottom);
      g.stroke();
      g.setLineDash([]);
    }

    const timeIndex = this.hoverX === null
      ? this.count - 1
      : Math.max(0, Math.min(
          this.count - 1,
          Math.round(((this.hoverX - left) / plotW) * (this.windowSamples - 1)) - i0,
        ));
    g.fillStyle = "#52514e";
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "left";
    g.fillText(hms(this.ts[this.head]!), left, this.h - 2);
    g.textAlign = "right";
    g.fillText(hms(this.ts[(this.head + timeIndex) % this.windowSamples]!), this.w - right, this.h - 2);
  }
}
