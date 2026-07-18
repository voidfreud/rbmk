import { describe, expect, test } from "bun:test";
import { CORE_RADIUS, RadialField, buildFuelChannels, rodAxialEffect } from "../src/field";
import { N_AXIAL, N_FUEL_CHANNELS } from "../src/constants";
import { zeroNode } from "../src/types";
import { Reactor } from "../src/reactor";
import { buildRods } from "../src/rods";

describe("radial field reconstruction", () => {
  test("buildFuelChannels returns 1661 channels inside CORE_RADIUS", () => {
    const ch = buildFuelChannels();
    expect(ch.length).toBe(N_FUEL_CHANNELS);
    expect(ch.length).toBe(1661);
    for (const c of ch) {
      expect(Math.hypot(c.x, c.y)).toBeLessThanOrEqual(CORE_RADIUS + 1e-9);
    }
  });

  test("buildRods id === index contract", () => {
    const rods = buildRods(211);
    expect(rods.every((r, i) => r.id === i)).toBe(true);
  });

  test("uniform rods yield mean rel ~1 and balanced quadrants", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    for (const rod of r.state.rods) {
      rod.insertion = 0.5;
      rod.target = 0.5;
    }
    const field = new RadialField(r.state.rods);
    field.update(r.state.nodes);

    let sum = 0;
    for (let i = 0; i < field.rel.length; i++) sum += field.rel[i]!;
    const mean = sum / field.rel.length;
    expect(mean).toBeCloseTo(1, 3);

    const quads = [0, 0, 0, 0];
    const qn = [0, 0, 0, 0];
    for (let i = 0; i < field.channels.length; i++) {
      const { x, y } = field.channels[i]!;
      const q = (x >= 0 ? 0 : 1) + (y >= 0 ? 0 : 2);
      quads[q]! += field.rel[i]!;
      qn[q]!++;
    }
    const means = quads.map((s, i) => s / Math.max(1, qn[i]!));
    const avg = means.reduce((a, b) => a + b, 0) / 4;
    for (const m of means) {
      expect(Math.abs(m - avg) / avg).toBeLessThan(0.05);
    }
  });

  test("inserting one quadrant depresses that quadrant", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    for (const rod of r.state.rods) {
      // Fully out except Q1 (x>0, y>0) which is fully inserted.
      if (rod.x > 0 && rod.y > 0) {
        rod.insertion = 1;
        rod.target = 1;
      } else {
        rod.insertion = 0;
        rod.target = 0;
      }
    }
    const field = new RadialField(r.state.rods);
    field.update(r.state.nodes);

    const quads = [0, 0, 0, 0];
    const qn = [0, 0, 0, 0];
    for (let i = 0; i < field.channels.length; i++) {
      const { x, y } = field.channels[i]!;
      // Q1 = x>0,y>0 → index 0 with the same packing as above
      const q = (x >= 0 ? 0 : 1) + (y >= 0 ? 0 : 2);
      quads[q]! += field.rel[i]!;
      qn[q]!++;
    }
    const means = quads.map((s, i) => s / Math.max(1, qn[i]!));
    // Q1 (x>=0,y>=0) is index 0
    expect(means[0]!).toBeLessThan(0.3);
    expect(means[0]!).toBeLessThan(Math.min(means[1]!, means[2]!, means[3]!));
  });

  test("zero-flux nodes: finite rel and geometric rodAxialEffect", () => {
    const rods = buildRods(211);
    for (const rod of rods) {
      rod.insertion = 0.5;
      rod.target = 0.5;
    }
    const nodes = Array.from({ length: N_AXIAL }, () => zeroNode());

    const field = new RadialField(rods);
    field.update(nodes);
    for (let i = 0; i < field.rel.length; i++) {
      expect(Number.isFinite(field.rel[i]!)).toBe(true);
    }

    const sample = rods.find((rod) => rod.group === "RR")!;
    const eff = rodAxialEffect(sample, nodes);
    expect(Number.isFinite(eff.abs)).toBe(true);
    expect(Number.isFinite(eff.disp)).toBe(true);
    expect(eff.abs).toBeGreaterThan(0);
  });
});
