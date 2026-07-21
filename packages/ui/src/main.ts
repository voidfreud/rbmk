import {
  N_AXIAL,
  Reactor,
  SimEvent,
  equilibriumIodineXenon,
  type RodState,
} from "@rbmk/sim-core";
import { Cartogram, depthLabel, rodCoord, rodStrokeM } from "./cartogram";
import { ChannelMap } from "./channelmap";
import { Slice } from "./slice";
import { MultiTrendChart, hms } from "./strips";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

/**
 * Shared canvas hover tooltip (#tooltip). labelFn returns the label string,
 * or null/undefined/"" to hide.
 */
function attachTooltip(
  canvas: HTMLCanvasElement,
  labelFn: (e: MouseEvent) => string | null | undefined,
): void {
  const tip = $("tooltip");
  let pending = false;
  let lastE: MouseEvent | null = null;
  canvas.addEventListener("mousemove", (e) => {
    lastE = e;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const ev = lastE;
      if (!ev) return;
      const label = labelFn(ev);
      if (label) {
        tip.style.display = "block";
        tip.style.left = `${ev.clientX + 14}px`;
        tip.style.top = `${ev.clientY + 14}px`;
        tip.textContent = label;
      } else {
        tip.style.display = "none";
      }
    });
  });
  canvas.addEventListener("mouseleave", () => {
    tip.style.display = "none";
    lastE = null;
  });
}

// ---------------------------------------------------------------------------
// Reactor
// ---------------------------------------------------------------------------
const reactor = new Reactor();
const XE_EQ = equilibriumIodineXenon(1.0).xenon;

/** Core-average Xe-135 relative to full-power equilibrium (1.0 = equil at 100%). */
function xenonRel(): number {
  return reactor.state.nodes.reduce((a, n) => a + n.xenon, 0) / N_AXIAL / XE_EQ;
}

/** Core-average steam void fraction (0–1). */
function voidAvg(): number {
  return reactor.state.nodes.reduce((a, n) => a + n.voidFrac, 0) / N_AXIAL;
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------
const cartogram = new Cartogram(
  $<HTMLCanvasElement>("cartogram"),
  reactor.state.rods,
);
const slice = new Slice($<HTMLCanvasElement>("slice"));
const channelMap = new ChannelMap(
  $<HTMLCanvasElement>("channelmap"),
  reactor.state.rods,
);

const fieldCanvas = $<HTMLCanvasElement>("channelmap");
attachTooltip(fieldCanvas, (e) =>
  channelMap.hit(
    e.clientX,
    e.clientY,
    reactor.powerFraction(),
  ),
);

const sliceCanvas = $<HTMLCanvasElement>("slice");
attachTooltip(sliceCanvas, (e) => slice.hit(e.clientX, e.clientY));

// Recorders with their real working limits drawn in status colors.
const trends = new MultiTrendChart(
  $<HTMLCanvasElement>("st-trends"),
  [
    {
      id: "rho", label: "reactivity", color: "#9085e9",
      fmt: (v) => `${v.toFixed(2)}β`, clampAbs: 25,
      refLines: [{ v: 1, color: "#d03b3b", label: "PHYSICAL LIMIT +1β · not an RPS trip" }],
    },
    {
      id: "power", label: "power", color: "#3987e5",
      fmt: (v) => v >= 0.1 ? `${v.toFixed(1)}%` : `${v.toExponential(0)}%`,
      refLines: [{ v: 110, color: "#d03b3b", label: "AZM SCRAM · 110%" }],
    },
    {
      id: "period", label: "period", color: "#199e70",
      fmt: (v) => Math.abs(v) < 1 / 200
        ? "steady"
        : `${Math.abs(1 / v).toFixed(0)} s ${v > 0 ? "rise" : "fall"}`,
      clampAbs: 0.2,
      refLines: [
        { v: 1 / 10, color: "#d03b3b", label: "AZS SCRAM · 10 s" },
        { v: 1 / 15, color: "#fab219", label: "WARNING · 15 s" },
        { v: 1 / 60, color: "#c98500", label: "WITHDRAWAL BLOCK · 60 s" },
      ],
    },
    {
      id: "xe", label: "xenon", color: "#c98500",
      fmt: (v) => `${v.toFixed(2)}×`,
      refLines: [{ v: 1, color: "#898781", label: "full-power equilibrium" }],
    },
  ],
  ["rho", "power", "period"],
);

// Power channel scale: auto follows the plant (log below 0.5%, like having
// both the linear and log channels of the real instrumentation).
let pwMode: "auto" | "lin" | "log" = "auto";
for (const m of ["auto", "lin", "log"] as const) {
  $(`pw-${m}`).onclick = () => {
    pwMode = m;
    for (const b of ["auto", "lin", "log"]) {
      $(`pw-${b}`).classList.toggle("active", b === m);
    }
  };
}
// Reactivity is the base lane; related signals can be compared on the same
// time axis without mixing their unlike units onto one deceptive y-axis.
for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-overlay]")) {
  btn.onclick = () => {
    const id = btn.dataset.overlay!;
    const enabled = !trends.isEnabled(id);
    trends.setEnabled(id, enabled);
    btn.classList.toggle("active", enabled);
    btn.setAttribute("aria-pressed", String(enabled));
    btn.textContent = `${enabled ? "−" : "+"} ${id === "xe" ? "xenon" : id}`;
    $("pw-scale").hidden = !trends.isEnabled("power");
  };
}

// ---------------------------------------------------------------------------
// Event log feed
// ---------------------------------------------------------------------------
const STATE_DELTA_KEYS = [
  "power",
  "period",
  "rho",
  "orm",
  "voidAvg",
  "fuelTempAvg",
  "coolantTempAvg",
  "flowFraction",
] as const;

const STATE_SUMMARY_KEYS = [
  "power",
  "rho",
  "period",
  "orm",
  "voidAvg",
  "xenon",
  "fuelTempAvg",
  "coolantTempAvg",
  "flowFraction",
] as const;

type EventPayload = Record<string, unknown>;

