import {
  N_AXIAL,
  Reactor,
  equilibriumIodineXenon,
  type RodGroup,
} from "@rbmk/sim-core";
import { Cartogram, depthLabel } from "./cartogram";
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

const stripPower = new StripChart($("st-power") as HTMLCanvasElement, "#3987e5", (v) => `${v.toFixed(1)}%`);
const stripPeriod = new StripChart($("st-period") as HTMLCanvasElement, "#199e70", (v) => (Math.abs(v) >= 999 ? "inf" : `${v.toFixed(0)}s`), 360, 999);
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
  updateSelInfo();
}
$("sel-manual").onclick = () => selectGroup("manual");
$("sel-auto").onclick = () => selectGroup("auto");
$("sel-shortened").onclick = () => selectGroup("shortened");
$("sel-emergency").onclick = () => selectGroup("emergency");
$("sel-none").onclick = () => {
  selected.clear();
  updateSelInfo();
};

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
}
updateSelInfo();

const STEP = 0.05; // 35 cm
function driveSelected(delta: number | "stop"): void {
  for (const id of selected) {
    const rod = reactor.state.rods[id]!;
    if (delta === "stop") {
      reactor.setRodTarget(id, rod.insertion);
    } else {
      reactor.setRodTarget(id, rod.target + delta);
    }
  }
}
function repeatWhileHeld(el: HTMLElement, fn: () => void): void {
  let timer: ReturnType<typeof setInterval> | null = null;
  el.addEventListener("mousedown", () => {
    fn();
    timer = setInterval(fn, 180);
  });
  for (const ev of ["mouseup", "mouseleave"]) {
    el.addEventListener(ev, () => {
      if (timer) clearInterval(timer);
      timer = null;
    });
  }
}
repeatWhileHeld($("rod-out"), () => driveSelected(-STEP));
repeatWhileHeld($("rod-in"), () => driveSelected(+STEP));
$("rod-stop").onclick = () => driveSelected("stop");

// ---------------------------------------------------------------------------
// AR, setpoint, flow, speed, AZ-5
// ---------------------------------------------------------------------------
const arToggle = $("ar-toggle");
arToggle.onclick = () => {
  reactor.arEnabled = !reactor.arEnabled;
  arToggle.classList.toggle("active", reactor.arEnabled);
  arToggle.textContent = reactor.arEnabled ? "AR engaged" : "AR off";
};

const setpoint = $<HTMLInputElement>("setpoint");
setpoint.oninput = () => {
  reactor.arSetpoint = Number(setpoint.value) / 100;
  $("setpoint-val").textContent = `${setpoint.value}%`;
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

function frame(now: number): void {
  const wallDt = Math.min(0.1, (now - lastWall) / 1000);
  lastWall = now;

  if (speed > 0 && wallDt > 0) {
    const simDt = wallDt * speed;
    reactor.tick(simDt, speed > 1 ? 0.1 : 0.02);
  }

  const t = reactor.state.time;
  if (t >= nextSample) {
    const xe =
      reactor.state.nodes.reduce((a, n) => a + n.xenon, 0) / N_AXIAL / XE_EQ;
    const period = reactor.period();
    stripPower.push(t, reactor.powerFraction() * 100);
    stripPeriod.push(t, Math.abs(period) >= 1e5 ? 999 : period);
    stripRho.push(t, reactor.reactivityDollars());
    stripXe.push(t, xe);
    nextSample = t + 0.5;
  }

  // Instruments.
  $("i-time").textContent = `t = ${hms(t)}`;
  $("i-power").textContent = `${(reactor.powerFraction() * 100).toFixed(1)}%`;
  $("i-mw").textContent = `${(reactor.thermalPowerW() / 1e6).toFixed(0)} MW thermal`;
  const period = reactor.period();
  $("i-period").textContent = Math.abs(period) >= 1e5 ? "∞" : `${period.toFixed(0)} s`;
  $("i-rho").textContent = `${reactor.reactivityDollars().toFixed(2)} $`;
  $("i-orm").textContent = reactor.ormRods().toFixed(1);
  const xe =
    reactor.state.nodes.reduce((a, n) => a + n.xenon, 0) / N_AXIAL / XE_EQ;
  $("i-xe").textContent = `${xe.toFixed(2)}×`;
  const voidAvg =
    reactor.state.nodes.reduce((a, n) => a + n.voidFrac, 0) / N_AXIAL;
  $("i-void").textContent = `${(voidAvg * 100).toFixed(0)}%`;
  $("i-flow").textContent = `${Math.round(reactor.state.flowFraction * 100)}%`;
  $("ar-pos").textContent = `${(reactor.arInsertion() * 7).toFixed(2)} m`;

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
  if (selected.size > 0) updateSelInfo();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
