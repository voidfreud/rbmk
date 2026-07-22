import { describe, expect, test } from "bun:test";
import {
  BETA_EFF,
  DELAYED_BETA,
  DELAYED_LAMBDA,
  GEN_TIME,
  N_AXIAL,
} from "../src/constants";
import {
  createKineticsWorkspace,
  equilibriumPrecursors,
  powerFraction,
  stepKinetics,
} from "../src/kinetics";
import { Reactor } from "../src/reactor";
import { zeroNode } from "../src/types";

/**
 * Solve the 6-group inhour equation for asymptotic period T given
 * reactivity rho (absolute Δk/k):
 *   rho = L/T + sum_i beta_i / (1 + lambda_i T)
 * Returns the positive e-folding period [s], or Infinity if rho <= 0.
 */
function inhourPeriod(rho: number): number {
  if (rho <= 0) return Infinity;
  // Period is positive and finite for 0 < rho < beta_eff (delayed critical).
  // Bracket: T from ~0.01 s (prompt-ish) to large.
  let lo = 1e-3;
  let hi = 1e6;
  const f = (T: number) => {
    let s = GEN_TIME / T;
    for (let i = 0; i < DELAYED_BETA.length; i++) {
      s += DELAYED_BETA[i]! / (1 + DELAYED_LAMBDA[i]! * T);
    }
    return s - rho;
  };
  // f(T) decreases with T; f(lo) should be > 0 for delayed-supercritical.
  for (let i = 0; i < 80; i++) {
    const mid = Math.sqrt(lo * hi); // log-space mid for wide range
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

describe("kinetics / inhour", () => {
  test("reused solver workspace is numerically identical to allocating mode", () => {
    const makeNodes = () =>
      Array.from({ length: N_AXIAL }, (_, k) => {
        const node = zeroNode();
        node.flux = 0.4 + k / N_AXIAL;
        return node;
      });
    const allocating = makeNodes();
    const reused = makeNodes();
    equilibriumPrecursors(allocating);
    equilibriumPrecursors(reused);
    const rho = Array.from(
      { length: N_AXIAL },
      (_, k) => -0.002 + (0.004 * k) / (N_AXIAL - 1),
    );
    const workspace = createKineticsWorkspace();
    for (let i = 0; i < 100; i++) {
      stepKinetics(allocating, rho, 0.01);
      stepKinetics(reused, rho, 0.01, workspace);
    }
    for (let k = 0; k < N_AXIAL; k++) {
      expect(reused[k]!.flux).toBe(allocating[k]!.flux);
      expect(reused[k]!.precursors).toEqual(allocating[k]!.precursors);
    }
  });

  test("small +rho step period roughly matches inhour", () => {
    // Isolated nodal kinetics (no thermal feedback). Absorbing axial
    // boundaries make rho=0 subcritical, so first bisect critical rho,
    // then step +0.1 beta and compare the asymptotic period to inhour.
    const makeNodes = () =>
      Array.from({ length: N_AXIAL }, () => {
        const n = zeroNode();
        n.flux = 1;
        return n;
      });

    const growthFor = (rho0: number): number => {
      const nodes = makeNodes();
      equilibriumPrecursors(nodes);
      const rho = new Array(N_AXIAL).fill(rho0);
      // Renormalize each step; accumulate log growth in the second half.
      let logG = 0;
      const steps = 400;
      const dt = 0.005;
      for (let i = 0; i < steps; i++) {
        stepKinetics(nodes, rho, dt);
        const p = powerFraction(nodes);
        if (!(p > 0) || !Number.isFinite(p)) return 1e3;
        if (i >= steps / 2) logG += Math.log(p);
        const inv = 1 / p;
        for (const node of nodes) {
          node.flux *= inv;
          for (let g = 0; g < node.precursors.length; g++)
            node.precursors[g]! *= inv;
        }
      }
      return logG / ((steps / 2) * dt);
    };

    let lo = -0.05;
    let hi = 0.05;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (growthFor(mid) > 0) hi = mid;
      else lo = mid;
    }
    const rhoCrit = (lo + hi) / 2;

    const rhoStep = 0.1 * BETA_EFF; // +0.1 $
    const expectedT = inhourPeriod(rhoStep);
    expect(expectedT).toBeGreaterThan(10);
    expect(expectedT).toBeLessThan(200);

    const nodes = makeNodes();
    equilibriumPrecursors(nodes);
    const rho = new Array(N_AXIAL).fill(rhoCrit + rhoStep);
    // Settle into the asymptotic mode (renormalize so precursors catch up).
    for (let i = 0; i < 3000; i++) {
      stepKinetics(nodes, rho, 0.01);
      const p = powerFraction(nodes);
      if (p > 0) {
        const inv = 1 / p;
        for (const node of nodes) {
          node.flux *= inv;
          for (let g = 0; g < node.precursors.length; g++)
            node.precursors[g]! *= inv;
        }
      }
    }
    // Free-run without renorm to measure period.
    for (let i = 0; i < 200; i++) stepKinetics(nodes, rho, 0.01);
    const p0 = powerFraction(nodes);
    const measureDt = 5.0;
    for (let i = 0; i < measureDt / 0.01; i++) stepKinetics(nodes, rho, 0.01);
    const p1 = powerFraction(nodes);
    expect(p1).toBeGreaterThan(p0);
    const measuredT = measureDt / Math.log(p1 / p0);

    // Loose tolerance: nodal leakage + finite settle; within ~30%.
    expect(measuredT).toBeGreaterThan(expectedT * 0.7);
    expect(measuredT).toBeLessThan(expectedT * 1.3);
  });

  test("reactimeter tracks a small rhoExtra step after AR is disabled", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    r.arEnabled = false;
    r.protection.overpower = false;
    r.protection.period = false;
    // Steady critical: reactimeter near zero.
    expect(Math.abs(r.reactivityBeta())).toBeLessThan(0.05);

    const stepBeta = 0.05; // +0.05 $
    r.setRhoExtra(stepBeta * BETA_EFF);
    r.tick(0.5, 0.01);
    // Meter should see most of the step within ~10-30% after 0.5 s
    // (thermal feedback has not fully responded yet).
    const reading = r.reactivityBeta();
    expect(reading).toBeGreaterThan(stepBeta * 0.6);
    expect(reading).toBeLessThan(stepBeta * 1.5);
  });
  test("net reactivity exposes unsmoothed current core reactivity", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    const before = r.netReactivityBeta();
    r.setRhoExtra(0.05 * BETA_EFF);
    expect(r.netReactivityBeta() - before).toBeCloseTo(0.05, 6);
  });
});
