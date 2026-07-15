# Audit backlog

Findings from the multi-agent deep audit (2026-07-15). Discovery done by six
specialist reviewers on Fable at maximum reasoning; each finding is being
adversarially re-verified by three Opus 4.8 skeptics (majority rules).


**57 findings** — status filled in as verification completes. Verdict column: `confirmed` (>=2/3 Opus skeptics agree it is real), `rejected`, or `pending`.


## Correctness bugs (12)


### 1. `packages/ui/src/main.ts:600` — All four strip-chart recorders freeze after 'start at power' / 'cold start' because nextSample is not reset when the reactor resets sim time to 0.
- **Verdict:** pending _(Fable pre-verdict: 3 confirm / 0 refute)_
- **Scenario:** initAtPower/initShutdown set state.time = 0 (reactor.ts:233, 280), but the module-level `nextSample` keeps its old value (last t + 0.5). Repro: run 10 min at 60x (t ~ 36000 s), click 'cold start' -> t restarts at 0, `t >= nextSample` stays false, so no samples are pushed to stripPower/stripPeriod/stripRho/stripXe until sim time again exceeds 36000 s (10 more wall-minutes at 60x, 10 hours at 1x). The recorders sit frozen on the previous run's trace during the whole startup, and the retained old samples make the time axis/hover tooltips show stale timestamps mixed with the new run.
- **Proposed fix:** In the init-power and init-shutdown click handlers (or inside snapDisplays), set nextSample = 0 and clear the four StripChart buffers (add a reset() that empties ts/vs).

### 2. `packages/ui/src/main.ts:683` — Annunciator lamp memory (lampT) is never reset on re-init, so after time resets to 0 the 'power interlock' and 'AR changeover' lamps light spuriously for hundreds of seconds.
- **Verdict:** pending _(Fable pre-verdict: 3 confirm / 0 refute)_
- **Scenario:** Lamps use `t - lampT.sil < 15`. Repro: trigger SIL_BLOK at t = 600 (step-out one 4-rod squad, immediately select the next squad and step-out while the first is still traveling plus the AR bank moving -> >= 8 rods withdrawing), then click 'start at power'. Sim time resets to 0, so t - 600 is negative and < 15 is true: the 'power interlock' alarm lamp burns continuously for the first 615 s of the fresh session with no event behind it. Same mechanic for an-chg after any AR changeover in the previous run.
- **Proposed fix:** Reset lampT.sil/chg/lar to -Infinity in both init click handlers, or change the guards to `t >= lampT.x && t - lampT.x < 15`.

### 3. `packages/ui/src/main.ts:685` — The 'LAR dropout' annunciator can never light on an actual dropout, and lights falsely after a cold start.
- **Verdict:** pending _(Fable pre-verdict: 3 confirm / 0 refute)_
- **Scenario:** Condition is `lampT.lar > 0 && !reactor.arEnabled`, but the dropout path (reactor.ts:528-543) keeps arEnabled = true - it auto-changes-over to AR mode. Repro: LAR mode at 30%, dial setpoint to 8%; when power sags below 9% the sim logs LAR_DROPOUT and flips to AR, yet the lamp stays dark because arEnabled is still true. Conversely, once any dropout has ever happened, clicking 'cold start' (which sets arEnabled = false, reactor.ts:270) lights the LAR-dropout ALARM at t = 0 of a fresh, never-dropped-out core, and it stays lit until AR is re-engaged.
- **Proposed fix:** Make it a hold-time lamp like the others: `setLamp("an-lar", t >= lampT.lar && t - lampT.lar < 15 ? "alarm" : "")`, and reset lampT on init.

### 4. `packages/ui/src/main.ts:413` — AZ-1 setback changes reactor.arSetpoint underneath the setpoint slider; the first accidental slider nudge silently cancels the protection setback.
- **Verdict:** pending _(Fable pre-verdict: 3 confirm / 0 refute)_
- **Scenario:** reactor.azSetback() clamps arSetpoint to <= 0.5 (reactor.ts:457) but the range input stays at its old position (e.g. 100). The text label shows the true 50% (frame loop, line 695), but the input element is desynced: touching the slider by one tick fires oninput and sets arSetpoint = 0.99, commanding a ramp straight back to full power right after a graduated-protection setback - the opposite of what the operator intended.
- **Proposed fix:** Resync the widget when the reactor changes the value: in the az1 click handler (and/or the 5 Hz block) set setpoint.value = String(Math.round(reactor.arSetpoint * 100)).

### 5. `packages/ui/src/main.ts:354` — lever() starts driving on ANY mouse button and only stops on the element's own mouseup/mouseleave, so rods can keep driving with no button held.
- **Verdict:** pending _(Fable pre-verdict: 3 confirm / 0 refute)_
- **Scenario:** Two repros: (a) right-click '▲▲ hold to withdraw' - mousedown (button 2) fires drive, the OS context menu swallows the mouseup and freezes event delivery, so the selected rods withdraw continuously at 0.4 m/s the whole time the menu is open (uncommanded reactivity insertion), stopping only when the pointer later leaves the button; (b) hold ▲▲, Cmd-Tab away with the pointer still over the button and release in the other app - neither mouseup nor mouseleave ever fires, and the rods drive to fully-withdrawn. Same for the per-row ▲/▼ levers created in rebuildSelRows.
- **Proposed fix:** In lever(): wrap drive as `(e) => { if (e.button === 0) drive(); }`, and register release on window 'mouseup' and window 'blur' (idempotent stop) in addition to the element's mouseup/mouseleave.

### 6. `packages/ui/src/main.ts:153` — Right-click on the cartogram leaves dragStart stuck: a phantom drag-rectangle follows the cursor, tooltips die, and the NEXT left-click anywhere performs an unintended rect-selection.
- **Verdict:** pending _(Fable pre-verdict: 3 confirm / 0 refute)_
- **Scenario:** The mousedown handler doesn't check e.button. Right-clicking the core map sets dragStart, then the browser context menu swallows the corresponding mouseup so the window mouseup handler never clears it. From then on the dashed selection rect is drawn from the stale anchor to every cursor position (lines 710-713), rod hover tooltips are suppressed (`rod && !dragStart`, line 188), and the next left-click release anywhere in the window executes rodsInRect(anchor, release) - silently replacing the operator's rod selection with whatever fell inside the phantom box.
- **Proposed fix:** Guard the handler with `if (e.button !== 0) return;` and also clear dragStart/dragNow on 'contextmenu' and window 'blur'.

### 7. `packages/ui/src/main.ts:391` — AR subgroup auto/manual switches (AR-1/2/3) go stale versus 'override auto'/'return to auto', and bypass reactor.setAutoControl so rods keep traveling to a stale regulator target.
- **Verdict:** pending _(Fable pre-verdict: 3 confirm / 0 refute)_
- **Scenario:** The ar-sw-N button classes are only toggled inside their own click handlers, but rod-override/rod-return (lines 366-367) flip the same rod.autoControlled flags underneath: select the AR bank, click 'override auto' - all 12 AR rods are now manual, yet all three subgroup switches still display 'auto'. Worse, the ar-sw handler mutates rod.autoControlled directly instead of calling reactor.setAutoControl, which snaps target = insertion on release (reactor.ts:403): switching a subgroup to manual while the regulator is driving it leaves the 4 rods still traveling to the last arTarget instead of freezing, an uncommanded rod motion after the operator took them manual.
- **Proposed fix:** Route the switch through reactor.setAutoControl(ids, nowAuto), and resync the three button classes from the rods' autoControlled flags in the 5 Hz instrument block (alongside the existing arToggle/arMode resync).

