import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import type { SimEvent } from "../packages/sim-core/src/types";
import index from "../packages/ui/index.html";

const LOG_PATH = "data/log.jsonl";

// Ensure the data directory exists at startup.
const logDir = LOG_PATH.substring(0, LOG_PATH.lastIndexOf("/"));
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

/** Append a single JSONL line — restart-safe, unambiguous append via node:fs. */
function appendLogLine(line: string): void {
  appendFileSync(LOG_PATH, line, "utf-8");
}

const server = Bun.serve({
  port: 3141,
  routes: {
    "/": index,
    "/api/log/events": {
      POST: async (req) => {
        const events: SimEvent[] = await req.json();
        if (!Array.isArray(events) || events.length === 0) {
          return new Response("invalid payload", { status: 400 });
        }
        const lines = events
          .map((e) => JSON.stringify(e))
          .join("\n") + "\n";
        appendLogLine(lines);
        return new Response("ok");
      },
      OPTIONS: () => new Response(null, { status: 204 }),
    },
    "/api/log/download": {
      GET: () => {
        const f = Bun.file(LOG_PATH);
        return f.size > 0
          ? new Response(f, {
              headers: {
                "Content-Type": "application/x-jsonlines",
                "Content-Disposition": 'attachment; filename="rbmk-log.jsonl"',
              },
            })
          : new Response("no log data yet", { status: 404 });
      },
    },
  },
  development: true,
});

console.log(`RBMK control room: ${server.url}`);
console.log(`Log endpoint: POST /api/log/events — appends JSONL to ${LOG_PATH}`);
console.log(`Log download: GET  /api/log/download`);
