/**
 * Format simulation seconds as HH:MM:SS for strip stamps and the event log.
 * TODO: when @rbmk/sim-core exports hms(), re-export it from here so UI and
 * demo stay on one implementation (demo is owned elsewhere — do not touch).
 */
export function hms(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
