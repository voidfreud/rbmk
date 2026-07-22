import { describe, expect, test } from "bun:test";
import { Reactor } from "../src/reactor";


describe("issue regressions", () => {
  test("ROD_CMD reports the mean insertion delta", () => {
    const reactor = new Reactor();
    reactor.initAtPower(1);
    const rods = reactor.state.rods.filter((rod) => rod.group === "RR");
    rods[0]!.insertion = 0.2;
    rods[1]!.insertion = 0.7;
    for (const rod of rods) rod.target = rod.insertion;

    reactor.setRodTarget("RR", 0.1);
    const event = reactor.log.all().findLast((entry) => entry.code === "ROD_CMD");

    const meanDelta = rods.reduce((sum, rod) => sum + (0.1 - rod.insertion), 0) / rods.length;
    expect(event?.data?.meanDelta).toBeCloseTo(meanDelta, 12);
    expect(event?.msg).toContain("mean delta");
  });

  test("mixed AR/LAR overrides identify both regulator groups", () => {
    const reactor = new Reactor();
    reactor.initAtPower(1);
    const ar = reactor.state.rods.find((rod) => rod.group === "AR")!;
    const lar = reactor.state.rods.find((rod) => rod.group === "LAR")!;

    reactor.setAutoControl([ar.id, lar.id], false);
    const event = reactor.log.all().findLast((entry) => entry.code === "AR_OVERRIDE");
    expect(event?.msg).toContain("AR/LAR");
    expect(event?.data?.groups).toEqual(["AR", "LAR"]);
  });

  test("tick rejects invalid timing arguments", () => {
    const reactor = new Reactor();
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => reactor.tick(dt)).toThrow(RangeError);
    }
    for (const maxStep of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => reactor.tick(1, maxStep)).toThrow(RangeError);
    }
  });

  test("critical calibration normalizes photoneutron trial state", () => {
    const base = new Reactor();
    const scaled = new Reactor();
    base.initAtPower(1);
    scaled.initAtPower(1);

    for (let k = 0; k < base.state.nodes.length; k++) {
      const baseNode = base.state.nodes[k]!;
      const scaledNode = scaled.state.nodes[k]!;
      baseNode.photoneutrons[0] = baseNode.photoneutrons[0]! * 10;
      baseNode.photoneutrons[1] = baseNode.photoneutrons[1]! * 10;
      scaledNode.flux = baseNode.flux * 2;
      scaledNode.precursors = baseNode.precursors.map((value) => value * 2);
      scaledNode.photoneutrons = baseNode.photoneutrons.map((value) => value * 2);
    }

    base.calibrateCritical();
    scaled.calibrateCritical();

    expect(scaled.state.rhoBase).toBeCloseTo(base.state.rhoBase, 8);
    for (const node of scaled.state.nodes) {
      expect(node.photoneutrons.every(Number.isFinite)).toBe(true);
    }
  });
});
