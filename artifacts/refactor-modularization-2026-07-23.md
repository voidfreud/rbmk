# Modularization plan: reactor.ts and main.ts (2026-07-23)

**For the agent executing this:** this plan is self-contained. Read it top to
bottom once, then execute one PR at a time, in order. Do not batch PRs. Do not
"improve" logic while moving code — every step is a pure, mechanical move, and
the unchanged test suite is the proof you didn't break physics. If anything in
this plan contradicts the code in front of you, the code wins; stop and
re-analyze that step instead of improvising.

## Goal

Split `packages/sim-core/src/reactor.ts` (1810 lines, god-class) and
`packages/ui/src/main.ts` (1065 lines, wiring blob) into modules with clear
single responsibilities, so that each file can be understood and reviewed in
one read.

## Non-goals (read twice)

- **No behavior change.** Not one number. The 103 physics tests + UI smoke
  must pass at every step with **zero edits to test files**. If a step seems
  to require a test change, the step is wrong — redesign it.
- **No public API change.** `packages/sim-core/src/index.ts` is the package
  contract; `Reactor`'s public methods keep their names and signatures. The
  UI imports (`@rbmk/sim-core`) must not need a single changed line.
  Delegation from `Reactor` to internal modules is the architecture, not a
  "shim" — the facade IS the contract.
- **No drive-by fixes.** Found a wart while moving code? Note it in the PR
  description, don't fix it there.
- **No performance regressions.** The hot loop (`tick`/`substep`, up to 100
  substeps/sim-second at speed multipliers) must stay zero-allocation: scratch
  buffers stay instance-owned, no closures or objects created per substep.

## Why these boundaries (evidence)

Boundaries were derived from the GitNexus call/field-access graph, not vibes:

- **IPK reactimeter** (`ipkC`, `ipkPhoto`, `lastRhoIpk`): written only by
  `resetIpk` and the IPK block inside `substep`; read only by
  `reactivityBeta()`. Self-contained algorithm (inverse point kinetics).
  Cleanest seam in the file.
- **AR controller** (all `ar*` fields): the PI step + LAR/AR changeover +
  saturation handling is a contiguous block inside `substep`
  (~lines 1100–1263), written elsewhere only by lifecycle resets
  (`initAtPower`, `initShutdown`, `resetScram`, `azSetback`) and setters
  (`setArMode`, `setArEnabled`…). Those resets become controller methods.
- **Alarm/cooldown state** (eight `last*T` timestamps, `periodAlarmLatched`,
  PRIZMA/STATE/milestone bookkeeping): `resetAlarmState` already writes every
  one of them — the reset map IS the field list. Writers are `substep`,
  `checkAlarms`, `setRodTarget` (all become tracker calls).
- **What stays in `reactor.ts`:** `CoreState`, scratch workspaces, the
  `tick`/`substep` orchestration, init (`initAtPower`/`initShutdown`/
  `calibrateCritical`), rod commands (`scram`, `setRodTarget`…), and
  instruments (`period`, `ormRods`, `netReactivityBeta`, `feedbackRhoByNode`,
  `nodePowers`, `refreshDecayShape`). Init writes nearly every field in the
  class — extracting it would create the worst coupling, so init becomes an
  *orchestrator* calling the new modules' reset methods instead.

`main.ts` has no unit tests (only `bun run smoke:ui` + browser drive), so its
extraction is strictly leaf-first and lower priority than the physics core.

## Target architecture

```
packages/sim-core/src/
  reactor.ts       facade + CoreState + tick/substep orchestration + init + controls + instruments
  reactimeter.ts   IpkReactimeter: inverse-point-kinetics instrument state + step + reset
  regulator.ts     ArController: AR/LAR PI control, changeover, saturation, setpoints, ownership
  alarms.ts        AlarmTracker: cooldown timestamps, latches, PRIZMA/STATE/milestone bookkeeping
packages/ui/src/
  main.ts          composition root: construction, wiring, frame loop
  log-upload.ts    JSONL upload pipeline (drainLogBatch, flushLog, timer, beacon)
  event-feed.ts    SimEvent → DOM rendering (list items, details, formatDataLines)
```

## Execution plan

Each step is ONE pull request. Gate for every PR (all must pass):
`bun run ci` green · `gitnexus check_import_cycles` shows no new cycles ·
`detect_changes` scope matches the step · tests unmodified · AGENTS.md layout
section updated in the same PR.

