import { describe, expect, test } from "bun:test";
import {
  MAX_LOG_BODY_BYTES,
  MAX_LOG_EVENTS,
  MAX_LOG_SESSIONS,
  parseSessionId,
  readBoundedBody,
  SessionSeqTracker,
  validateLogBatch,
} from "./log-ingest";

const event = { t: 1, level: "info", code: "TEST", msg: "ok" } as const;

describe("log ingestion validation", () => {
  test("accepts a bounded SimEvent batch", () => {
    const result = validateLogBatch([event], JSON.stringify([event]).length);
    expect(result).toEqual({ events: [event] });
  });

  test("rejects malformed events before persistence", () => {
    const result = validateLogBatch(
      [{ ...event, level: "debug" }, { ...event, msg: 42 }],
      100,
    );
    expect(result).toEqual({ status: 400, message: "invalid event" });
  });
  test("rejects non-finite nested structured values", () => {
    for (const field of ["data", "before", "after"]) {
      const payload = JSON.parse(
        `[{"t":1,"level":"info","code":"TEST","msg":"bad","${field}":{"value":1e400}}]`,
      );
      expect(validateLogBatch(payload, 100)).toEqual({
        status: 400,
        message: "invalid event",
      });
    }
  });

  test("rejects oversized batches", () => {
    const result = validateLogBatch(
      new Array(MAX_LOG_EVENTS + 1).fill(event),
      100,
    );
    expect(result).toEqual({ status: 400, message: "too many events" });
  });

  test("rejects oversized request bodies", () => {
    const result = validateLogBatch([event], MAX_LOG_BODY_BYTES + 1);
    expect(result).toEqual({ status: 413, message: "payload too large" });
  });

  test("bounds streamed request bodies before buffering", async () => {
    const request = new Request("http://localhost/api/log/events", {
      method: "POST",
      body: "x".repeat(MAX_LOG_BODY_BYTES + 1),
    });
    const result = await readBoundedBody(request);
    expect(result).toEqual({ status: 413, message: "payload too large" });
  });
});

describe("session seq dedupe", () => {
  const ev = (seq: number) => ({ ...event, seq });

  test("drops a retried batch at or below the high-water mark", () => {
    const tracker = new SessionSeqTracker();
    const batch = [ev(1), ev(2), ev(3)];
    expect(tracker.filterNew("a", batch)).toEqual(batch);
    expect(tracker.filterNew("a", batch)).toEqual([]);
  });

  test("keeps only the unseen tail of an overlapping batch", () => {
    const tracker = new SessionSeqTracker();
    tracker.filterNew("a", [ev(1), ev(2)]);
    expect(tracker.filterNew("a", [ev(2), ev(3), ev(4)])).toEqual([
      ev(3),
      ev(4),
    ]);
  });

  test("tracks sessions independently", () => {
    const tracker = new SessionSeqTracker();
    tracker.filterNew("a", [ev(5)]);
    expect(tracker.filterNew("b", [ev(1)])).toEqual([ev(1)]);
  });

  test("keeps seq-less events and passes everything without a session", () => {
    const tracker = new SessionSeqTracker();
    tracker.filterNew("a", [ev(1)]);
    expect(tracker.filterNew("a", [event])).toEqual([event]);
    expect(tracker.filterNew(null, [ev(1)])).toEqual([ev(1)]);
  });

  test("evicts the oldest session past the capacity bound", () => {
    const tracker = new SessionSeqTracker();
    for (let i = 0; i <= MAX_LOG_SESSIONS; i++) {
      tracker.filterNew(`s${i}`, [ev(1)]);
    }
    // s0 was evicted, so its seq 1 is accepted again; s1 is still tracked.
    expect(tracker.filterNew("s1", [ev(1)])).toEqual([]);
    expect(tracker.filterNew("s0", [ev(1)])).toEqual([ev(1)]);
  });
});

describe("parseSessionId", () => {
  test("reads the s query parameter", () => {
    expect(parseSessionId("http://x/api/log/events?s=abc123")).toBe("abc123");
  });

  test("rejects missing or oversized ids", () => {
    expect(parseSessionId("http://x/api/log/events")).toBeNull();
    expect(parseSessionId(`http://x/?s=${"y".repeat(65)}`)).toBeNull();
  });
});
