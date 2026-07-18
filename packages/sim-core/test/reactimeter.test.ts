import { describe, expect, test } from "bun:test";
import { Reactor } from "../src/reactor";

describe("reactimeter (IPK)", () => {
  test("|reactivityBeta| is small at steady full power", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    r.tick(30);
    expect(Math.abs(r.reactivityBeta())).toBeLessThan(0.05);
    expect(Number.isFinite(r.reactivityBeta())).toBe(true);
  });

  test("post-scram reactivity is deeply negative and finite", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    r.scram("test");
    r.tick(60, 0.05);
    const rho = r.reactivityBeta();
    expect(Number.isFinite(rho)).toBe(true);
    expect(rho).toBeLessThan(-5);
  });

  test("shutdown hot standby reads subcritical", () => {
    const r = new Reactor();
    r.initShutdown();
    const rho = r.reactivityBeta();
    expect(rho).toBeGreaterThan(-10);
    expect(rho).toBeLessThan(-2);
    expect(Number.isFinite(rho)).toBe(true);
  });

  test("withdrawing AZ from shutdown raises reactivity toward zero", () => {
    const r = new Reactor();
    r.initShutdown();
    const rho0 = r.reactivityBeta();
    // Step AZ out, re-issuing so the continuous period block can clear.
    for (let i = 0; i < 12; i++) {
      r.setRodTarget("AZ", 0);
      r.tick(10, 0.1);
    }
    const rho1 = r.reactivityBeta();
    expect(rho1).toBeGreaterThan(rho0);
    expect(rho1).toBeLessThan(0);
    expect(r.powerFraction()).toBeLessThan(1e-3);
  });
});