function isRecord(value: unknown): value is EventPayload {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fmtNum(value: number): string {
  if (Math.abs(value) < 1e-3) return `${value.toExponential(2)}`;
  return value.toFixed(4);
}

function formatMetric(key: string, value: unknown): string {
  if (!isFiniteNumber(value)) return `${String(value)}`;
  if (key === "power") return `${(value * 100).toFixed(2)}%`;
  if (key === "rho") return `${value.toFixed(5)} β`;
  if (key === "period") return `${value.toFixed(1)} s`;
  if (key === "voidAvg" || key === "flowFraction") return `${(value * 100).toFixed(2)}%`;
  if (key === "xenon" || key === "decayHeat") return `${value.toExponential(3)}`;
  if (key === "fuelTempAvg" || key === "coolantTempAvg") return `${value.toFixed(1)} °C`;
  if (key === "orm") return `${value.toFixed(1)}`;
  return fmtNum(value);
}

function formatRodIns(value: unknown): string {
  if (!isRecord(value)) return `${String(value)}`;
  const entries = ["RR", "AR", "LAR", "AZ", "USP"]
    .map((group) => {
      const v = value[group];
      return isFiniteNumber(v) ? `${group} ${(v * 100).toFixed(1)}%` : null;
    })
    .filter((entry): entry is string => entry !== null);
  return entries.length > 0 ? entries.join(", ") : "{}";
}

function summarizeEventData(e: SimEvent): string[] {
  const data = isRecord(e.data) ? e.data : null;
  if (!data) return [];
  const keys = e.code === "STATE"
    ? [...STATE_SUMMARY_KEYS]
    : ["power", "period", "rho", "orm", "speed", "flowFraction", "setpoint", "reason"];
  const values: string[] = [];
  for (const key of keys) {
    const value = data[key];
    if (value === undefined) continue;
    values.push(`${key}: ${formatMetric(key, value)}`);
  }
  return values;
}

let lastState: EventPayload | null = null;

function stateDeltas(
  next: EventPayload,
  before: EventPayload | null = lastState,
): string[] {
  if (!before) return [];
  const deltas: string[] = [];
  for (const key of STATE_DELTA_KEYS) {
    const prev = before[key];
    const curr = next[key];
    if (!isFiniteNumber(prev) || !isFiniteNumber(curr)) continue;
    const delta = curr - prev;
    if (Math.abs(delta) < 1e-12) continue;
    const sign = delta >= 0 ? "+" : "";
    const label = key === "power" ? `${(delta * 100).toFixed(3)}pp`
      : key === "period" ? `${delta.toFixed(1)} s`
      : key === "rho" ? `${delta.toFixed(5)} β`
      : key === "voidAvg" || key === "flowFraction"
      ? `${sign}${(delta * 100).toFixed(2)}pp`
      : formatMetric(key, delta);
    deltas.push(`Δ${key} ${sign}${label}`);
  }
  return deltas;
}

function transitionLines(
  before: EventPayload,
  after: EventPayload,
  keys: readonly string[] = [],
): string[] {
  const tracked = keys.length > 0 ? keys : [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ];
  const lines: string[] = [];
  for (const key of tracked) {
    const prev = before[key];
    const next = after[key];
    if (prev === next) continue;
    if (!prev || !next) {
      lines.push(`${key}: ${String(prev)} → ${String(next)}`);
      continue;
    }
    if (isFiniteNumber(prev) && isFiniteNumber(next)) {
      const delta = next - prev;
      const sign = delta >= 0 ? "+" : "";
      const label = key === "power" ? `${(delta * 100).toFixed(3)}pp`
        : key === "period" ? `${delta.toFixed(1)} s`
        : key === "rho" ? `${delta.toFixed(5)} β`
        : key === "voidAvg" || key === "flowFraction"
          ? `${sign}${(delta * 100).toFixed(2)}pp`
          : formatMetric(key, delta);
      lines.push(`${key}: ${formatMetric(key, prev)} → ${formatMetric(key, next)} (${sign}${label})`);
      continue;
    }
    lines.push(`${key}: ${String(prev)} → ${String(next)}`);
  }
  return lines;
}

function inferContextFromData(e: SimEvent): { actor: string | null; where: string | null; cause: string | null } {
  const data = isRecord(e.data) ? e.data : null;
  const actor = e.actor
    ? e.actor
    : e.code.startsWith("ROD") ? "operator"
      : e.code.startsWith("AR") ? "AR control"
      : e.code === "FLOW" || e.code === "SPEED" ? "console"
      : e.code === "STATE" || e.code === "POWER" || e.code === "PRIZMA" ? "core"
      : e.code === "AZ1" || e.code === "AZ5" ? "protection logic"
      : e.code === "ALERT" ? "reactor core"
      : null;

  const where = e.where
    ? e.where
    : e.code === "FLOW"
      ? "coolant loop"
      : e.code === "SPEED"
        ? "operator panel"
        : e.code === "PRIZMA"
          ? "controls panel"
          : null;

  const cause = e.cause
    || (isRecord(data) && typeof data.reason === "string" ? data.reason : null)
    || (typeof data?.reasonDetail === "string" ? data.reasonDetail : null)
    || (isRecord(data) && typeof data.trigger === "string" ? data.trigger : null)
    || (typeof e.msg === "string" && e.msg.includes("—") ? e.msg.split("—")[1]?.trim() : null)
    || null;

  return { actor, where, cause };
}

function formatDataLines(data: EventPayload, limit = 20, exclude: ReadonlySet<string> = new Set()): string[] {
  const primary = [
    "power",
    "period",
    "rho",
    "orm",
    "voidAvg",
    "xenon",
    "fuelTempAvg",
    "coolantTempAvg",
    "decayHeat",
    "flowFraction",
    "rodIns",
    "arMode",
    "arActiveGroup",
    "arSetpoint",
    "arSetpointActive",
    "arTarget",
    "scrammed",
    "protectionPeriod",
    "protectionOverpower",
    "speed",
    "setpoint",
    "prevSetpoint",
    "milestone",
    "fromGroup",
    "toGroup",
    "activeGroup",
    "reason",
  ];
  const lines: string[] = [];
  const seen = new Set<string>();
  const add = (key: string): void => {
    if (!(key in data) || exclude.has(key)) return;
    const value = data[key];
    if (key === "rodIns") {
      lines.push(`  rodIns: ${formatRodIns(value)}`);
    } else {
      lines.push(`  ${key}: ${formatMetric(key, value)}`);
    }
    seen.add(key);
  };
  for (const key of primary) add(key);
  for (const key of Object.keys(data)) {
    if (seen.has(key) || exclude.has(key)) continue;
    if (lines.length >= limit) break;
    const value = data[key];
    lines.push(`  ${key}: ${formatMetric(key, value)}`);
    seen.add(key);
  }
  return lines;
}

const alarmList = $("alarm-list");
reactor.log.addSink((e) => {
  const data = isRecord(e.data) ? e.data : null;
  const li = document.createElement("li");
  li.className = `event ${e.level}`;
  const title = document.createElement("div");
  title.className = "event-title";
  const icon = e.level === "alarm" ? "▲ " : e.level === "warn" ? "◆ " : "· ";
  const seq = e.seq === undefined ? "—" : String(e.seq).padStart(4, "0");
  title.textContent = `${icon}${hms(e.t)} [${seq}] ${e.code}: ${e.msg}`;
  li.appendChild(title);

  const snapshot = summarizeEventData(e);
  if (snapshot.length > 0) {
    const summary = document.createElement("div");
    summary.className = "event-summary";
    summary.textContent = `snapshot: ${snapshot.join(" · ")}`;
    li.appendChild(summary);
  }

  const before = isRecord(e.before) ? e.before : null;
  const after = isRecord(e.after) ? e.after : null;
  const lines: string[] = [];
  if (before && after) {
    const transition = transitionLines(before, after, e.code === "STATE" ? [...STATE_DELTA_KEYS] : []);
    lines.push(...transition);
  } else if (e.code === "STATE" && data) {
    const delta = stateDeltas(data);
    lines.push(...delta);
  }
  if (lines.length > 0) {
    const deltaLine = document.createElement("div");
    deltaLine.className = "event-delta";
    deltaLine.textContent = e.before && e.after
      ? `transition: ${lines.join(" · ")}`
      : `Δ: ${lines.join(" · ")}`;
    li.appendChild(deltaLine);
  }

  const context = inferContextFromData(e);
  const metaParts = [
    context.actor ? `actor: ${context.actor}` : null,
    context.where ? `where: ${context.where}` : null,
    context.cause ? `cause: ${context.cause}` : null,
  ].filter((line): line is string => line !== null);
  if (metaParts.length > 0) {
    const meta = document.createElement("div");
    meta.className = "event-meta";
    meta.textContent = metaParts.join(" · ");
    li.appendChild(meta);
  }

  if (data) {
    const details = document.createElement("details");
    const detSummary = document.createElement("summary");
    detSummary.textContent = "event data";
    details.appendChild(detSummary);
    const detailText = document.createElement("pre");
    const dataExclude = e.code === "STATE"
      ? new Set(STATE_SUMMARY_KEYS)
      : new Set<string>();
    detailText.textContent = formatDataLines(data, 20, dataExclude).join("\n");
    details.appendChild(detailText);
    li.appendChild(details);
  }

  alarmList.prepend(li);
  if (e.code === "STATE") {
    if (after && isRecord(after)) {
      lastState = after;
    } else if (data) {
      lastState = { ...data };
    }
  }
  while (alarmList.children.length > 200) alarmList.lastChild?.remove();
});

// Batched POST sink: forwards events to the server's JSONL endpoint so they
// are persisted to disk. Flushes every ~3 s or every 100 events, whichever
// comes first + sendBeacon on pagehide for lossless session tails.
const logPending: SimEvent[] = [];
let logFlushTimer: ReturnType<typeof setInterval> | null = null;
function flushLog(): void {
  if (logPending.length === 0) return;
  const batch = logPending.splice(0, logPending.length);
  const body = JSON.stringify(batch);
  fetch("/api/log/events", { method: "POST", body, headers: { "Content-Type": "application/json" } }).catch(() => {});
}
reactor.log.addSink((e) => {
  logPending.push(e);
  if (logPending.length >= 100) flushLog();
  else if (!logFlushTimer) {
    logFlushTimer = setInterval(() => { flushLog(); if (logPending.length === 0 && logFlushTimer) { clearInterval(logFlushTimer); logFlushTimer = null; } }, 3000);
  }
});
addEventListener("pagehide", () => {
  if (logPending.length > 0) {
    navigator.sendBeacon("/api/log/events", new Blob([JSON.stringify(logPending)], { type: "application/json" }));
    logPending.length = 0;
  }
});

// Annunciator memory: transient events light their lamp for a hold time.
// Sink for lamp timestamps is attached after selection helpers so SIL_BLOK
// can also clear the map selection (P0.14).
const lampT = { sil: -Infinity, chg: -Infinity, lar: -Infinity };

function setLamp(id: string, state: "" | "ok" | "warn" | "alarm"): void {
  const el = $(id);
  el.className = `lamp${state ? ` ${state}` : ""}`;
}

// Bring the plant to power AFTER the log sink is attached so INIT shows up.
// (lamp/SIL_BLOK sink is wired just below selection helpers.)
reactor.initAtPower(1.0, { manualInsertion: 0.55 });

// ---------------------------------------------------------------------------
// Rod selection & control
// ---------------------------------------------------------------------------
const selected = new Set<number>();

const mapCanvas = $<HTMLCanvasElement>("cartogram");

// TEZ L.24 addressing: every mimic-field button toggles one physical rod.
// Selection accumulates until the operator presses Sbros vybora (clear).
mapCanvas.addEventListener("click", (e) => {
  const rod = cartogram.hit(e.clientX, e.clientY);
  if (!rod) return;
  if (selected.has(rod.id)) selected.delete(rod.id);
  else selected.add(rod.id);
  rebuildSelRows();
  updateSelInfo();
});

mapCanvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// Cartogram tooltip with the PRIZMA-style local worth estimate.
attachTooltip(mapCanvas, (e) => {
  const rod = cartogram.hit(e.clientX, e.clientY);
  if (!rod) return null;
  // PRIZMA-style worth estimate for this rod from its current position.
  const w = reactor.rodWorthBeta(rod.id);
  const worth = w
    ? ` · worth ↑${w.toOut >= 0 ? "+" : ""}${w.toOut.toFixed(2)}β ↓${w.toIn >= 0 ? "+" : ""}${w.toIn.toFixed(2)}β`
    : "";
  return depthLabel(rod) + worth;
});

$("sel-none").onclick = () => {
  selected.clear();
  rebuildSelRows();
  updateSelInfo();
};
$("sel-az-bank").onclick = () => {
  selected.clear();
  for (const rod of reactor.state.rods) {
    if (rod.group === "AZ") selected.add(rod.id);
  }
  rebuildSelRows();
  updateSelInfo();
};

/** Per-rod servo rows (selsyn-style) for up to 30 selected rods. */
function rebuildSelRows(): void {
  const wrap = $("sel-rows");
  wrap.textContent = "";
  if (selected.size === 0 || selected.size > 30) return;
  for (const id of [...selected].sort((a, b) => a - b)) {
    const rod = reactor.state.rods[id]!;
    const row = document.createElement("div");
    row.className = "rod-row";
    row.dataset.rod = String(id);
    row.innerHTML =
      `<span class="coord">${rodCoord(rod)}</span>` +
      `<span class="grp">${rod.group}</span>` +
      `<span class="bar"><i style="width:${rod.insertion * 100}%"></i></span>` +
      `<span class="depth num">${(rod.insertion * rodStrokeM(rod)).toFixed(2)}m</span>` +
      `<span class="lim num"></span>`;
    wrap.append(row);
  }
}

/** Refresh bars/depths in place (no DOM rebuild) at instrument rate. */
function refreshSelRows(): void {
  for (const row of document.querySelectorAll<HTMLElement>(".rod-row")) {
    const rod = reactor.state.rods[Number(row.dataset.rod)]!;
    row.querySelector<HTMLElement>(".bar > i")!.style.width = `${rod.insertion * 100}%`;
    row.querySelector(".depth")!.textContent = `${(rod.insertion * rodStrokeM(rod)).toFixed(2)}m`;
    // Limit-switch lamps: VK = upper end stop (fully withdrawn),
    // NK = lower end stop (fully inserted), like the real selsyn LEDs.
    const lim = row.querySelector<HTMLElement>(".lim")!;
    if (rod.insertion <= 0.003) {
      lim.textContent = "ВК";
      lim.style.color = "var(--warning)";
    } else if (rod.insertion >= 0.997) {
      lim.textContent = "НК";
      lim.style.color = "var(--good)";
    } else {
      lim.textContent = "";
    }
  }
}

function updateSelInfo(): void {
  const info = $("sel-info");
  const selectedRods = [...selected].map((id) => reactor.state.rods[id]!);
  const nonAz = selectedRods.filter((rod) => rod.group !== "AZ").length;
  const regBlock =
    reactor.arEnabled && selectedRods.some((rod) => reactor.regulatorOwns(rod));
  for (let n = 1; n <= 5; n++) {
    const lamp = $(`sel-count-${n}`);
    const on = n < 5 ? selected.size === n : selected.size >= 5;
    lamp.classList.toggle("on", on);
    lamp.classList.toggle("blocked", n === 5 && nonAz >= 5);
  }
  if (selected.size === 0) {
    info.textContent = "No rods selected · click individual buttons on the core map";
  } else if (selected.size === 1) {
    const id = [...selected][0]!;
    const rod = reactor.state.rods[id]!;
    info.textContent = regBlock
      ? `${depthLabel(rod)} · under automatic control — switch to manual first`
      : `${depthLabel(rod)} · withdrawal available`;
  } else {
    const groups = [...new Set(selectedRods.map((rod) => rod.group))].join("/");
    const state =
      nonAz >= 5
        ? "withdrawal BLOCKED · insertion available"
        : regBlock
          ? "automatic rods in selection — manual override required for withdrawal"
          : selectedRods.every((rod) => rod.group === "AZ")
            ? "AZ protection bank · cocking withdrawal available"
            : "withdrawal available";
    info.textContent = `${selectedRods.length} selected · ${groups} · ${state}`;
  }
  refreshSelRows();
}

// Annunciator hold timestamps + P0.14: SIL_BLOK clears map selection.
reactor.log.addSink((e) => {
  if (e.code === "SIL_BLOK") {
    lampT.sil = e.t;
    selected.clear();
    rebuildSelRows();
    updateSelInfo();
  } else if (e.code === "AR_CHANGEOVER") {
    lampT.chg = e.t;
  } else if (e.code === "LAR_DROPOUT") {
    lampT.lar = e.t;
  }
});

/** Drive command for the selection: continuous lever or stop.
 * Panel rule (TEZ L.24): WITHDRAWAL is restricted at 5+ non-AZ rods (max 4);
 * insertion is never count-restricted. AZ rods are exempt - the emergency
 * bank is cocked as a SET before startup (which is why the power interlock
 * excludes them too). */
let lastSelLimitT = -Infinity;
/** Rod ids captured at lever press; release stops this set, not current selection. */
let drivingIds: number[] | null = null;
function driveSelected(cmd: "out" | "in" | "stop"): void {
  if (cmd === "stop") {
    const ids = drivingIds ?? [...selected];
    drivingIds = null;
    for (const id of ids) {
      const rod = reactor.state.rods[id]!;
      reactor.setRodTarget(id, rod.insertion);
    }
    return;
  }
  const isWithdrawal = cmd === "out";
  const ids = [...selected];
  const nonAz = ids.filter(
    (id) => reactor.state.rods[id]!.group !== "AZ",
  ).length;
  // P0.13: refuse at >=5 non-AZ (max 4 for withdrawal).
  if (isWithdrawal && nonAz >= 5) {
    if (reactor.state.time - lastSelLimitT > 5) {
      lastSelLimitT = reactor.state.time;
      const pSel = reactor.powerFraction();
      reactor.log.warn(
        reactor.state.time,
        "SEL_LIMIT",
        `withdrawal restricted: ${nonAz} non-AZ rods selected (max 4 for withdrawal)`,
        {
          nonAz,
          power: Number(pSel.toExponential(4)),
          period: Number(reactor.period().toFixed(1)),
          orm: Number(reactor.ormRods().toFixed(1)),
        },
      );
    }
    return;
  }
  drivingIds = ids;
  for (const id of ids) {
    const rod = reactor.state.rods[id]!;
    if (cmd === "out") reactor.setRodTarget(id, 0);
    else if (cmd === "in") reactor.setRodTarget(id, 1);
  }
}

/** Real lever feel: hold = rods drive at 0.4 m/s, release = they stop.
 * P0.5: left-button only; release on element mouseup/leave and window
 * mouseup/blur. Window listeners remove themselves so rebinding is safe. */
function lever(el: HTMLElement, drive: () => void, release: () => void): void {
  let held = false;
  const stop = () => {
    if (!held) return;
    held = false;
    window.removeEventListener("mouseup", stop);
    window.removeEventListener("blur", stop);
    release();
  };
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (held) return;
    held = true;
    drive();
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
  });
  el.addEventListener("mouseup", stop);
  el.addEventListener("mouseleave", stop);
}
lever($("rod-out"), () => driveSelected("out"), () => driveSelected("stop"));
lever($("rod-in"), () => driveSelected("in"), () => driveSelected("stop"));
lever($("rod-out-reserve"), () => driveSelected("out"), () => driveSelected("stop"));
lever($("rod-in-reserve"), () => driveSelected("in"), () => driveSelected("stop"));
$("rod-stop-all").onclick = () => {
  for (const rod of reactor.state.rods) reactor.setRodTarget(rod.id, rod.insertion);
};
$("rod-override").onclick = () => reactor.setAutoControl([...selected], false);
$("rod-return").onclick = () => reactor.setAutoControl([...selected], true);

