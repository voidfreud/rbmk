import {
  BETA_EFF,
  N_AXIAL,
  Reactor,
  equilibriumIodineXenon,
  type RodGroup,
} from "@rbmk/sim-core";
import { Cartogram, depthLabel, rodCoord } from "./cartogram";
import { ChannelMap } from "./channelmap";
import { Slice } from "./slice";
import { StripChart, hms } from "./strips";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// Reactor
// ---------------------------------------------------------------------------
const reactor = new Reactor();
const XE_EQ = equilibriumIodineXenon(1.0).xenon;

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

$("view-power").onclick = () => {
  channelMap.view = "power";
  $("view-power").classList.add("active");
  $("view-temp").classList.remove("active");
};
$("view-temp").onclick = () => {
  channelMap.view = "temp";
  $("view-temp").classList.add("active");
  $("view-power").classList.remove("active");
};

const fieldCanvas = $<HTMLCanvasElement>("channelmap");
fieldCanvas.addEventListener("mousemove", (e) => {
  const label = channelMap.hit(e.clientX, e.clientY, reactor.powerFraction());
  const tip = $("tooltip");
  if (label) {
    tip.style.display = "block";
    tip.style.left = `${e.clientX + 14}px`;
    tip.style.top = `${e.clientY + 14}px`;
    tip.textContent = label;
  } else {
    tip.style.display = "none";
  }
});
fieldCanvas.addEventListener("mouseleave", () => ($("tooltip").style.display = "none"));

const sliceCanvas = $<HTMLCanvasElement>("slice");
sliceCanvas.addEventListener("mousemove", (e) => {
  const label = slice.hit(e.clientX, e.clientY);
  const tip = $("tooltip");
  if (label) {
    tip.style.display = "block";
    tip.style.left = `${e.clientX + 14}px`;
    tip.style.top = `${e.clientY + 14}px`;
    tip.textContent = label;
  } else {
    tip.style.display = "none";
  }
});
sliceCanvas.addEventListener("mouseleave", () => ($("tooltip").style.display = "none"));

// Recorders with their real working limits drawn in status colors.
const stripPower = new StripChart(
  $("st-power") as HTMLCanvasElement, "#3987e5", (v) => `${v.toFixed(1)}%`,
  360, undefined,
  [{ v: 110, color: "#d03b3b", label: "AZM trip 110%", stretch: true }],
);
const stripPeriod = new StripChart(
  $("st-period") as HTMLCanvasElement, "#199e70",
  (v) => (Math.abs(v) >= 200 ? "inf" : `${v.toFixed(0)}s`), 360, 200,
  [
    { v: 10, color: "#d03b3b", label: "AZS trip 10 s" },
    { v: 60, color: "#fab219", label: "withdrawal block 60 s" },
  ],
);
const stripRho = new StripChart(
  $("st-rho") as HTMLCanvasElement, "#9085e9", (v) => `${v.toFixed(2)}β`,
  360, 25,
  [{ v: 1, color: "#d03b3b", label: "prompt critical +1β", stretch: true }],
);
const stripXe = new StripChart(
  $("st-xe") as HTMLCanvasElement, "#c98500", (v) => `${v.toFixed(2)}×`,
  360, undefined,
  [{ v: 1, color: "#898781", label: "full-power equilibrium" }],
);

// ---------------------------------------------------------------------------
// Event log feed
// ---------------------------------------------------------------------------
const alarmList = $("alarm-list");
reactor.log.addSink((e) => {
  const li = document.createElement("li");
  li.className = e.level;
  const icon = e.level === "alarm" ? "▲ " : e.level === "warn" ? "◆ " : "· ";
  li.textContent = `${icon}${hms(e.t)} ${e.code}: ${e.msg}`;
  alarmList.prepend(li);
  while (alarmList.children.length > 200) alarmList.lastChild?.remove();
});

// Annunciator memory: transient events light their lamp for a hold time.
const lampT = { sil: -Infinity, chg: -Infinity, lar: -Infinity };
reactor.log.addSink((e) => {
  if (e.code === "SIL_BLOK") lampT.sil = e.t;
  else if (e.code === "AR_CHANGEOVER") lampT.chg = e.t;
  else if (e.code === "LAR_DROPOUT") lampT.lar = e.t;
});

