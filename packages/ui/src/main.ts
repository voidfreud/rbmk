import {
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

const stripPower = new StripChart($("st-power") as HTMLCanvasElement, "#3987e5", (v) => `${v.toFixed(1)}%`);
const stripPeriod = new StripChart($("st-period") as HTMLCanvasElement, "#199e70", (v) => (Math.abs(v) >= 200 ? "inf" : `${v.toFixed(0)}s`), 360, 200);
const stripRho = new StripChart($("st-rho") as HTMLCanvasElement, "#9085e9", (v) => `${v.toFixed(2)}$`, 360, 25);
const stripXe = new StripChart($("st-xe") as HTMLCanvasElement, "#c98500", (v) => `${v.toFixed(2)}×`);

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

// Bring the plant to power AFTER the log sink is attached so INIT shows up.
reactor.initAtPower(1.0, { manualInsertion: 0.45 });

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
  if (dist < 5) {
    const rod = cartogram.hit(e.clientX, e.clientY);
    if (rod) {
      if (!e.shiftKey) selected.clear();
      if (selected.has(rod.id)) selected.delete(rod.id);
      else selected.add(rod.id);
    } else if (!e.shiftKey) {
      selected.clear();
    }
  } else {
    if (!e.shiftKey) selected.clear();
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
      `<span class="depth num">${(rod.insertion * 7).toFixed(2)}m</span>`;
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

/** Drive command for the selection: continuous lever, pulse step, or stop. */
function driveSelected(cmd: "out" | "in" | "stop" | number): void {
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

$("ar-mode-ar").onclick = () => {
  reactor.arMode = "AR";
  $("ar-mode-ar").classList.add("active");
  $("ar-mode-lar").classList.remove("active");
};
$("ar-mode-lar").onclick = () => {
  reactor.arMode = "LAR";
  $("ar-mode-lar").classList.add("active");
  $("ar-mode-ar").classList.remove("active");
};

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
    // Plant state annunciator.
    const period = reactor.period();
    let stateTxt: string;
    if (reactor.state.scrammed) stateTxt = "SCRAMMED";
    else if (disp.power > 0.05) stateTxt = "POWER OPERATION";
    else if (period > 0 && period < 500) stateTxt = "SUPERCRITICAL - RISING";
    else stateTxt = "SUBCRITICAL";
    $("i-state").textContent = stateTxt;
    $("i-mw").textContent = `${(reactor.thermalPowerW() / 1e6).toFixed(0)} MW thermal`;
    $("i-period").textContent = periodText();
    $("i-rho").textContent = `${disp.rho.toFixed(2)} $`;
    $("i-orm").textContent = reactor.ormRods().toFixed(1);
    $("i-xe").textContent = `${disp.xe.toFixed(2)}×`;
    $("i-void").textContent = `${(disp.voidAvg * 100).toFixed(0)}%`;
    $("i-flow").textContent = `${Math.round(reactor.state.flowFraction * 100)}%`;
    $("ar-pos").textContent = `${(reactor.arInsertion() * 7).toFixed(2)} m`;
    $("ar-active").textContent =
      reactor.arMode === "LAR" ? "LAR" : `AR-${reactor.arActiveGroup}`;
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
