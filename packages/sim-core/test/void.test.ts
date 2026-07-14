import { describe, expect, test } from "bun:test";
import { Reactor } from "../src/reactor";

describe("void feedback", () => {
  test("flow reduction -> void -> power excursion -> overpower scram", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    r.arEnabled = false;
    const p0 = r.powerFraction();
    const void0 = r.state.nodes.reduce((a, n) => a + n.voidFrac, 0);

    r.setFlowFraction(0.75);

    let maxPower = p0;
    let maxVoid = void0;
    for (let i = 0; i < 24; i++) {
      r.tick(0.5);
      maxPower = Math.max(maxPower, r.powerFraction());
      maxVoid = Math.max(
        maxVoid,
        r.state.nodes.reduce((a, n) => a + n.voidFrac, 0),
      );
    }

    // Positive void coefficient: less flow -> more void -> more power...
    expect(maxVoid).toBeGreaterThan(void0 * 1.05);
    expect(maxPower).toBeGreaterThan(p0 * 1.05);
    // ...until the emergency protection trips on overpower.
    expect(r.state.scrammed).toBe(true);
    expect(r.powerFraction()).toBeLessThan(0.2);
  });

  test("with the regulator ON a mild flow cut is ridden out", () => {
    // The real AR bank is only 4 rods (~0.2 beta of authority): a harsh
    // step flow cut rightly trips the protection, but a mild one is held.
    const r = new Reactor();
    r.initAtPower(1.0);
    r.setFlowFraction(0.95);
    r.tick(30);
    expect(r.state.scrammed).toBe(false);
    expect(Math.abs(r.powerFraction() - 1.0)).toBeLessThan(0.08);
  });
});