### 8. `packages/sim-core/src/reactor.ts:347` — Rods can be manually withdrawn while an AZ-5 scram is latched: setRodTarget has no scrammed guard and the UI drive panel stays fully live during 'SCRAMMED'.
- **Verdict:** pending
- **Scenario:** scram() sets rod targets to 1 once; nothing re-asserts them. Repro: at 100%, open the cover and press AZ-5; while the state tile reads SCRAMMED (latch not reset), select 5 RR rods and hold '▲▲ hold to withdraw' - driveSelected sets their targets to 0 and stepRodDrives pulls them back out at 0.4 m/s against the active scram. The real CPS forces drives in while the AZ-5 latch is set; here the latch only gates the AR and the resetScram bookkeeping.
- **Proposed fix:** In setRodTarget, refuse targets below current insertion while state.scrammed (log an RPS warn), or re-assert target = 1 for non-USP rods each substep while scrammed; optionally also disable the UI drive buttons when reactor.state.scrammed.

### 9. `packages/sim-core/src/reactor.ts:605` — The silovaya blokirovka interlock permanently prevents the LAR regulator from withdrawing rods, contradicting docs that LAR is the PRIMARY at-power regulator (10-100%).
- **Verdict:** pending
- **Scenario:** In LAR mode regulatorOwns() owns all 12 LAR rods and drives them to one shared arTarget (lines 567-569); the interlock check at line 605 then sees 12 rods with target < insertion whenever the regulator needs to add reactivity, and halts them every substep. Empirical run: initAtPower(1.0), arMode='LAR', arSetpoint=0.5, tick 2 h -> 20 SIL_BLOK alarms, LAR mean insertion RISES 0.50->0.63 (never withdraws), power collapses to 0 with the annunciator spamming 'power interlock: 12 rods withdrawing'. docs/physics.md line 65 and docs/research/controls.md say LAR is the primary regulator at power; here it can only ever insert. The real LAR was 12 independent zone regulators that would never gang-withdraw.
- **Proposed fix:** Exempt regulator-owned automatic movements from the >=8 count (count only operator-commanded withdrawals), or model the LAR zones as independently-timed servos so fewer than 8 move at once; at minimum count rods per command source.

### 10. `packages/sim-core/src/reactor.ts:199` — initAtPower never re-enables the AR that initShutdown disabled, so the UI's 'start at power' after a cold start hands the user an open-loop-unstable plant that auto-scrams within ~30 s.
- **Verdict:** pending
- **Scenario:** initShutdown() sets this.arEnabled = false (reactor.ts:270) but initAtPower() only sets arSetpoint/arSetpointActive and never touches arEnabled. Confirmed with a probe reproducing the UI flow (main.ts:458 'cold start' then main.ts:449 'start at power'): after initAtPower(1.0) arEnabled is still false, the positive-void plant drifts up with no regulator, and AZM scrams ('power above 110% rated') within the first 30 s of real-time ticking with zero operator action; power then collapses to 0.1%. The settle loop inside initAtPower also runs without the regulator in this state.
- **Proposed fix:** Set this.arEnabled = true at the top of initAtPower (it already presumes an engaged regulator by setting arSetpoint = fraction), or have the UI init-power handler re-enable it explicitly.

### 11. `packages/sim-core/src/reactor.ts:233` — Alarm cooldown timestamps and the period-alarm latch are not reset when init* rewinds s.time to 0, silently suppressing safety annunciations for up to the previous session's length.
- **Verdict:** pending
- **Scenario:** initAtPower/initShutdown reset s.time = 0 but leave lastSilBlokT, lastBandWarnT, lastBlockedWarnT, lastPeriodBlockWarnT, lastRodAutoWarnT, lastPeriodAlarmT and periodAlarmLatched at their old (large) values, so every `s.time - lastX > COOLDOWN` guard is false until sim time catches up. Confirmed by probe: trigger SIL_BLOK at t=301, re-init (time -> 0), trigger the same 10-rod withdrawal again — the interlock still silently halts the rods but the SIL_BLOK alarm is swallowed (log count stays 1 instead of 2). Same mechanism mutes RPS_BLOCKED warnings ('trip condition met - BLOCKED by operator') and the startup PERIOD_BLOCK message, so after a re-init rod-withdrawal commands are refused with no feedback at all.
- **Proposed fix:** Reset all last*T fields to -Infinity and periodAlarmLatched to false wherever s.time is rewound (a small resetAlarmState() helper called from both init paths).

### 12. `packages/sim-core/src/reactor.ts:578` — AR subgroup changeover round-robins forever (every 5 s) once all three subgroups saturate at the same end, flooding the log and never restoring regulation.
- **Verdict:** pending
- **Scenario:** The changeover picks `next = (active % 3) + 1` without checking whether the next subgroup has any authority in the needed direction. When xenon buildup drives all three AR banks fully withdrawn (demo Phase 2: hold at 50% while Xe rises to ~2x), each changeover sets arTarget to the next bank's insertion (also 0), the PI immediately re-saturates it, and 5 s later it changes over again. Measured in a demo run: 304 AR_CHANGEOVER warnings between t=220 s and t=13918 s, cycling AR-1->2->3->1 every ~5 s for hours. The real behavior being modeled is a one-time handover to a standby group; with no group having authority the real panel raises a persistent out-of-authority annunciation, it does not cycle.
- **Proposed fix:** Before changing over, check the candidate subgroup has usable travel in the required direction (its mean insertion differs from the saturated end by some margin); if no subgroup qualifies, latch a single 'AR out of authority - release with manual rods' alarm (with ALARM_COOLDOWN) and stop cycling until a bank regains margin.

## Physics (3)


### 13. `packages/sim-core/src/thermal.ts:66` — Quality clamp Math.min(1, ...) silently discards enthalpy above saturated vapor and holds coolantTemp at T_SAT, under-predicting fuel temperature and Doppler feedback exactly in the severe low-flow/overpower regime.
- **Verdict:** pending
- **Scenario:** With the UI flow slider at its 30% minimum and the void-runaway scenario (probe: initAtPower(1.0), AR off, protections blocked, flow 0.3 settles at ~350% rated), node exit enthalpy reaches ~4e6 J/kg while h_g = H_F + H_FG = 2.77e6 J/kg: the upper half of the core is past dryout, but the model caps quality at 1, keeps coolantTemp = 285.8 C, and the excess energy simply vanishes from the enthalpy march. Fuel then keeps being cooled by FUEL_UA against a 286 C sink, so fuel temperature (and the stabilizing Doppler that terminated the probe transient at 3.5x rated) is overestimated in cooling capacity / under-predicted in temperature precisely during the accidents the sim is built to explore. Not listed under docs/physics.md 'Known simplifications' (which covers decay heat, radial dimension, xenon estimate, ORM).
- **Proposed fix:** Add a superheat branch: for hMid > H_F + H_FG set quality = 1 and coolantTemp = T_SAT + (hMid - H_F - H_FG)/CP_STEAM (with a degraded post-dryout FUEL_UA if desired), or at minimum document the cap as a known simplification.

### 14. `packages/sim-core/src/thermal.ts:57` — Coolant enthalpy march is fed instantaneous fission power while the fuel/graphite UA heat transfer is generated and then discarded, so transient energy is not conserved and the void feedback path has no fuel time constant.
- **Verdict:** pending
- **Scenario:** stepThermal charges the coolant with `power/flow` (raw node thermal power) and SEPARATELY integrates fuel/graphite temperatures whose FUEL_UA*(Tf-Tc)+GRAPHITE_UA*(Tg-Tc) heat flow never enters the enthalpy march. Measured: at steady 100% the UA flow to coolant is 3200 MW (equal to thermal power, so steady state is coincidentally right), but 2 s after AZ-5 the fuel+graphite are still shedding 2812 MW that simply vanishes while the coolant sees only 1139 MW; top-node quality collapses 0.105 -> 0.002 in 2 s and void 0.46 -> 0.17 by 5 s. Physically the ~1.4e10 J stored in fuel (tau ~5 s) keeps channels boiling for ~10+ s after scram, so the post-scram void-reactivity ramp is far too fast. Conversely during a power excursion (void.test scenario) void follows neutron power with only the 3 s TAU_VOID lag instead of lagging behind the ~5 s fuel-to-coolant time constant, making the positive void feedback loop unphysically fast. Not listed in docs/physics.md 'Known simplifications'.
- **Proposed fix:** Heat the coolant with what actually crosses the cladding: q_node = FUEL_UA*(Tf-Tc) + GRAPHITE_UA*(Tg-Tc) + f_direct*power (small ~3-5% direct gamma/neutron deposition), i.e. hMid/h march on q_node instead of `power`. Use previous-substep temperatures in the march (stable at dt<=0.1 s given 5 s/1.6 h time constants). Steady state and rhoBase calibration are unchanged since UA flow equals node power at equilibrium.

