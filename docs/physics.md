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

## Known simplifications (v0)

- Decay heat is a 3-group exponential fit; replace with the Glasstone /
  ANS-5.1 three-segment power law (a t^-b; see nuceng.ca decayhe1b.pdf).
- Whole core is one average channel stack; no radial dimension yet, so no
  spatial xenon oscillations (literature: ~28-36 h period in large PWRs;
  INSAG-1 notes RBMK behaves "almost as if several independent reactors").
- Xenon reactivity uses the large-reactor poisoning estimate
  rho = -sigma_Xe N_Xe / (nu Sigma_f), node-locally.
- ORM (operating reactivity margin) is not yet computed as
  "equivalent rods" - needed for accident-scenario fidelity (8 vs required
  15 rods at the accident; INSAG-7 Annex I).
