# Configuration Reference

This document describes every configuration option currently supported by **BSB-LAN MQTT Schedule Card v0.1.9** and gives common configuration examples.

## Visual configuration editor (v0.1.8)

When adding or editing this custom card through **Home Assistant Dashboard → Edit card**, the graphical editor offers:

- Card title, common `text.*` entity prefix, or explicit seven weekday `text.*` entity selectors;
- Optional Siemens operating-mode entity (`select.*`), native HA schedule (`schedule.*`), and synchronization mode;
- Time step (1–60), accent color text plus color picker and theme reset;
- Optional source availability entity of any Home Assistant domain and maximum source age.

The editor preserves existing YAML keys and does not invoke Siemens write operations. Switching to individual mapping initially populates all seven entities from the existing prefix; switching back to prefix requires the seven entity IDs to have the same prefix. The editor refuses unsafe conversion of heterogeneous IDs. **Inspect the generated mapping when changing input modes.**

YAML configuration remains fully supported, including for complex users who prefer manual editing. The editor relies on Home Assistant frontend selectors and should be verified on your HA version before publication.

## Full option reference

| Option | Type | Default | Required | Description |
|---|---|---|---|---|
| `type` | string | — | yes | Must be `custom:bsb-lan-schedule-card` |
| `title` | string | `BSB-LAN Heating Schedule` | no | Text shown in the card header |
| `entity_prefix` | string | — | one entity method required | Prefix used to construct all seven weekday `text.*` entity IDs |
| `entities` | object | — | one entity method required | Explicit Monday-Sunday `text.*` entity mapping |
| `time_step` | integer | `10` | no | Minute interval offered by the start/end selectors; allowed range 1-60 |
| `mode_entity` | string | omitted | no | Entity containing the BSB-LAN operating mode; enables the mode badge and Automatic-mode active-period highlighting |
| `accent_color` | CSS color string | Home Assistant `--primary-color` | no | Non-semantic card accent color |
| `native_schedule_entity` | `schedule.*` entity ID | omitted | no | Optional UI-created HA schedule helper to mirror Siemens's full week into |
| `native_sync_mode` | `manual` / `on_save` / `live` | `manual` | no | Native sync behavior, only valid together with `native_schedule_entity` |
| `source_health_entity` | any entity ID | omitted | no | Optional availability proxy; `unknown`, `unavailable`, or missing blocks native checks/writes. Binary sensors and input booleans additionally require `on` |
| `source_max_age_minutes` | positive number | omitted | no | Optional fail-closed check on each source `text.*` state `last_updated`; **not** a reliable MQTT connectivity test by itself |

Use **either** `entity_prefix` **or** `entities` for the schedule entities.

---

## `entity_prefix`

For the normal BSB-LAN naming pattern, `entity_prefix` is the shortest configuration.

```yaml
entity_prefix: text.bsb_lan_heating_schedule_1_
```

The card appends:

```text
monday
tuesday
wednesday
thursday
friday
saturday
sunday
```

which produces, for example:

```text
text.bsb_lan_heating_schedule_1_monday
```

The resulting entities must all be writable `text.*` entities.

---

## `entities`

Use explicit mapping if entities have been renamed or do not share one prefix.

```yaml
entities:
  monday: text.bsb_lan_heating_schedule_1_monday
  tuesday: text.bsb_lan_heating_schedule_1_tuesday
  wednesday: text.bsb_lan_heating_schedule_1_wednesday
  thursday: text.bsb_lan_heating_schedule_1_thursday
  friday: text.bsb_lan_heating_schedule_1_friday
  saturday: text.bsb_lan_heating_schedule_1_saturday
  sunday: text.bsb_lan_heating_schedule_1_sunday
```

All seven weekdays must be supplied.

---

## `time_step`

Default:

```yaml
time_step: 10
```

This controls which values the editor offers. For Siemens RVS time programs, **10 minutes is the recommended setting** because it matches the controller's normal time-program resolution.

The card deliberately preserves an existing controller value even if that value is not on the configured editor step; it will not silently round an already-stored schedule.

If a different step is used, make sure the target controller actually accepts those values. Using a multiple of 10 is safest for Siemens RVS systems.

---

## `mode_entity`

Example:

```yaml
mode_entity: select.bsb_lan_heating_circuit_1_operating_mode
```

The card does not guess this entity. The option is explicit because users can have multiple heating circuits, renamed entities, or no operating-mode entity at all.

When omitted:

- no operating-mode badge is shown;
- the schedule editor works normally;
- the card does not highlight a phase as currently active, because it cannot know whether the Siemens controller is actually following the schedule.