function setLamp(id: string, state: "" | "ok" | "warn" | "alarm"): void {
  const el = $(id);
  el.className = `lamp${state ? ` ${state}` : ""}`;
}

// Bring the plant to power AFTER the log sink is attached so INIT shows up.
reactor.initAtPower(1.0, { manualInsertion: 0.55 });

// ---------------------------------------------------------------------------
// Rod selection & control
// ---------------------------------------------------------------------------
const selected = new Set<number>();
let dragStart: [number, number] | null = null;
let dragNow: [number, number] | null = null;

const mapCanvas = $<HTMLCanvasElement>("cartogram");
const tooltip = $("tooltip");

mapCanvas.addEventListener("mousedown", (e) => {
  dragStart = [e.clientX, e.clientY];
  dragNow = dragStart;
});
window.addEventListener("mousemove", (e) => {
  if (dragStart) dragNow = [e.clientX, e.clientY];
});
window.addEventListener("mouseup", (e) => {
  if (!dragStart) return;
  const dist = Math.hypot(e.clientX - dragStart[0], e.clientY - dragStart[1]);
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  if (dist < 5) {
    const rod = cartogram.hit(e.clientX, e.clientY);
    if (rod) {
      if (!additive) selected.clear();
      if (selected.has(rod.id)) selected.delete(rod.id);
      else selected.add(rod.id);
    } else if (!additive) {
      selected.clear();
    }
  } else {
    if (!additive) selected.clear();
    for (const rod of cartogram.rodsInRect(dragStart[0], dragStart[1], e.clientX, e.clientY)) {
      selected.add(rod.id);
    }
  }
  dragStart = null;
  dragNow = null;
  rebuildSelRows();
  updateSelInfo();
});

mapCanvas.addEventListener("mousemove", (e) => {
  const rod = cartogram.hit(e.clientX, e.clientY);
  if (rod && !dragStart) {
    tooltip.style.display = "block";
    tooltip.style.left = `${e.clientX + 14}px`;
    tooltip.style.top = `${e.clientY + 14}px`;
    tooltip.textContent = depthLabel(rod);
  } else {
    tooltip.style.display = "none";
  }
});
mapCanvas.addEventListener("mouseleave", () => (tooltip.style.display = "none"));

function selectGroup(group: RodGroup): void {
  selected.clear();
  for (const rod of reactor.state.rods) {
    if (rod.group === group) selected.add(rod.id);
  }
  rebuildSelRows();
  updateSelInfo();
}
$("sel-manual").onclick = () => selectGroup("RR");
$("sel-auto").onclick = () => selectGroup("AR");
$("sel-lar").onclick = () => selectGroup("LAR");
$("sel-shortened").onclick = () => selectGroup("USP");
$("sel-emergency").onclick = () => selectGroup("AZ");
$("sel-none").onclick = () => {
  selected.clear();
  rebuildSelRows();
  updateSelInfo();
};

const GRP_SHORT: Record<string, string> = {
  RR: "RR",
  AR: "AR",
  LAR: "LAR",
  AZ: "AZ",
  USP: "USP",
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
      `<span class="grp">${GRP_SHORT[rod.group]}</span>` +
      `<span class="bar"><i style="width:${rod.insertion * 100}%"></i></span>` +
      `<span class="depth num">${(rod.insertion * 7).toFixed(2)}m</span>` +
      `<span class="lim num"></span>`;
    const up = document.createElement("button");
    up.textContent = "▲";
    const down = document.createElement("button");
    down.textContent = "▼";
    const stopRod = () => reactor.setRodTarget(id, reactor.state.rods[id]!.insertion);
    lever(up, () => reactor.setRodTarget(id, 0), stopRod);
    lever(down, () => reactor.setRodTarget(id, 1), stopRod);
    row.append(up, down);
    wrap.append(row);
  }
}

