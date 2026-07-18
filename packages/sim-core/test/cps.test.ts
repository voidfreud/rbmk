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

  test("silovaya blokirovka: 8+ rods withdrawing are halted", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    const rr = r.state.rods.filter((rod) => rod.group === "RR").slice(0, 10);
    for (const rod of rr) r.setRodTarget(rod.id, 0);
    r.tick(2);
    // The interlock reset their targets to their positions: nobody at 0.
    for (const rod of rr) expect(rod.target).toBeGreaterThan(0.1);
    expect(r.log.all().some((e) => e.code === "SIL_BLOK")).toBe(true);
  });

  test("ORM arrives only as periodic PRIZMA printouts", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    const t0 = r.prizma().t;
    r.tick(301, 0.1);
    const p = r.prizma();
    expect(p.t).toBeGreaterThan(t0);
    expect(p.orm).toBeGreaterThan(0);
    expect(r.log.all().some((e) => e.code === "PRIZMA")).toBe(true);
  });

  test("LAR drops out below its band and changes over to AR automatically", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    r.arMode = "LAR";
    r.arGradient = 0.01;
    r.arSetpoint = 0.05;
    r.tick(220, 0.1);
    expect(r.log.all().some((e) => e.code === "LAR_DROPOUT")).toBe(true);
    // Standby regulator on side chambers picked up regulation.
    expect(r.arMode as string).toBe("AR");
    expect(r.arEnabled).toBe(true);
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

  test("initAtPower after initShutdown leaves arEnabled true", () => {
    const r = new Reactor();
    r.initShutdown();
    expect(r.arEnabled).toBe(false);
    r.initAtPower(0.5);
    expect(r.arEnabled).toBe(true);
  });

  test("resetScram does not withdraw all AR rods", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    r.scram("test");
    r.tick(30);
    const arAfterScram = r.state.rods
      .filter((rod) => rod.group === "AR")
      .map((rod) => rod.insertion);
    for (const ins of arAfterScram) expect(ins).toBeCloseTo(1, 2);

    r.resetScram();
    const tReset = r.state.time;
    r.tick(120, 0.1);

    const arAfter = r.state.rods.filter((rod) => rod.group === "AR");
    // Bank must stay near post-scram (fully in), not walk out to 0.
    for (const rod of arAfter) expect(rod.insertion).toBeGreaterThan(0.7);
    // No changeover storm after the latch is cleared (init settle may have
    // logged earlier AR_CHANGEOVERs; ignore those).
    const changeovers = r.log
      .all()
      .filter((e) => e.code === "AR_CHANGEOVER" && e.t >= tReset);
    expect(changeovers.length).toBe(0);
  });

  test("setRodTarget withdrawal refused while scrammed", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    r.scram("test");
    // Full travel from ~0.45 takes ~10 s at 0.4 m/s over 7 m.
    r.tick(20);
    const rr = r.state.rods.find((rod) => rod.group === "RR")!;
    expect(rr.insertion).toBeGreaterThan(0.9);
    r.setRodTarget(rr.id, 0);
    expect(rr.target).toBeCloseTo(1, 5);
    expect(r.log.all().some((e) => e.code === "SCRAM_HOLD")).toBe(true);
    // Latch still holds drives in over subsequent ticks.
    r.tick(10);
    expect(rr.insertion).toBeCloseTo(1, 5);
  });

  test("LAR mode can withdraw without permanent SIL_BLOK freeze", () => {
    const r = new Reactor();
    r.initAtPower(1.0);
    r.setArMode("LAR");
    // Lower setpoint so LAR wants to withdraw (power above setpoint).
    r.arGradient = 0.01;
    r.arSetpoint = 0.7;
    const larBefore = r.state.rods
      .filter((rod) => rod.group === "LAR")
      .map((rod) => rod.insertion);
    r.tick(30, 0.1);
    const larAfter = r.state.rods.filter((rod) => rod.group === "LAR");
    // Some LAR motion is allowed (regulator-owned rods are not silovaya-frozen).
    const moved = larAfter.some(
      (rod, i) => Math.abs(rod.insertion - larBefore[i]!) > 0.01,
    );
    expect(moved).toBe(true);
    // Power should not collapse solely due to silovaya freezing LAR.
    expect(r.powerFraction()).toBeGreaterThan(0.4);
  });

  test("setArMode re-seeds arTarget from newly owned bank", () => {
    const r = new Reactor();
    r.initAtPower(1.0, { autoInsertion: 0.5 });
    // Park LAR bank at a different insertion so a naive mode switch would jump.
    for (const rod of r.state.rods) {
      if (rod.group === "LAR") {
        rod.insertion = 0.8;
        rod.target = 0.8;
      }
    }
    r.setArMode("LAR");
    expect(r.arMode).toBe("LAR");
    // Mean LAR insertion is 0.8; re-seed should land near that, not AR's 0.5.
    expect(r.arInsertion()).toBeCloseTo(0.8, 5);
    // Immediately after setArMode, the owned bank target matches insertion
    // (no huge PI step from a stale arTarget).
    const owned = r.state.rods.filter((rod) => rod.group === "LAR");
    for (const rod of owned) expect(rod.target).toBeCloseTo(0.8, 5);
  });
});