// ---------------------------------------------------------------------------
// AR, setpoint, flow, speed, AZ-5
// ---------------------------------------------------------------------------
const arToggle = $("ar-toggle");
arToggle.onclick = () => {
  reactor.setArEnabled(!reactor.arEnabled);
  arToggle.classList.toggle("active", reactor.arEnabled);
  arToggle.textContent = reactor.arEnabled ? "engaged" : "off";
};

// Prefer reactor API: re-seeds arTarget from the newly owned bank so rods
// do not jump to a stale regulator target (P0.19).
function setArMode(mode: "ARM" | "AR" | "LAR"): void {
  reactor.setArMode(mode);
  for (const m of ["arm", "ar", "lar"]) {
    $(`ar-mode-${m}`).classList.toggle("active", m === mode.toLowerCase());
  }
}
$("ar-mode-arm").onclick = () => setArMode("ARM");
$("ar-mode-ar").onclick = () => setArMode("AR");
$("ar-mode-lar").onclick = () => setArMode("LAR");

// AR subgroup auto/manual switches: off = the 4 rods of that subgroup are
// released to manual control (and the regulator skips them).
// P0.18: route through setAutoControl so the reactor owns the flag.
for (const sub of [1, 2, 3] as const) {
  const btn = $(`ar-sw-${sub}`);
  btn.onclick = () => {
    const rods = reactor.state.rods.filter(
      (r) => r.group === "AR" && r.arSubgroup === sub,
    );
    const nowAuto = !rods[0]!.autoControlled;
    reactor.setAutoControl(
      rods.map((r) => r.id),
      nowAuto,
    );
    btn.classList.toggle("active", nowAuto);
  };
}

