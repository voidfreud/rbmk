/**
 * Single-instance gate: acquires a Web Lock before bootstrapping the
 * control room. If another tab already holds the lock, shows an overlay
 * and retries every 2 s until the lock is free.
 */

const LOCK_NAME = "rbmk-instance";

function showOverlay(): void {
  document.getElementById("busy-overlay")?.classList.add("visible");
}

function hideOverlay(): void {
  document.getElementById("busy-overlay")?.classList.remove("visible");
}

let released = false;
let stopResolver: (() => void) | null = null;

async function attemptPrimary(): Promise<void> {
  if (released) return;
  try {
    await navigator.locks.request(
      LOCK_NAME,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          showOverlay();
          setTimeout(attemptPrimary, 2000);
          return;
        }
        hideOverlay();
        const stopped = new Promise<void>((r) => { stopResolver = r; });
        // Dynamic import is load-bearing: main.ts must not execute until the
        // Web Lock is acquired. A static import would boot a second reactor.
        await import("./main");
        await stopped;
      },
    );
  } catch {
    setTimeout(attemptPrimary, 2000);
  }
}

addEventListener("beforeunload", () => {
  released = true;
  stopResolver?.();
});

if ("locks" in navigator) {
  attemptPrimary();
} else {
  const sub = document.querySelector("#busy-overlay .busy-sub");
  if (sub) sub.textContent = "Web Locks API unavailable — starting unprotected.";
  import("./main").then(() => hideOverlay());
}