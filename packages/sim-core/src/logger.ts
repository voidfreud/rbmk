import type { SimEvent } from "./types";

export type EventSink = (event: SimEvent) => void;

/**
 * Structured event log. Keeps an in-memory ring and forwards every event to
 * optional sinks (a JSONL file writer, a UI console, ...).
 */
export class EventLog {
  private readonly events: SimEvent[] = [];
  private readonly sinks: EventSink[] = [];
  private readonly capacity: number;

  constructor(capacity = 10000) {
    this.capacity = capacity;
  }

  addSink(sink: EventSink): void {
    this.sinks.push(sink);
  }

  emit(event: SimEvent): void {
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.shift();
    for (const sink of this.sinks) sink(event);
  }

  info(t: number, code: string, msg: string, data?: Record<string, unknown>) {
    this.emit({ t, level: "info", code, msg, data });
  }

  warn(t: number, code: string, msg: string, data?: Record<string, unknown>) {
    this.emit({ t, level: "warn", code, msg, data });
  }

  alarm(t: number, code: string, msg: string, data?: Record<string, unknown>) {
    this.emit({ t, level: "alarm", code, msg, data });
  }

  all(): readonly SimEvent[] {
    return this.events;
  }
}
