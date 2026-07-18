import { describe, expect, test } from "bun:test";
import {
  CP_STEAM,
  FUEL_UA,
  GRAPHITE_UA,
  H_F,
  H_FG,
  N_AXIAL,
  P_RATED,
  T_SAT,
} from "../src/constants";
import { Reactor } from "../src/reactor";
import { equilibriumThermal, stepThermal, voidFromQuality } from "../src/thermal";
import { zeroNode } from "../src/types";

describe("steady operation", () => {
  test("calibrated reactor holds power for 60 s", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    const p0 = r.powerFraction();
    expect(p0).toBeCloseTo(1.0, 1);
    r.tick(60);
    const p1 = r.powerFraction();
    // Feedbacks are live; allow a few percent drift over a minute.
    expect(Math.abs(p1 - p0) / p0).toBeLessThan(0.05);
  });

  test("thermal fields look like an operating RBMK", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    const nodes = r.state.nodes;
    const top = nodes[0]!;
    const bottom = nodes[nodes.length - 1]!;
    // Coolant enters subcooled at the bottom, boils by the top.
    expect(bottom.voidFrac).toBeLessThan(top.voidFrac);
    expect(top.quality).toBeGreaterThan(0.02);
    expect(top.coolantTemp).toBeCloseTo(285.8, 0);
    // Fuel runs hot somewhere in the core; peak flux sits low (rods enter
    // from the top and push the axial shape down, as in the real machine).
    const hottest = Math.max(...nodes.map((n) => n.fuelTemp));
    expect(hottest).toBeGreaterThan(500);
    const peakIndex = nodes.reduce(
      (best, n, k) => (n.flux > nodes[best]!.flux ? k : best),
      0,
    );
    expect(peakIndex).toBeGreaterThan(nodes.length / 2);
  });

  test("coolant enthalpy is driven by UA heat transfer at equilibrium", () => {
    const nodes = Array.from({ length: N_AXIAL }, () => zeroNode());
    // Flat power distribution at full rated.
    const nodePowers = new Array(N_AXIAL).fill(P_RATED / N_AXIAL);
    equilibriumThermal(nodes, nodePowers, 1);
    // At eq, sum of UA*(T-Tc) + direct ≈ node power for each node.
    const DIRECT = 0.04;
    for (let k = 0; k < N_AXIAL; k++) {
      const n = nodes[k]!;
      const power = nodePowers[k]!;
      const qUa =
        FUEL_UA * (n.fuelTemp - n.coolantTemp) +
        GRAPHITE_UA * (n.graphiteTemp - n.coolantTemp);
      const q = qUa + DIRECT * power;
      // Within a few percent of deposited power.
      expect(Math.abs(q - power) / power).toBeLessThan(0.08);
    }
    // Top of core still boiling (not dryout at rated flow).
    expect(nodes[0]!.quality).toBeGreaterThan(0.02);
    expect(nodes[0]!.quality).toBeLessThan(1);
    expect(nodes[0]!.coolantTemp).toBeCloseTo(T_SAT, 0);
  });

  test("superheat branch: quality=1 and T > T_SAT when enthalpy exceeds H_F+H_FG", () => {
    const nodes = Array.from({ length: N_AXIAL }, () => zeroNode());
    // Extreme power / low flow so exit enthalpy is superheated.
    const nodePowers = new Array(N_AXIAL).fill((P_RATED * 3) / N_AXIAL);
    for (let i = 0; i < 200; i++) {
      stepThermal(nodes, nodePowers, 0.15, 1);
    }
    const top = nodes[0]!;
    expect(top.quality).toBe(1);
    expect(top.coolantTemp).toBeGreaterThan(T_SAT + 1);
    // Void at quality=1 is fully vaporous (within slip correlation).
    expect(top.voidFrac).toBeGreaterThan(0.9);
    expect(voidFromQuality(1)).toBeCloseTo(1, 5);
    // Sanity: superheat uses CP_STEAM scale.
    expect(CP_STEAM).toBe(2000);
    expect(H_F + H_FG).toBeGreaterThan(H_F);
  });
});
