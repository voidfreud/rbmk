import { appendFile, mkdir } from "node:fs/promises";
import type { SimEvent } from "../packages/sim-core/src/types";
import index from "../packages/ui/index.html";

const LOG_PATH = "data/log.jsonl";

// Ensure the data directory exists and start a fresh log for this run so
// `data/log.jsonl` only contains events from the current server session.
const logDir = LOG_PATH.substring(0, LOG_PATH.lastIndexOf("/"));
await mkdir(logDir, { recursive: true });
await Bun.write(LOG_PATH, "");

async function appendLogLine(line: string): Promise<void> {
  await appendFile(LOG_PATH, line, "utf-8");
}

const server = Bun.serve({
  port: 3141,
  routes: {
    "/": index,
    "/api/log/events": {
      POST: async (req) => {
        try {
          const events: SimEvent[] = await req.json();
          if (!Array.isArray(events) || events.length === 0) {
            return new Response("invalid payload", { status: 400 });
          }
          const lines = events
            .map((e) => JSON.stringify(e))
            .join("\n") + "\n";
          await appendLogLine(lines);
          return new Response("ok");
        } catch {
          return new Response("error", { status: 500 });
        }
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