### PR 1 — extract `reactimeter.ts` (smallest; proves the pattern)

**Move:** `ipkC`, `ipkPhoto`, `lastRhoIpk` fields; `resetIpk()`; the IPK
integration block inside `substep` (the `for` loops over 6 delayed groups +
photoneutron groups updating `this.ipkC`/`this.ipkPhoto` and computing
`this.lastRhoIpk`); the `lastRhoIpk` read in `reactivityBeta()`.
**Shape:** `class IpkReactimeter { reset(power: number): void; step(power: number, smoothedRate: number, dt: number): void; get rho(): number }`.
`Reactor` owns one instance; `resetIpk()` becomes `this.ipk.reset(...)`,
`reactivityBeta()` reads `this.ipk.rho`.
**Why first:** smallest state footprint, single responsibility, touches only
one block of the hot loop — if the pattern (facade + delegation + tests
unmodified) works anywhere, it works here.
**Watch out:** the IPK step runs per substep — `step()` must take all inputs
as parameters and allocate nothing. `equilibriumPrecursor`/`stepPrecursor`
imports move to the new file.

### PR 2 — extract `alarms.ts`

**Move:** `ALARM_COOLDOWN`; fields `lastBlockedWarnT`, `lastPeriodBlockWarnT`,
`lastRodAutoWarnT`, `lastScramHoldT`, `lastSilBlokT`, `lastBandWarnT`,
`lastAzCockT`, `lastArAzBlockT`, `lastPeriodAlarmT`, `periodAlarmLatched`,
`lastPrizma`, `nextPrizmaT`, `nextStateT`, `lastPowerBin`,
`POWER_MILESTONES`; `resetAlarmState()`.
**Shape:** `class AlarmTracker` with `reset()`, `ready(key, t): boolean`
(cooldown gate that also stamps), and small typed state for
PRIZMA/STATE/milestones. Call sites (`substep`, `checkAlarms`,
`setRodTarget`, init methods) replace `s.time - this.lastX > ALARM_COOLDOWN`
idioms with tracker calls — same comparisons, same order.
**Why second:** still mechanical, but exercises the "shared mutable state
moves behind a typed API" pattern that PR 3 needs.
**Watch out:** every cooldown site must keep its exact threshold and its
write-back timing (stamp only when the event actually fires). Compare diffs
line by line; the tests cover SIL_BLOK/PRIZMA cadence and will catch drift.

### PR 3 — extract `regulator.ts` (the big one)

**Move:** fields `arEnabled`, `arSetpoint`, `arGradient`, `arSetpointActive`,
`arMode`, `arActiveGroup`, `arSaturatedFor`, `arErrPrev`, `arTarget`,
`lastArNoAuthT`; the AR block of `substep` (~1100–1263: setpoint ramp, PI
step, LAR band handling, changeover, saturation, AR_NO_AUTH); methods
`setArEnabled`, `setArSetpoint`, `setArGradient`, `setArMode`,
`setAutoControl`, `activeSetpoint`, `regulatorBand`, `regulatorOwns`,
`arInsertion`; the AR-touching parts of `initAtPower`/`initShutdown`/
`resetScram`/`azSetback` (become `regulator.initAtPower(...)`,
`regulator.reset()`, `regulator.setback()`).
**Shape:** `class ArController` constructed with `(rods: RodState[], log: EventLog, ctx: { powerFraction(): number; period(): number; ormRods(): number; isInitializing(): boolean })`
— context callbacks, NOT a Reactor reference (keeps the dependency one-way:
Reactor → controller).
**Why last:** it has the most interactions with instruments and logging; by
now the pattern is proven and `AlarmTracker` already owns `lastArNoAuthT`'s
cooldown (decide ownership explicitly in the PR: cooldown stays in
AlarmTracker, PI state in ArController).
**Watch out:**
- `regulatorOwns` is called by `substep`, `setRodTarget`, `initAtPower`, and
  the UI (`Reactor.regulatorOwns` is public API — the method stays on
  `Reactor`, delegating). Cross-package single-source rule is preserved.
- The PI block reads `pBefore` and writes `arMode`/`arActiveGroup` mid-substep;
  keep statement order identical. Extract the block verbatim first, rename
  `this.` → controller refs second, in two commits inside the PR if clearer.
