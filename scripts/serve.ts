import { appendFile, mkdir } from "node:fs/promises";
import {
  parseSessionId,
  readBoundedBody,
  SessionSeqTracker,
  validateLogBatch,
} from "./log-ingest";
import index from "../packages/ui/index.html";

const LOG_PATH = "data/log.jsonl";

// Ensure the data directory exists and start a fresh log for this run so
// `data/log.jsonl` only contains events from the current server session.
const logDir = LOG_PATH.substring(0, LOG_PATH.lastIndexOf("/"));
await mkdir(logDir, { recursive: true });
await Bun.write(LOG_PATH, "");

const seqTracker = new SessionSeqTracker();

// Serialize appends: concurrent flushes (multiple tabs) must not interleave
// or reorder writes to the JSONL file.
let logWriteChain: Promise<unknown> = Promise.resolve();
function enqueueLogWrite(lines: string): Promise<void> {
  const write = logWriteChain.then(() => appendFile(LOG_PATH, lines, "utf-8"));
  logWriteChain = write.catch(() => {});
  return write;
}

const server = Bun.serve({
  port: 3141,
  routes: {
    "/": index,
    "/api/log/events": {
      POST: async (req) => {
        try {
          const bodyResult = await readBoundedBody(req);
          if ("status" in bodyResult) {
            return new Response(bodyResult.message, {
              status: bodyResult.status,
            });
          }
          let payload: unknown;
          try {
            payload = JSON.parse(new TextDecoder().decode(bodyResult.body));
          } catch {
            return new Response("invalid JSON", { status: 400 });
          }
          const validation = validateLogBatch(
            payload,
            bodyResult.body.byteLength,
          );
          if ("status" in validation) {
            return new Response(validation.message, {
              status: validation.status,
            });
          }
          const fresh = seqTracker.filterNew(
            parseSessionId(req.url),
            validation.events,
          );
          if (fresh.length === 0) return new Response("ok");
          const lines =
            fresh.map((event) => JSON.stringify(event)).join("\n") + "\n";
          await enqueueLogWrite(lines);
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