/** Refresh bars/depths in place (no DOM rebuild) at instrument rate. */
function refreshSelRows(): void {
  for (const row of document.querySelectorAll<HTMLElement>(".rod-row")) {
    const rod = reactor.state.rods[Number(row.dataset.rod)]!;
    row.querySelector<HTMLElement>(".bar > i")!.style.width = `${rod.insertion * 100}%`;
    row.querySelector(".depth")!.textContent = `${(rod.insertion * 7).toFixed(2)}m`;
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
  if (selected.size === 0) {
    info.textContent = "no rods selected";
  } else if (selected.size === 1) {
    const rod = reactor.state.rods[[...selected][0]!]!;
    info.textContent = depthLabel(rod);
  } else {
    const rods = [...selected].map((id) => reactor.state.rods[id]!);
    const avg = rods.reduce((a, r) => a + r.insertion, 0) / rods.length;
    info.textContent = `${rods.length} rods — mean insertion ${(avg * 7).toFixed(2)} m`;
  }
  refreshSelRows();
}

const STEP = 0.05; // 35 cm

/** Drive command for the selection: continuous lever, pulse step, or stop.
 * Panel rule (TEZ L.24): WITHDRAWAL is restricted with 5+ rods selected;
 * insertion is never count-restricted. AZ rods are exempt - the emergency
 * bank is cocked as a SET before startup (which is why the power interlock
 * excludes them too). */
let lastSelLimitT = -Infinity;
function driveSelected(cmd: "out" | "in" | "stop" | number): void {
  const isWithdrawal = cmd === "out" || (typeof cmd === "number" && cmd < 0);
  const nonAz = [...selected].filter(
    (id) => reactor.state.rods[id]!.group !== "AZ",
  ).length;
  if (isWithdrawal && nonAz > 5) {
    if (reactor.state.time - lastSelLimitT > 5) {
      lastSelLimitT = reactor.state.time;
      reactor.log.warn(
        reactor.state.time,
        "SEL_LIMIT",
        `withdrawal restricted: ${nonAz} non-AZ rods selected (max 5 for withdrawal)`,
      );
    }
    return;
  }
  for (const id of selected) {
    const rod = reactor.state.rods[id]!;
    if (cmd === "stop") reactor.setRodTarget(id, rod.insertion);
    else if (cmd === "out") reactor.setRodTarget(id, 0);
    else if (cmd === "in") reactor.setRodTarget(id, 1);
    else reactor.setRodTarget(id, rod.target + cmd);
  }
}

/** Real lever feel: hold = rods drive at 0.4 m/s, release = they stop. */
function lever(el: HTMLElement, drive: () => void, release: () => void): void {
  el.addEventListener("mousedown", drive);
  for (const ev of ["mouseup", "mouseleave"]) el.addEventListener(ev, release);
}
lever($("rod-out"), () => driveSelected("out"), () => driveSelected("stop"));
lever($("rod-in"), () => driveSelected("in"), () => driveSelected("stop"));
$("rod-step-out").onclick = () => driveSelected(-STEP);
$("rod-step-in").onclick = () => driveSelected(+STEP);
$("rod-stop").onclick = () => driveSelected("stop");
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
  reactor.arEnabled = !reactor.arEnabled;
  arToggle.classList.toggle("active", reactor.arEnabled);
  arToggle.textContent = reactor.arEnabled ? "engaged" : "off";
};

function setArMode(mode: "ARM" | "AR" | "LAR"): void {
  reactor.arMode = mode;
  for (const m of ["arm", "ar", "lar"]) {
    $(`ar-mode-${m}`).classList.toggle("active", m === mode.toLowerCase());
  }
}
$("ar-mode-arm").onclick = () => setArMode("ARM");
$("ar-mode-ar").onclick = () => setArMode("AR");
$("ar-mode-lar").onclick = () => setArMode("LAR");

// AR subgroup auto/manual switches: off = the 4 rods of that subgroup are
// released to manual control (and the regulator skips them).
for (const sub of [1, 2, 3] as const) {
  const btn = $(`ar-sw-${sub}`);
  btn.onclick = () => {
    const rods = reactor.state.rods.filter(
      (r) => r.group === "AR" && r.arSubgroup === sub,
    );
    const nowAuto = !rods[0]!.autoControlled;
    for (const rod of rods) rod.autoControlled = nowAuto;
    btn.classList.toggle("active", nowAuto);
  };
}