When configured but missing/unavailable, the card shows an **Unavailable** mode badge without preventing schedule editing.

The standard BSB-LAN states expected by the card are:

```text
0 - Protection
1 - Automatic
2 - Reduced
3 - Comfort
65535 - ---
```

Only `Automatic` allows the current schedule phase to be shown as active.

---

## `accent_color`

Example:

```yaml
accent_color: "#00a7c4"
```

Any valid CSS color string can be used, for example:

```yaml
accent_color: "#e67e22"
```

```yaml
accent_color: "rgb(156, 39, 176)"
```

or a Home Assistant/CSS variable where supported:

```yaml
accent_color: "var(--primary-color)"
```

The accent affects:

- today's row tint;
- opened/selected row tint;
- editor background tint;
- enabled Phase 2/3 switches;
- Save button;
- focused time controls;
- today's weekday label.

It intentionally does **not** recolor semantic status information.

### Semantic colors

| State | Color behavior |
|---|---|
| active period | green / success |
| Automatic mode | blue / info |
| Comfort mode | green / success |
| Reduced mode | amber / warning |
| Protection mode | grey / neutral |
| Unavailable mode | red / error |
| UNSAVED | amber / warning |
| validation / entity errors | red / error |
| external-change warning | amber / warning |

---


## Native Home Assistant schedule mirroring

Native schedule integration support is **optional**. Without `native_schedule_entity`, the card remains the original Siemens/BSB-LAN editor, with no native HA writes.

```yaml
native_schedule_entity: schedule.floor_heating_schedule
native_sync_mode: manual
```

This adds compact **Check** and **Sync HA** buttons, plus an automatic read-only comparison when the card loads. It reads all seven existing BSB-LAN text entity states and uses Home Assistant's WebSocket `schedule/list` and `schedule/update` APIs to update the named schedule helper. The direction is **Siemens → native HA**, never the reverse. The native entity's own name, icon, unchanged schedule blocks, and any custom data on unchanged blocks are kept. Native days that differ from Siemens are replaced. There is no op if the times already match.

**Read-only status:** `In sync` means all seven days matched by start/end times at the last check. `Out of sync (N days)` means one or more weekdays differ (hover for names). Only time blocks are compared, not additional block `data` or Siemens operating mode. The card checks on dashboard load and BSB-LAN MQTT source changes, and watches `schedule/subscribe` for native helper edits while the dashboard is open. Press **Check** to force a comparison at any time. It never writes on Check, including in `manual` mode. If HA WebSocket subscriptions are unavailable, the Check button remains available.

**Detailed difference viewer (v0.1.8):** when the status says `Out of sync (N days)`, click the status to expand a read-only comparison. It lists the actual Siemens and native HA periods side-by-side, highlighting individual differences. Only differing days are included; no WebSocket update is sent by opening the viewer.

**Optional source-safety guards:**

```yaml
source_health_entity: sensor.bsb_lan_outside_temperature  # Example; must be available
# source_max_age_minutes: 120  # Optional; use only if source states are refreshed regularly
```

The card already validates all seven source strings (including mandatory P1, sequencing and overlap) before comparing or synchronizing; an unavailable/invalid day blocks the whole operation. If configured, `source_health_entity` must exist and have a normal available state. Missing, `unknown` and `unavailable` all block operations. For `binary_sensor.*` and `input_boolean.*`, the state must also be `on` (`off` blocks). Normal sensor values such as outdoor temperature are acceptable, including `0` or negative readings. `source_max_age_minutes` additionally rejects missing or old `last_updated` timestamps, but **an unchanged state may retain an old timestamp even if Siemens is healthy**. Only enable this check when your integration refreshes state timestamps predictably. No stale-data freshness guarantee exists by default. These are card-side checks, not an always-on health monitor.

**Compact health badge (v0.1.9):** If `source_health_entity` is configured, the card displays a badge directly **to the left of the operating-mode badge** with the same font, rounded shape, and padding:

| Badge | Condition | Meaning |
|---|---|---|
| **Online** (green) | Configured entity exists and has an available state; binary sensors/input booleans must be `on` | Availability proxy is healthy |
| **Offline** (red) | Entity is missing, `unknown`, `unavailable`, empty, or a binary sensor/input boolean is not `on` | Availability proxy is unhealthy; native synchronization blocked |
| **No badge** | `source_health_entity` not configured | No independent availability proxy selected |

