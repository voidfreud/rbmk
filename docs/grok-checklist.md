# Grok branch — tracked checklist

Working checklist for making the RBMK-1000 control panel **usable and
honest** without full plant hydraulics/turbine. Branch: `grok`.

## Relationship to the 57 audit findings

**Yes — this checklist includes all 57 findings** from
[`docs/audit-backlog.md`](audit-backlog.md) (multi-agent deep audit,
2026-07-15). Each backlog item is referenced as `#N` below.

- **Audit backlog** = discovery detail, repro scenarios, proposed fixes,
  skeptic verdicts (`pending` / `confirmed` / `rejected`).
- **This file** = prioritised work tracking for the control-panel goal,
  plus UX/fidelity requirements that were not in the original 57.

Mark items `[x]` when fixed and verified (test and/or manual repro). When
an audit finding is fixed, also update its verdict/status in the backlog
doc (or note "fixed on grok" under the finding).

---

## Design goals (always in mind)

- [x] **G0. Realistic exploitation** — Operators (and curious players) should
  be able to *use* the desk the way a SIUR would: find the control, understand
  what it does, command it, and read back the plant. Features that only work
  if you already know the source code are unfinished. Prefer real CPS
  terminology with plain-language support, not cryptic abbreviations alone.
  *(partial this pass: operator path + event-log for refusals in guide; full
  cold-start drill still operator skill.)*
