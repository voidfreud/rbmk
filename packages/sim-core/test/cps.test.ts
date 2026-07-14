import { describe, expect, test } from "bun:test";
import { N_AXIAL } from "../src/constants";
import { Reactor } from "../src/reactor";
import { absorberInterval, buildRods, rodReactivityByNode } from "../src/rods";

describe("control and protection system", () => {
  test("rod complement matches the 2nd-generation breakdown (211 total)", () => {
    const rods = buildRods(211);
    const count = (g: string) => rods.filter((r) => r.group === g).length;
    expect(rods.length).toBe(211);
    expect(count("AR")).toBe(12);
    expect(count("LAR")).toBe(12);
    expect(count("AZ")).toBe(24);
    expect(count("USP")).toBe(32);
    expect(count("RR")).toBe(131);
    // Three AR subgroups of four.
    for (const sub of [1, 2, 3]) {
      expect(
        rods.filter((r) => r.group === "AR" && r.arSubgroup === sub).length,
      ).toBe(4);
    }
  });

  test("USP absorbers enter from the bottom", () => {
    const iv = absorberInterval({ group: "USP", insertion: 0.5 });
    expect(iv).not.toBeNull();
    // Bottom edge at the core bottom (7 m), extending upward.
    expect(iv![1]).toBeCloseTo(7, 5);
    expect(iv![0]).toBeCloseTo(7 - 0.5 * 3.05, 5);
    // And they poison the BOTTOM nodes.
    const rods = buildRods(211);
    for (const rod of rods) rod.insertion = 0;
    const before = rodReactivityByNode(rods);
    for (const rod of rods) if (rod.group === "USP") rod.insertion = 0.5;
    const after = rodReactivityByNode(rods);
    expect(after[N_AXIAL - 1]!).toBeLessThan(before[N_AXIAL - 1]!);
    expect(after[0]!).toBeCloseTo(before[0]!, 10);
  });

  test("AZ-5 does not drive USP rods (pre-1986 behavior)", () => {
    const r = new Reactor();
    r.initAtPower(1.0, { uspInsertion: 0.2 });
    r.scram("test");
    r.tick(40);
    for (const rod of r.state.rods) {
      if (rod.group === "USP") {
        expect(rod.insertion).toBeCloseTo(0.2, 5);
      } else {
        expect(rod.insertion).toBeCloseTo(1, 5);
      }
    }
  });

  test("manual command to a regulator-owned rod is refused", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    const owned = r.state.rods.find(
      (rod) => rod.group === "AR" && rod.arSubgroup === r.arActiveGroup,
    )!;
    const before = owned.target;
    r.setRodTarget(owned.id, 0);
    expect(owned.target).toBeCloseTo(before, 5);
    const warns = r.log.all().filter((e) => e.code === "ROD_AUTO");
    expect(warns.length).toBe(1);
  });

  test("blocked protections warn instead of scramming", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    r.arEnabled = false;
    r.protection.overpower = false;
    r.protection.period = false;
    r.setFlowFraction(0.75); // drives a power excursion past 110%
    let maxPower = 0;
    for (let i = 0; i < 40; i++) {
      r.tick(0.5);
      maxPower = Math.max(maxPower, r.powerFraction());
    }
    expect(maxPower).toBeGreaterThan(1.1);
    expect(r.state.scrammed).toBe(false);
    const blocked = r.log.all().filter((e) => e.code === "RPS_BLOCKED");
    expect(blocked.length).toBeGreaterThan(0);
  });
});