The badge reflects **only the selected health entity**, not the state of the seven MQTT schedule strings. For instance, the badge may still read **Online** while an MQTT schedule entity is unavailable; native synchronization remains blocked by the existing schedule validation guard. Hover to view the monitored entity and its state/reason. The badge is not an end-to-end Siemens communication test. `source_max_age_minutes` remains an optional separate synchronization guard, not a heartbeat, and it does not affect the badge.

**Sync HA** is disabled after a successful check shows `In sync`; a changed schedule or a new check can re-enable it. No new YAML options are required. A failed check is distinct from an out-of-sync result.

**Modes**

| Value | Behavior |
|---|---|
| `manual` (default) | Only writes the HA helper when **Sync HA** is explicitly clicked. Read-only comparisons still run. Editing Siemens does *not* automatically update the native helper. |
| `on_save` | Also tries to synchronize the whole week after this card sees confirmation of a Siemens day Save. External Siemens changes are not automatically mirrored. |
| `live` | In addition, mirrors changed Siemens MQTT states while the dashboard is open, including an initial check on opening the dashboard; writes only if schedules differ. Updates are debounced by 1.2 seconds. |

The Sync HA button always uses **confirmed MQTT entity states**, not unsaved drafts from an open editor. It is disabled while the editor has unsaved changes. Updating a native helper requires **administrator** permissions.

### Important limitations

- The target must be a **UI-created native schedule helper**. `schedule.*` entities defined in YAML are read-only for this storage WebSocket update path.
- **A Lovelace card cannot synchronize when nobody has it open.** `live` does not run as a background service, and it cannot guarantee control-state correctness after power loss or HA restarts.
- This is **one-way** synchronization only. Changes you make directly in the native Schedule Helper UI may be overwritten the next time the card synchronizes.
- The entire seven-day Siemens week is the source of truth. The helper's days with different time blocks are replaced. There is no day-level merge.
- Custom `data` attached to native time blocks can be lost during replacement; to prevent accidental data loss, the card **refuses to change a day containing nonempty custom block data** until you resolve that separately. Unchanged days keep the data.
- `schedule/update` is a frontend-management WebSocket API, **not a documented automation action**. Its contract may change across Home Assistant releases.
- The card checks for missing/invalid BSB-LAN entities and invalid/overlapping periods before updating anything.
- The card resolves the helper's internal schedule ID through HA's entity registry to handle renamed entities. If it cannot safely identify the target, it refuses to update.
- Keep your Siemens operating mode semantics in mind: a schedule helper mirrors the **programmed time ranges**, not whether the RVS is in Automatic, Comfort, Reduced, or Protection mode. If pellet stove operation must follow *effective heating demand*, a derived state sensor including the Siemens operating mode may be more appropriate.

For heating control that must function **unattended**, use a backend process or an HA template binary sensor based directly on BSB-LAN entities, rather than depending on the card remaining open.

### Testing safely

1. Ensure the target native schedule is UI-created, and back up its existing time blocks (Developer Tools → Actions → `schedule.get_schedule`).
2. Set `native_sync_mode: manual` and identify the *exact* native `schedule.*` entity you intend to overwrite.
3. Open the card and observe the automatically computed status. Click **Check** to confirm a read-only comparison; note the changed-day count before touching **Sync HA**.
4. Click **Sync HA** only if out of sync and inspect the new status.
5. Verify all seven days in the native Schedule Helper editor or using `schedule.get_schedule`.
6. Change one Siemens period using the card, Save and verify BSB-LAN first. The status should change to **Out of sync**; click Sync HA and confirm the new native period.
7. Only then consider `on_save` or `live` mode.

---

# Example configurations

## 1. Minimal schedule editor

No mode badge, Home Assistant theme accent:

```yaml
type: custom:bsb-lan-schedule-card
entity_prefix: text.bsb_lan_heating_schedule_1_
```

## 2. Recommended Siemens setup

```yaml
type: custom:bsb-lan-schedule-card
title: Siemens Heating Schedule
entity_prefix: text.bsb_lan_heating_schedule_1_
mode_entity: select.bsb_lan_heating_circuit_1_operating_mode
time_step: 10
```

## 3. Custom cyan accent

```yaml
type: custom:bsb-lan-schedule-card
title: Floor Heating
entity_prefix: text.bsb_lan_heating_schedule_1_
mode_entity: select.bsb_lan_heating_circuit_1_operating_mode
accent_color: "#00a7c4"
time_step: 10
```

## 4. Orange accent

Only the visual accent changes. Mode/active/warning/error colors keep their semantic meaning.