$("rps-azm").onclick = () => {
  reactor.setProtection("overpower", !reactor.protection.overpower);
  $("rps-azm").classList.toggle("active", reactor.protection.overpower);
};
$("rps-azs").onclick = () => {
  reactor.setProtection("period", !reactor.protection.period);
  $("rps-azs").classList.toggle("active", reactor.protection.period);
};
const setpoint = $<HTMLInputElement>("setpoint");
setpoint.oninput = () => {
  reactor.setArSetpoint(Number(setpoint.value) / 100);
  $("setpoint-val").textContent = `${setpoint.value}%`;
};
// P0.7: AZ-1 drops the AR setpoint — keep the slider in sync.
$("az1").onclick = () => {
  reactor.azSetback();
  setpoint.value = String(Math.round(reactor.arSetpoint * 100));
  $("setpoint-val").textContent = `${setpoint.value}%`;
};

const gradient = $<HTMLInputElement>("gradient");
// Slider is in hundredths of %/s: 1..35 -> 0.01..0.35 %/s.
gradient.oninput = () => {
  reactor.setArGradient(Number(gradient.value) / 10000);
  $("gradient-val").textContent = `${(Number(gradient.value) / 100).toFixed(2)}%/s`;
};

/** Snap damped instrument displays to the actual state (used on re-init). */
function snapDisplays(): void {
  disp.power = reactor.powerFraction();
  disp.rho = reactor.reactivityBeta();
  disp.xe = xenonRel();
  disp.voidAvg = voidAvg();
  disp.periodRate = 0;
}

