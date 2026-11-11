# BSB-LAN MQTT Schedule Card

A compact editable Home Assistant Lovelace card for **Siemens heating schedules exposed by BSB-LAN as writable `text.*` entities**, typically through MQTT Discovery.

![Version](https://img.shields.io/badge/version-0.1.9-blue?style=flat-square)
![Marketplace](https://img.shields.io/badge/Home%20Assistant-Marketplace-blue?style=flat-square)

![Compact Siemens weekly schedule editor with health and operating-mode badges](screenshots/schedule-overview.png)

## Overview

The card provides two levels:

1. a compact seven-day schedule overview;
2. an inline editor for one selected day.

A BSB-LAN schedule day is expected to use the Siemens three-period format:

```text
05:30-06:30 17:20-20:40 ##:##-##:##
```

`##:##-##:##` means that the trailing phase is unused.

The card reads and writes Home Assistant entities only. Saving uses `text.set_value`; the card does **not** publish MQTT directly.

## Main features

- Compact Monday-Sunday overview
- Click any weekday to edit it inline
- Up to three Siemens periods per day
- Siemens sequential-phase rules enforced
- `HH:MM` editor with configurable minute step
- `24:00` supported as an end time
- Direct `text.set_value` writeback
- Waits for Home Assistant/BSB-LAN to confirm a saved value
- Copy/Paste between day editors without writing until Save
- Detailed validation messages
- External-change conflict protection while editing
- Optional operating-mode badge
- Active-period highlighting when operating mode is Automatic
- Configurable card accent color
- Semantic colors for operating modes, active period, warnings, and errors
- Home Assistant theme-aware background/text/borders
- Responsive desktop/mobile layout
- Optional one-way synchronization to a native Home Assistant `schedule.*` UI helper
- `Sync HA` button; configurable manual, on-save, or live-while-dashboard-open modes
- Native update checks all seven days and skips no-op writes
- Preserves native schedule name, icon, unchanged days, and block data on unchanged days
- Rejects destructive replacement of custom block data on changed days
- Compact Online/Offline source-availability badge with fail-closed write blocking
- Optional source availability guard can use any Home Assistant entity (including normal BSB-LAN sensors)
- No external frontend dependencies

## Siemens schedule rules

The controller requires phases to be populated sequentially. Valid combinations are:

```text
Phase 1 ON   Phase 2 OFF  Phase 3 OFF
Phase 1 ON   Phase 2 ON   Phase 3 OFF
Phase 1 ON   Phase 2 ON   Phase 3 ON
```

Phase 1 is mandatory. Phase 3 cannot exist without Phase 2. The editor enforces these rules before anything can be sent to the controller.

## Quick configuration

```yaml
type: custom:bsb-lan-schedule-card
title: Siemens Heating Schedule
entity_prefix: text.bsb_lan_heating_schedule_1_
mode_entity: select.bsb_lan_heating_circuit_1_operating_mode
time_step: 10
accent_color: "#03a9f4"
```

`mode_entity` is optional. If it is omitted, the card does not show an operating-mode badge and does not claim that a schedule period is currently active.

### Optional native Home Assistant schedule mirroring

To mirror the seven BSB-LAN days into an existing **UI-created** native schedule helper:

```yaml
type: custom:bsb-lan-schedule-card
entity_prefix: text.bsb_lan_heating_schedule_1_
native_schedule_entity: schedule.floor_heating_schedule
native_sync_mode: manual
```

A read-only **Check** button and a **Sync HA** button appear. On opening the card, it compares all seven Siemens days against the native helper and displays **In sync** (green) or **Out of sync (N days)** (amber). Hover over the status for the differing weekdays. The check performs no writes. **Sync HA** is disabled when already in sync and copies the confirmed BSB-LAN values for the **entire week** into the native helper. It does not send anything back to Siemens or save unsaved editor drafts. The native schedule must be a UI-created schedule helper, and you must be an administrator. `native_sync_mode` may be `manual` (default), `on_save`, or `live`.

**Important: The card is browser-side, not a background service.** `on_save` updates the native helper only when a BSB-LAN write is confirmed *in this card*. `live` additionally notices external MQTT changes **while the dashboard/card is open**, and checks the mirror when the dashboard loads. With no dashboard open, no synchronization or status checking occurs. The status describes the last comparison, not a permanent synchronization guarantee. Do not rely on browser-side mirroring alone for unattended heating control after power outages. For automation-critical control, prefer the Siemens-derived `binary_sensor` or a backend synchronization integration.

The native helper is overwritten for days whose time ranges differ. The card refuses to erase nonempty custom block `data` on those days; identical days keep their block data. Take a schedule backup before first use.

For the complete option reference and configuration examples, see **[CONFIGURATION.md](CONFIGURATION.md)**. For the native-mirror acceptance checklist, see **[TESTING.md](TESTING.md)**.

## Required Home Assistant entities

The schedule itself requires seven writable `text.*` entities, one for each weekday. A typical BSB-LAN setup exposes:

```text
text.bsb_lan_heating_schedule_1_monday
text.bsb_lan_heating_schedule_1_tuesday
text.bsb_lan_heating_schedule_1_wednesday
text.bsb_lan_heating_schedule_1_thursday
text.bsb_lan_heating_schedule_1_friday
text.bsb_lan_heating_schedule_1_saturday
text.bsb_lan_heating_schedule_1_sunday
```

The optional operating-mode entity is normally a BSB-LAN `select.*` entity such as:

```text
select.bsb_lan_heating_circuit_1_operating_mode
```

It is deliberately **not auto-detected**. Configure the correct entity explicitly when you want mode support.

## New in v0.1.9

- `source_health_entity` now accepts **any existing Home Assistant entity**, such as `sensor.bsb_lan_outside_temperature`; no template binary sensor is needed. Missing, `unknown` and `unavailable` entities block native synchronization. `binary_sensor.*` and `input_boolean.*` must additionally be `on`.
- A compact **Online / Offline** indicator appears directly left of the operating-mode badge when a source health entity is configured. Green means the chosen entity is available (or `on` for binary health entities); red means unavailable, unknown, missing, or an inactive binary health entity. Hover for the entity ID/state. No badge is shown without a health entity.
- **Sync HA** is disabled while the source fails safety validation. No background connection monitoring has been introduced.
- A configured availability entity is only a proxy for source connectivity. It cannot independently prove successful Siemens-controller communication.

Example: `source_health_entity: sensor.bsb_lan_outside_temperature`.

## New in v0.1.8

- Graphical card configuration editor using Home Assistant's built-in entity selectors.
- Switch between seven explicit weekday entities and a common prefix.
- Accent color picker and optional safety settings, while preserving full YAML compatibility.
- Includes all v0.1.7 period-difference and safety improvements.

## Previous v0.1.7 changes

- Click **Out of sync (N days)** for a period-by-period comparison between Siemens and the native HA helper.
- New optional `source_health_entity` and `source_max_age_minutes` guards: fail closed before reading or writing when explicitly configured source health is not satisfactory.
- Existing cards and YAML configurations work without modification; optional safety guards are off by default.

## Installation

<!-- ha-marketplace:exclude-start -->
### Home Assistant Marketplace (2026.11 or newer)

1. Publish or locate the **public GitHub repository** containing these files. A local ZIP is not directly installable through Marketplace.
2. In Home Assistant, go to **Settings → Marketplace → Add from link** and enter its GitHub URL, e.g. `https://github.com/OWNER/REPOSITORY` (GitHub connection may be requested).
3. Install the repository as a **Dashboard** item. The Marketplace discovers this card using `hacs.json` and installs the JavaScript module.
4. Reload your Home Assistant browser, then add `custom:bsb-lan-schedule-card` to a dashboard. Existing card YAML remains valid.

You do **not** need a separate HACS installation in Home Assistant 2026.11 or newer.

### Older Home Assistant installations

Home Assistant 2026.10 and older use the separate HACS interface. This release declares Home Assistant 2026.11 as its minimum tested version; older versions are not verified and are not offered for this release. The legacy HACS repository format is otherwise broadly compatible.

### Migrating an existing manual installation

If you already load `bsb-lan-schedule-card.js` through a manually configured resource, **remove/disable the old resource before loading the Marketplace-installed resource**. The card registers a custom element, and loading both resources may cause a duplicate-registration error. Keep a backup of the existing JS and dashboard YAML; you do **not** need to recreate the card configuration.

The Marketplace-installed path is determined by the **GitHub repository name**, not by the archive filename:

```text
/local/community/<repository-name>/bsb-lan-schedule-card.js
```

### Manual installation

Copy `bsb-lan-schedule-card.js` into a directory under `/config/www/`, for example `/config/www/community/bsb-lan-schedule-card/`, and register one JavaScript Module resource at:

```text
/local/community/bsb-lan-schedule-card/bsb-lan-schedule-card.js
```

Hard-refresh the browser after updates. Never load both manual and Marketplace resources simultaneously.

<!-- ha-marketplace:exclude-end -->

For repository publishing instructions, see **[PUBLISHING.md](PUBLISHING.md)**.

## Editing and Save behavior

Opening a weekday creates a local draft. Nothing is written while start/end values, phase toggles, or Paste are being used.

Only **Save** sends the complete reconstructed schedule to Home Assistant. The card then waits for the `text.*` entity to report the same value before closing the editor.

## Copy/Paste

Copy/Paste is intentionally an editor operation:

```text
Open Monday -> Copy -> Open Tuesday -> Paste -> review -> Save
```

Paste only changes the local draft. It never writes to Siemens automatically.

The card tags copied values with its own compatible schedule format. Browser/OS clipboard access is best-effort because browser security rules can block it; the in-page card clipboard is the primary mechanism for normal Copy/Paste use.

## External changes while editing

If the selected Siemens schedule changes after the editor was opened and you have unsaved edits, the card does not overwrite either version silently. It shows:

- the new controller value;
- your local draft;
- **Reload Siemens** to discard the draft;
- **Keep my edits** to intentionally overwrite the newer controller value on the next Save.

## Operating modes

When `mode_entity` is configured, standard BSB-LAN values are shown as:

| State | Badge | Meaning in the card |
|---|---|---|
| `0 - Protection` | Protection | Schedule not treated as active |
| `1 - Automatic` | Automatic | Current schedule period can be highlighted |
| `2 - Reduced` | Reduced | Schedule not treated as active |
| `3 - Comfort` | Comfort | Continuous comfort mode; schedule period is not highlighted |
| invalid / unavailable | Unavailable | Mode state cannot be used |

## Color behavior

`accent_color` controls the non-semantic visual accent of the card, including the selected/today tint, enabled phase toggles, Save button, and focused editor controls.

Semantic states intentionally keep their own meaning:

- active schedule period: green;
- Automatic: blue;
- Comfort: green;
- Reduced: amber;
- Protection: grey;
- Unavailable/errors: red;
- unsaved/warning state: amber.

If `accent_color` is omitted, the card uses Home Assistant's `--primary-color`.

## Version 0.1.4

- `mode_entity` is now explicit and configurable; automatic hardcoded detection was removed
- Added configurable `accent_color`
- Accent is applied consistently to selection/today/editor controls
- Active schedule period now uses a semantic green highlight
- Operating-mode badge colors are semantic and independent of the chosen accent
- Unavailable mode now uses error/red styling
- Added complete configuration documentation and examples
- Retains v0.1.3 validation, conflict protection, Copy/Paste, and Siemens phase enforcement

See **[CHANGELOG.md](CHANGELOG.md)** for the version history.