### 15. `packages/sim-core/src/rods.ts:97` — USP rods drive 2.3x too slowly: stepRodDrives converts 0.4 m/s to insertion-fraction using CORE_HEIGHT (7 m) for every group, but USP insertion spans only USP_ABS_LENGTH (3.05 m).
- **Verdict:** pending
- **Scenario:** `maxStep = (speed*dt)/CORE_HEIGHT` treats one unit of insertion as 7 m of travel for all rods, but absorberInterval maps USP insertion 0..1 to 0..3.05 m of bottom-entry absorber. Measured: setRodTarget('USP', 1) from 0 completes in 18.0 s, an effective tip speed of 0.169 m/s, whereas docs/physics.md cites 0.4 m/s for all drives (TEZ L.24) which should give ~7.6 s. Consequence: USP reactivity-insertion rate from below (bottom-field trimming, and any post-1986-style scenario where USP motion matters) is 2.3x too slow relative to every other rod group.
- **Proposed fix:** Scale the drive step by the group's actual stroke: `const stroke = rod.group === "USP" ? USP_ABS_LENGTH : CORE_HEIGHT; const maxStep = (speed * dt) / stroke;` (import USP_ABS_LENGTH is already available in rods.ts).

## Numerics (2)


### 16. `packages/ui/src/main.ts:569` — Instrument damping uses wall-clock dt, so at 10x/60x the recorders and period/power meters lag by up to 30 s of SIM time while the 'period <60 s' lamp uses the raw value.
- **Verdict:** pending
- **Scenario:** smooth() uses a = wallDt/0.5, i.e. a 0.5 s wall time constant = 30 s of sim time at 60x. The strip charts sample `disp.*` on a sim-time cadence (every 0.5 sim-seconds, line 603), so the SAME physical transient is recorded with a 60x-heavier low-pass at 60x speed - a genuine 15 s startup period can plot far above the drawn 'AZS trip 10 s' line. Meanwhile the an-period annunciator (line 682) uses raw reactor.period(): at 60x the lamp lights while i-period still reads hundreds of seconds, contradicting the meter next to it.
- **Proposed fix:** Smooth with sim dt (a = Math.min(1, simDt / tau), tau in sim-seconds) or push unsmoothed reactor values to the StripCharts; keep wall-time damping only for the on-screen numeric flicker if desired.

### 17. `packages/sim-core/src/kinetics.ts:90` — Backward-Euler tridiagonal flux solve has an amplification pole at dt*lambda_max = 1; at the fast-forward step dt=0.1 the pole sits at node rho ~ 3.0 beta, with unguarded blow-up, sign-flipped solutions, and zero-clamped nodes beyond it.
- **Verdict:** pending
- **Scenario:** Derived bound: (I - dt*A) with A = diag((rho_k-beta)/L) + w*Lap loses its M-matrix/positivity property when dt*(rho_k-beta)/GEN_TIME >= 1, i.e. rho_k >= BETA_EFF + GEN_TIME/dt = 0.00979 (1.96 beta) at dt=0.1, and its fundamental-mode eigenvalue crosses zero at rho = BETA_EFF + GEN_TIME*(1/dt + w*mu1), mu1 = 2-2cos(pi/15), = 0.01503 (3.01 beta) at dt=0.1 (11.6 beta at dt=0.01, so only the fast-forward path is exposed; UI 10x/60x speeds pass maxStep=0.1 at main.ts:604). Empirically confirmed with a Bun probe: at uniform rho=0.014 (2.8 beta), 1 s of dt=0.1 over-predicts growth 1.3e7 vs true 7.4e3; at rho=0.015 power explodes ~1e10 per 5 steps regardless of physics (reaches 4.9e129 in 6 s, and Infinity->NaN if sustained); at rho=0.016-0.025 (up to 5 beta) the solution sign-flips, the Math.max(0,f) clamps zero out boundary nodes (flux profile becomes asymmetric with nodes 12-13 exactly 0), and growth is UNDER-predicted by 11 orders of magnitude (2.5e2 vs 5.1e13 at 5 beta). Reachable in-sim: initAtPower(0.2), setFlowFraction(0), protections blocked (an intended operator feature) produces sustained local node rho of 3.8-4.3 beta; the flow-loss-at-full-power scenario reaches 3.56 beta. So precisely the Chernobyl-style excursions the simulator exists to model produce silent numerical garbage when run at 10x/60x.
- **Proposed fix:** In Reactor.substep (or stepKinetics), limit the effective kinetics substep so dt*max_k((rho_k - BETA_EFF)/GEN_TIME) stays below ~0.5 (subdivide the step when max rho is high — cheap: rhoByNode is already computed); optionally assert/log if any Thomas pivot m or diag goes non-positive.

## UI logic (4)


