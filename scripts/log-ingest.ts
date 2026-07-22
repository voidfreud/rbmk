import type { SimEvent } from "../packages/sim-core/src/types";

export const MAX_LOG_BODY_BYTES = 1 << 20;
export const MAX_LOG_EVENTS = 100;
const MAX_EVENT_CODE_LENGTH = 64;
const MAX_EVENT_MESSAGE_LENGTH = 2048;
const MAX_EVENT_CONTEXT_LENGTH = 128;
const MAX_EVENT_DATA_BYTES = 16 << 10;

const encoder = new TextEncoder();

type LogValidation =
  | { events: SimEvent[] }
  | { status: 400 | 413; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasBoundedString(
  value: unknown,
  maxLength: number,
  required = false,
): value is string {
  if (required && typeof value !== "string") return false;
  return value === undefined || (typeof value === "string" && value.length <= maxLength);
}

function hasBoundedRecord(value: unknown, maxBytes: number): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  try {
    const json = JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "number" && !Number.isFinite(nested)) {
        throw new TypeError("non-finite structured value");
      }
      return nested;
    });
    return json !== undefined && encoder.encode(json).byteLength <= maxBytes;
  } catch {
    return false;
  }
}

function isSimEvent(value: unknown): value is SimEvent {
  if (!isRecord(value)) return false;
  if (
    typeof value.t !== "number" ||
    !Number.isFinite(value.t) ||
    value.t < 0 ||
    (value.level !== "info" && value.level !== "warn" && value.level !== "alarm") ||
    !hasBoundedString(value.code, MAX_EVENT_CODE_LENGTH, true) ||
    !hasBoundedString(value.msg, MAX_EVENT_MESSAGE_LENGTH, true) ||
    !hasBoundedString(value.actor, MAX_EVENT_CONTEXT_LENGTH) ||
    !hasBoundedString(value.cause, MAX_EVENT_CONTEXT_LENGTH) ||
    !hasBoundedString(value.where, MAX_EVENT_CONTEXT_LENGTH) ||
    !hasBoundedRecord(value.data, MAX_EVENT_DATA_BYTES) ||
    !hasBoundedRecord(value.before, MAX_EVENT_DATA_BYTES) ||
    !hasBoundedRecord(value.after, MAX_EVENT_DATA_BYTES)
  ) {
    return false;
  }
  return (
    value.seq === undefined ||
    (typeof value.seq === "number" &&
      Number.isSafeInteger(value.seq) &&
      value.seq > 0)
  );
}

export function validateLogBatch(
  payload: unknown,
  bodyBytes: number,
): LogValidation {
  if (bodyBytes > MAX_LOG_BODY_BYTES) {
    return { status: 413, message: "payload too large" };
  }
  if (!Array.isArray(payload) || payload.length === 0) {
    return { status: 400, message: "invalid payload" };
  }
  if (payload.length > MAX_LOG_EVENTS) {
    return { status: 400, message: "too many events" };
  }
  if (!payload.every(isSimEvent)) {
    return { status: 400, message: "invalid event" };
  }
  return { events: payload };
}

export async function readBoundedBody(
  request: Request,
): Promise<{ body: Uint8Array } | { status: 413; message: string }> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_LOG_BODY_BYTES) {
    return { status: 413, message: "payload too large" };
  }

  if (!request.body) return { body: new Uint8Array() };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_LOG_BODY_BYTES) {
      await reader.cancel();
      return { status: 413, message: "payload too large" };
    }
    chunks.push(part.value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body };
}