```yaml
type: custom:bsb-lan-schedule-card
title: Heating Schedule
entity_prefix: text.bsb_lan_heating_schedule_1_
mode_entity: select.bsb_lan_heating_circuit_1_operating_mode
accent_color: "#ff7a00"
```

## 5. Explicit entities after Home Assistant renaming

```yaml
type: custom:bsb-lan-schedule-card
title: Siemens Schedule
mode_entity: select.siemens_heating_operating_mode
entities:
  monday: text.siemens_schedule_monday
  tuesday: text.siemens_schedule_tuesday
  wednesday: text.siemens_schedule_wednesday
  thursday: text.siemens_schedule_thursday
  friday: text.siemens_schedule_friday
  saturday: text.siemens_schedule_saturday
  sunday: text.siemens_schedule_sunday
```

## 6. Another heating circuit

If BSB-LAN exposes another Siemens schedule/circuit, point the card to that entity set and its corresponding mode selector.

```yaml
type: custom:bsb-lan-schedule-card
title: Heating Circuit 2
entity_prefix: text.bsb_lan_heating_schedule_2_
mode_entity: select.bsb_lan_heating_circuit_2_operating_mode
time_step: 10
accent_color: "#9c27b0"
```

The exact entity names depend on the BSB-LAN/Home Assistant discovery names in the installation.

## 7. Coarser editor choices

A 20-minute selector step remains aligned to Siemens' 10-minute resolution:

```yaml
type: custom:bsb-lan-schedule-card
entity_prefix: text.bsb_lan_heating_schedule_1_
time_step: 20
```

Existing off-step values are still preserved until edited.

---

# Editor behavior

## Phase sequencing

The editor intentionally implements Siemens rules rather than allowing arbitrary empty slots:

- Phase 1 is always required;
- Phase 2 can be turned on/off;
- Phase 3 can only be turned on while Phase 2 is enabled;
- turning Phase 2 off also turns Phase 3 off.

Valid serialized examples:

```text
05:30-06:30 ##:##-##:## ##:##-##:##
```

```text
05:30-06:30 17:00-20:00 ##:##-##:##
```

```text
05:30-06:30 17:00-20:00 22:00-23:00
```

A middle gap such as this is not considered a valid Siemens schedule:

```text
05:30-06:30 ##:##-##:## 22:00-23:00
```

## Validation

Save and Copy are blocked for invalid drafts. Validation covers:

- Phase 1 mandatory;
- Phase 3 dependency on Phase 2;
- invalid/missing start time;
- invalid/missing end time;
- end must be later than start;
- overlaps with the previous enabled phase.

The editor reports the specific phase and relevant times where possible.

## `24:00`

`24:00` is accepted as an **end** value. It is not offered as a start value.

## Save confirmation

After `text.set_value` is called, the card waits for the Home Assistant entity to report the exact new schedule string. Normally BSB-LAN updates quickly. If confirmation has not arrived after the card's wait period, the editor remains open and reports that the command was sent but has not yet been confirmed.

## External changes

If a schedule entity changes externally while its editor contains unsaved changes, the card shows a conflict panel. This protects against silently overwriting changes made from the Siemens controller, another Home Assistant session, or another writer.

## Copy/Paste

Copy/Paste operates on the editor draft only. Paste never sends data to Siemens until Save is pressed.

The card uses a tagged format internally:

```text
BSB-LAN-SCHEDULE:v1|05:30-06:30 17:00-20:00 ##:##-##:##
```

This prevents arbitrary clipboard text from being interpreted as a compatible schedule.

## 8. Native schedule helper — manual sync (safest first test)

```yaml
type: custom:bsb-lan-schedule-card
title: Floor Heating (Siemens)
entity_prefix: text.bsb_lan_heating_schedule_1_
mode_entity: select.bsb_lan_heating_circuit_1_operating_mode
native_schedule_entity: schedule.floor_heating_schedule
native_sync_mode: manual
accent_color: "#03a9f4"
```

## 9. Native schedule helper — after saving Siemens

```yaml
type: custom:bsb-lan-schedule-card
entity_prefix: text.bsb_lan_heating_schedule_1_
native_schedule_entity: schedule.floor_heating_schedule
native_sync_mode: on_save
```

## 10. Live browser-side mirror — for supervised use

```yaml
type: custom:bsb-lan-schedule-card
entity_prefix: text.bsb_lan_heating_schedule_1_
native_schedule_entity: schedule.floor_heating_schedule
native_sync_mode: live
```

**Live mode does not operate in the background** once the dashboard is closed. It is not sufficient as the sole mechanism for maintaining a heater-control schedule.
