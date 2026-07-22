# Physics constants: sources and reconciliation

Constants in `packages/sim-core/src/constants.ts`, reconciled against
literature on 2026-07-14 (two research passes over primary/authoritative
sources). Summary of what is cited vs estimated.

## Kinetics

| Constant | Value | Source | Confidence |
|---|---|---|---|
| beta_eff | 0.005 | Bracketed 0.0045-0.0053: AECL NEACRP-A-1987-0831 uses 5.26e-3 (<https://oecd-nea.org/upload/docs/application/pdf/2020-07/neacrp-a-1987-0831.pdf>); accident-kinetics analyses cite ~0.0045 | medium-high |
| 6-group beta_i, lambda_i | Keepin thermal U-235, rescaled to beta_eff | Keepin, Wimett & Zeigler, Phys. Rev. 107, 1044 (1957), <https://doi.org/10.1103/physrev.107.1044>; still standard per modern validation (Takahashi et al. 2021) | high |
| Lambda (generation time) | 4.79e-4 s | AECL NEACRP-A-1987-0831, explicit kinetics-code input | high |

## Reactivity coefficients

| Constant | Value | Source | Confidence |
|---|---|---|---|
| Void coefficient | +0.020 abs (= +4 beta full voiding) | INSAG-7 Section 2.1: +(4-5) beta full voiding, +(2.0-2.5)e-4 dk/k per % void at accident-era refuelling regime (<http://large.stanford.edu/courses/2017/ph241/walker2/docs/insag-7.pdf>) | high |
| Fuel (Doppler) | -1.5e-5 /K | Literature -1.2e-5 /K (Mercier 2021 citing INSAG-7, <https://www.epj-n.org/articles/epjn/full_html/2021/01/epjn200018/epjn200018.html>); strengthened to stand in for unmodeled negative contributions - ESTIMATED beyond -1.2e-5 | medium |
| Graphite temp | +6e-6 /K | Sign well-established (positive, significant); no clean published magnitude - ESTIMATED within +0.5..3 pcm/K | low (magnitude) |

## Control rods

| Constant | Value | Source | Confidence |
|---|---|---|---|
| Drive speed | 0.4 m/s (~18 s full travel) | INSAG-7; Malko (<http://www.rri.kyoto-u.ac.jp/NSRG/reports/kr79/kr79pdf/Malko1.pdf>); NEACRP-A-1987-0826 | high |
| Displacer geometry | 4.5 m graphite, 1.25 m water columns | INSAG-7, direct quote | high |
| Tip effect magnitude | tuned to ~ +1 beta peak (bottom-peaked flux, full-bank AZ-5) | Literature +0.5..+1 beta, point estimate +0.8: Karpan calc; TREP +0.5 / STEPAN +1 (Khalimonchuk et al. 2016, <https://doi.org/10.32918/nrs.2016.1(69).04>) | medium-high |
| Absorber worth / m | 5.2e-4 per rod per m | ESTIMATED; indirect anchor: AECL "75 mk movable complement" ~ 40 pcm/rod average | low |

## Iodine / xenon chain

| Constant | Value | Source | Confidence |
|---|---|---|---|
| gamma_I | 0.0639 | IAEA RRIH compendium (Slovenia Xe-poisoning protocol); CANDU teaching docs agree (0.063) | high |
| gamma_Xe | 0.00237 | Same; chain total ~6.6% matches CANDU Fundamentals ch.20 | high |
| lambda_I | 2.9306e-5 /s (6.57 h) | ICRP-107 / MIRD | high |
| lambda_Xe | 2.1066e-5 /s (9.14 h) | ICRP-107 / MIRD | high |
| sigma_Xe | 2.65e-18 cm^2 | Textbook 2200 m/s value; measured spread 2.6-3.5e6 b (Fickel & Tomlinson; Petruska et al.) | high |
| Equilibrium worth check | -2000..-3000 pcm at full power | CANDU -28 mk; NRC Westinghouse training ~-2500 pcm; model gives ~-2560 pcm at phi=1.2e14 | consistent |
| Post-shutdown peak | t_peak = ln(lambda_I/lambda_Xe)/(lambda_I - lambda_Xe) ~ 11.3 h | DOE-HDBK-1019/2-93; analytic | high |

## Operating point

| Constant | Value | Source | Confidence |
|---|---|---|---|
| Thermal power | 3200 MW | Malko Table 1; NRC ML20202G309 | high |
| Core 7 m x 11.8 m, 1661 channels, 211 rods | - | consistent across all sources | high |
| Avg thermal flux | 1.2e14 n/cm2/s | IGDTP CAST-2017 (1.2e14); Plukiene et al. MCNPX (1.55-1.61e14) | high |
| Inlet 270 C, outlet ~284 C, ~7 MPa | - | INSAG-7 direct | high |
| Core flow ~13300 kg/s | 8 MCPs x 8000 m3/h (INSAG-7) x ~0.74 t/m3 | high |

## Control and protection system (CPS)

| Item | Modeled as | Source | Confidence |
|---|---|---|---|
| Rod complement | 131 RR + 12 AR (3x4) + 12 LAR + 24 AZ + 32 USP = 211 | NIKIET textbook (Cherkashov ed.) 2nd-gen breakdown via budan.livejournal.com; a competing pre-accident count (115/12/12/24/24 = 187) exists from Karpan's 00:39 printout - unreconciled in open literature | medium |
| USP shortened absorbers | 3.05 m absorber from the BOTTOM, no displacer; manually driven for axial shaping and NOT driven by AZ-5 (pre-1986) | budan/accidont geometry; chernobylcritical (AZ-5 asymmetry, named accident factor) | high |
| AR/LAR structure | 3 redundant AR subgroups of 4 plus 12 primary LAR rods; LAR changes to the active AR subgroup after a 5 s fully-inserted saturation during a rising high-power transient, while low-power detector dropout remains the separate LAR handoff | chernobylcritical + corroborating reconstructions; changeover numeric conditions not found - 5 s saturation and high-power direction are ESTIMATED | medium-high |
| Setpoint gradient | active setpoint ramps at 0.03 %/s default (panel gauge 0-0.35 %/s) | reference simulator's gradient gauge; real numeric limit unconfirmed | medium |
| Protections | AZS (period < 10 s), AZM (power > 110%), both operator-blockable with logged warnings; AZ-1 setback drives AZ bank + setpoint to 50%; AZ-5 full scram excl. USP | Terminology (AZS/AZM) from operator-manual reconstructions; numeric setpoints ESTIMATED (not found in open sources); blockability documented by INSAG-7 | low-medium (numbers), high (structure) |
| ORM | PRIZMA printout every ~5 min ONLY - no live gauge, no ORM protection pre-1986; 15-rod floor administrative | accidont.ru/ozr.html; controls research (docs/research/controls.md) | high |
| Withdrawal restriction | >=5 rods selected: withdrawal refused (insertion never restricted); >=8 rods withdrawing: power interlock halts all + annunciates ("silovaya blokirovka"); ARM/AR/LAR automatic withdrawal is also held until AZ is cocked | TEZ L.24 (studfile SUZ manual mirror) and Rule 3.1.7 | high |
| Regulator ladder | ARM 0.25-6% / AR 5-105% (one of 3 subgroups active) / LAR 10-100% (PRIMARY at power, in-core chambers, BLIND below ~10% - drops out). **We use 10% dropout / [0.1, 1.0] band** as coded. Research also cites LAR primary ~20-100% with blind/LAZ dead ~10-20% (docs/research/controls.md); open sources spread 10-20% — we pick the conservative lower edge so LAR still works at 15%. | pavrda.cz/62, topwar 269168, Gospromatomnadzor 1991 (00:28 failure); controls research | high (structure), medium (exact band edge) |
| Rod speeds | 0.4 m/s all drives; LAR WITHDRAWS at 0.2 m/s | TEZ L.24 | high |
| Startup period rule | withdrawal blocked while period < 60 s (below 5% power); PERIOD warn < 15 s (clear > 25 s); AZS trip floor 10 s (sources spread 5-10 s) | poznayka s27313, consultant.ru NP rule; warn threshold ESTIMATED | medium-high |
| Rod complement (3rd variant) | The 00:39 SKALA printout header reads "127 RR + 48 AZ + 12 AR + 24 USP = 211" (48 AZ likely 24 AZ + 24 PK-AZ; no separate LAR line). Three compositions now compete; we keep NIKIET 131/12/12/24/32 | accidont.ru/datable.html | unresolved |

## Known simplifications (v0)

- Decay heat is a 3-group exponential fit; replace with the Glasstone /
  ANS-5.1 three-segment power law (a t^-b; see nuceng.ca decayhe1b.pdf).
- Whole core is one average channel stack; no radial dimension yet, so no
  spatial xenon oscillations (literature: ~28-36 h period in large PWRs;
  INSAG-1 notes RBMK behaves "almost as if several independent reactors").
- Xenon reactivity uses the large-reactor poisoning estimate
  rho = -sigma_Xe N_Xe / (nu Sigma_f), node-locally.
- ORM is a geometric equivalent-rod estimate Σ(insertion) over RR+AR+LAR
  (AZ/USP excluded) — “rods remaining in the core,” matching the plant sense
  (WNA / INSAG-7). Low ORM ⇒ bank withdrawn. Real PRIZMA used flux-weighted
  reactivity reconstruction; this is enough for the administrative 15-rod
  floor and accident-night low-ORM drills without claiming SKALA fidelity.
- Thermal flow is floored at 5% of rated inside `stepThermal` so a zero
  flowFraction cannot divide-by-zero the enthalpy march. Full pump coastdown /
  LOCA voiding waits on packages/sim-plant.
