import { describe, expect, test } from "bun:test";
import {
  equilibriumIodineXenon,
  stepIodineXenon,
  xenonReactivity,
} from "../src/isotopes";

describe("iodine-xenon chain", () => {
  test("equilibrium xenon reactivity at full flux is in the textbook range", () => {
    const { xenon } = equilibriumIodineXenon(1.0);
    const rho = xenonReactivity(xenon);
    // Large thermal reactors: roughly -1500 to -3500 pcm equilibrium poisoning.
    expect(rho).toBeLessThan(-0.010);
    expect(rho).toBeGreaterThan(-0.040);
  });

  test("integration converges to the analytic equilibrium", () => {
    let iodine = 0;
    let xenon = 0;
    const dt = 60;
    // 200 hours at constant full flux.
    for (let t = 0; t < (200 * 3600) / dt; t++) {
      ({ iodine, xenon } = stepIodineXenon(iodine, xenon, 1.0, dt));
    }
    const eq = equilibriumIodineXenon(1.0);
    expect(iodine / eq.iodine).toBeCloseTo(1, 2);
    expect(xenon / eq.xenon).toBeCloseTo(1, 2);
  });

  test("post-shutdown xenon peaks hours later and above equilibrium", () => {
    const eq = equilibriumIodineXenon(1.0);
    let { iodine, xenon } = eq;
    const dt = 30;
    let peak = xenon;
    let peakTime = 0;
    for (let t = 0; t < (30 * 3600) / dt; t++) {
      ({ iodine, xenon } = stepIodineXenon(iodine, xenon, 0, dt));
      if (xenon > peak) {
        peak = xenon;
        peakTime = (t + 1) * dt;
      }
    }
    // Textbook: peak ~10-11 h after shutdown for phi ~ 5e13.
    expect(peakTime / 3600).toBeGreaterThan(6);
    expect(peakTime / 3600).toBeLessThan(14);
    expect(peak).toBeGreaterThan(eq.xenon * 1.2);
    // And it decays away eventually.
    expect(xenon).toBeLessThan(peak * 0.5);
  });
});
