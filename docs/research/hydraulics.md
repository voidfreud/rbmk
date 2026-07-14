# RBMK-1000 primary circuit (KMPTs) — research report (2026-07-15)

For packages/sim-plant when we build it. Confidence: H/M/L as tagged.
Sources: ruatom.ru/rbmk/14.htm, reactors.narod.ru/rbmk/06_gidro.htm + 08_mcp.htm,
en.ppt-online.org/201493, INSAG-7, accidont.ru/ENG/chrono.html + mcp.html,
WNA Chernobyl App-1, hwinfo.com Dyatlov + mm.pdf, Kaliatka/Uspuras RELAP5/CATHARE
(RBMK-1500 analogue), ru.wiki Паросепаратор, consultant.ru BRU-K.

## Layout (H)
- Two independent loops, coupled ONLY through the common steam space.
  Each cools ~830 of 1661 channels.
- Per loop: 4 MCPs (3+1 standby; 8/unit), 2 drum separators (4/unit),
  24 downcomers 325x15, suction+pressure headers Du900 (pressure OD 1040/70),
  22 group distribution headers (RGK) 325x15 each feeding 38-41 channels,
  per-channel lower water lines 57x3.5 with ZRK valve + ball flowmeter,
  upper steam-water lines 76x4.
- Suction<->pressure header bypass 836x42, normally-open gate + check valve:
  the natural-circulation path (6 per loop, DN300 per startup report).
- Loop conditions: inlet 270 C, outlet 284 C at ~7 MPa, exit quality 14-15%.

## MCP (TsVN-8) (H unless noted)
Flow 8000 m3/h rated (throttled 6000-7000 below 500 MWt); head ~200 m wc
(~2.0 MPa nameplate, ~1.5 MPa at operating point); inlet 7.2 MPa / 270 C;
~1000 rpm; motor 4300 kW 6 kV; eff ~80%; flywheel GD2 = 15 t*m2 (added for
coastdown; I ~ 3750 kg*m2 pump-only, L on split); mass 107 t; seal leak 8 m3/h;
min suction head >= 23 m wc (cavitation).
- Coastdown bridges ~40-60 s; natural circulation then holds ~15-20% of
  nominal loop flow (RELAP5/CATHARE, Ignalina data). Scram on loss of 3/4 or
  2/3 running pumps or 6 kV loss. Single-pump trip: survivors rise ~9500 m3/h,
  check valve shuts.