$("rps-azm").onclick = () => {
  reactor.protection.overpower = !reactor.protection.overpower;
  $("rps-azm").classList.toggle("active", reactor.protection.overpower);
};
$("rps-azs").onclick = () => {
  reactor.protection.period = !reactor.protection.period;
  $("rps-azs").classList.toggle("active", reactor.protection.period);
};
$("az1").onclick = () => reactor.azSetback();

const setpoint = $<HTMLInputElement>("setpoint");
setpoint.oninput = () => {
  reactor.arSetpoint = Number(setpoint.value) / 100;
  $("setpoint-val").textContent = `${setpoint.value}%`;
};

const gradient = $<HTMLInputElement>("gradient");
gradient.oninput = () => {
  // Slider is in hundredths of %/s: 1..35 -> 0.01..0.35 %/s.
  reactor.arGradient = Number(gradient.value) / 10000;
  $("gradient-val").textContent = `${(Number(gradient.value) / 100).toFixed(2)}%/s`;
};

/** Snap damped instrument displays to the actual state (used on re-init). */
function snapDisplays(): void {
  disp.power = reactor.powerFraction();
  disp.rho = reactor.reactivityDollars();
  disp.xe =
    reactor.state.nodes.reduce((a, n) => a + n.xenon, 0) / N_AXIAL / XE_EQ;
  disp.voidAvg =
    reactor.state.nodes.reduce((a, n) => a + n.voidFrac, 0) / N_AXIAL;
  disp.periodRate = 0;
}

$("init-power").onclick = () => {
  reactor.initAtPower(1.0, { manualInsertion: 0.55 });
  setpoint.value = "100";
  selected.clear();
  rebuildSelRows();
  updateSelInfo();
  snapDisplays();
};
$("init-shutdown").onclick = () => {
  reactor.initShutdown();
  setpoint.value = "0";
  selected.clear();
  rebuildSelRows();
  updateSelInfo();
  snapDisplays();
};

const flow = $<HTMLInputElement>("flow");
flow.oninput = () => {
  reactor.setFlowFraction(Number(flow.value) / 100);
  $("flow-val").textContent = `${flow.value}%`;
};

