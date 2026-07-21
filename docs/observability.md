# Event log & observability

## SimEvent schema

Every reactor event is a `SimEvent` object with these fields:

| Field | Type | Description |
|---|---|---|
| `t` | `number` | Sim-time [s] when the event occurred |
| `level` | `"info"` \| `"warn"` \| `"alarm"` | Severity |
| `code` | `string` | Short event type code (e.g. `ROD_CMD`, `AZ5`, `STATE`) |
| `msg` | `string` | Human-readable one-line description |
| `data` | `Record<string, unknown>` (optional) | Structured state snapshot (power, period, ORM, etc.) |
| `seq` | `number` (optional) | Monotonic sequence number assigned by `EventLog.emit()` |
| `actor` | `string` (optional) | Who or what subsystem triggered this event |
| `cause` | `string` (optional) | Reason or trigger extracted from the message |
| `where` | `string` (optional) | Panel or subsystem where the event originated |
| `before` | `Record<string, unknown>` (optional) | Pre-transition state for transitions |
| `after` | `Record<string, unknown>` (optional) | Post-transition state for transitions |

## Sequence numbers

`EventLog` assigns a monotonically increasing `seq` to every event on emission.
If the caller supplies an explicit `seq` that is **greater** than the current
counter, the counter advances to it and subsequent auto-assigned sequences
remain monotonic. A supplied `seq` that is null or **less than or equal** to the
counter is silently replaced with the next auto-assigned value.

## Metadata enrichment

Before an event is emitted, `EventLog.info()`, `.warn()`, and `.alarm()` run an
`enrichMeta` pipeline that infers `actor`, `where`, and `cause` from the event
code and message text:

### `actor` inference

| Condition | `actor` value |
|---|---|
| `ROD_CMD`, `ROD_AUTO`, `SCRAM_HOLD`, `PERIOD_BLOCK`, `AZ_COCK`, `SEL_*` | `"operator"` |
| `AR_ENABLED`, `AR_SETPOINT`, `AR_GRADIENT`, `AR_MODE`, `AR_OVERRIDE`, `PROTECTION`, `AZ5_RESET` | `"operator"` |
| `FLOW`, `RHO_EXTRA`, `SPEED` | `"operator"` |
| `AZ1`, `AZ5` | `"protection logic"` |
| `SIL_BLOK`, `RPS_BLOCKED`, `PERIOD` | `"safety interlock"` |
| `AR_BAND`, `AR_CHANGEOVER`, `AR_NO_AUTH`, `LAR_DROPOUT` | `"AR controller"` |
| `STATE`, `POWER`, `PRIZMA` | `"instrumentation"` |
| `INIT` | `"plant startup"` |
| (fallback) | `"reactor core"` |

### `where` inference

| Condition | `where` value |
|---|---|
| `ROD_AUTO`, `SCRAM_HOLD`, `PERIOD_BLOCK`, `AZ_COCK`, `ROD_CMD` | `"rod controls"` |
| `AZ1`, `AZ5` | `"protection panel"` |
| `AR_*`, `LAR_*` | `"AR/regulation"` |
| `PROTECTION`, `RPS_BLOCKED`, `PERIOD` | `"protection panel"` |
| `FLOW` | `"coolant loop"` |
| `RHO_EXTRA`, `SPEED` | `"operator console"` |
| `STATE`, `POWER`, `PRIZMA` | `"control instruments"` |
| `INIT` | `"initialization"` |
| (fallback) | `"simulation kernel"` |

### `cause` inference

1. Explicit `cause` supplied by the caller (via the `meta` parameter).
2. `data.reason` (string), `data.reasonDetail` (string), `data.trigger` (string).
3. `data.cause` field (string).
4. Text after a Unicode em-dash (`—`) in the message string.
5. Text after ` - ` (space-dash-space) in the message string.

## Consumers

Events are held in an in-memory ring buffer (10 000 capacity, `EventLog.all()`)
and forwarded to three registered sinks:

1. **UI chronological feed**: renders each event with timestamp, sequence
   number, state summary, `actor`/`where`/`cause` context, state deltas
   for `STATE` events, and an expandable `<details>` for the full data payload.
2. **Annunciator lamps**: SIL_BLOK triggers clear the rod selection and light
   the power-interlock lamp; other event codes drive annunciator state.
3. **JSONL persistence** (when `bun run start` is running): batched every
   3 s or 100 events and POSTed to `POST /api/log/events`; a
   `navigator.sendBeacon` on page unload prevents event loss. The full log is
   downloadable from `GET /api/log/download` and lives at `data/log.jsonl`.

## Event codes

| Code | Level | Meaning |
|---|---|---|
| `INIT` | info | Reactor initialization |
| `PROTECTION` | info | Protection channel armed/blocked |
| `ROD_CMD` | info | Rod drive command issued |
| `SCRAM_HOLD` | warn | Withdrawal refused while scrammed |
| `ROD_AUTO` | warn | Manual command to auto-controlled rod refused |
| `PERIOD_BLOCK` | warn | Withdrawal blocked: short period |
| `AZ_COCK` | warn | Withdrawal refused: AZ bank not cocked |
| `AR_OVERRIDE` | info | Manual override/return of AR/LAR rods |
| `AR_ENABLED` | info | Automatic regulator engaged/disengaged |
| `AR_SETPOINT` | info | Power setpoint changed |
| `AR_GRADIENT` | info | Setpoint gradient changed |
| `AR_MODE` | info | Regulator mode switch (AR/ARM/LAR) |
| `AZ1` | alarm | AZ-1 setback actuated |
| `AZ5` | alarm | AZ-5 scram actuated |
| `AZ5_RESET` | info | Scram latch reset |
| `LAR_DROPOUT` | alarm | LAR dropped out, changeover to AR |
| `AR_BAND` | warn | Power outside regulator band |
| `AR_CHANGEOVER` | warn | AR subgroup changeover |
| `AR_NO_AUTH` | warn | AR out of authority (saturated) |
| `SIL_BLOK` | alarm | Power interlock: 8+ rods withdrawing halted |
| `PERIOD` | alarm | Reactor period below 15 s |
| `PRIZMA` | info/warn | Periodic ORM printout |
| `RPS_BLOCKED` | warn | Protection trip blocked by operator |
| `FLOW` | info | Pump flow changed |
| `RHO_EXTRA` | info | Extra reactivity changed |
| `SPEED` | info | Simulation speed changed |
| `STATE` | info | Periodic plant state snapshot |
| `POWER` | info | Power milestone crossed |
