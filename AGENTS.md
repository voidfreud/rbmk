# RBMK-1000 Simulator

A from-scratch RBMK-1000 (Chernobyl unit 4) reactor simulator with real
physics. Inspired by hartrusion/RbmkSimulator (GPLv3, Java) but shares no
code with it; that repo and INSAG-7 serve as reference material only.

## Stack and commands

- **Bun** (no Node, no build step). TypeScript strict mode throughout.
- `bun run check` - strict TypeScript plus the physics validation suite
- `bun run start` - control-room UI at http://localhost:3141/
- `bun run smoke:ui` - validates a complete served UI entry point
- `bun run ci` - check + smoke (same gate as GitHub Actions)

## Layout

```
packages/sim-core/   pure physics, zero deps, never touches a browser API
  src/constants.ts   every physical constant, with units and source notes
  src/kinetics.ts    1D axial nodal neutron kinetics, 6 delayed groups
  src/isotopes.ts    I-135 -> Xe-135 chain, decay heat groups
  src/thermal.ts     channel boiling, void, fuel/graphite temperatures
  src/rods.ts        rod geometry incl. graphite displacers ("tip effect")
  src/reactor.ts     assembly: tick loop, AR controller, alarms, calibration
scripts/smoke-ui.ts  UI server smoke validation used locally and in CI
packages/ui/         canvas control room, subscribes to sim-core
  src/main.ts        frame loop, rod selection, AR/AZ/speed controls, tooltips
  src/cartogram.ts   top-down 211-rod map (cells, hit-test, glyphs)
  src/channelmap.ts  radial power field + CPS overlays; positions precomputed
  src/slice.ts       axial core profile (power, rod tracks, coolant direction)
  src/strips.ts      shared-time MultiTrendChart recorder (ring buffer)
packages/sim-plant/  (future) pumps, drum separators, turbine, grid
```

## Physics model (v0)

- 14 axial nodes over the 7 m core; each node has flux, 6 precursor groups,
  I-135/Xe-135, fuel/graphite/coolant temps, steam quality, void fraction.
- Node reactivity = rhoBase (criticality calibration) + rods + void +
  Doppler + graphite temp + xenon. Node coupling is an implicit tridiagonal
  diffusion solve, unconditionally stable; fast-forward uses maxStep=0.1 s.
- Rods model the pre-1986 geometry: absorber from the top, 4.5 m graphite
  displacer, 1.25 m water columns - so the positive scram ("tip effect")
  emerges from geometry, not scripting. See rods.test.ts.
- Real CPS structure (docs/physics.md "CPS" section): 131 RR + 12 AR
  (3 subgroups, auto changeover) + 12 LAR + 24 AZ + 32 USP. USP enter
  from BELOW and are NOT driven by AZ-5 (pre-1986). Protections: AZS
  (period), AZM (overpower), both operator-blockable; AZ-1 setback;
  delayed PRIZMA ORM advisory below 15 rods. Regulator setpoint ramps at
  arGradient.
- The plant is genuinely unstable open-loop (positive void coefficient);
  the AR (automatic regulator) PI controller holds it, like the real one.
  Tests that probe raw feedback set `reactor.arEnabled = false`.
- Rod worth rates matter: moving the whole RR bank at once is ~0.5–0.7 beta/s
  and WILL trip the plant - move small squads (the real limit was ~4
  rods at once; the UI enforces TEZ L.24 max-4 withdrawal selection, and
  sim-core hard-stops ≥8 non-AZ withdrawals via SIL_BLOK).
- Reactivity displayed in dollars of BETA_EFF = 0.005.
- ORM is equivalent rods remaining in the core among RR+AR+LAR
  (Σ(insertion)); PRIZMA warns when that falls below 15 at power.

## Conventions

- Node index 0 = TOP of core (rod insertion side); coolant enters at the
  BOTTOM (index N_AXIAL-1). Watch this in any axial code.
- All integrators are implicit/semi-implicit; do not add an explicit-Euler
  update for anything stiff (that caused NaNs twice already).
- Constants are reconciled against literature (citations in docs/physics.md);
  the few marked ESTIMATED have no clean published figure - keep the flag if
  you touch them.
- Keep sim-core framework-free and deterministic: no Date.now(), no
  randomness without an injected seed, no I/O (logger sinks are injected).
