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
  xenonReactivity,
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
 * (power sags below / creeps above setpoint), trim the manual rod bank a
 * little - this is how real crews compensated xenon transients.
 */
let manualTarget = 0.45;
function operatorTrim(): void {
  const err = reactor.arSetpoint - reactor.powerFraction();
  const tol = 0.01 * Math.max(0.1, reactor.arSetpoint);
  if (err > tol) {
    manualTarget = Math.max(0.02, manualTarget - 0.015);
    reactor.setRodTarget("manual", manualTarget);
  } else if (err < -tol) {
    manualTarget = Math.min(0.5, manualTarget + 0.015);
    reactor.setRodTarget("manual", manualTarget);
  }
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
reactor.initAtPower(1.0, { manualInsertion: 0.45 });
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
runFor(3600, 60, { operator: true, printEvery: 30 });
console.log(`    manual bank now at insertion ${manualTarget.toFixed(2)} (0.45 at shift start)`);

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
