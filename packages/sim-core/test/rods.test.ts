import { describe, expect, test } from "bun:test";
import { N_AXIAL, ROD_SPEED, USP_ABS_LENGTH } from "../src/constants";
import { globalReactivity } from "../src/kinetics";
import { Reactor } from "../src/reactor";
import { buildRods, rodReactivityByNode, stepRodDrives } from "../src/rods";
import type { NodeState } from "../src/types";
import { zeroNode } from "../src/types";

describe("control rods", () => {
  test("rod reactivity scratch output is reset before reuse", () => {
    const rods = buildRods(211);
    const expected = rodReactivityByNode(rods);
    const scratch = new Array(N_AXIAL).fill(12345);
    expect(rodReactivityByNode(rods, scratch)).toBe(scratch);
    expect(scratch).toEqual(expected);
    for (const rod of rods) rod.insertion = 0;
    expect(rodReactivityByNode(rods, scratch)).toBe(scratch);
    expect(scratch).not.toEqual(expected);
  });

  test("inserting manual rods lowers power (regulator off)", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    r.arEnabled = false;
    const p0 = r.powerFraction();
    r.setRodTarget("RR", 0.35);
    r.tick(30);
    expect(r.powerFraction()).toBeLessThan(p0 * 0.9);
  });

  test("scram shuts the reactor down", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    r.scram("test");
    r.tick(40);
    expect(r.powerFraction()).toBeLessThan(0.05);
    const alarms = r.log.all().filter((e) => e.code === "AZ5");
    expect(alarms.length).toBe(1);
  });

  test("graphite tip: initial insertion from fully withdrawn adds reactivity at the core bottom", () => {
    const rods = buildRods(211);
    for (const rod of rods) {
      rod.insertion = 0;
      rod.target = 0;
    }
    const before = rodReactivityByNode(rods);
    // AZ-5 does not drive USP rods (pre-1986); move the top-entering rods.
    for (const rod of rods) if (rod.group !== "USP") rod.insertion = 0.1;
    const after = rodReactivityByNode(rods);
    const delta = after.map((v, k) => v - before[k]!);

    // Negative where the absorber enters (top), positive near the bottom
    // where the displacer pushes the water column out.
    expect(delta[0]!).toBeLessThan(0);
    const bottomGain = delta[N_AXIAL - 2]! + delta[N_AXIAL - 3]!;
    expect(bottomGain).toBeGreaterThan(0);
  });

  test("with a bottom-peaked flux the first seconds of AZ-5 are net POSITIVE", () => {
    const rods = buildRods(211);
    for (const rod of rods) {
      rod.insertion = 0;
      rod.target = 0;
    }
    // Bottom-peaked flux shape, as in a xenon-distorted low-power core.
    const nodes: NodeState[] = [];
    for (let k = 0; k < N_AXIAL; k++) {
      const node = zeroNode();
      node.flux = 0.05 + (0.95 * k) / (N_AXIAL - 1);
      nodes.push(node);
    }

    const before = rodReactivityByNode(rods);
    for (const rod of rods) if (rod.group !== "USP") rod.insertion = 0.08;
    const after = rodReactivityByNode(rods);
    const deltaByNode = after.map((v, k) => v - before[k]!);
    const weightedDelta = globalReactivity(nodes, deltaByNode);
    expect(weightedDelta).toBeGreaterThan(0);

    // Full insertion is strongly negative no matter the shape.
    for (const rod of rods) if (rod.group !== "USP") rod.insertion = 1;
    const full = rodReactivityByNode(rods);
    const fullDelta = globalReactivity(
      nodes,
      full.map((v, k) => v - before[k]!),
    );
    expect(fullDelta).toBeLessThan(-0.02);
  });

  test("USP full stroke completes in ~7–9 s (stroke = USP_ABS_LENGTH)", () => {
    const rods = buildRods(211);
    const usp = rods.filter((r) => r.group === "USP");
    for (const rod of usp) {
      rod.insertion = 0;
      rod.target = 1;
    }
    // Expected travel time = USP_ABS_LENGTH / ROD_SPEED ≈ 7.6 s.
    const expected = USP_ABS_LENGTH / ROD_SPEED;
    expect(expected).toBeGreaterThan(7);
    expect(expected).toBeLessThan(9);

    let t = 0;
    const dt = 0.05;
    while (t < 20 && usp.some((r) => r.insertion < 1 - 1e-9)) {
      stepRodDrives(rods, dt);
      t += dt;
    }
    expect(t).toBeGreaterThan(7);
    expect(t).toBeLessThan(9);
    for (const rod of usp) expect(rod.insertion).toBeCloseTo(1, 5);

    // Standard rods still take ~CORE_HEIGHT/speed ≈ 17.5 s.
    const rr = rods.find((r) => r.group === "RR")!;
    rr.insertion = 0;
    rr.target = 1;
    t = 0;
    while (t < 30 && rr.insertion < 1 - 1e-9) {
      stepRodDrives(rods, dt);
      t += dt;
    }
    expect(t).toBeGreaterThan(16);
    expect(t).toBeLessThan(19);
  });
});
