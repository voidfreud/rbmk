# RBMK-1000 LAR + BShchU rod controls — research report (2026-07-15)

2nd-gen RBMK-1000 (ChNPP-4 class). Confidence high throughout unless noted.
Sources: pavrda.cz/cernobyl/rbmk/62.htm (SUZ spec); yastalker.site (LNPP-3);
studfile.net/preview/16424193/page:68 (TEZ L.24 selection/interlock logic);
poznayka s96041-s96045 (SFKRE); accidont.ru/datable.html + ozr.html;
elib.biblioatom 1983 Dollezhal + 2013 Postnikov; Gospromatomnadzor 1991;
NRC ML20202G309.

## LAR
- 12 zones, one LAR rod per zone (1st-gen units: 7). Each rod follows the
  AVERAGE of its two KTV-17 in-core fission chambers (triaxial, 3 sections);
  holds zone power to +-1.5% of setpoint. Flattens radial-azimuthal harmonics.
- Regulator ladder: ARM 0.25-6% (4 rods on summed side-chamber signal);
  1AR/2AR 5-105% (one active, one standby); LAR 20-100% PRIMARY in the main
  band; LAR-BIK (8 peripheral rods on side chambers) 5-100% hot standby with
  auto-switchover. Operator-selected, not co-run. LAR-LAZ INOPERABLE below
  ~10-20% (in-core chambers blind) - central to the accident.
  **Sim choice (P1.11):** code uses LAR band [0.1, 1.0] with dropout below
  ~10% (matches physics.md). Research primary band is often quoted 20-100%;
  the simulator also hands a fully-inserted LAR bank to the active AR group
  after 5 s when power is rising, rather than leaving regulation inert. We
  keep 10% so regulation remains valid at 10-20% power.
- 00:28 Apr 26: at ~520 MWt Toptunov switched LAR off, engaged AR-1 (side
  chambers); AR-1 dropped on unbalance, AR-2 failed to pick up (fault logged
  00:30:50); with no regulator, power fell to ~30 MWt; xenon built. Root:
  global side-chamber control is blind to core center at low power.

## In-core instrumentation (SFKRE / SKALA)
- DKE(r) radial: 117 early / 130 later (use 130 for ChNPP-4) beta-emission
  SPNDs in fuel-assembly central tubes -> SKALA field reconstruction.
- DKE(v) axial: 12 channels x 7 sections (numbered from top).
- KTV-17: 2 per LAR rod. BIK side chambers in lateral shield at mid-height
  -> AR/ARM/LAR-BIK + AZ power/period.
- SIUR's LIVE view: selsyn wall (one per rod, +-50 mm), log power/period
  meters, ZRT-A reactimeter chart, AR imbalance galvanometers ("zaichiki").
  Full field + ORM were NOT live - printout on a several-minute cycle.

## Rod-control ergonomics (TEZ L.24)
- Addressing: one selection button PER ROD on a mimic field laid out as the
  core map (not a coordinate keypad). "Sbros vybora" clears selection.
- Moving: two KUS hold-to-move keys (main + reserve); continuous servo, no
  step clicks. Selection count lamps "1"-"5".
- Withdrawal restriction when >=5 rods selected ("Ogranichenie na vyvod");
  insertion NEVER count-restricted. (Startup "groups of 4 with 2-min holds"
  is procedure, not the panel limit.)
- Speeds FIXED: 0.4+-0.1 m/s insert/withdraw (RR/AR/LAZ/ARM); LAR WITHDRAWS
  at 0.2 m/s. Stroke 6550 mm; insert-on-key ~17-18 s; AZ-5 <=12 s (source
  spread vs INSAG-7 18 s - flag); BAZ <=2.5 s. USP from bottom, stroke 3500 mm.
- USP is a separate manually selected axial-shaping bank in this model; its
  bottom-entry drives are not regulator-owned and AZ-5 leaves their position
  unchanged in the pre-1986 configuration.
- Indicators: selsyn +-50 mm with upper (VK) / lower (NK) limit-switch LEDs.
- 6 sectors x 3 groups of 12; PK-AZ group buttons white 1-4, red A, black R.

## Interlocks
- No positive reactivity insertion unless AZ rods cocked/armed (rule 3.1.7);
  blocked on warning signals (3.1.9).
- Withdrawal restriction at 5+ selected (panel logic).
- "Silovaya blokirovka": fires when >=8 rods of RR/USP/BAZ/AR/LAR are being
  withdrawn - clears selection, annunciates; combined with "PK mode" it
  generates AZ-5.
- Period: emergency setpoint >=5 s, warning >=15 s (AZSP/AZSR); startup rule:
  stop withdrawal if any instrument shows period <60 s. (Other research: trip
  floor >=10 s regulatory. Spread 5-10 s; we use 10 s.)
- ORM: pre-1986 NO signalization and NO ORM-based AZ; 15/30-rod limits were
  administrative. ORM computed by PRIZMA/SKALA, delivered as a PRINTOUT on a
  several-minute cycle. Live BShchU ORM display added only after Chernobyl.

## Rod-position printout (00:39 / 01:22:37 tapes)
Per rod: 4-digit cell coord YYXX, type, position in METERS (2 decimals),
measured as insertion from the upper limit; rods at upper limit unchanged are
OMITTED. Header population: "127 RR + 48 AZ + 12 AR + 24 USP = 211" - a THIRD
competing composition (vs NIKIET 131/12/12/24/32 and Karpan-derived 187).
Note 48 AZ likely = 24 AZ + 24 PK-AZ. Unreconciled; we keep NIKIET.

## Fidelity punch list (ranked)
T1: ORM printout latency (no live gauge); LAR primary (research 20-100%, sim 10-100%) + dead <10-20%
    + handover-failure mode; AZ-5 slow insertion with tip effect; silovaya
    blokirovka >=8 + PK-mode AZ-5 coupling; fixed speeds (LAR out 0.2).
T2: per-rod mimic-field selection + 2 hold-keys + count lamps + clear;
    withdrawal restriction >=5; selsyn wall with VK/NK LEDs; chart recorders
    as live trace distinct from printouts.
T3: dial skeuomorphism, sector partitioning, plato duplicates.
