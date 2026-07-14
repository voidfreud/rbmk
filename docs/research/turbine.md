# RBMK-1000 turbine / generator / electrical — research report (2026-07-15)

For packages/sim-plant when we build it. Confidence H/M/L as tagged.
Correction to our earlier note: rated steam per turbine ~2855 t/h (793 kg/s),
not ~1450 t/h; reactor makes ~5400-5800 t/h split over two turbines.

## K-500-65/3000 (2 per unit, 500 MWe each) (H)
Kharkiv (Turboatom). Single shaft, 1 HP + 4 LP cylinders, 3000 rpm. Inlet
~6.6 MPa saturated x~0.995 (~280-284 C). Max 543 MWe; heat rate ~11,090
kJ/kWh; mass ~1523 t. HP double-flow 2x5 stages, exhaust ~0.34 MPa wet;
4x SPP-500 moisture-separator/reheaters dry+superheat to ~263-265 C; LP 4x
double-flow 2x5 stages -> 8 exhausts, one condenser per LP (~0.004 MPa,
~28 C). Two-lift condensate pumps, 5 LP heaters, deaerator, NO HP heaters.
Feed pump SPE-1650-75.

## Dynamics / coastdown (anchor numbers)
- Shaft-line kinetic energy at 3000 rpm ~ 3000 MJ (accidont.ru/ENG/runner.html,
  M-H). J = 2E/w^2 ~ 6.1e4 kg*m2; H = E/S ~ 5.1 s (S~588 MVA, cosphi 0.85).
- Governor: hydraulic, on 2 combined stop+control valve blocks; droop assume
  4-5% (L on exact). Fast stop closes swing-check flaps SPP->LP.
- 1986 loaded rundown: TG-8 valves shut 01:23:04; generator feeds 4 MCPs +
  feed pumps via auxiliary bus; bespoke DonTekhEnergo "rundown block" field
  regulator holds voltage ~constant as speed decays (1982/84/85 attempts
  failed: V fell with speed too fast). Observed: GENTLE decay; grid-fed MCPs
  slightly ROSE; total core flow fell only ~15% (~60,000 -> ~48-50,000 m3/h)
  over ~36 s; no cavitation (INSAG-7). Danger was subcooling removal into
  positive void coeff, not the electrics. (H)

## Generator TVV-500-2 (H/M)
2-pole 3000 rpm, 500 MW, S~588 MVA cosphi 0.85; stator water-cooled, rotor
H2; shaft-coupled 50 Hz exciter (TVV series: HF inductor exciter + diode
rectifier + EPA-500 AVR). Rundown field regulator = bespoke block, triggered
by MPA button, also issues bus-transfer switching.

## Electrical scheme (H)
Both generators -> one step-up transformer to 750 kV via two series breakers;
unit aux transformers tap between generator and breakers. Each unit
transformer -> two 6 kV boards (7A,7B,8A,8B) feeding MCP motors (6 kV,
~5.5 MW). Three essential 6 kV lines, each with own diesel: diesels
auto-start ~15 s, full load ~60-75 s; TG bridge ~45-50 s. External standby:
330 kV station transformer + cross-unit reserve busbars.

## Steam dump (H)
BRU-K: 4 units (2/turbine), ~725-900 t/h each, total ~50% of full steam flow,
setpoint ~71.5 kgf/cm2, stroke seconds; BRU-B 1x ~725 t/h -> bubbler,
~72 kgf/cm2; main safety valves 8 in groups 75/76/77 kgf/cm2 (700/1400/700
t/h). Fast condenser dump lets the plant ride a single-TG trip WITHOUT scram
(pressure peak ~30 s, regulator trims reactor to ~60%). BOTH-TG trip = AZ-5
condition (BLOCKED 00:43:27 on the accident night).

## Minimal viable turbine model
States: omega (rated 314.16 rad/s), valve position y (stop valve = 0/1 gate).
Params: J=6.1e4 kg*m2, E0=3000 MJ, Prated_mech ~510 MW at 2900 t/h,
dh~600-630 kJ/kg, droop 0.04 (assumed).
- m_turb = y*Cv*P_drum; P_mech = eta*m_turb*dh; T_steam = P_mech/omega.
- Grid-synced: omega pinned; islanded rundown: T_elec = P_aux(omega)/omega,
  P_aux = P_aux0*(omega/omega0)^3, P_aux0 ~ 20-25 MW (4 MCPs + feed pumps).
- J domega/dt = T_steam - T_elec - b*omega.
- Rundown closed form (valves shut): omega(t) = omega0/(1 + t/T*),
  T* = 2E0/P_aux0 ~ 240-300 s -> omega(45 s)/omega0 ~ 0.85-0.87. Matches the
  observed ~15% flow droop. MCP flow: Q(t) ~ Q0/(1+t/T*) for rundown pumps;
  grid pumps rise slightly; net core flow 0.85-0.90 at ~40 s.
- Coupling: OUT MCP speed -> hydraulics; IN P_drum -> steam flow/torque;
  OUT steam draw (turbine + BRU-K) -> drum pressure balance. Event hooks:
  stop-valve shut; both-TG-trip -> AZ-5 (blockable); mains breaker open ->
  islanded load with field regulator.
Open items (L): exact droop; free coastdown time; exact P_aux0.
