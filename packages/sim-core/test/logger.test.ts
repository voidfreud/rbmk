import { describe, expect, test } from "bun:test";
import { EventLog } from "../src/logger";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


describe("EventLog", () => {
  test("auto-assigns monotonic sequence numbers", () => {
    const log = new EventLog();
    log.info(0, "TEST", "first");
    log.info(1, "TEST", "second");
    log.warn(2, "TEST", "third");
    const events = log.all();
    expect(events.length).toBe(3);
    expect(events[0]!.seq).toBe(1);
    expect(events[1]!.seq).toBe(2);
    expect(events[2]!.seq).toBe(3);
  });

  test("respects externally supplied sequence numbers", () => {
    const log = new EventLog();
    log.emit({ t: 0, level: "info", code: "TEST", msg: "pre", seq: 42 });
    log.info(1, "TEST", "after");
    const events = log.all();
    expect(events.length).toBe(2);
    expect(events[0]!.seq).toBe(42);
    // nextSeq advanced past 42, so the next auto-assigned seq is 43
    expect(events[1]!.seq).toBe(43);
  });

  test("enforces monotonic seq: non-increasing supplied value is replaced", () => {
    const log = new EventLog();
    log.emit({ t: 0, level: "info", code: "TEST", msg: "one", seq: 100 });
    log.emit({ t: 1, level: "info", code: "TEST", msg: "two", seq: 5 });
    log.info(2, "TEST", "three");
    const events = log.all();
    expect(events[0]!.seq).toBe(100);
    // seq=5 is ≤ 100, so it gets the next auto-assigned seq instead
    expect(events[1]!.seq).toBe(101);
    expect(events[2]!.seq).toBe(102);
  });

  test("ring buffer evicts oldest events at capacity", () => {
    const log = new EventLog(3);
    log.info(0, "A", "a");
    log.info(1, "B", "b");
    log.info(2, "C", "c");
    log.info(3, "D", "d");
    const events = log.all();
    expect(events.length).toBe(3);
    expect(events[0]!.code).toBe("B");
    expect(events[1]!.code).toBe("C");
    expect(events[2]!.code).toBe("D");
  });

  test("info/warn/alarm set correct levels", () => {
    const log = new EventLog();
    log.info(0, "X", "info msg");
    log.warn(1, "X", "warn msg");
    log.alarm(2, "X", "alarm msg");
    const events = log.all();
    expect(events[0]!.level).toBe("info");
    expect(events[1]!.level).toBe("warn");
    expect(events[2]!.level).toBe("alarm");
  });

  test("metadata enrichment infers actor from event code", () => {
    const log = new EventLog();
    log.info(0, "ROD_CMD", "rod command issued");
    log.warn(1, "AR_CHANGEOVER", "changeover");
    log.alarm(2, "AZ5", "scram");
    const events = log.all();
    expect(events[0]!.actor).toBe("operator");
    expect(events[1]!.actor).toBe("AR controller");
    expect(events[2]!.actor).toBe("protection logic");
  });

  test("operator AR config events get actor 'operator'", () => {
    const log = new EventLog();
    log.info(0, "AR_ENABLED", "regulator engaged");
    log.info(1, "AR_SETPOINT", "setpoint changed");
    log.info(2, "PROTECTION", "protection armed");
    const events = log.all();
    expect(events[0]!.actor).toBe("operator");
    expect(events[1]!.actor).toBe("operator");
    expect(events[2]!.actor).toBe("operator");
  });

  test("safety interlocks get actor 'safety interlock'", () => {
    const log = new EventLog();
    log.alarm(0, "SIL_BLOK", "power interlock");
    log.warn(1, "RPS_BLOCKED", "trip blocked");
    log.alarm(2, "PERIOD", "short period");
    const events = log.all();
    expect(events[0]!.actor).toBe("safety interlock");
    expect(events[1]!.actor).toBe("safety interlock");
    expect(events[2]!.actor).toBe("safety interlock");
  });

  test("metadata enrichment infers where from event code", () => {
    const log = new EventLog();
    log.info(0, "FLOW", "flow changed");
    log.info(1, "STATE", "snapshot");
    const events = log.all();
    expect(events[0]!.where).toBe("coolant loop");
    expect(events[1]!.where).toBe("control instruments");
  });

  test("parseCause extracts cause from message dash separator", () => {
    const log = new EventLog();
    log.alarm(0, "AZ5", "SCRAM triggered by test — power 100.0%, period 20.0 s");
    const events = log.all();
    expect(events[0]!.cause).toBe("power 100.0%, period 20.0 s");
  });

  test("sinks receive every emitted event", () => {
    const log = new EventLog();
    const received: string[] = [];
    log.addSink((e) => received.push(e.code));
    log.info(0, "A", "a");
    log.warn(1, "B", "b");
    log.alarm(2, "C", "c");
    expect(received).toEqual(["A", "B", "C"]);
  });

  test("sink receives enriched metadata", () => {
    const log = new EventLog();
    let captured: unknown = null;
    log.addSink((e) => { captured = e; });
    log.info(0, "ROD_CMD", "rod command — withdraw 4 rods");
    expect(isRecord(captured)).toBe(true);
    if (isRecord(captured)) {
      expect(captured.actor).toBe("operator");
      expect(captured.cause).toBe("withdraw 4 rods");
      expect(typeof captured.seq).toBe("number");
    }
  });

  test("info/warn/alarm pass data payload through", () => {
    const log = new EventLog();
    log.info(0, "TEST", "msg", { power: 0.5, orm: 80 });
    const events = log.all();
    expect(events[0]!.data).toEqual({ power: 0.5, orm: 80 });
  });

  test("enrichMeta picks up user-supplied actor/cause/where", () => {
    const log = new EventLog();
    log.info(0, "GENERIC", "message", undefined, {
      actor: "custom-actor",
      cause: "custom-cause",
      where: "custom-where",
    });
    const events = log.all();
    expect(events[0]!.actor).toBe("custom-actor");
    expect(events[0]!.cause).toBe("custom-cause");
    expect(events[0]!.where).toBe("custom-where");
  });

  test("data.cause overrides message-dash parseCause", () => {
    const log = new EventLog();
    // data.cause takes precedence over message parsing
    log.alarm(0, "AZ5", "SCRAM — ignored dash cause", { cause: "explicit cause" });
    const events = log.all();
    expect(events[0]!.cause).toBe("explicit cause");
  });
});
