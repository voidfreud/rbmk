import { describe, expect, test } from "bun:test";
import { Reactor } from "../src/reactor";

describe("rodWorthBeta", () => {
  test("restores insertion and is pure under repeated calls", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    const rr = r.state.rods.find((rod) => rod.group === "RR")!;
    const az = r.state.rods.find((rod) => rod.group === "AZ")!;
    const usp = r.state.rods.find((rod) => rod.group === "USP")!;
    const samples = [
      { rod: rr, insertions: [0, 0.2, 0.5, 1] as const },
      { rod: az, insertions: [0, 0.2, 0.5, 1] as const },
      { rod: usp, insertions: [0, 0.2, 0.5, 1] as const },
    ];

    for (const { rod, insertions } of samples) {
      for (const ins of insertions) {
        rod.insertion = ins;
        rod.target = ins;
        const saved = rod.insertion;
        const w1 = r.rodWorthBeta(rod.id)!;
        const w2 = r.rodWorthBeta(rod.id)!;
        // Bit-exact restore after probe.
        expect(rod.insertion).toBe(saved);
        // Deterministic double-call.
        expect(w1.toOut).toBe(w2.toOut);
        expect(w1.toIn).toBe(w2.toIn);
        // At fully out, toOut is zero; at fully in, toIn is zero.
        if (ins === 0) expect(Math.abs(w1.toOut)).toBeLessThan(1e-12);
        if (ins === 1) expect(Math.abs(w1.toIn)).toBeLessThan(1e-12);
        // Further in always adds absorber (toIn <= 0) for RR/USP/AZ.
        // toOut can dip negative mid-stroke via the graphite tip effect.
        if (rod.group !== "USP" || ins > 0) {
          expect(w1.toIn).toBeLessThanOrEqual(1e-9);
        }
      }
    }

    // Operating-shape sign pin (audit #49 measured RR@0.45, USP@0.2).
    rr.insertion = 0.45;
    rr.target = 0.45;
    const rrW = r.rodWorthBeta(rr.id)!;
    expect(rrW.toOut).toBeGreaterThan(0);
    expect(rrW.toIn).toBeLessThan(0);

    usp.insertion = 0.2;
    usp.target = 0.2;
    const uspW = r.rodWorthBeta(usp.id)!;
    expect(uspW.toOut).toBeGreaterThan(0);
    expect(uspW.toIn).toBeLessThan(0);

    az.insertion = 0;
    az.target = 0;
    const azW = r.rodWorthBeta(az.id)!;
    expect(Math.abs(azW.toOut)).toBeLessThan(1e-12);
    expect(azW.toIn).toBeLessThan(0);

    expect(r.rodWorthBeta(-1)).toBeNull();
    expect(r.rodWorthBeta(9999)).toBeNull();
  });

  test("does not perturb subsequent tick trajectory", () => {
    const a = new Reactor();
    const b = new Reactor();
    a.initAtPower(1.0);
    b.initAtPower(1.0);
    a.arEnabled = false;
    b.arEnabled = false;

    // Probe many rods on A only; B is the control.
    for (let i = 0; i < 30; i++) {
      const id = i % a.state.rods.length;
      a.rodWorthBeta(id);
    }

    a.tick(1);
    b.tick(1);

    expect(a.powerFraction()).toBeCloseTo(b.powerFraction(), 12);
    for (let k = 0; k < a.state.nodes.length; k++) {
      expect(a.state.nodes[k]!.flux).toBeCloseTo(b.state.nodes[k]!.flux, 10);
    }
    for (let i = 0; i < a.state.rods.length; i++) {
      expect(a.state.rods[i]!.insertion).toBe(b.state.rods[i]!.insertion);
    }
  });
});
