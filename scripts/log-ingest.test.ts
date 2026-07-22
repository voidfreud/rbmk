import { describe, expect, test } from "bun:test";
import {
  MAX_LOG_BODY_BYTES,
  MAX_LOG_EVENTS,
  readBoundedBody,
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