/**
 * Shared re-init UI reset (P0.2 / P0.3 + polish): clear strip buffers,
 * event log, rewind sample clock, clear annunciator hold memory, snap
 * damped displays, and resync AR toggle / setpoint from the reactor.
 */
function resetSessionUi(): void {
  trends.reset();
  alarmList.innerHTML = "";
  logPending.length = 0;
  lastState = null;
  nextSample = 0;
  nextDomUpdate = 0;
  drivingIds = null;
  lampT.sil = -Infinity;
  lampT.chg = -Infinity;
  lampT.lar = -Infinity;
  snapDisplays();
  arToggle.classList.toggle("active", reactor.arEnabled);
  arToggle.textContent = reactor.arEnabled ? "engaged" : "off";
  setpoint.value = String(Math.round(reactor.arSetpoint * 100));
  $("setpoint-val").textContent = `${setpoint.value}%`;
  const flowPct = Math.round(reactor.state.flowFraction * 100);
  flow.value = String(flowPct);
  $("flow-val").textContent = `${flowPct}%`;
  gradient.value = String(Math.round(reactor.arGradient * 10000));
  $("gradient-val").textContent = `${(reactor.arGradient * 100).toFixed(2)}%/s`;
  $("rps-azm").classList.toggle("active", reactor.protection.overpower);
  $("rps-azs").classList.toggle("active", reactor.protection.period);
  for (const m of ["arm", "ar", "lar"]) {
    $(`ar-mode-${m}`).classList.toggle("active", m === reactor.arMode.toLowerCase());
  }
}