let speed = 1;
for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
  btn.onclick = () => {
    speed = Number(btn.dataset.speed);
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

let lastWall = performance.now();
let nextSample = 0;
let nextDomUpdate = 0;

/**
 * Damped display values: real panel instruments have mechanical/electrical
 * damping, so the readouts must not flicker at frame rate. Smooth with
 * ~0.5 s time constant and write to the DOM at 5 Hz.
 */
const disp = { power: 1, rho: 0, xe: 1, voidAvg: 0.35, periodRate: 0 };
function smooth(wallDt: number): void {
  const a = Math.min(1, wallDt / 0.5);
  disp.power += (reactor.powerFraction() - disp.power) * a;
  disp.rho += (reactor.reactivityDollars() - disp.rho) * a;
  const xe =
    reactor.state.nodes.reduce((a2, n) => a2 + n.xenon, 0) / N_AXIAL / XE_EQ;
  disp.xe += (xe - disp.xe) * a;
  const voidAvg =
    reactor.state.nodes.reduce((a2, n) => a2 + n.voidFrac, 0) / N_AXIAL;
  disp.voidAvg += (voidAvg - disp.voidAvg) * a;
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

  if (speed > 0 && wallDt > 0) {
    const simDt = wallDt * speed;
    reactor.tick(simDt, speed > 1 ? 0.1 : 0.02);
  }
  smooth(wallDt);

  const t = reactor.state.time;
  if (t >= nextSample) {
    const period = 1 / Math.max(1 / 200, Math.abs(disp.periodRate)) *
      Math.sign(disp.periodRate || 1);
    stripPower.push(t, disp.power * 100);
    stripPeriod.push(t, Math.abs(period) >= 200 ? 200 : period);
    stripRho.push(t, disp.rho);
    stripXe.push(t, disp.xe);
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
    // Plant state annunciator.
    const period = reactor.period();
    let stateTxt: string;
    if (reactor.state.scrammed) stateTxt = "SCRAMMED";
    else if (disp.power > 0.05) stateTxt = "POWER OPERATION";
    else if (period > 0 && period < 500) stateTxt = "SUPERCRITICAL - RISING";
    else stateTxt = "SUBCRITICAL";
    $("i-state").textContent = stateTxt;
    $("i-period").textContent = periodText();
    // Reactivity in beta units (the ZRT-A reactimeter's convention), with
    // % dk/k as the secondary readout.
    $("i-rho").textContent = `${disp.rho.toFixed(2)} β`;
    $("i-rho-pct").textContent = `${(disp.rho * BETA_EFF * 100).toFixed(3)}% Δk/k`;
    // ORM comes from PRIZMA printouts only (pre-1986 realism): the value is
    // stale by design, and the age readout says how stale.
    const prizma = reactor.prizma();
    $("i-orm").textContent = prizma.orm.toFixed(1);
    const age = Math.max(0, t - prizma.t);
    $("i-orm-age").textContent = `printout ${Math.floor(age / 60)}:${String(Math.floor(age % 60)).padStart(2, "0")} ago`;
    $("i-xe").textContent = `${disp.xe.toFixed(2)}×`;
    $("i-void").textContent = `${(disp.voidAvg * 100).toFixed(0)}%`;
    $("i-flow").textContent = `${Math.round(reactor.state.flowFraction * 100)}%`;
    $("ar-pos").textContent = `${(reactor.arInsertion() * 7).toFixed(2)} m`;
    $("ar-active").textContent =
      reactor.arMode === "LAR" ? "LAR" : `AR-${reactor.arActiveGroup}`;
    // The regulator can disengage itself (LAR dropout) - reflect it.
    arToggle.classList.toggle("active", reactor.arEnabled);
    arToggle.textContent = reactor.arEnabled ? "engaged" : "off";

    // Plant thermal readouts.
    const nodes = reactor.state.nodes;
    $("p-tf").textContent = `${Math.round(Math.max(...nodes.map((n) => n.fuelTemp)))}°C`;
    $("p-tg").textContent = `${Math.round(nodes.reduce((a, n) => a + n.graphiteTemp, 0) / N_AXIAL)}°C`;
    $("p-x").textContent = `${(Math.max(...nodes.map((n) => n.quality)) * 100).toFixed(1)}%`;
    $("p-dh").textContent = `${(reactor.state.decayHeat.groups.reduce((a, b) => a + b, 0) / 1e6).toFixed(0)} MW`;

    // Annunciators.
    setLamp("an-scram", reactor.state.scrammed ? "alarm" : "");
    setLamp("an-azm", reactor.protection.overpower ? "ok" : "warn");
    setLamp("an-azs", reactor.protection.period ? "ok" : "warn");
    $("an-azm").lastChild!.textContent = reactor.protection.overpower ? "AZM armed" : "AZM BLOCKED";
    $("an-azs").lastChild!.textContent = reactor.protection.period ? "AZS armed" : "AZS BLOCKED";
    setLamp("an-period", period > 0 && period < 60 ? "warn" : "");
    setLamp("an-silblok", t - lampT.sil < 15 ? "alarm" : "");
    setLamp("an-chg", t - lampT.chg < 15 ? "warn" : "");
    setLamp("an-lar", lampT.lar > 0 && !reactor.arEnabled ? "alarm" : "");
    setLamp("an-orm", reactor.prizma().orm < 15 && disp.power > 0.1 ? "warn" : "");

    // AR imbalance galvanometer ("zaichik"): power minus active setpoint.
    drawImbalance(reactor.powerFraction() - reactor.activeSetpoint());
    $("setpoint-val").textContent =
      `${Math.round(reactor.arSetpoint * 100)}% (at ${Math.round(reactor.activeSetpoint() * 100)}%)`;
    if (selected.size > 0) updateSelInfo();
    // The channel field changes slowly; recompute and redraw at 5 Hz.
    channelMap.update(reactor.state.nodes);
    channelMap.draw(reactor.state.nodes, disp.power);
  }

  // Panels.
  const dragRect =
    dragStart && dragNow
      ? ([dragStart[0], dragStart[1], dragNow[0], dragNow[1]] as [number, number, number, number])
      : null;
  cartogram.draw(selected, dragRect);
  slice.draw(reactor.state.nodes, reactor.state.rods);
  stripPower.draw();
  stripPeriod.draw();
  stripRho.draw();
  stripXe.draw();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
