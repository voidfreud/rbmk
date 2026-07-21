# Performance & bottleneck sweep (2026-07-21)

## Objective
Continue checking for poor optimization and bottlenecks; persist findings.

## Evidence runs
1. `bun run check` (typecheck + tests)
   - PASS: `63 pass`, `0 fail`.
2. `bun run smoke:ui`
   - PASS: UI smoke validation succeeded.
3. Static pass 1 (grep over `packages/ui/src` and `packages/sim-core/src` for allocation-heavy patterns): found potential hot-path candidates.
4. Static pass 2 (focused `slices 700..908` and `reactor` substep range for same patterns + additional allocation-pattern scan): confirmed the same candidate set; no new high-priority patterns beyond pass 1.

## Findings

### 1) Per-frame DOM/CPU work builds arrays in UI draw/update path (medium)
- `packages/ui/src/main.ts:816-819`
  - `Math.max(...nodes.map(...))` and `nodes.reduce(...)` are executed each DOM refresh (~5 Hz).
  - `Math.max(...nodes.map(...))` forces two short-lived arrays (`map` + spread args).
  - Recommendation: replace with a single loop that tracks min/max/mean directly to avoid temp arrays.

### 2) Slice rendering allocates temporary arrays every draw (medium)
- `packages/ui/src/slice.ts:139`
  - `Math.max(1e-12, ...nodes.map((n) => n.flux))` inside `draw` (60 Hz).
  - This creates an array each draw via `nodes.map` and variadic spread.
  - Recommendation: compute `maxFlux` in a manual loop.

### 3) Core hot loop allocates filtered arrays in `tick` path (medium-high)
- `packages/sim-core/src/reactor.ts:1073-1080`
  - `const withdrawing = s.rods.filter(...)` is executed each `substep` call.
  - `tick` can run many substeps per frame at fast speed, so this allocates continuously (even when no withdrawals).
  - Recommendation: keep boolean/count counters during the loop and avoid array allocation unless threshold is met.

### 4) Core hot loop computes bank means with filter+reduce repeatedly (medium)
- `packages/sim-core/src/reactor.ts:922-942`, `1007-1042`
  - `s.rods.filter(...).reduce(...)` used around AR changeover paths to pick standby banks.
  - Not always on, but in saturated-authority control cases it compounds extra allocations + scans.
  - Recommendation: precompute subgroup sums once per step or maintain rolling aggregates.

### 5) Radial field update reconstruct path allocates full rod effect array each update (low)
- `packages/sim-core/src/field.ts:131`
  - `const eff = this.rods.map((rod) => rodAxialEffect(rod, nodes));`
  - Called from UI every field recompute (currently ~5 Hz).
  - Recommendation: cache `rodAxialEffect` values in typed buffers and update incrementally as rod/flux state changes.

### 6) Periodic state snapshot allocates several group arrays (low)
- `packages/sim-core/src/reactor.ts:1263-1266`
  - For each of `RR/AR/LAR/AZ/USP` this does `filter` + `reduce` during periodic `STATE` logging.
  - Frequency is coarse (`STATE_INTERVAL`), so this is not a primary bottleneck.
  - Keep as-is unless CPU budget indicates issue.

## No-new-findings sequence
- Pass 1 found the items above and no additional high-risk entries outside already identified hot paths.
- Pass 2 did not produce new candidates beyond this set.

## Next action
No code changes were applied in this sweep; file-level candidates are ready for follow-up optimization PR if needed.

## Additional continuation run (2026-07-21, second sweep)

### 7) `calibrateCritical()` omits photoneutrons from trial kinetics state (physics/logic defect)
- `packages/sim-core/src/reactor.ts:444-448`
- `calibrateCritical()` builds a trial vector for `stepKinetics()` as:
  - `flux`
  - `precursors`
  - **without** `photoneutrons`
- Impact:
  - `stepKinetics()` computes reactivity from delayed sources plus prompt; `photoneutrons` are optional and skipped when absent.
  - The calibration trial therefore evaluates growth in a different neutronics model than the live state whenever `photoneutrons` are nonzero.
  - On startup with nonzero photoneutron precursors, `rhoBase` changes by ~2.3e-2 in-dollars at 10× photoneutron scaling and by ~2.5e-3 in-dollars at baseline scaling in a repro script; this is a real-state-consistency error, not a no-op.
