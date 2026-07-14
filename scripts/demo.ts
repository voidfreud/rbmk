/**
 * Demo scenario: a shift at the plant.
 *
 *  1. Steady at 100% rated power.
 *  2. Dispatcher orders a reduction to 50% - watch xenon build in.
 *  3. Three hours later the order comes to go back up - the xenon pit bites.
 *  4. AZ-5. Decay heat and the xenon corpse remain.
 *
 * Writes a strip log to stdout and structured JSONL to logs/run.jsonl.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BETA_EFF,
  N_AXIAL,
  Reactor,
  equilibriumIodineXenon,
} from "@rbmk/sim-core";

const logDir = join(import.meta.dir, "..", "logs");
mkdirSync(logDir, { recursive: true });
const logPath = join(logDir, "run.jsonl");
writeFileSync(logPath, "");

const reactor = new Reactor();
reactor.log.addSink((e) => {
  appendFileSync(logPath, JSON.stringify({ kind: "event", ...e }) + "\n");
  const stamp = hms(e.t);
  console.log(`        [${e.level.toUpperCase()}] ${stamp} ${e.code}: ${e.msg}`);
});

const XE_EQ_FULL = equilibriumIodineXenon(1.0).xenon;

function hms(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fluxBar(): string {
  // Axial profile, bottom of the core on the left.
  const glyphs = " .:-=+*#%@";
  let out = "";
  for (let k = N_AXIAL - 1; k >= 0; k--) {
    const f = reactor.state.nodes[k]!.flux;
    const i = Math.max(0, Math.min(glyphs.length - 1, Math.round(f * 4)));
    out += glyphs[i];
  }
  return out;
}

function sample(note = ""): void {
  const s = reactor.state;
  const p = reactor.powerFraction();
  const xe =
    s.nodes.reduce((a, n) => a + n.xenon, 0) / N_AXIAL / XE_EQ_FULL;
  const voidAvg = s.nodes.reduce((a, n) => a + n.voidFrac, 0) / N_AXIAL;
  const period = reactor.period();
  const periodStr =
    Math.abs(period) >= 1e5 ? "  inf" : String(Math.round(period)).padStart(5);
  const row = {
    kind: "sample",
    t: s.time,
    power: p,
    periodS: Math.abs(period) >= 1e5 ? null : period,
    reactivityDollars: reactor.reactivityDollars(),
    xenonRel: xe,
    voidAvg,
    thermalMW: reactor.thermalPowerW() / 1e6,
  };
  appendFileSync(logPath, JSON.stringify(row) + "\n");
  console.log(
    `${hms(s.time)}  P=${(p * 100).toFixed(1).padStart(5)}%  ` +
      `T=${periodStr}s  rho=${reactor.reactivityDollars().toFixed(2).padStart(6)}$  ` +
      `Xe=${xe.toFixed(2)}  void=${voidAvg.toFixed(2)}  |${fluxBar()}| ${note}`,
  );
}

/**
 * The shift operator: when the automatic regulator runs out of authority
 * (power off setpoint, or the AR bank near its end stops), trim a SMALL
 * squad of manual rods - the real BShchU allowed at most ~4 rods moving
 * at once, and that limit is what keeps reactivity rates sane. Moving the
 * whole 131-rod bank at drive speed would be ~5 beta/s - instant trip.
 */
const rrRods = reactor.state.rods.filter((r) => r.group === "RR");
let rrCursor = 0;
function meanRR(): number {
  return rrRods.reduce((a, r) => a + r.insertion, 0) / rrRods.length;
}
function operatorTrim(): void {
  const err = reactor.activeSetpoint() - reactor.powerFraction();
  const tol = 0.01 * Math.max(0.1, reactor.activeSetpoint());
  let dir = 0;
  if (err > tol) dir = -1; // power low: withdraw
  else if (err < -tol) dir = +1; // power high: insert
  // "Release the AR": when the auto bank nears either end of its range,
  // shift the load onto manual rods so the AR regains authority.
  const ar = reactor.arInsertion();
  if (ar > 0.85) dir = +1;
  else if (ar < 0.15 && dir === 0) dir = -1;
  if (dir === 0) return;
  // Urgency scaling within the panel rules: withdrawal is restricted to
  // <=5 rods at once (and >=8 withdrawing trips the power interlock), so
  // urgency shows up as deeper steps; insertion is never count-restricted.
  const mag = Math.abs(err);
  const squad = dir < 0 ? 4 : mag > 0.06 ? 16 : mag > 0.03 ? 8 : 4;
  const step = mag > 0.06 ? 0.15 : mag > 0.03 ? 0.1 : 0.05;
  for (let j = 0; j < squad; j++) {
    const rod = rrRods[(rrCursor + j) % rrRods.length]!;
    const t = Math.min(0.9, Math.max(0.02, rod.target + dir * step));
    reactor.setRodTarget(rod.id, t);
  }
  rrCursor = (rrCursor + squad) % rrRods.length;
}

interface RunOpts {
  maxStep?: number;
  printEvery?: number;
  operator?: boolean;
}

function runFor(seconds: number, chunk: number, opts: RunOpts = {}): void {
  const { maxStep = 0.1, printEvery = 1, operator = false } = opts;
  const chunks = Math.ceil(seconds / chunk);
  for (let i = 0; i < chunks; i++) {
    reactor.tick(Math.min(chunk, seconds - i * chunk), maxStep);
    if (operator) operatorTrim();
    if ((i + 1) % printEvery === 0 || i === chunks - 1) sample();
  }
}

console.log("=== RBMK-1000 sim-core demo: a shift at the plant ===\n");
console.log("bottom [" + "-".repeat(N_AXIAL - 8) + "] top  (flux profile)\n");

console.log("--- Phase 1: steady at 100% ---");
reactor.initAtPower(1.0, { manualInsertion: 0.55 });
sample("steady state");
runFor(120, 60);

console.log("\n--- Phase 2: dispatcher orders 50%; xenon transient follows ---");
reactor.arSetpoint = 0.5;
runFor(300, 60, { operator: true, printEvery: 5 });
console.log("    ... 3 hours at 50%, operator trimming against xenon ...");
runFor(3 * 3600, 60, { operator: true, printEvery: 45 });

console.log("\n--- Phase 3: ramp back to full power - climbing against the pit ---");
while (reactor.arSetpoint < 1.0 && !reactor.state.scrammed) {
  reactor.arSetpoint = Math.min(1.0, reactor.arSetpoint + 0.05);
  runFor(240, 60, { operator: true, printEvery: 4 });
}
console.log("    ... one hour holding full power, xenon burning off ...");
runFor(3600, 30, { operator: true, printEvery: 60 });
console.log(`    manual bank mean insertion now ${meanRR().toFixed(2)} (0.55 at shift start)`);

console.log("\n--- Phase 4: AZ-5 ---");
reactor.scram("end of demo shift");
runFor(60, 15, { maxStep: 0.01 });
console.log("    ... 30 minutes after shutdown (decay heat, xenon rising) ...");
runFor(1800, 900);
console.log(
  `\nThermal power after shutdown: ${(reactor.thermalPowerW() / 1e6).toFixed(0)} MW (decay heat)`,
);
const xePeakRel =
  reactor.state.nodes.reduce((a, n) => a + n.xenon, 0) / N_AXIAL / XE_EQ_FULL;
console.log(`Xenon at ${xePeakRel.toFixed(2)}x full-power equilibrium and climbing.`);
console.log(`\nEvents and samples written to logs/run.jsonl`);
console.log(`beta_eff = ${BETA_EFF}, all reactivity in dollars of that.`);