/** True after a cold start: the startup checklist tracks live progress. */
let startupMode = false;

$("init-power").onclick = () => {
  reactor.initAtPower(1.0, { manualInsertion: 0.55 });
  startupMode = false;
  selected.clear();
  rebuildSelRows();
  updateSelInfo();
  resetSessionUi();
};
$("init-shutdown").onclick = () => {
  reactor.initShutdown();
  startupMode = true;
  $<HTMLDetailsElement>("guide").open = true;
  selected.clear();
  rebuildSelRows();
  updateSelInfo();
  resetSessionUi();
};

/** Startup checklist: each step checks itself off from the plant's state. */
function updateChecklist(): void {
  const rods = reactor.state.rods;
  const power = reactor.powerFraction();
  const period = reactor.period();
  const azOut = rods
    .filter((r) => r.group === "AZ")
    .every((r) => r.insertion < 0.05);
  const rrSquadStarted = rods.some(
    (r) => r.group === "RR" && r.insertion < 0.95,
  );
  const done = [
    startupMode,
    startupMode && azOut,
    startupMode && azOut && rrSquadStarted,
    startupMode && ((period > 0 && period < 150) || power > 0.0025),
    startupMode &&
      reactor.arMode === "ARM" &&
      reactor.arEnabled &&
      reactor.arSetpoint > 0,
    startupMode &&
      reactor.arEnabled &&
      power > 0.0025 &&
      Math.abs(power - reactor.activeSetpoint()) < 0.02 * Math.max(0.05, reactor.activeSetpoint()),
  ];
  let currentSet = false;
  for (let i = 0; i < 6; i++) {
    const li = $(`ck-${i + 1}`);
    li.classList.toggle("done", done[i]!);
    const isCurrent = !done[i] && !currentSet && startupMode;
    if (isCurrent) currentSet = true;
    li.classList.toggle("current", isCurrent);
  }
}

const flow = $<HTMLInputElement>("flow");
flow.oninput = () => {
  reactor.setFlowFraction(Number(flow.value) / 100);
  $("flow-val").textContent = `${flow.value}%`;
};

let speed = 1;
for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
  btn.onclick = () => {
    const newSpeed = Number(btn.dataset.speed);
    if (newSpeed !== speed) {
      speed = newSpeed;
      const pSpd = reactor.powerFraction();
      reactor.log.info(reactor.state.time, "SPEED", `simulation speed set to ${speed}×`, {
        speed,
        power: Number(pSpd.toExponential(4)),
        period: Number(reactor.period().toFixed(1)),
        orm: Number(reactor.ormRods().toFixed(1)),
      });
    }
    for (const b of document.querySelectorAll("[data-speed]")) b.classList.remove("active");
    btn.classList.add("active");
  };
}

const az5 = $<HTMLButtonElement>("az5");
const cover = $("az5-cover");
cover.onclick = () => {
  cover.classList.toggle("open");
  az5.disabled = !cover.classList.contains("open");
};
az5.onclick = () => reactor.scram("AZ-5 button (control room)");
$("scram-reset").onclick = () => reactor.resetScram();

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
// AR imbalance galvanometer: +-5% scale, needle at (power - setpoint).
const imbCanvas = $<HTMLCanvasElement>("imbalance");
const imbCtx = imbCanvas.getContext("2d")!;
{
  const dpr = window.devicePixelRatio || 1;
  imbCanvas.style.width = `${imbCanvas.width}px`;
  imbCanvas.style.height = `${imbCanvas.height}px`;
  imbCanvas.width *= dpr;
  imbCanvas.height *= dpr;
  imbCtx.scale(dpr, dpr);
}
function drawImbalance(err: number): void {
  const w = 230;
  const h = 40;
  const g = imbCtx;
  g.clearRect(0, 0, w, h);
  g.strokeStyle = "#2c2c2a";
  g.lineWidth = 1;
  g.font = "9px system-ui, sans-serif";
  g.fillStyle = "#898781";
  g.textAlign = "center";
  for (const pct of [-5, -2.5, 0, 2.5, 5]) {
    const x = w / 2 + (pct / 5) * (w / 2 - 14);
    g.beginPath();
    g.moveTo(x, 8);
    g.lineTo(x, h - 14);
    g.stroke();
    g.fillText(pct === 0 ? "0" : `${pct > 0 ? "+" : ""}${pct}`, x, h - 3);
  }
  const clamped = Math.max(-0.05, Math.min(0.05, err));
  const nx = w / 2 + (clamped / 0.05) * (w / 2 - 14);
  g.strokeStyle = Math.abs(err) > 0.02 ? "#fab219" : "#199e70";
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(nx, 4);
  g.lineTo(nx, h - 12);
  g.stroke();
}

