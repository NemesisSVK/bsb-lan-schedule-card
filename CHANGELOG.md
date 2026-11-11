# Changelog

## v0.1.9

- Generalized `source_health_entity` to any HA entity; normal sensor values count as available, while missing/unknown/unavailable fail closed. Binary sensors and input booleans additionally require `on`.
- Added a compact green **Online** / red **Offline** health badge immediately left of the operating-mode badge (only when `source_health_entity` is configured). The badge reflects only the configured entity, not MQTT validity; the existing fail-closed checks remain unchanged. The original multi-state source status row was removed for a less cluttered layout.
- Disabled Sync HA when the source is unsafe. Retained separate native HA sync comparison status, existing editing flow, and v0.1.8 visual configuration editor.
- Added regression coverage for source availability, outage and recovery, display, and unrestricted entity picker.


## v0.1.8

- Fixed the native schedule difference viewer alignment when fewer than three phases are present; unused cells now remain explicitly aligned and long native schedules scroll horizontally.

- Added a Home Assistant graphical Lovelace card editor (`getConfigElement` / `config-changed`).
- Supports source-mode switching, seven HA text-entity pickers, optional mode/native/health entity selectors, time-step and accent controls.
- Preserved YAML configuration and all prior v0.1.7 behavior.
- Added offline tests for schema and emitted configuration, plus documentation.


## v0.1.7

- Added interactive read-only per-period difference viewer for out-of-sync native HA schedules.
- Added configurable fail-closed `source_health_entity` (binary_sensor/input_boolean expected on).
- Added optional `source_max_age_minutes` `last_updated` age guard; explicitly opt-in because this timestamp is not guaranteed to be a heartbeat.
- Clear difference details on failed comparisons and successful synchronization.
- Added offline regression coverage for differences and safety blockers.

## 0.1.6

- Added read-only synchronization status against the configured UI-created native HA schedule helper
- Automatic comparison on dashboard load, Siemens MQTT state changes, and native Schedule Helper updates (`schedule/subscribe`)
- Added **Check** button: re-reads schedules without any write, including in manual mode
- Green **In sync** / amber **Out of sync (N days)** status with hover details listing changed weekdays
- Disabled **Sync HA** when comparison confirms that all seven days already match
- No new YAML configuration required; manual mode remains write-on-click only
- Expanded automated tests and manual validation guidance

## 0.1.5

- Added optional, one-way BSB-LAN → native HA schedule helper mirroring through `schedule/list` and `schedule/update`
- Added explicit `native_schedule_entity` and `native_sync_mode` (`manual`, `on_save`, `live`)
- Added Sync HA button and detailed status/error messages
- Detects renamed native schedule entity IDs using the entity registry
- Validates all seven BSB-LAN source days before any native write
- Preserves native schedule name, icon, and unchanged days with their custom data
- Blocks destructive changes to native days that have custom block data
- Skips updates if schedules already match and verifies updates by readback
- Debounces live sync while the dashboard is open; no background behavior implied
- Added native mirroring instructions, safety caveats, and configuration examples


## 0.1.4

- Removed hardcoded/automatic operating-mode entity detection
- Added explicit optional `mode_entity`
- Added configurable `accent_color`
- Applied accent consistently to today/open/editor controls
- Changed active-period highlight to semantic green
- Added semantic operating-mode badge colors
- Unavailable operating mode now uses error/red styling
- Added comprehensive configuration documentation and examples

## 0.1.3

- Added optional operating-mode badge
- Added active-period highlighting while in Automatic mode
- Improved Phase 2/3 controls
- Added precise validation messages
- Improved external-change conflict handling

## 0.1.2

- Added editor-only Copy/Paste
- Added compatible tagged schedule clipboard format

## 0.1.1

- Enforced Siemens sequential phase rules
- Made Phase 1 mandatory
- Made Phase 3 dependent on Phase 2

## 0.1.0

- Initial working version
- Compact seven-day overview
- Inline day editor
- Three-phase parsing/editing
- Direct `text.set_value` writeback
