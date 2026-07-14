import { describe, expect, test } from "bun:test";
import { Reactor } from "../src/reactor";

describe("shutdown state and startup", () => {
  test("shutdown hot standby is subcritical at source level and stable", () => {
    const r = new Reactor();
    r.initShutdown();
    const p0 = r.powerFraction();
    expect(p0).toBeGreaterThan(1e-7);
    expect(p0).toBeLessThan(1e-3);
    expect(r.reactivityDollars()).toBeLessThan(-1);
    r.tick(120, 0.1);
    expect(Math.abs(r.powerFraction() / p0 - 1)).toBeLessThan(0.2);
  });

  test("rod withdrawal raises subcritical multiplication (1/M)", () => {
    const r = new Reactor();
    r.initShutdown();
    const p0 = r.powerFraction();
    r.setRodTarget("AZ", 0);
    r.tick(90, 0.1);
    const p1 = r.powerFraction();
    expect(p1).toBeGreaterThan(p0 * 1.2);
    expect(p1).toBeLessThan(1e-3); // still subcritical
    expect(r.state.scrammed).toBe(false);
  });

  test("yanking the whole manual bank trips the period protection", () => {
    const r = new Reactor();
    r.initShutdown();
    r.setRodTarget("AZ", 0);
    r.tick(60, 0.1);
    r.setRodTarget("RR", 0.5); // 131 rods at once - reckless
    r.tick(180, 0.1);
    expect(r.state.scrammed).toBe(true);
  });

  test("a disciplined squad-by-squad startup reaches criticality without tripping", () => {
    const r = new Reactor();
    r.initShutdown();
    r.setRodTarget("AZ", 0);
    r.tick(90, 0.1);

    const rr = r.state.rods.filter((rod) => rod.group === "RR");
    let cursor = 0;
    let steps = 0;
    // Withdraw 6 rods at a time until the period meter comes alive.
    while (steps < 60) {
      const period = r.period();
      if (period > 0 && period < 150) break; // supercritical, stop pulling
      for (let j = 0; j < 6; j++) {
        const rod = rr[(cursor + j) % rr.length]!;
        r.setRodTarget(rod.id, Math.max(0, rod.target - 0.25));
      }
      cursor = (cursor + 6) % rr.length;
      r.tick(45, 0.1);
      steps++;
      expect(r.state.scrammed).toBe(false);
    }
    const period = r.period();
    expect(period).toBeGreaterThan(0);
    expect(period).toBeLessThan(150);

    // Power now rises on a controlled period, no trip.
    const p0 = r.powerFraction();
    r.tick(90, 0.05);
    expect(r.state.scrammed).toBe(false);
    expect(r.powerFraction()).toBeGreaterThan(p0 * 1.5);
  });
});