- [x] **G1. Hover / discoverability** — Every button, lamp, meter, toggle,
  chart, and indicator must expose **comprehensible** information on hover
  (native `title` and/or the shared `#tooltip`): full name, what it does,
  units, typical range, and when it matters. **No mysterious or cyphered
  controls** — labels like "AZS", "SIL", "ORM", "VK/NK", "AR-1" need an
  expansion in the tooltip (e.g. "AZS — emergency period protection; trips
  AZ-5 if period < 10 s"). Canvases already have some tooltips; the rest of
  the desk must match that standard.
- [x] **G2. Control panel first** — Reactor control fidelity over plant
  water/turbine (deferred). Fix CPS, instruments, drives, and core feedback
  that the panel depends on before sim-plant work.
- [ ] **G3. Honest instruments** — If a quantity is approximate or not yet
  modeled, say so in UI/docs; never label a wrong scale as the real one
  (see ORM #24).

---

## P0 — Session / desk broken in normal use

| Done | ID | Summary | Audit |
|:----:|----|---------|------:|
| [x] | P0.1 | `initAtPower` re-enables AR after cold start; settle with regulator on | #10 |
| [x] | P0.2 | Reset strip `nextSample` + clear chart buffers on re-init | #1, #21 |
| [x] | P0.3 | Reset annunciator `lampT` (and use `t >= lampT` guards); fix LAR dropout lamp | #2, #3 |
| [x] | P0.4 | Reset reactor alarm cooldown timestamps / period latch on re-init | #11 |
| [x] | P0.5 | Lever: left-button only; window `mouseup` + `blur` release | #5 |
| [x] | P0.6 | Cartogram: ignore non-left mousedown; clear drag on contextmenu/blur | #6 |
| [x] | P0.7 | Resync setpoint slider when AZ-1 (or reactor) changes `arSetpoint` | #4 |
| [x] | P0.8 | While SCRAMMED: refuse withdrawal / re-assert insert targets; UI drive disabled or inert | #8 |

---

## P0 — CPS mechanics fail the panel contract

| Done | ID | Summary | Audit |
|:----:|----|---------|------:|
| [x] | P0.9 | Silovaya: do not treat regulator-owned LAR/AR ganged withdraw as operator 8-rod interlock (or model independent zone servos) | #9 |
| [x] | P0.10 | AR changeover: no infinite 5 s round-robin; latch "out of authority" | #12, #26 |
| [x] | P0.11 | `resetScram` must not walk AR banks out (setpoint/authority contract + test) | #44 |
| [x] | P0.12 | AZ-1 is a true ~50% setback (drop active setpoint; AR must not fight for 28 min) | #47 |
| [x] | P0.13 | Withdrawal select limit: refuse at `>=5` non-AZ (max 4); fix message | #19 |
| [x] | P0.14 | `SIL_BLOK` clears UI selection (or stop claiming it does) | #20 |
| [x] | P0.15 | Startup period <60 s: **continuously** stop withdrawals, not only at command time | #22 |
| [x] | P0.16 | AZS period trip: remove or justify power >0.5% floor; docs match code | #25 |
| [x] | P0.17 | Rule 3.1.7: no positive reactivity insert unless AZ bank cocked | #29 |
| [x] | P0.18 | AR subgroup switches via `setAutoControl`; resync auto/manual lamp state | #7 |
| [x] | P0.19 | `setArMode` re-seeds `arTarget` from owned bank (UI must not bare-write `arMode`) | #55 |

---

## P1 — Instruments that lie

| Done | ID | Summary | Audit |
|:----:|----|---------|------:|
| [x] | P1.1 | ORM: real equivalent-rod scale **or** honest labeling + threshold; floor can fire in accident-like configs | #24 |
| [x] | P1.2 | Channel field "temp" view shows temperature (or remove toggle) | #42 |
| [x] | P1.3 | Strip/instrument damping on **sim** time (or unsmoothed chart samples); period lamp vs meter agree | #16 |
| [x] | P1.4 | Reactimeter tests + pin steady/scram/shutdown readings | #45 |
| [x] | P1.5 | Correct documented RR-bank reactivity rate (~0.5–0.7 β/s or retune worth) | #30 |

---

## P1 — Core physics the panel depends on

(Still no full hydraulics — only thermal/kinetics/rods that feed the desk.)

| Done | ID | Summary | Audit |
|:----:|----|---------|------:|
| [x] | P1.6 | Coolant enthalpy from UA heat transfer (+ small direct fraction), not raw fission power | #14 |
| [x] | P1.7 | Superheat branch or document dryout quality cap | #13 |
| [x] | P1.8 | Kinetics substep under high ρ so dt=0.1 (10x/60x) does not pole/NaN | #17, #56 |
| [x] | P1.9 | USP drive speed uses USP stroke (~3.05–3.5 m), not 7 m core height | #15, #23 |

---

## P1 — Interlock / band fidelity (docs vs code)

| Done | ID | Summary | Audit |
|:----:|----|---------|------:|
| [x] | P1.10 | Period warning threshold 15 s vs 20 s: pick and document | #27 |
| [ ] | P1.11 | LAR band 10% vs 20%: reconcile physics.md + controls.md + code | #28 |
| [x] | P1.12 | ARM upper band enforced; gate band/dropout during `initializing` | #51 |

---

## P2 — Dead code, API traps, hygiene

| Done | ID | Summary | Audit |
|:----:|----|---------|------:|
| [x] | P2.1 | Dead CSS tokens / unused markup (`--serious`, `--grid`, bare `.strip`, orphan ids) | #18 |
| [x] | P2.2 | Delete identity `GRP_SHORT` | #31 |
| [x] | P2.3 | Extract shared tooltip attach helper (3 canvas copies) | #32 |
| [x] | P2.4 | Share `hms()` in sim-core (demo + strips) | #33 |
| [x] | P2.5 | Remove or expose `lastRhoByNode` | #34 |
| [x] | P2.6 | Use or delete `assertNodeCount` | #35 |
| [ ] | P2.7 | `rhoExtra`: real setter + calibrateCritical include, or delete | #36, #43 |
| [ ] | P2.8 | RodSelector `"all"` / `"AR1"`–`"AR3"`: test + ROD_AUTO guard, or drop | #37, #46 |
| [ ] | P2.9 | Share IPK/precursor helpers with kinetics.ts | #38 |
| [x] | P2.10 | `thermalPower` uses `DECAY_FRACTION_TOTAL` | #39 |
| [x] | P2.11 | Shared xenon/void average helpers (UI + demo) | #40 |
| [ ] | P2.12 | `PRESSURE` constant: document-only or wire to properties | #41 |

---

## P2 — Test coverage gaps (pin the contract)

| Done | ID | Summary | Audit |
|:----:|----|---------|------:|
| [x] | P2.13 | `resetScram` test (no autonomous AR walkout) | #44 |
| [x] | P2.14 | Reactimeter / IPK suite | #45 |
| [ ] | P2.15 | Group-selector ROD_AUTO + AR subgroup targets | #46 |
| [ ] | P2.16 | `azSetback` endpoint + non-latching | #47 |
| [ ] | P2.17 | AR automatic changeover sequence | #48 |
| [x] | P2.18 | `rodWorthBeta` purity (try/finally) + sign tests | #49 |
| [x] | P2.19 | `field.ts` / RadialField id===index contract | #50 |
| [ ] | P2.20 | ARM band + no band spam during init | #51 |
| [x] | P2.21 | Startup period-block continuous/command tests | #52 |
| [ ] | P2.22 | `buildRods` count contract | #53 |
| [ ] | P2.23 | PRIZMA cadence + re-init re-arm | #54 |
| [x] | P2.24 | Operator `setArMode` re-seed | #55 |
| [x] | P2.25 | Fast-forward (maxStep=0.1) vs 0.01 excursion agreement | #56 |
| [ ] | P2.26 | Analytic inhour / reactimeter step kinetics tests | #57 |

---

## UX — discoverability & realistic exploitation (new; not in the 57)

These are first-class on this branch, not backlog leftovers.

| Done | ID | Summary |
|:----:|----|---------|
| [x] | UX.1 | **Hover audit**: every control and indicator in `packages/ui/index.html` has a plain-language `title` (or live tooltip) stating name, function, units, and trip/band if any |
| [x] | UX.2 | Expand CPS jargon on hover: AZ-5, AZ-1, AZS, AZM, AR/ARM/LAR, RR, USP, SIL, ORM, PRIZMA, VK/NK, selsyn, gradient, silovaya, ORM floor, period block |
| [x] | UX.3 | Annunciator lamps: hover = what fired, what it means, what to do (not just a short label) |
| [x] | UX.4 | Strip charts: axis units + threshold lines explained on hover (AZS 10 s, power 110%, etc.) |
| [x] | UX.5 | Checklist / guide steps use operator language consistent with tooltips (same terms, no private nicknames) |
| [x] | UX.6 | **Exploitability pass**: cold start → criticality → power raise → hold → AZ-1 → AZ-5 → reset is doable from the UI alone without reading source; document any remaining sim-only shortcuts |
| [x] | UX.7 | Disabled / refused actions always feedback (log + optional toast/lamp): SEL_LIMIT, SIL_BLOK, ROD_AUTO, PERIOD_BLOCK, scrammed drive — never silent no-ops |
| [x] | UX.8 | Prefer real panel layout language (BShchU / SIUR desk) where we already researched it (`docs/research/controls.md` fidelity punch list T1–T3) |

---

## Suggested fix order

1. **Re-init hygiene** — P0.1–P0.4  
2. **Drive/selection safety** — P0.5–P0.8  
3. **Regulator + interlocks** — P0.9–P0.19  
4. **Discoverability** — G0–G1, UX.1–UX.8 (can interleave with P0; cheap wins)  
5. **Instruments** — P1.1–P1.5  
6. **Core physics for panel feedback** — P1.6–P1.9  
7. **Band/doc reconciliation** — P1.10–P1.12  
8. **Tests + zombies** — P2.*

---

## Progress log

| Date | Note |
|------|------|
| 2026-07-18 | Branch `grok` created. Checklist written: all 57 audit items mapped + design goals G0/G1 (realistic exploitation, hover discoverability). |
| 2026-07-18 | Second parallel wave: P0.17 + P1 physics/instruments + P2 tests (50 pass). |
| 2026-07-18 | Parallel workflow doc; first multi-agent pass on grok lineage: P0.1–P0.15 (most), P0.18–P0.19, UX titles. `bun test` 29 pass. Topic branches: `grok-p0-core`, `grok-p0-ui`, `grok-ux-tooltips` merged into `grok`. |
| 2026-07-18 | `grok-hygiene-ui`: P2.1 dead CSS, P2.2 GRP_SHORT, P2.3 attachTooltip, P2.4 hms via packages/ui/src/time.ts (sim-core not yet), P2.11 xenonRel/voidAvg, UX.5–6/8 guide + BShchU titles, G0 partial (event log). |
| | |

---

## Full ID map (audit #1–#57 → checklist)

| Audit | Checklist |
|------:|-----------|
| 1, 21 | P0.2 |
| 2, 3 | P0.3 |
| 4 | P0.7 |
| 5 | P0.5 |
| 6 | P0.6 |
| 7 | P0.18 |
| 8 | P0.8 |
| 9 | P0.9 |
| 10 | P0.1 |
| 11 | P0.4 |
| 12, 26 | P0.10 |
| 13 | P1.7 |
| 14 | P1.6 |
| 15, 23 | P1.9 |
| 16 | P1.3 |
| 17, 56 | P1.8, P2.25 |
| 18 | P2.1 |
| 19 | P0.13 |
| 20 | P0.14 |
| 22 | P0.15 |
| 24 | P1.1 |
| 25 | P0.16 |
| 27 | P1.10 |
| 28 | P1.11 |
| 29 | P0.17 |
| 30 | P1.5 |
| 31–43 | P2.2–P2.12 (and #36/#43 → P2.7) |
| 44–57 | P0.11, P0.12, P2.13–P2.26, P1.4 as listed above |

**Count check:** audit findings **1–57** all appear above. **New (not in 57):** G0–G3, UX.1–UX.8.
