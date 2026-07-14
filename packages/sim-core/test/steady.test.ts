import { describe, expect, test } from "bun:test";
import { Reactor } from "../src/reactor";

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
});