// ZRT-A-style reactivity indication. This is an operator instrument, while
// the +1 beta mark is a physical prompt-critical boundary, not an AZ trip.
const rhoCanvas = $<HTMLCanvasElement>("reactivity-meter");
const rhoCtx = rhoCanvas.getContext("2d")!;
{
  const dpr = window.devicePixelRatio || 1;
  rhoCanvas.style.width = `${rhoCanvas.width}px`;
  rhoCanvas.style.height = `${rhoCanvas.height}px`;
  rhoCanvas.width *= dpr;
  rhoCanvas.height *= dpr;
  rhoCtx.scale(dpr, dpr);
}
function drawReactivity(rho: number): void {
  const w = 230;
  const h = 46;
  const g = rhoCtx;
  g.clearRect(0, 0, w, h);
  const x = (v: number) => 14 + ((v + 1) / 2) * (w - 28);
  g.font = "9px system-ui, sans-serif";
  g.textAlign = "center";
  for (const v of [-1, -0.5, 0, 0.5, 1]) {
    g.strokeStyle = v === 1 ? "#d03b3b" : v === 0 ? "#199e70" : "#2c2c2a";
    g.lineWidth = v === 0 || v === 1 ? 1.5 : 1;
    g.beginPath();
    g.moveTo(x(v), 7);
    g.lineTo(x(v), h - 15);
    g.stroke();
    g.fillStyle = v === 1 ? "#d03b3b" : "#898781";
    g.fillText(v > 0 ? `+${v}` : String(v), x(v), h - 3);
  }
  const shown = Math.max(-1, Math.min(1, rho));
  g.strokeStyle = rho >= 1 ? "#d03b3b" : rho > 0.5 ? "#fab219" : "#9085e9";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x(shown), 3);
  g.lineTo(x(shown), h - 13);
  g.stroke();
}

let lastWall = performance.now();
let nextSample = 0;
let nextDomUpdate = 0;

/**
 * Damped display values: real panel instruments have mechanical/electrical
 * damping, so the readouts must not flicker at frame rate. Smooth with a
 * ~0.5 s time constant in *sim* seconds (not wall clock) so 60× fast-forward
 * does not turn the filters into a 30 s lag — period lamp and meter stay
 * consistent. Write to the DOM at 5 Hz.
 */
const disp = { power: 1, rho: 0, xe: 1, voidAvg: 0.35, periodRate: 0 };
function smooth(simDt: number): void {
  const a = Math.min(1, simDt / 0.5);
  disp.power += (reactor.powerFraction() - disp.power) * a;
  disp.rho += (reactor.reactivityBeta() - disp.rho) * a;
  disp.xe += (xenonRel() - disp.xe) * a;
  disp.voidAvg += (voidAvg() - disp.voidAvg) * a;
  const p = reactor.period();
  disp.periodRate += (1 / p - disp.periodRate) * a;
}

/** Period readout: off-scale beyond +-200 s reads as infinity, like the meter. */
function periodText(): string {
  const rate = disp.periodRate;
  if (Math.abs(rate) < 1 / 200) return "∞";
  return `${(1 / rate).toFixed(0)} s`;
}