- The render loop runs at requestAnimationFrame cadence (~60 Hz) and must
  stay zero-allocation in the hot paths: no `.map`/`.filter`/spread or
  per-frame object/tuple construction inside `draw` or hit-test.
  Sliding-window recorders use a ring buffer (head/count into a
  preallocated array), not `Array.shift()`. Static geometry (channel/rod
  lattice pixel positions) is precomputed once into typed arrays at
  construction and indexed in the loop instead of recomputing. Pointer
  hit-testing is coalesced to one `requestAnimationFrame` per frame —
  store the latest mouse event, run the label function once.
- Cross-package business rules have ONE source of truth in sim-core,
  exposed as a public method (e.g. `Reactor.regulatorOwns`); the UI calls
  it — never duplicate the logic (a second copy drifts silently).
  
- Every reactor event logs a structured `SimEvent` with a monotonic `seq`, sim-time, level (`info`/`warn`/`alarm`), event code, human-readable message, optional `actor`/`cause`/`where` context (inferred by `enrichMeta` from event code and message), optional `data` snapshot, and optional `before`/`after` transition snapshots. The in-memory ring (10 000 events) feeds UI sinks and, when the dev server is running, a JSONL file at `data/log.jsonl` via `POST /api/log/events` (downloadable at `GET /api/log/download`). The UI batches events (≤100 or every 3 s) and uses `navigator.sendBeacon` on page unload for lossless tails.  Full schema and enrichment tables live in `docs/observability.md`. Event codes: `INIT`, `PROTECTION`, `ROD_CMD`, `SCRAM_HOLD`, `ROD_AUTO`, `PERIOD_BLOCK`, `AZ_COCK`, `AR_OVERRIDE`, `AR_ENABLED`, `AR_SETPOINT`, `AR_GRADIENT`, `AR_MODE`, `AZ5`, `AZ1`, `AZ5_RESET`, `FLOW`, `RHO_EXTRA`, `LAR_DROPOUT`, `AR_BAND`, `AR_CHANGEOVER`, `AR_NO_AUTH`, `SIL_BLOK`, `PERIOD`, `PRIZMA`, `RPS_BLOCKED`, `STATE`, `POWER`, `SPEED`.

## Roadmap

1. sim-core v0: nodal kinetics + xenon + rods + thermal (DONE, tested)
2. Constants reconciliation vs literature (DONE, docs/physics.md)
3. packages/ui: canvas control room (DONE v0+: per-rod selsyn depth cells,
   channel field, axial slice, shared trend monitor, hold-to-drive KUS,
   individual rod selection, AR panel with
   subgroups/gradient/override, protection panel, cold start + start at
   power, plant-state annunciator; `bun run start`, port 3141. Perf pass
   DONE: rAF-coalesced hit-testing, precomputed lattice positions,
   ring-buffer recorder, zero-alloc draw, deduped `regulatorOwns`, dead
   code removed. Per-frame redraw of all canvases is intentionally kept
   — see Conventions.)
4. Radial dimension (2D nodal mesh) for spatial xenon oscillations
5. packages/sim-plant: hydraulic loops, pumps, drum separators, turbine
6. Grid/electrical side

## Working agreements

- Update this file as the architecture evolves (owner request).
- Public repo; direct pushes to `main` are blocked — all changes land via
  pull request with CI green (enforced for admins too).
- Commit AND push after every completed change/iteration (owner request) -
  small checkpoints, not batched mega-commits. Push to a feature branch
  and open a PR; merge after the "Physics, types, and UI smoke" check
  passes (auto-delete on merge is enabled).
- Use short-lived feature branches or isolated worktrees for parallel work;
  keep commits focused, and merge only validated changes.
- Plant systems (hydraulics/turbine) are deliberately deferred; reactor
  control fidelity comes first (owner request 2026-07-15). Research
  reports for the plant live in docs/research/ for when we get there.
- CI on `main` and pull requests must pass type-checking, physics tests,
  and the UI smoke test.
- Keep docs in sync with the code. When a change alters behavior, a public
  API, or the architecture, update this file, README.md, and docs/ in the
  SAME change (same commit). A doc that describes behavior that no longer
  exists is a bug, not a nice-to-have. If you add a convention worth
  enforcing, put it under Conventions above; if you move or delete a file,
  fix every doc that names it.
