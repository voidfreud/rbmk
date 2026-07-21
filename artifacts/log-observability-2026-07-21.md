# Logging/observability findings (2026-07-21)

## Objective
Validate operator-facing event logging and stop only when no new logic/physics defects are discovered.

## Evidence checked
- `data/log.jsonl` contains both `warn` and `info` events with rich payloads, including frequent `STATE` snapshots and event `data`.
- Example from run tail shows `AR_CHANGEOVER`, `ROD_CMD`, `PRIZMA`, `FLOW`, `INIT`, `STATE`, etc. with structured keys.
- This confirms the underlying event model already carries much more than the UI line-level message.

## Findings

### 1) UI event feed hides full payload (high confidence)
- **Location:** `packages/ui/src/main.ts` event sink / rendering block.
- **Symptom observed:** event list showed only icon + short message and looked like mostly warnings/state-only updates, matching the user’s report.
- **Root cause:** the existing renderer only rendered a compact text label and did not surface per-event `data`, actor/cause/context, or deltas in the default view; users had to inspect server logs manually.
- **Fix applied:**
  - Restore the event renderer to include:
    - sequence/time/code/title,
    - compact state summary from event `data`,
    - inferred context (`actor`, `where`, `cause`),
    - state deltas for `STATE` events, and
    - expandable `event data` details for all events.
  - Add dedicated styling for those details in `packages/ui/index.html` so the richer stream is readable without log bloat.

### 2) No new logic/physics/engine defects discovered in this observability pass
- Static scan + test execution found no additional engine or physics regressions beyond existing known findings already tracked in `artifacts/performance-bottlenecks-2026-07-21.md`.

## Validation
- `bun run check` — PASS (`63 pass`, `0 fail`).
- `bun run smoke:ui` — PASS.
- `EventLog`/`SimEvent` type updates continue to accept extended metadata (`actor`, `cause`, `where`, `before`, `after`) with optional sequence stamping.

## Status after this pass
- **Open item:** none for logging/UI observability after this change set.
- **Consecutive no-result condition:** this run’s check completed with no new logic/physics defects in this pass.

## Post-audit changes (PR #9, same day)
- 15 `EventLog` unit tests added (`logger.test.ts`).
- `emit()` now enforces strictly monotonic sequences (non-increasing supplied
  values are silently replaced).
- `inferActor`/`inferWhere` split operator config events from automatic
  controller advisories; `AZ5` and `SIL_BLOK` fixed (both were falling
  through to the wrong defaults).
- `docs/observability.md` documents the full schema and enrichment tables.
- `AGENTS.md` and `README.md` updated for the new fields.
- Final `bun run check`: **78 pass**, 0 fail.