- Min-flow trip ~5000 m3/h class; >~7000 m3/h risks cavitation (the accident
  night's clear violation). Margin set by pump-inlet subcooling.

## Drum separators (BS)
- Horizontal, ~31 m x ~2.6 m ID, wall ~10 cm, ~240 t (M; dia spread 2.3-2.8).
- Volume ~165 m3 each; ~80 m3 water at normal level (L - computed).
- Three-impulse level control (level + steam flow + feed flow); 2 drums/loop
  tied by 2 water + 5 steam equalizers (H).
- Level moved by: feedwater(+), separated water to downcomers(-), steam out(-),
  and void swell/shrink (fast, initially wrong-signed) (H).
- Low-level scram: -600 mm (emergency) and -1100 mm by power range (INSAG-7, H).
  High-level trip exists. Accident-night levels -50/-500 mm (within limits).
- Pressure: normal 6.4-6.9 MPa. NOTE: could NOT confirm "55/50 kgf/cm2" trip
  setpoints; everything found sits 65-70 operating / 68 BRU-K. Treat 50-55 as L.
- Pressure dynamics stiff (seconds): test-end spike right drum -> 88 kgf/cm2
  at 01:23:48.

## Steam side / pressure-void sign (H)
Pressure RISE -> void collapse -> NEGATIVE reactivity; pressure DROP ->
flashing -> POSITIVE. Coupling variable: drum pressure sets Tsat/h_fg for the
core void calculation.
- BRU-K (to condenser): opens 6.7 MPa (68), holds 6.27 (64); ~900 t/h per unit
  x4 (older spec 725). BRU-B to barboter; 8 main safety valves 725 t/h each.
- Barboters: 2/unit, 20 t steam at 1.2 MPa, ~300 t/h transit.

## Feedwater (H)
~165-168 C at drum inlet (deaerator 0.69 MPa); ~2800 t/h per loop at full
power (total ~ steam flow 5400-5600 t/h); 3 lines/loop (2+1). ACCIDENT LEVER:
less feedwater -> hotter downcomer mix -> lower core-inlet subcooling ->
earlier boiling -> positive reactivity. Accident night: MCP inlet 280.8/283.2 C
vs Tsat ~284 C (near-zero subcooling). Deaerators: 4/unit, 0.69 MPa, 120 m3.

## April 25-26 1986 test (H)
Purpose: TG-8 coastdown to power 4 MCPs + feed pumps until diesels (~1 min).
Config: all 8 MCPs running (overflow: total ~57,000 m3/h vs ~45-48k nominal;
45,390 -> 54,590 when pumps 7/8 started 01:02-01:06; 57,120 at test start).
At 01:23:00-04 (DREG, left/right): power 200 MWt / 40 MWe; flow 57,120 m3/h;
feedwater 164/72 t/h; drum pressure 63/64 kgf/cm2; levels -50/-500 mm;
MCP inlet 280.8/283.2 C.
Timeline: 01:03/01:07 pumps 7/8 on; 01:23:04 TG-8 stop valves shut (test
start, ~36 s powered rundown); 01:23:40 AZ-5; 01:23:43 power >530 MWt, period
<20 s alarms; 01:23:46-47 coasting MCPs disconnect, flow -35-40%, drum
pressure spike; ~01:23:47-49 explosions; instruments lost 01:23:51-52.
Dyatlov/INSAG-7 note: 4 pumps/loop not itself prohibited; hazard was low
subcooling + positive void coeff + low ORM, not pump hydraulics.

## Minimal viable lumped model (~10 states)
Two symmetric loops i in {L,R}. Couple to core via (T_in_i, flow fraction
phi_i, pressure p_i); core returns steam generation Gamma_i (or exit quality)
and power.
States per loop: pump speed omega_i; loop flow W_i; drum pressure p_i; drum
water mass m_w_i; feedwater flow W_fw_i; core-inlet temp T_in_i. Optional
shared steam-header pressure p_s.
ODEs:
(a) I domega/dt = tau_motor - K_tau*omega*W (coastdown: tune to ~15% flow at
    ~45-60 s; powered: omega -> setpoint fast).
(b) (L/A) dW/dt = dH_pump(omega,W) + dH_buoyancy - R*W^2 (homologous pump
    curve a(w/w0)^2 + b(w/w0)(W/W0) + c(W/W0)^2; buoyancy = natural-circ floor;
    R tuned so 3 pumps -> ~46,000 m3/h total).
(c) V_s/(drho_g/dp) dp/dt = Gamma - W_turbine - W_BRUK(p) - W_relief(p).
(d) dm_w/dt = W_fw + W_sep - W_dc + swell/shrink from d(void inventory)/dt.
(e) T_fw dW_fw/dt = W_fw_dem - W_fw (three-impulse controller; manual override).
(f) T_dc = (W_rec*h_f(p) + W_fw*h_fw)/(W_rec+W_fw) -> T_in via transport delay
    V_downcomer/W; dT_sub = Tsat(p) - T_in; gate MCP cavitation on dT_sub
    (~23 m podpor limit).
Nominal anchors (full power, per loop): flow ~23,000 m3/h (3 pumps), drum
6.9 MPa, Tsat 284 C, feed 2800 t/h at 165 C, steam ~2750 t/h, T_in 270 C
(dT_sub ~14 C). Accident anchor: ~28,500 m3/h per loop (4 pumps), dT_sub
1-3 C, 200 MWt.
