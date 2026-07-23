import type { SimEvent } from "./types";

type EventMeta = Partial<
  Pick<SimEvent, "actor" | "cause" | "where" | "before" | "after">
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCause(
  msg: string,
  data?: Record<string, unknown>,
  cause?: string,
): string | undefined {
  if (cause) return cause;
  if (isRecord(data)) {
    const reason = data.reason;
    if (typeof reason === "string") return reason;
    const reasonDetail = data.reasonDetail;
    if (typeof reasonDetail === "string") return reasonDetail;
    const trigger = data.trigger;
    if (typeof trigger === "string") return trigger;
    if (typeof data.cause === "string") return data.cause;
  }
  const split = msg.indexOf("—");
  if (split >= 0) {
    const suffix = msg.slice(split + 1).trim();
    if (suffix.length > 0) return suffix;
  }
  const maybeDash = msg.indexOf(" - ");
  if (maybeDash >= 0) {
    const suffix = msg.slice(maybeDash + 3).trim();
    if (suffix.length > 0) return suffix;
  }
  return undefined;
}

function inferActor(code: string): string {
  // Operator actions: explicit console/setter commands.
  if (
    code === "ROD_CMD" ||
    code === "ROD_AUTO" ||
    code === "SCRAM_HOLD" ||
    code === "PERIOD_BLOCK" ||
    code === "AZ_COCK" ||
    code === "AR_ENABLED" ||
    code === "AR_SETPOINT" ||
    code === "AR_GRADIENT" ||
    code === "AR_MODE" ||
    code === "AR_OVERRIDE" ||
    code === "PROTECTION" ||
    code === "AZ5_RESET" ||
    code === "FLOW" ||
    code === "RHO_EXTRA" ||
    code === "SPEED" ||
    code === "SELECT" ||
    code === "ROD_STOP" ||
    code === "AZ5_COVER" ||
    code.startsWith("SEL_")
  ) {
    return "operator";
  }
  // Protection trips (automatic, not operator-triggered).
  if (code === "AZ1" || code === "AZ5") {
    return "protection logic";
  }
  // Safety interlocks and warnings.
  if (code === "SIL_BLOK" || code === "RPS_BLOCKED" || code === "PERIOD") {
    return "safety interlock";
  }
  // Automatic regulator: control actions and advisories emitted by the
  // regulation loop, not from an operator command.
  if (
    code.startsWith("AR_") ||
    code.startsWith("LAR_")
  ) {
    return "AR controller";
  }
  if (code === "STATE" || code === "POWER" || code === "PRIZMA") {
    return "instrumentation";
  }
  if (code === "INIT") {
    return "plant startup";
  }
  return "reactor core";
}

function inferWhere(code: string): string {
  if (
    code === "ROD_AUTO" ||
    code === "SCRAM_HOLD" ||
    code === "PERIOD_BLOCK" ||
    code === "AZ_COCK" ||
    code === "ROD_CMD" ||
    code === "SELECT" ||
    code === "ROD_STOP" ||
    code.startsWith("SEL_")
  ) {
    return "rod controls";
  }
  if (code === "AZ1" || code === "AZ5" || code === "AZ5_COVER") {
    return "protection panel";
  }
  if (
    code.startsWith("AR_") ||
    code.startsWith("LAR_")
  ) {
    return "AR/regulation";
  }
  if (code === "PROTECTION" || code === "RPS_BLOCKED" || code === "PERIOD") {
    return "protection panel";
  }
  if (code === "FLOW") {
    return "coolant loop";
  }
  if (code === "RHO_EXTRA" || code === "SPEED") {
    return "operator console";
  }
  if (code === "STATE" || code === "POWER" || code === "PRIZMA") {
    return "control instruments";
  }
  if (code === "INIT") {
    return "initialization";
  }
  return "simulation kernel";
}

function enrichMeta(
  code: string,
  msg: string,
  data: Record<string, unknown> | undefined,
  userMeta?: EventMeta,
): EventMeta {
  return {
    actor: userMeta?.actor ?? inferActor(code),
    where: userMeta?.where ?? inferWhere(code),
    cause:
      parseCause(msg, data, userMeta?.cause) ??
      (isRecord(userMeta) ? (userMeta.cause as string | undefined) : undefined),
    before: userMeta?.before,
    after: userMeta?.after,
  };
}

export type EventSink = (event: SimEvent) => void;

/**
 * Format sim-time seconds as HH:MM:SS (shared by UI strip-chart axes).
 * Pure; no Date.now().
 */
export function hms(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Structured event log. Keeps an in-memory ring and forwards every event to
 * optional sinks (a JSONL file writer, a UI console, ...).
 */
export class EventLog {
  private readonly events: SimEvent[];
  private readonly sinks: EventSink[] = [];
  private readonly capacity: number;
  private head = 0;
  private count = 0;
  private nextSeq = 0;

  constructor(capacity = 10000) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("EventLog capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.events = new Array<SimEvent>(capacity);
  }

  addSink(sink: EventSink): void {
    this.sinks.push(sink);
  }

  emit(event: SimEvent): void {
    if (event.seq == null || event.seq <= this.nextSeq) {
      event.seq = ++this.nextSeq;
    } else {
      this.nextSeq = event.seq;
    }
    const index = (this.head + this.count) % this.capacity;
    this.events[index] = event;
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
    for (const sink of this.sinks) sink(event);
  }

  info(
    t: number,
    code: string,
    msg: string,
    data?: Record<string, unknown>,
    meta?: EventMeta,
  ): void {
    const enriched = enrichMeta(code, msg, data, meta);
    this.emit({ t, level: "info", code, msg, data, ...enriched });
  }

  warn(
    t: number,
    code: string,
    msg: string,
    data?: Record<string, unknown>,
    meta?: EventMeta,
  ): void {
    const enriched = enrichMeta(code, msg, data, meta);
    this.emit({ t, level: "warn", code, msg, data, ...enriched });
  }

  alarm(
    t: number,
    code: string,
    msg: string,
    data?: Record<string, unknown>,
    meta?: EventMeta,
  ): void {
    const enriched = enrichMeta(code, msg, data, meta);
    this.emit({ t, level: "alarm", code, msg, data, ...enriched });
  }

  all(): readonly SimEvent[] {
    const events = new Array<SimEvent>(this.count);
    for (let i = 0; i < this.count; i++) {
      events[i] = this.events[(this.head + i) % this.capacity]!;
    }
    return events;
  }
}