- `arMode` is publicly assignable for tests ("Left assignable for tests") —
  keep a getter/setter pair on `Reactor` so test files compile unchanged.
  Same for `arGradient` and `arSetpoint`: `cps.test.ts:162-164` assigns all
  three directly (`r.arMode = "LAR"; r.arGradient = 0.01; r.arSetpoint = 0.05`),
  so all three need accessor pairs delegating to the controller.

### PR 4 — extract `ui/log-upload.ts`

**Move:** `LOG_SESSION`, `MAX_LOG_PENDING`/`MAX_BATCH_*` constants,
`logPending`, `logFlushTimer`/`logFlushInFlight`/`logOverflowWarned`,
`trimLogPending`, `drainLogBatch`, `startLogFlushTimer`, `flushLog`, the
`pagehide` beacon handler. Export an `attachLogUpload(log: EventLog): void`
that registers the sink and the beacon.
**Why:** cohesive, recently rewritten, zero reactor coupling beyond the sink
registration. Smoke test + one browser drive (check the Network tab batches)
is the gate — there are no unit tests here.

### PR 5 — extract `ui/event-feed.ts`

**Move:** the `SimEvent` → DOM rendering (list-item construction, context
line, `<details>` payload, `formatDataLines`). Export
`renderEvent(e: SimEvent): HTMLLIElement`.
**Why:** pure rendering, no state. Same gate as PR 4.

### PR 6 (optional, only if 1–5 landed cleanly) — `ui/selection.ts` + `ui/ar-panel.ts`

Selection state (`selected`, selsyn `rebuildSelRows`, count lamps, SIL_BLOK
clear) and AR panel wiring. Higher coupling (cartogram hit-test, reactor
calls, annunciator timestamps); do these as two separate PRs with browser
drives, or skip — main.ts at ~500 lines after PRs 4–5 may already be
acceptable.

## Rules of engagement (every PR)

1. Branch per PR: `refactor/pr<N>-<module>`. CI must be green before merge;
   repo rule: no direct pushes to `main`.
2. **Tests are the oracle — do not edit them.** A red test after a pure move
   means the move changed behavior; find and fix the move, never the test.
3. Move code verbatim first; adjust references second; rename nothing in the
   same PR as a move.
4. Keep statement order in the hot loop identical; keep scratch buffers
   instance-owned; no new per-substep allocations (grep the diff for
   `new `, arrow closures, spread inside `substep`/`step` paths).
5. Update `AGENTS.md` (layout section) and any affected docs **in the same
   PR** — repo rule.
6. Before merge, run a reviewer subagent on the diff with the instruction:
   "verify this is a pure move; flag any behavioral difference."

## Verification toolbox

- `bun run ci` — typecheck + 103 physics tests + UI smoke (the gate).
- `gitnexus analyze_impact {target, direction: "upstream"}` — before moving a
  symbol, confirm the dependent set matches this plan's claims.
- `gitnexus check_import_cycles` — after each extraction; new modules must
  not create cycles (dependency direction: reactimeter/regulator/alarms →
  nothing in reactor.ts; reactor.ts → them).
- `gitnexus detect_changes {scope: "all"}` — pre-commit scope sanity.
- `lsp references` — exact call sites before moving any method (the graph is
  a map, LSP is the territory).
- Browser drive after UI PRs: panels render, event feed populates, log
  batches POST.

## Known buts

- **`substep` stays long** (~600 lines after PR 3). That's acceptable: it's
  the integration point of a stiff ODE step; splitting the physics sequence
  itself is a different, riskier project. This plan removes the *detachable*
  subsystems.
- **Cooldown ownership between AlarmTracker and ArController** (`lastArNoAuthT`,
  `lastSilBlokT`, `lastBandWarnT`) is a judgment call — decide in PR 3, keep
  it consistent, document the choice in that PR.
- **If a test goes red and you can't see why within 30 minutes:** revert the
  PR branch, don't patch around it. A pure move cannot legitimately change
  physics.
- **`field.ts`/`RadialField` is out of scope** — display-only, already
  cohesive.

## Definition of done

PRs 1–5 merged (6 optional); `reactor.ts` ≤ ~1100 lines and reads as
orchestration; `main.ts` ≤ ~700 lines and reads as composition; `bun run ci`
green on `main`; no test file modified in any PR; AGENTS.md layout reflects
the new modules.