- Recommendation:
  - Copy `photoneutrons` into the calibration trial (`photoneutrons: [...n.photoneutrons]`) when present, matching the same kinetics state used by live operation.

### Validation for finding #7
- Commanded repro script (custom temp script): compare calibration with and without trial photoneutrons copied.
- Result (at 1.0 power startup, factor=1, 10, 100 scaling of initial photoneutron pool):
  - `factor=1` `noPhoto=0.02977127280729057`, `withPhoto=0.02975875238238679`, `delta=-1.25204e-5` (`-2.504e-3` in-math cents)
  - `factor=10` `noPhoto=0.02977127280729057`, `withPhoto=0.029652834754351785`, `delta=-1.18438e-4` (`-2.36876e-2` in-dollars)
  - `factor=100` `noPhoto=0.02977127280729057`, `withPhoto=0.028608651531452624`, `delta=-1.16262e-3` (`-2.325e-1` in-dollars)
- Also verified: `bun run check` and `bun run smoke:ui` both pass after this diagnostic run (no code changes).

## Additional no-new loops (post-finding)
- Loop A: grep scans over UI/core for allocation signatures returned only previously listed candidates + selection-only paths; no new bottlenecks above current candidate set.
- Loop B: follow-up grep scans over marker/bug strings and selection per-frame paths returned no new logic defects.
- Loop C: no new logic defects surfaced; no additional findings in this branch of passes.

## Next action
- Fix finding #7 before any optimization follow-up; then rerun `bun run check` / `bun run smoke:ui`.

## Additional continuation run (2026-07-21, third sweep)

### No additional defects found (Consecutive no-result Loop D/E)
- `bun run check`:
  - PASS: `63 pass`, `0 fail`.
- `bun run smoke:ui`
  - PASS: UI smoke validation succeeded.
- Loop D: targeted marker and copy-pattern scan (`TODO/FIXME`, `as any`, map/filter/reduce allocation scans, clone-shape scans) returned no new logic/physics/engine defects beyond previously recorded findings.
- Loop E: additional consistency scan (`Math.min/Math.max`/pow/signature-heavy hotspots) likewise returned no new defects outside the existing item set.
- Stop condition reached for this cycle: two consecutive logic/physics/engine scans with no new findings.

## Fixes applied (2026-07-21, post-review)

### Completed by this cycle
1. ✅ `main.ts` plant thermal readouts now use a single manual loop (`main.ts:815-826`) instead of mixed `map`/`reduce`/`Math.max(...nodes.map...)` calls.
2. ✅ `slice.ts` axial max-peak scan now uses a single loop (`slice.ts:139-143`).
3. ✅ SIL_BLOK no-longer uses `s.rods.filter(...)` allocation (`reactor.ts:1072-1110`).
4. ✅ AR bank mean calculations were replaced with direct accumulation loops in:
   - `setArMode` (`reactor.ts:684-690`)
   - `scram` (`reactor.ts:726-731`)
   - `resetScram` (`reactor.ts:801-810`)
   - LAR→AR changeover (`reactor.ts:942-952`)
   - AR saturation and changeover (`reactor.ts:1027-1072`).
5. ✅ `RadialField.update` no longer materializes full rod effect array per update (`field.ts:133-150`); rod effects are cached in scratch typed arrays and reused for each channel loop.
6. ✅ `STATE` snapshot group averages now use single-pass totals and counters (`reactor.ts:1299-1350`) instead of repeated `filter/reduce`.
7. ✅ `calibrateCritical()` now copies `photoneutrons` into the trial kinetics vector (`reactor.ts:445-448`), fixing the initialization consistency defect.

### Post-fix verification
- `bun run check` — PASS (`63 pass`, `0 fail`)
- `bun run smoke:ui` — PASS
- Pattern continuity scan #1 (`Math.max(...nodes.map...)`, `rods.map(rod => rodAxialEffect(...))`, `filter(...).reduce(...)`) — no matches.
- Pattern continuity scan #2 (same signature set) — no matches.

### Net status
- No additional performance/logic/physics defects found in two consecutive full scans after fixes; all logged findings above are addressed.
