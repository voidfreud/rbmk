import { describe, expect, test } from "bun:test";
import { Reactor } from "../src/reactor";

describe("fast-forward maxStep agreement (P2.25)", () => {
  test("void/scram trajectory at maxStep 0.01 vs 0.1 stays finite and similar", () => {
    function run(maxStep: number) {
      const r = new Reactor();
      r.initAtPower(1.0);
      r.arEnabled = false;
      r.setFlowFraction(0.75);
      const samples: number[] = [];
      // ~12 s of wall-clock sim time — enough for void excursion + scram.
      for (let i = 0; i < 120; i++) {
        r.tick(0.1, maxStep);
        const p = r.powerFraction();
        expect(Number.isFinite(p)).toBe(true);
        samples.push(p);
      }
      return { scrammed: r.state.scrammed, final: samples[samples.length - 1]!, peak: Math.max(...samples) };
    }

    const fine = run(0.01);
    const coarse = run(0.1);

    expect(Number.isFinite(fine.final)).toBe(true);
    expect(Number.isFinite(coarse.final)).toBe(true);
    expect(Number.isFinite(fine.peak)).toBe(true);
    expect(Number.isFinite(coarse.peak)).toBe(true);

    // Both should trip (positive void coeff + AR off).
    expect(fine.scrammed).toBe(true);
    expect(coarse.scrammed).toBe(true);

    // Peaks and end states should be in the same ballpark (not orders off).
    // Allow generous relative tolerance — the audit only asks "similar-ish".
    const peakRatio = fine.peak / Math.max(1e-12, coarse.peak);
    expect(peakRatio).toBeGreaterThan(0.2);
    expect(peakRatio).toBeLessThan(5);
    // Post-scram both should be well down.
    expect(fine.final).toBeLessThan(0.3);
    expect(coarse.final).toBeLessThan(0.3);
  });
});