### 18. `packages/ui/index.html:20` — Dead CSS/markup: custom properties --serious and --grid are never used, and class="strip" has no CSS rule or JS selector.
- **Verdict:** pending _(Fable pre-verdict: 0 confirm / 3 refute)_
- **Scenario:** grep shows no `var(--serious)` or `var(--grid)` anywhere (index.html or src/*.ts); the strip charts hardcode the grid color "#2c2c2a" (strips.ts:93) instead of the token, so a theme retune via :root variables would restyle the panels but leave chart gridlines at the old color. The `strip` class on the four footer canvases (index.html:373-376) matches no stylesheet rule and no querySelector. Decorative ids #instruments, #map-legend, #checklist, #desk-plant, #desk-auto, #desk-protection are likewise referenced by no CSS selector and no JS.
- **Proposed fix:** Delete --serious, the strip class, and the unreferenced ids (or start honoring them); either remove --grid or have StripChart take its grid color from the CSS token so the variable is real.

### 19. `packages/ui/src/main.ts:342` — 5-rod withdrawal restriction is off by one: withdrawal is allowed with 5 non-AZ rods selected, but both docs say it is refused at >=5 selected (max 4).
- **Verdict:** pending
- **Scenario:** driveSelected checks `nonAz > 5`, refusing only at 6+. docs/physics.md line 64: '>=5 rods selected: withdrawal refused'; docs/research/controls.md: 'Withdrawal restriction when >=5 rods selected'; CLAUDE.md: 'the real limit was ~4 rods at once'. Select 5 RR rods and hold the out lever: the sim withdraws all 5 (~5 x 0.73 beta of stroke authority) where the real panel would refuse, and the warning text 'max 5 for withdrawal' encodes the same off-by-one.
- **Proposed fix:** Change the condition to `nonAz >= 5` and the message to 'max 4 for withdrawal' (matching the docs), or update both docs if the intent is a 5-rod maximum - currently code and docs disagree.

### 20. `packages/sim-core/src/reactor.ts:612` — SIL_BLOK alarm text claims 'selection cleared' but nothing clears the operator's rod selection, contradicting the documented interlock behavior.
- **Verdict:** pending
- **Scenario:** controls.md: silovaya blokirovka 'clears selection, annunciates'; docs/physics.md line 64 repeats it. The reactor only sets target=insertion and logs; the UI handler for SIL_BLOK (main.ts line 130) merely lights a lamp - the `selected` set survives, so the operator can instantly re-command the same 8+ rods with one keypress, defeating the interlock's purpose, while the log asserts the selection was cleared.
- **Proposed fix:** Have the UI clear `selected` (and rebuild the servo rows) when a SIL_BLOK event arrives, or drop 'selection cleared' from the reactor's message since sim-core cannot clear UI selection.

### 21. `packages/ui/src/main.ts:568` — Strip-chart sampling clock (nextSample) is never reset on re-init, so after clicking 'cold start' or 'start at power' all four strip charts freeze for as long as the previous session ran.
- **Verdict:** pending
- **Scenario:** nextSample is module-level and only advances (nextSample = t + 0.5 at main.ts:616). Reactor.initAtPower/initShutdown rewind reactor.state.time to 0, so after any re-init the guard `if (t >= nextSample)` at main.ts:609 stays false until sim time re-reaches the pre-init clock. Concrete: play 10 minutes at 1x (t=600), click 'cold start' — power/period/rho/Xe recorders record nothing for the next 600 sim-seconds (hours of wall time during a slow startup), exactly when the user wants to watch the 1/M approach.
- **Proposed fix:** Reset nextSample = 0 (and clear or restart the StripChart buffers, which otherwise contain samples with future timestamps) in the init-power and init-shutdown click handlers, e.g. inside snapDisplays().

## Realism vs. research (9)


### 22. `packages/sim-core/src/reactor.ts:370` — The startup 60-s period rule only refuses NEW withdrawal commands; rods already commanded out keep withdrawing indefinitely after the period collapses.
- **Verdict:** pending
- **Scenario:** docs/physics.md line 67 and controls.md ('stop withdrawal if any instrument shows period <60 s') describe an interlock that STOPS withdrawal. The check lives only in setRodTarget; the UI lever sets target=0 on mousedown, so a held withdrawal continues regardless of period. Empirical: initAtPower(0.001), arEnabled=false, command 7 RR to 0 while period is infinite -> period drops below 60 s at t=2.3 s with all 7 rods still withdrawing; they complete full travel and power rises 0.1%->3.3% with no halt and no trip.
- **Proposed fix:** Enforce the rule continuously in substep(): while powerFraction < 0.05 and 0 < period < 60, set target = insertion for every rod with target < insertion (and log the block once).

### 23. `packages/sim-core/src/rods.ts:97` — USP rods physically move at ~0.17 m/s instead of the specified 0.4 m/s because stepRodDrives normalizes every rod's speed by the 7 m core height.
- **Verdict:** pending
- **Scenario:** maxStep = (speed*dt)/CORE_HEIGHT for all groups, but a USP insertion fraction of 1.0 corresponds to only 3.05 m of absorber travel (stroke 3500 mm per controls.md). Empirical: commanding a USP rod from 0 to 1 takes 17.6 s of sim time, i.e. 3.05 m / 17.6 s = 0.173 m/s, versus the TEZ L.24 spec of 0.4+-0.1 m/s (~7.6-8.75 s). Axial-field trimming with USP is more than twice too sluggish.
- **Proposed fix:** Normalize by the per-group stroke: for USP use maxStep = (speed*dt)/USP_STROKE (3.5 m, or USP_ABS_LENGTH if insertion maps to absorber-in-core), keeping CORE_HEIGHT for standard rods.

### 24. `packages/sim-core/src/reactor.ts:714` — PRIZMA printout labels a raw insertion sum (including AZ and USP at full weight) as 'equivalent rods' and compares it to the real 15-rod administrative floor, so the ORM warning never fires even in accident-like configurations.
- **Verdict:** pending
- **Scenario:** ormRods() (line 474) sums insertion over all 211 rods. At nominal 100% power it prints 'ORM 90.8 equivalent rods' (real full-power ORM was ~26-30); after AZ-5 it reads 185. In an accident-like config (RR mean ~0.07, AR/LAR ~0.1, default USP 0.2) the sum is ~18 > 15, so the one condition the floor exists to catch (real ORM = 8 rods on the accident night) produces no warning. docs/physics.md 'Known simplifications' admits ORM 'is not yet computed as equivalent rods', yet the log message and ORM_MIN_RODS comparison present it as if it were - code and doc directly disagree, and the alarm threshold is on the wrong scale. USP full insertion also counts as 1.0 rods despite covering only 3.05 m of the 7 m core and not being AZ-5-droppable.
- **Proposed fix:** Either compute ORM in worth units (sum rodWorthBeta-style per-rod worths of the movable complement, divided by an average full-rod worth) before comparing to 15, or stop labeling the sum 'equivalent rods' and scale ORM_MIN_RODS to the crude metric (calibrate what the sum reads at the documented 26/15/8-rod operating points).

### 25. `packages/sim-core/src/reactor.ts:696` — AZS period trip carries an undocumented power floor (power > 0.5%), disabling period protection in exactly the startup range where it matters; docs state the 10 s trip with no power qualifier.
- **Verdict:** pending
- **Scenario:** docs/physics.md line 67 ('AZ-5 trip floor 10 s') and line 62 ('AZS (period < 10 s)') give no power floor, and controls.md places period protection (AZSP/AZSR, setpoint >=5 s) in the startup regime. Code requires power > 0.005. Empirical: at 0.1% power with a +0.8 beta step, period < 10 s is reached at power 0.28% but the scram waits until power crosses 0.526% - power doubles before protection acts; any excursion that turns over below 0.5% never trips at all, leaving only the (command-time-only) 60 s block below that level.
- **Proposed fix:** Remove or greatly lower the power floor (e.g. gate on flux above the source level ~1e-4 rather than 0.5%), or document the floor and its rationale in docs/physics.md if it is intentional.

### 26. `packages/sim-core/src/reactor.ts:578` — AR subgroup changeover round-robins forever among all-saturated subgroups, emitting ~1000 AR_CHANGEOVER warnings in 2 hours instead of a single standby handover plus an out-of-authority state.
- **Verdict:** pending
- **Scenario:** When all three AR subgroups are exhausted at the same end (e.g. all withdrawn compensating a xenon build), each changeover resets arTarget to the new bank's mean (also 0), which is still saturated, so 5 s later it hands over again: initAtPower(1.0), arSetpoint=0.5, tick 2 h -> 987 AR_CHANGEOVER warnings (1180 in LAR mode after dropout). docs/physics.md line 60 describes changeover as a standby group taking over on saturation - a one-shot redundancy action, not a 7-second oscillation that floods the event log and annunciator.
- **Proposed fix:** Track how many consecutive changeovers happened without the new bank leaving saturation; after one full cycle (3 groups), stop rotating and latch a distinct 'AR out of authority - release with manual rods' alarm until the bank regains range.

### 27. `packages/sim-core/src/reactor.ts:680` — Period warning annunciates at 20 s, but the research doc gives the AZSR warning setpoint as 15 s.
- **Verdict:** pending
- **Scenario:** docs/research/controls.md Interlocks: 'Period: emergency setpoint >=5 s, warning >=15 s (AZSP/AZSR)'. checkAlarms raises the PERIOD alarm at period < 20 s (latch clears above 30 s). A startup transient holding a steady 17 s period lights the warning in the sim but would not on the documented panel; neither physics.md nor the code comments record 20 s as a deliberate choice the way the 10 s trip choice is recorded.
- **Proposed fix:** Change the warning threshold to 15 s (clear above ~20-25 s), or add a row to docs/physics.md documenting 20 s as an ESTIMATED display threshold and why it departs from the cited 15 s.

### 28. `packages/sim-core/src/reactor.ts:427` — LAR band modeled as 10-100% while the newer controls research says LAR is primary in 20-100% (with LAR-BIK hot standby 5-100%); the two docs contradict each other and the conflict is nowhere acknowledged.
- **Verdict:** pending
- **Scenario:** regulatorBand() returns [0.1, 1.0] for LAR, matching docs/physics.md line 65 ('LAR 10-100%'), but docs/research/controls.md (dated one day later) says 'LAR 20-100% PRIMARY in the main band' and 'LAR-LAZ INOPERABLE below ~10-20%'. A player running LAR at 15% power gets normal regulation in the sim, where per the research the primary LAR band has not yet been entered; the dropout alarm also fires at 9% instead of up to ~20%. Unlike the rod-complement question, this doc conflict has no 'unreconciled' note.
- **Proposed fix:** Reconcile the two docs (pick 10% or 20% with a source note in physics.md), adjust regulatorBand()/the dropout threshold to match, or add an explicit 'spread 10-20%, we use 10%' flag like the period-trip entry has.

### 29. `packages/sim-core/src/reactor.ts:347` — Rule 3.1.7 interlock (no rod withdrawal unless the AZ emergency bank is cocked/withdrawn) is not modeled, so the core can be taken critical with zero fast scram reserve.
- **Verdict:** pending
- **Scenario:** docs/research/controls.md Interlocks: 'No positive reactivity insertion unless AZ rods cocked/armed (rule 3.1.7)', and it is not listed in the doc's fidelity punch list or CLAUDE.md roadmap as deferred. From initShutdown() a player can skip withdrawing the AZ bank (checklist step 2 is advisory only) and pull RR squads straight to criticality; setRodTarget imposes no AZ-cocked precondition. AZ-5 then has almost no fast negative reactivity to insert (the 24 AZ rods are already in), exactly the condition the real interlock exists to prevent.
- **Proposed fix:** In setRodTarget, refuse withdrawal commands (with a logged warning) while the AZ bank is not near fully withdrawn (e.g. any AZ rod insertion > 0.05), exempting AZ rods themselves so the bank can be cocked first.

### 30. `scripts/demo.ts:85` — Comment claim that moving the whole 131-rod RR bank at drive speed is '~5 beta/s' is ~7x higher than what the code actually produces (~0.5-0.7 beta/s).
- **Verdict:** pending
- **Scenario:** demo.ts's operator docstring (and CLAUDE.md 'moving the whole RR bank at once is ~5 beta/s') states ~5 beta/s. Measured against the code: with the reactor initialized at 100% (RR at 0.45 insertion) and all 131 RR rods moving at 0.4 m/s, the flux-squared-weighted global reactivity rate is -0.69 beta/s inserting and +0.49 beta/s withdrawing. The qualitative claim (it trips the plant) still holds via AZS/AZM, but the number documented as a physics fact is off by ~7x; either the comment is wrong or ROD_ABS_WORTH_PER_M (5.2e-4/m, ESTIMATED, ~26 pcm per fully inserted rod vs the cited ~40 pcm anchor) is undersized relative to the intent.
- **Proposed fix:** Re-measure and correct the figure in the demo.ts docstring and CLAUDE.md to ~0.5-0.7 beta/s (or, if 5 beta/s is the intended fidelity target, revisit ROD_ABS_WORTH_PER_M upward and re-run the scram-worth/tip-effect tuning).

## Dead code / zombies (13)


### 31. `packages/ui/src/main.ts:248` — GRP_SHORT is an identity map — every key maps to itself, so the lookup is pure redundancy.
- **Verdict:** pending _(Fable pre-verdict: 0 confirm / 3 refute)_
- **Scenario:** GRP_SHORT maps RR->"RR", AR->"AR", LAR->"LAR", AZ->"AZ", USP->"USP"; the only use is `GRP_SHORT[rod.group]` in rebuildSelRows (line 268), which always equals `rod.group`. A future 6th group (e.g. a post-1986 rod class) silently renders as `undefined` in the selsyn row because the map won't have the key, whereas `rod.group` never can.
- **Proposed fix:** Delete GRP_SHORT and use `rod.group` directly in the row template.

### 32. `packages/ui/src/main.ts:47` — Tooltip show/hide wiring is copy-pasted three times (channelmap, slice, cartogram canvases).
- **Verdict:** pending _(Fable pre-verdict: 0 confirm / 3 refute)_
- **Scenario:** Lines 47-59 (fieldCanvas), 62-74 (sliceCanvas) and 186-202 (mapCanvas) each hand-roll the same mousemove/mouseleave pattern: position #tooltip at clientX+14/clientY+14, set textContent from a hit() label, hide on miss/leave. The third copy already diverged (it adds a `!dragStart` guard and worth suffix the others lack); the next tooltip tweak (e.g. clamping to the viewport edge) will be applied to one copy and missed in the other two, giving inconsistent tooltip behavior per panel.
- **Proposed fix:** Extract one helper `attachTooltip(canvas: HTMLCanvasElement, label: (e: MouseEvent) => string | null)` that wires mousemove/mouseleave and positions #tooltip, and call it three times with panel-specific label closures.

### 33. `scripts/demo.ts:34` — hms() is implemented twice: demo.ts redefines the exact function exported from packages/ui/src/strips.ts.
- **Verdict:** pending _(Fable pre-verdict: 0 confirm / 3 refute)_
- **Scenario:** strips.ts:207 exports hms() and demo.ts:34 duplicates it character-for-character. demo.ts can't import from the UI package (and sim-core is where shared framework-free helpers belong), so any format change (e.g. adding days for multi-day xenon runs) made in one place leaves JSONL console stamps and UI strip-chart stamps disagreeing for the same sim time.
- **Proposed fix:** Move hms() into packages/sim-core (it is pure and framework-free, e.g. next to logger.ts), re-export from index.ts, and import it in both strips.ts and demo.ts.

### 34. `packages/sim-core/src/reactor.ts:68` — Private field lastRhoByNode is written every substep but never read — a write-only zombie in the hot loop.
- **Verdict:** pending _(Fable pre-verdict: 1 confirm / 2 refute)_
- **Scenario:** Declared at reactor.ts:68 and assigned at reactor.ts:625 (`this.lastRhoByNode = rhoByNode`), it appears nowhere else in packages/ or scripts/. At the default 10 ms substep that is 100 dead stores/s, and a reader debugging reactivity naturally assumes some instrument (reactimeter, slice view) consumes the per-node rho when in fact rodWorthBeta/feedbackRhoByNode recompute from scratch — misleading during any future per-node-rho UI work.
- **Proposed fix:** Delete the field and the assignment, or expose it via a public accessor (e.g. `rhoByNode(): readonly number[]`) if the axial-rho display planned for the slice panel wants it.

### 35. `packages/sim-core/src/types.ts:108` — assertNodeCount() is exported from the package API but referenced nowhere — not by sim-core, UI, demo, or tests.
- **Verdict:** pending _(Fable pre-verdict: 0 confirm / 3 refute)_
- **Scenario:** grep across packages/ and scripts/ finds only the definition. The invariant it guards (nodes.length === N_AXIAL) is never actually checked anywhere: a caller constructing a Reactor-like state with the wrong node count today fails with an opaque `nodes[k]!` undefined-property crash inside stepKinetics rather than this intended clear error, so the function provides zero protection while sitting in the public API.
- **Proposed fix:** Either delete it, or actually call it at the top of stepKinetics/stepThermal (where the length-N_AXIAL assumption is load-bearing) so the export earns its keep.

### 36. `packages/sim-core/src/types.ts:78` — CoreState.rhoExtra is a knob that is read every substep but can never become non-zero: no setter, no writer anywhere.
- **Verdict:** pending _(Fable pre-verdict: 1 confirm / 2 refute)_
- **Scenario:** It is initialized to 0 in the Reactor constructor (reactor.ts:135) and added into rhoByNode each substep (reactor.ts:623); no code in packages/, scripts/, or tests ever assigns it. Documented as "boron, fresh fuel etc." but there is no Reactor method, UI control, or demo path to it, and critically calibrateCritical() ignores it (growthFor uses rhoBase + rods + feedback only) — so if someone does set state.rhoExtra before initAtPower, calibration silently mis-converges and the reactor initializes off-critical.
- **Proposed fix:** Either remove rhoExtra until a boron/fuel model exists, or include it in calibrateCritical's trial rho and add a Reactor setter plus a test so the knob is real.

### 37. `packages/sim-core/src/reactor.ts:489` — RodSelector variants "all", "AR1", "AR2", "AR3" and their rodsFor() branches are dead: no caller in UI, demo, or tests ever uses them.
- **Verdict:** pending
- **Scenario:** Every call site passes a rod id or a plain group name ("RR", "AZ"). The AR1-3 parsing branch (reactor.ts:489-494) and the "all" branch (reactor.ts:484) are unexercised, untested API surface; notably `setRodTarget("AR1", ...)` would drive regulator-owned rods without the ROD_AUTO refusal (that guard only fires for `typeof selector === "number"`, reactor.ts:351), so the first future caller of the subgroup selector silently bypasses the interlock the single-rod path enforces.
- **Proposed fix:** Either drop the unused selector variants from RodSelector and rodsFor, or keep them and extend the autoControlled refusal to non-numeric selectors plus a cps.test.ts case covering "AR1" and "all".

### 38. `packages/sim-core/src/reactor.ts:855` — resetIpk() and the IPK tracker in substep() duplicate the equilibrium/semi-implicit precursor formulas already in kinetics.ts.
- **Verdict:** pending _(Fable pre-verdict: 0 confirm / 3 refute)_
- **Scenario:** resetIpk (reactor.ts:857-865) re-states equilibriumPrecursors' formula beta*n/(GEN_TIME*lambda) for 6 delayed + 2 photo groups, and the reactimeter update (reactor.ts:654-667) re-states stepKinetics' semi-implicit update (c + dt*beta*n/L)/(1 + dt*lambda) — four copies of the same two formulas across two modules. If BETA/lambda handling changes (e.g. adding a 7th group or switching the implicit form), the core and the instrument integrate different equations and the reactimeter stops reading exactly 0 at steady criticality, which startup.test.ts and the UI rho display rely on.
- **Proposed fix:** Extract shared helpers in kinetics.ts, e.g. `equilibriumPrecursor(beta, lambda, n)` and `stepPrecursor(c, beta, lambda, n, dt)`, and use them from both stepKinetics/equilibriumPrecursors and the Reactor IPK code.

### 39. `packages/sim-core/src/isotopes.ts:88` — thermalPower() recomputes DECAY_HEAT_FRACTIONS.reduce(...) on every call instead of using the exported DECAY_FRACTION_TOTAL constant.
- **Verdict:** pending _(Fable pre-verdict: 0 confirm / 3 refute)_
- **Scenario:** constants.ts:219 already defines DECAY_FRACTION_TOTAL as exactly this reduce; reactor.ts uses the constant (nodePowers, line 765) while thermalPower re-derives it inline at 100 Hz in the tick loop and again via thermalPowerW for the UI. If someone tunes the fractions to a 4-group ANS-5.1 fit (flagged PRELIMINARY) but edits only one of the two expressions' surroundings, prompt-share bookkeeping in nodePowers and total power in thermalPower disagree and thermal power silently stops summing to fission power at equilibrium.
- **Proposed fix:** Import DECAY_FRACTION_TOTAL in isotopes.ts and use it in thermalPower (constants.ts's definition stays the single source).

### 40. `packages/ui/src/main.ts:437` — Core-average xenon and void computations are duplicated between snapDisplays() and smooth() (and a third time in demo.ts).
- **Verdict:** pending _(Fable pre-verdict: 0 confirm / 3 refute)_
- **Scenario:** main.ts:439-443 and main.ts:581-586 both compute `nodes.reduce((a,n)=>a+n.xenon,0)/N_AXIAL/XE_EQ` and the void average; demo.ts:56-58 repeats them. A change in the display normalization (e.g. flux-weighting the xenon average, which is the physically right instrument reading) applied to smooth() but not snapDisplays() makes the readouts jump visibly on every 'start at power'/'cold start' click as the snap seeds a different value than the ongoing smoothing tracks.
- **Proposed fix:** Add small helpers (e.g. `xenonRel()` and `voidAvg()` next to XE_EQ, or a sim-core `coreAverages(nodes)`) and call them from snapDisplays, smooth, and demo.ts's sample().

### 41. `packages/sim-core/src/constants.ts:174` — Exported constant PRESSURE is referenced nowhere in packages/ or scripts/.
- **Verdict:** pending _(Fable pre-verdict: 0 confirm / 3 refute)_
- **Scenario:** Every other constant in the file is consumed by some module; PRESSURE (7.0 MPa) is only implied by the saturated-property constants (T_SAT, H_F, H_FG, RHO_F, RHO_G) that were evaluated at 7 MPa. Because nothing reads it, changing PRESSURE does nothing — a future hydraulics contributor 'lowering pressure' by editing it gets zero physical effect while the saturation constants silently stay at 7 MPa.
- **Proposed fix:** Either demote it to a doc comment on the saturation-property block ("all evaluated at 7.0 MPa"), or keep the export but make the saturation properties explicitly documented as functions of it when sim-plant arrives.

### 42. `packages/ui/src/channelmap.ts:127` — The channel-field 'temp' view never displays temperature: avgFuel is computed and unused, and the temp branch renders the identical normalized power field in amber.
- **Verdict:** pending
- **Scenario:** draw() computes avgFuel (lines 127-128) but no code reads it; the view === 'temp' branch colors cells by the same rel/maxRel as the power view, only in a different hue and without flicker. Repro: scram from 100% and wait - fuel temperatures decay and flatten toward decay-heat shapes, or halve pump flow - the 'temp' view never changes relative to the 'power' view. The legend explicitly advertises 'fuel temp', so the toggle misleads the operator.
- **Proposed fix:** Either derive a per-channel temperature estimate (e.g. map rel power through the axial fuel/coolant temps that update() already receives) and normalize against a fixed temperature scale, or delete avgFuel and the toggle until real per-channel temperatures exist.

### 43. `packages/sim-core/src/reactor.ts:306` — calibrateCritical omits state.rhoExtra from the trial reactivity, so any embedding code using the rhoExtra hook gets a calibration that is off by exactly rhoExtra; the field is otherwise written nowhere.
- **Verdict:** pending
- **Scenario:** substep() applies rho = rhoBase + rhoExtra + rods + feedback (reactor.ts:623) but growthFor() in calibrateCritical builds rho = rhoBase + rods + frozenFeedback only. Probe: initAtPower(0.5), set state.rhoExtra = 0.002 (+0.4 beta), call calibrateCritical(), AR off — the 'calibrated critical' core is actually +0.4 beta supercritical, runs away and AZM-scrams within 20 s. rhoExtra is never assigned outside the constructor anywhere in the repo, so today it is a public trap: the one obvious use (perturbation experiments followed by recalibration) is exactly the case that breaks.
- **Proposed fix:** Include s.rhoExtra in growthFor's rho array (rhoBase + s.rhoExtra + r + frozenFeedback[k]), or delete the field if it is not meant as a public hook.

## Test coverage gaps (14)


### 44. `packages/sim-core/src/reactor.ts:465` — resetScram has zero test coverage, hiding a confirmed post-reset failure: the AR autonomously withdraws all 12 AR rods from a scrammed core in a changeover storm.
- **Verdict:** pending
- **Scenario:** Empirically verified: initAtPower(1.0); scram(); tick(120); resetScram(); tick(300) leaves ALL 12 AR rods (all 3 subgroups) at insertion 0.00 with no operator command, plus 24 AR_CHANGEOVER alarms and a SIL_BLOK in 2 minutes. Cause: resetScram clears the latch but arSetpoint is still 1.0 and arSetpointActive ~1.0, so the PI winds arTarget to 0, saturates, and the 5 s changeover timer cycles 1->2->3->1 pulling each bank out in turn. No test touches resetScram, so both this behavior and any fix to it are unpinned - a refactor of the changeover or setpoint logic can change what happens after every scram recovery and all 24 tests stay green.
- **Proposed fix:** Add cps test 'scram reset does not move rods by itself': scram at 100%, tick 120 s, resetScram(), tick 120 s (maxStep 0.05); assert state.scrammed===false, every rod's insertion within 0.02 of its post-scram value (AR banks included), log contains no AR_CHANGEOVER after the reset timestamp, and reactivityBeta() stays < -5. Then decide the intended contract (e.g. resetScram zeroes arSetpoint/arSetpointActive) and assert it.

### 45. `packages/sim-core/src/reactor.ts:828` — reactivityBeta() (the IPK reactimeter) has no test at all despite being the primary instrument in the UI and demo JSONL.
- **Verdict:** pending
- **Scenario:** The whole inverse-point-kinetics block (ipkC/ipkPhoto trackers at substep lines 653-672, resetIpk seeding at 855-866) is asserted nowhere. A sign flip in lastRhoIpk, a GEN_TIME/NEUTRON_SOURCE change, or breaking the resetIpk equilibrium seeding after init would make the panel rho meter read garbage (e.g. +2 beta at steady criticality) with all 24 tests green. Measured good values to pin: -0.0001 beta at steady full power, -8.9 beta 60 s post-scram, -5.4 beta at initShutdown.
- **Proposed fix:** New reactimeter.test.ts: (1) initAtPower(1.0), tick(30) -> |reactivityBeta()| < 0.05; (2) scram, tick(60, 0.05) -> reactivityBeta() < -5 and finite; (3) initShutdown() -> reading in (-10, -2) and consistent with startup.test's 'subcritical at source level'; (4) withdraw AZ bank from shutdown, tick 90 s -> reading rises monotonically toward 0 but stays < 0 while powerFraction < 1e-3 (1/M consistency).

### 46. `packages/sim-core/src/reactor.ts:351` — setRodTarget group selectors ('AR1'..'AR3', 'AR', 'LAR', 'all') bypass the regulator-ownership refusal that cps.test only verifies for numeric ids.
- **Verdict:** pending
- **Scenario:** Confirmed: setRodTarget('AR1', 0) while AR-1 is the active regulator bank sets all 4 targets to 0 with NO ROD_AUTO warning, because the guard at line 351 requires typeof selector === 'number'. The existing test ('manual command to a regulator-owned rod is refused') only exercises the numeric path, so the invariant it claims is silently false for every other selector form. Today the regulator overwrites targets next substep, but any reorder of the substep (rod drives before AR update) or an arEnabled toggle turns this into a real uncommanded 4-rod reactivity poke. 'all' and the AR2/AR3 subgroup selectors are also completely untested (rodsFor parsing via Number(selector[2]) at line 489).
- **Proposed fix:** Extend cps.test: (a) setRodTarget('AR1', 0) with AR-1 regulator-owned -> owned rods' targets unchanged + ROD_AUTO logged (move the ownership check out of the typeof-number condition); (b) setRodTarget('AR2', 0.7) -> exactly the 4 subgroup-2 rods have target 0.7, nothing else moved; (c) setRodTarget('all', 1) -> all 211 targets 1, then define/assert whether 'all' may cock the AZ bank.

### 47. `packages/sim-core/src/reactor.ts:451` — azSetback() is untested; today it is a de-facto slow full shutdown that the AR fights for ~28 minutes, contradicting its own docstring.
- **Verdict:** pending
- **Scenario:** Measured: azSetback() at 100% -> power 0.026 at t=120 s and 0.000 at 12 min (not a setback to 50%), while arSetpointActive is still 0.964 at 120 s because azSetback lowers arSetpoint but the active setpoint ramps down at arGradient (0.0003/s => ~28 min), so the AR bank withdraws against the setback exactly as the comment says it should not. Nothing asserts the AZ bank reaches 1, that it is non-latching (scrammed stays false), that USP/RR are untouched, or the setpoint clamp - a regression that makes AZ1 latch a scram, drive USP, or skip the setpoint reduction passes the suite.
- **Proposed fix:** New test: initAtPower(1.0); azSetback(); assert log has exactly one AZ1 alarm, arSetpoint===0.5; tick(25) -> all AZ rods insertion > 0.95, all non-AZ targets unchanged, scrammed===false. Then pin intended endpoint behavior: either assert power falls below 0.5 without scram (current physics) or fix the fight (also drop arSetpointActive) and assert power settles near 0.5.

### 48. `packages/sim-core/src/reactor.ts:574` — The AR subgroup automatic changeover sequence (saturation -> next bank picks up) has no test; only the LAR->AR dropout is covered.
- **Verdict:** pending
- **Scenario:** The 5 s saturation timer, the (arActiveGroup % 3) + 1 cycle, and the re-seeding of arTarget from the NEW bank's mean insertion (lines 575-591) are all unasserted. Verified reproducible scenario: a slow reactivity drift (state.rhoExtra -= 2e-5 per second at full power) fires AR_CHANGEOVER within ~10 min while power holds 1.000. A regression that re-seeds arTarget from the old bank (new bank step-jumps, reactivity transient), advances to the wrong subgroup, or never resets arSaturatedFor would only show up as the resetScram changeover storm already does - unnoticed.
- **Proposed fix:** New cps test: initAtPower(1.0); loop 600 s applying state.rhoExtra -= 2e-5*dt with tick(1, 0.05). Assert: AR_CHANGEOVER logged, arActiveGroup !== 1 afterwards, the former subgroup's rods stopped tracking (their target frozen at saturation) while the new subgroup's targets track arTarget, |powerFraction - 1| < 0.02 throughout, scrammed===false.

### 49. `packages/sim-core/src/reactor.ts:837` — rodWorthBeta mutates live rod.insertion with no try/finally and has no test for sign conventions, state restoration, or purity.
- **Verdict:** pending
- **Scenario:** rodWorthBeta temporarily sets rod.insertion to 0 and 1 on the SAME RodState objects the sim integrates; restoration at line 846 is skipped if rodReactivityByNode ever throws (any future validation/assert added there), leaving a rod pinned fully inserted - a permanent silent reactivity change. The UI calls it on every mouse-move and up to 30x per selection refresh (ui/src/main.ts:193,321), so a purity regression corrupts the running core. Measured invariants to pin: RR@0.45 toOut=+0.007/toIn=-0.056; AZ@0 toOut===0/toIn=-0.063; USP@0.2 toOut=+0.002/toIn=-0.038; insertion restored bit-exact; out-of-range id -> null.
- **Proposed fix:** Wrap the body in try/finally { rod.insertion = saved }. New test: for one rod of each group at insertions {0, 0.2, 0.5, 1}: assert toOut >= 0 and toIn <= 0 for USP/RR (absorber-dominant from operating shape), toOut===0 at insertion 0 and toIn===0 at insertion 1, rod.insertion === saved after the call, two consecutive calls return identical values, and a tick(1) after 30 rodWorthBeta calls matches a control reactor's tick(1) exactly (purity/determinism).

### 50. `packages/sim-core/src/field.ts:89` — field.ts (RadialField, rodAxialEffect, buildFuelChannels) has zero tests, and RadialField.update indexes eff[] by rod.id - an unpinned contract with buildRods.
- **Verdict:** pending
- **Scenario:** Line 139 does eff[ids[i]] where eff = this.rods.map(...) and ids hold rod.id: correctness silently requires rods[i].id === i. Any buildRods change that reorders or renumbers rods corrupts every channel's power on the UI cartogram and the quadrant-tilt annunciator with no failing test. Also untested: normalization (measured mean rel = 1.0000), tilt detection (inserting only x>0,y>0 rods drops that quadrant to 0.05 vs 1.3-1.4 elsewhere), the zero-flux geometric fallback in rodAxialEffect, and buildFuelChannels()===1661 channels inside CORE_RADIUS.
- **Proposed fix:** New field.test.ts: (1) buildFuelChannels().length===1661, all hypot(x,y)<=CORE_RADIUS; (2) buildRods(211) then assert rods.every((r,i)=>r.id===i) (pin the id contract); (3) uniform insertion 0.5 + initAtPower(1.0) nodes -> mean(rel) within 1e-3 of 1 and four quadrant means within 5% of each other; (4) insert only rods with x>0&&y>0 -> that quadrant's mean rel < 0.3 and the lowest; (5) all-zero-flux nodes -> update() yields finite rel and rodAxialEffect returns the geometric fractions.

### 51. `packages/sim-core/src/reactor.ts:526` — ARM mode is entirely untested and the upper band bound of regulatorBand() is dead code: ARM silently regulates at 100% power with no warning.
- **Verdict:** pending
- **Scenario:** Confirmed: set arMode='ARM' at full power, tick 120 s -> zero AR_BAND warnings and ARM keeps driving the AR bank at 16x its documented 6% ceiling, because line 526 destructures only [lo] and nothing ever checks the hi bound. Also confirmed interplay bug the missing tests would surface: the band/dropout block is not gated on this.initializing, so initAtPower(0.03) logs spurious AR_BAND warnings during the settle loop (and would fire LAR_DROPOUT mid-init if arMode were LAR). Docs/comment promise band enforcement that half-exists.
- **Proposed fix:** Tests: (a) initAtPower(1.0); arMode='ARM'; tick(120) -> expect an AR_BAND (or refusal) for power ABOVE the band - implement the hi-bound check; (b) initAtPower(0.03) -> log contains no AR_BAND/LAR_DROPOUT entries (gate the band block on !this.initializing); (c) initAtPower(0.03); arMode='ARM'; arSetpoint=0.03; tick(60) -> power held within 5% of setpoint, no warnings.

### 52. `packages/sim-core/src/reactor.ts:368` — The period-block withdrawal rule (no withdrawal below 60 s period in the startup range) is untested.
- **Verdict:** pending
- **Scenario:** Verified working today (withdrawal target refused, PERIOD_BLOCK logged, insertion still accepted at period 34 s / power 4e-3), but nothing pins the powerFraction<0.05 gate, the 60 s threshold, or the direction test t < rod.insertion. Inverting the direction comparison or the power gate would either block ALL rod motion at full power (plant unmaneuverable, AR-independent manual trims dead) or let a startup operator yank rods on a 20 s period - the exact hazard the rule exists for, and the startup.test scenario would not catch it because it stops pulling once the period is short.
- **Proposed fix:** New startup test: reach a supercritical low-power state with period ~30-50 s (reuse the squad-withdrawal loop); pick an RR rod, setRodTarget(id, target-0.3) -> assert target unchanged and PERIOD_BLOCK logged; setRodTarget(id, target+0.3) -> accepted; tick until period > 60 or power > 0.05, retry withdrawal -> accepted.

### 53. `packages/sim-core/src/rods.ts:117` — buildRods with count !== 211 is a public option (ReactorOptions.rodCount) that produces degenerate cores - buildRods(50) has ZERO manual RR rods - with no test defining the contract.
- **Verdict:** pending
- **Scenario:** Measured: buildRods(50) -> RR=0, USP=2 (the 80 fixed group targets eat every position and USP is truncated); buildRods(100) -> RR=20. A Reactor constructed with rodCount 50 has no manual bank (startup impossible, silovaya/ORM meaningless) yet constructs without complaint. Nothing asserts ids are contiguous 0..n-1 or positions unique for any count - and RadialField's eff-indexing (finding above) hard-requires id===index, so a change here corrupts the UI field for all counts including 211.
- **Proposed fix:** Extend the cps rod-complement test: for counts {100, 211, 250} assert rods.length===count, ids exactly 0..count-1 in order, all (x,y) unique, AR subgroups 1/2/3 have 4 rods each, AZ===24, LAR===12; and either assert RR>0 for count>=150 or make buildRods throw for counts that cannot host the fixed special-group complement (define the contract).

### 54. `packages/sim-core/src/reactor.ts:710` — PRIZMA printout cadence under fast-forward and across the s.time=0 re-init reset is untested (only 'one printout after 301 s' is pinned).
- **Verdict:** pending
- **Scenario:** Measured correct today: exactly 12 printouts over tick(3600, 0.1) and printout age <= 300 s. But the re-arm style (nextPrizmaT = s.time + PERIOD at line 711) and the nextPrizmaT=0 resets inside initAtPower/initShutdown (lines 234, 281) are load-bearing and unasserted: switching to catch-up accumulation (nextPrizmaT += PERIOD) after a time jump floods the demo JSONL and UI log with thousands of PRIZMA entries, while forgetting the reset after init (where s.time rewinds from ~100 s of settling to 0) starves the operator of any ORM printout for the stale interval. Both consumed by scripts/demo.ts and the UI ORM-age display.
- **Proposed fix:** Extend the PRIZMA test: initAtPower(1.0); count PRIZMA log entries; tick(3600, 0.1); assert exactly 12 new entries and state.time - prizma().t <= PRIZMA_PERIOD; separately assert prizma().t === 0 right after init and that the first post-init printout lands by t <= 300 after initShutdown() too.

### 55. `packages/sim-core/src/reactor.ts:93` — Operator mode switching via the bare public arMode field (as the UI does at main.ts:389) is unpinned: switching to LAR does not re-seed arTarget from the LAR bank.
- **Verdict:** pending
- **Scenario:** The automatic dropout path (lines 531-538) carefully re-seeds arTarget from the newly-owned bank, but a direct arMode write - the only API the UI uses - does not. If the LAR bank sits at a different insertion than the AR bank when the operator flips modes (normal after any operating history, since AR drifts under PI control while LAR is parked), all 12 LAR rods immediately jump-target to the stale arTarget: an uncommanded reactivity swing worth ~0.5 beta. No test exercises ANY operator-initiated mode change (ARM<->AR<->LAR), only the automatic LAR dropout.
- **Proposed fix:** Add a setArMode(mode) method that re-seeds arTarget from the newly-owned bank's mean insertion and resets arErrPrev (mirror lines 533-538); switch ui/main.ts to it. Test: initAtPower(1.0); drift the AR bank (small rhoExtra drift, tick 300) so arTarget !== 0.5; setArMode('LAR'); tick(30) -> assert LAR insertions moved by < 0.02, |power-1| < 0.02, no scram; then setArMode('AR') back with the symmetric assertions.

### 56. `packages/sim-core/test/void.test.ts:17` — No test exercises the fast-forward path (maxStep=0.1) on a supercritical/feedback transient, so the dt=0.1 kinetics-pole regressions ship silently.
- **Verdict:** pending
- **Scenario:** The only tick(x, 0.1) calls in the suite are subcritical/startup cases (startup.test.ts, cps.test.ts); every transient/feedback test (void.test.ts, rods.test.ts) runs at the default 0.01 s step. The finding-1 failure mode — trajectories diverging by orders of magnitude between maxStep 0.01 and 0.1 once local rho approaches 2-3 beta — is therefore invisible to `bun test`, even though the UI's 10x/60x buttons run every user transient at maxStep 0.1.
- **Proposed fix:** Add a test that runs one strong transient (e.g. flow-loss from full power with protections blocked, or a scram tip-effect case) twice, at maxStep 0.01 and 0.1, and asserts the power trajectories agree within a tolerance band and stay finite.

### 57. `packages/sim-core/test/steady.test.ts:1` — No test pins the kinetics integrator or reactimeter to analytic point-kinetics results (inhour periods, prompt jump, reactimeter step response), so a units/sign regression in kinetics.ts or the IPK block would pass the suite.
- **Verdict:** pending
- **Scenario:** The suite checks qualitative behavior (power falls when rods insert, xenon peaks 6-14 h, etc.) but nothing quantitative about kinetics. Verified externally during this audit: asymptotic periods match the 6-group inhour equation to <1% (+0.1 beta -> 99.0 s vs 99.8 s analytic; +0.2 -> 37.6 vs 37.6; +0.5 -> 6.2 vs 6.2), prompt jump for +0.05 beta is 6.4% (analytic rho/(beta-rho)=5.3% plus void feedback), and the reactimeter reads a +0.05 beta rhoExtra step as 0.051 beta at t+0.5 s and -5.3 beta at shutdown. A future edit (e.g. mis-scaling GEN_TIME, DELAYED_BETA rescale, or the IPK delayed-tracker units in reactor.ts:654-671) would silently break period/reactimeter calibration - the AZS trip and startup period-block logic both key off these numbers - while every existing test still passes.
- **Proposed fix:** Add a kinetics.test.ts that (a) bisects a uniform node reactivity for zero growth then asserts the measured asymptotic e-folding period for +0.1/+0.5 beta steps matches the inhour solution within a few percent, and (b) asserts reactivityBeta() tracks a small rhoExtra step (protections blocked, AR off) within ~10% after 0.5 s and reads ~0 (+/-0.01 beta) at calibrated steady state.
