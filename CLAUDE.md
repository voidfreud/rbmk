# RBMK-1000 Simulator

A from-scratch RBMK-1000 (Chernobyl unit 4) reactor simulator with real
physics. Inspired by hartrusion/RbmkSimulator (GPLv3, Java) but shares no
code with it; that repo and INSAG-7 serve as reference material only.

## Stack and commands

- **Bun** (no Node, no build step). TypeScript strict mode throughout.
- `bun test` - physics validation suite (packages/sim-core/test/)
- `bun run scripts/demo.ts` - "a shift at the plant" CLI scenario,
  writes structured JSONL to logs/run.jsonl

## Layout

```
packages/sim-core/   pure physics, zero deps, never touches a browser API
  src/constants.ts   every physical constant, with units and source notes
  src/kinetics.ts    1D axial nodal neutron kinetics, 6 delayed groups
  src/isotopes.ts    I-135 -> Xe-135 chain, decay heat groups
  src/thermal.ts     channel boiling, void, fuel/graphite temperatures
  src/rods.ts        rod geometry incl. graphite displacers ("tip effect")
  src/reactor.ts     assembly: tick loop, AR controller, alarms, calibration
scripts/demo.ts      demo scenario + shift-operator heuristic
packages/ui/         (future) canvas/SVG control room, subscribes to sim-core
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
  ORM alarm below 15 rods. Regulator setpoint ramps at arGradient.
- The plant is genuinely unstable open-loop (positive void coefficient);
  the AR (automatic regulator) PI controller holds it, like the real one.
  Tests that probe raw feedback set `reactor.arEnabled = false`.
- Rod worth rates matter: moving the whole RR bank at once is ~0.5–0.7 beta/s
  and WILL trip the plant - move small squads (the real limit was ~4
  rods at once). The demo's operatorTrim shows the pattern.
- Reactivity displayed in dollars of BETA_EFF = 0.005.

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

## Roadmap

1. sim-core v0: nodal kinetics + xenon + rods + thermal (DONE, tested)
2. Constants reconciliation vs literature (DONE, docs/physics.md)
3. packages/ui: canvas control room (DONE v0+: per-rod selsyn depth cells,
   channel field, axial slice, strip charts, lever-style rod drive
   (hold = 0.4 m/s, release = stop) + pulse steps, AR panel with
   subgroups/gradient/override, protection panel, cold start + start at
   power, plant-state annunciator; `bun run ui`, port 3141)
4. Radial dimension (2D nodal mesh) for spatial xenon oscillations
5. packages/sim-plant: hydraulic loops, pumps, drum separators, turbine
6. Grid/electrical side

## Working agreements

- Update this file as the architecture evolves (owner request).
- Private repo; pushing and merging to GitHub allowed without asking.
- Commit AND push after every completed change/iteration (owner request) -
  small checkpoints, not batched mega-commits.
- Parallel work: **grok lineage + isolated worktrees** (see
  `docs/parallel-workflow.md`). Integration branch is **`grok`**; agents
  use short-lived **`grok-<task>`** branches (hyphen — not `grok/…`)
  forked from `grok`; **never merge agent work to `main`** until an
  explicit promote. Phrase: “parallel on the grok lineage; protect main.”
- Plant systems (hydraulics/turbine) are deliberately deferred; reactor
  control fidelity comes first (owner request 2026-07-15). Research
  reports for the plant live in docs/research/ for when we get there.
- Control-panel usability checklist (includes all 57 audit findings plus
  hover/exploitability goals): `docs/grok-checklist.md`. Detailed repros
  remain in `docs/audit-backlog.md`.