function frame(now: number): void {
  const wallDt = Math.min(0.1, (now - lastWall) / 1000);
  lastWall = now;

  // simDt drives both the physics tick and instrument damping so 10×/60×
  // does not inflate the display time-constant relative to plant dynamics.
  const simDt = speed > 0 && wallDt > 0 ? wallDt * speed : 0;
  if (simDt > 0) {
    reactor.tick(simDt, speed > 1 ? 0.1 : 0.02);
  }
  smooth(simDt);

  const t = reactor.state.time;
  if (t >= nextSample) {
    // Charts sample the same sim-time-smoothed instruments as the meters
    // (tau = 0.5 sim-s), so thresholds drawn on the strip match the panel.
    trends.push(t, {
      power: disp.power * 100,
      // Inverse period (growth rate) separates the 60/15/10 s limits.
      period: disp.periodRate,
      rho: disp.rho,
      xe: disp.xe,
    });
    nextSample = t + 0.5;
  }

  // Instruments, throttled to 5 Hz.
  if (now >= nextDomUpdate) {
    nextDomUpdate = now + 200;
    $("i-time").textContent = `t = ${hms(t)}`;
    // Auto-ranging power display: percent at power, exponential in the
    // source/startup range where "0.0%" would hide everything.
    const pw = disp.power * 100;
    $("i-power").textContent =
      pw >= 0.1 ? `${pw.toFixed(1)}%` : `${pw.toExponential(1)}%`;
    // Source range: the ISS count-rate meter (2..1e4 cps ~ 1e-11..1e-8 of
    // nominal flux) is what a startup is actually flown on.
    $("i-mw").textContent =
      disp.power < 0.0025
        ? `ISS ${Math.max(0, disp.power * 1e7).toFixed(0)} cps`
        : `${(reactor.thermalPowerW() / 1e6).toFixed(0)} MW thermal`;
    // Plant state annunciator. Period for state/lamp uses the same damped
    // rate as the period meter so 60× does not light the lamp while the
    // readout still lags (P1.3).
    const rate = disp.periodRate;
    const periodDisp =
      Math.abs(rate) < 1 / 200 ? Infinity : 1 / rate;
    let stateTxt: string;
    if (reactor.state.scrammed) stateTxt = "SCRAMMED";
    else if (disp.power > 0.05) stateTxt = "POWER OPERATION";
    else if (periodDisp > 0 && periodDisp < 500) stateTxt = "SUPERCRITICAL - RISING";
    else stateTxt = "SUBCRITICAL";
    $("i-state").textContent = stateTxt;
    $("i-trend").textContent =
      Math.abs(rate) < 1 / 200 ? "STEADY" : rate > 0 ? "RISING" : "FALLING";
    $("i-period").textContent = `period ${periodText()}`;
    $("i-rho").textContent = `reactivity ${disp.rho.toFixed(2)} β`;
    // ORM comes from PRIZMA printouts only (pre-1986 realism): equivalent
    // rods remaining in the core Σ(insertion) over RR+AR+LAR.
    const prizma = reactor.prizma();
    $("i-orm").textContent = prizma.orm.toFixed(1);
    const age = Math.max(0, t - prizma.t);
    $("i-orm-age").textContent = `equivalent rods in core · PRIZMA report ${Math.floor(age / 60)}:${String(Math.floor(age % 60)).padStart(2, "0")} old`;
    $("i-xe").textContent = `${disp.xe.toFixed(2)}×`;
    $("i-xe-status").textContent =
      disp.xe > 1.15 ? "elevated · suppressing power" : disp.xe < 0.85 ? "below full-power equilibrium" : "normal near 1.00×";
    $("i-void").textContent = `steam void ${(disp.voidAvg * 100).toFixed(0)}%`;
    $("i-flow").textContent = `Flow ${Math.round(reactor.state.flowFraction * 100)}%`;
    $("ar-pos").textContent = `${(reactor.arInsertion() * 7).toFixed(2)} m`;
    $("ar-active").textContent =
      reactor.arMode === "LAR" ? "LAR" : `AR-${reactor.arActiveGroup}`;
    // The regulator can disengage or change mode by itself (LAR dropout
    // auto-changeover) - the panel must reflect the machine, not the click.
    arToggle.classList.toggle("active", reactor.arEnabled);
    arToggle.textContent = reactor.arEnabled ? "engaged" : "off";
    for (const m of ["arm", "ar", "lar"]) {
      $(`ar-mode-${m}`).classList.toggle(
        "active",
        m === reactor.arMode.toLowerCase(),
      );
    }

    // Plant thermal readouts.
    const nodes = reactor.state.nodes;
    let maxTf = 0;
    let sumTg = 0;
    let maxVoid = 0;
    for (const n of nodes) {
      if (n.fuelTemp > maxTf) maxTf = n.fuelTemp;
      sumTg += n.graphiteTemp;
      if (n.quality > maxVoid) maxVoid = n.quality;
    }
    $("p-tf").textContent = `${Math.round(maxTf)}°C`;
    $("p-tg").textContent = `${Math.round(sumTg / N_AXIAL)}°C`;
    $("p-x").textContent = `${(maxVoid * 100).toFixed(1)}%`;

    // Annunciators.
    setLamp("an-scram", reactor.state.scrammed ? "alarm" : "");
    setLamp("an-azm", reactor.protection.overpower ? "ok" : "warn");
    setLamp("an-azs", reactor.protection.period ? "ok" : "warn");
    $("an-azm-detail").textContent = reactor.protection.overpower
      ? "Power >110% → AZ-5"
      : "BLOCKED · overpower will only log";
    $("an-azs-detail").textContent = reactor.protection.period
      ? "Rising period <10 s → AZ-5"
      : "BLOCKED · short period will only log";
    $("rps-azm").textContent = reactor.protection.overpower ? "AZM armed · 110%" : "AZM BLOCKED";
    $("rps-azs").textContent = reactor.protection.period ? "AZS armed · 10 s" : "AZS BLOCKED";
    setLamp("an-period", periodDisp > 0 && periodDisp < 60 ? "warn" : "");
    // P0.3: hold-time lamps require t >= stamp (so re-init at t=0 does not
    // light them from a stale Infinity-delta) and LAR uses the same 15 s hold.
    setLamp(
      "an-silblok",
      t >= lampT.sil && t - lampT.sil < 15 ? "alarm" : "",
    );
    setLamp(
      "an-chg",
      t >= lampT.chg && t - lampT.chg < 15 ? "warn" : "",
    );
    setLamp(
      "an-lar",
      t >= lampT.lar && t - lampT.lar < 15 ? "alarm" : "",
    );
    // Advisory only: PRIZMA ORM below 15 equivalent rods during power operation.
    setLamp("an-orm", reactor.prizma().orm < 15 && disp.power > 0.1 ? "warn" : "");

    // AR imbalance galvanometer ("zaichik"): power minus active setpoint.
    const arErr = reactor.powerFraction() - reactor.activeSetpoint();
    drawImbalance(arErr);
    $("imbalance-state").textContent = Math.abs(arErr) < 0.001
      ? `balanced · error ${(arErr * 100).toFixed(2)} percentage points`
      : arErr > 0
        ? `power high by ${(arErr * 100).toFixed(2)} points · regulator inserts rods`
        : `power low by ${Math.abs(arErr * 100).toFixed(2)} points · regulator withdraws rods`;
    drawReactivity(disp.rho);
    $("reactivity-state").textContent = `${disp.rho >= 0 ? "+" : ""}${disp.rho.toFixed(2)} β · ${disp.rho > 0 ? "power tends to rise" : disp.rho < 0 ? "power tends to fall" : "critical / steady"}`;

    // Power-channel scale and the startup checklist.
    trends.powerLogMode =
      pwMode === "log" || (pwMode === "auto" && disp.power < 0.005);
    updateChecklist();
    $("setpoint-val").textContent =
      `${Math.round(reactor.arSetpoint * 100)}% (at ${Math.round(reactor.activeSetpoint() * 100)}%)`;
    // P0.7: resync slider from reactor when the operator is not dragging it
    // (AZ-1 / plant-side setpoint changes).
    if (document.activeElement !== setpoint) {
      const sp = String(Math.round(reactor.arSetpoint * 100));
      if (setpoint.value !== sp) setpoint.value = sp;
    }
    // P0.18: resync AR subgroup auto/manual lamps from reactor state.
    for (const sub of [1, 2, 3] as const) {
      const rod = reactor.state.rods.find(
        (r) => r.group === "AR" && r.arSubgroup === sub,
      );
      $(`ar-sw-${sub}`).classList.toggle("active", rod?.autoControlled ?? false);
    }
    if (selected.size > 0) updateSelInfo();
    // Field reconstruction is quasi-static; recompute at 5 Hz (drawing
    // happens every frame so the detector shimmer stays smooth).
    channelMap.update(reactor.state.nodes);
    const field = channelMap.summary();
    $("field-hot").textContent = `${field.hottest.toFixed(2)}× average`;
    $<HTMLElement>("field-scale").style.setProperty(
      "--average-pos",
      `${Math.min(100, 100 / field.hottest).toFixed(1)}%`,
    );
    $("field-side").textContent =
      `${field.highQuadrant} · +${Math.max(0, field.highOffsetPct).toFixed(0)}%`;
    $("field-spread").textContent = field.spreadPct < 5
      ? `${field.spreadPct.toFixed(0)}% · even`
      : field.spreadPct < 10
        ? `${field.spreadPct.toFixed(0)}% · watch`
        : `${field.spreadPct.toFixed(0)}% · tilted`;
  }

  // Panels.
  cartogram.draw(selected);
  channelMap.draw(disp.power, t);
  slice.draw(reactor.state.nodes, reactor.state.rods);
  trends.draw();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
