# Native schedule mirroring — manual validation checklist (v0.1.9)

**Safety:** Test with a disposable, UI-created native Home Assistant Schedule Helper first, not the pellet stove's production schedule. Changing a native schedule can immediately affect automations that depend on it.

## Preparation

1. In Home Assistant, create a **UI Schedule Helper** called `BSB Mirror Test` and note its actual `schedule.*` entity ID.
2. Take a backup of its time blocks (Developer Tools → Actions → `schedule.get_schedule`).
3. Keep your original Siemens BSB-LAN schedule entities intact.
4. Configure the card in manual mode (replace the example target):

```yaml
type: custom:bsb-lan-schedule-card
title: Siemens Heating Schedule
entity_prefix: text.bsb_lan_heating_schedule_1_
mode_entity: select.bsb_lan_heating_circuit_1_operating_mode
native_schedule_entity: schedule.bsb_mirror_test
native_sync_mode: manual
time_step: 10
```

5. Install the v0.1.9 JavaScript and hard-refresh the dashboard (`Ctrl+F5`). Use an HA **administrator** login.

## Tests

- [ ] Card opens and shows all seven Siemens days unchanged.
- [ ] Header shows `Native HA: ...`, status, **Check** and **Sync HA** buttons.
- [ ] Card initially compares the schedules without sending any update; displays **Out of sync (N days)** when they differ and **In sync** if all seven match.
- [ ] Press **Check** and verify no native write happens, regardless of whether schedules match.
- [ ] Hover an out-of-sync status to see the differing weekdays; confirm `Sync HA` is disabled if **In sync**.
- [ ] While the card is open, edit a time block directly in the native Schedule Helper UI and verify status changes (uses HA `schedule/subscribe` where available). If subscription fails, press Check manually.
- [ ] Press **Sync HA** when out of sync. It should report an update; after read-only verification, show **In sync**. Check that all seven days of the *test helper* now match Siemens (use the native helper UI or `schedule.get_schedule`).
- [ ] With no intervening changes, **Sync HA** should now be disabled. **Check** should continue to work without sending updates.
- [ ] With `native_sync_mode: manual`, edit Monday in the card and Save; verify BSB-LAN first. The native schedule should **not** update until **Sync HA** is pressed.
- [ ] Change to `native_sync_mode: on_save`, edit a Siemens period and Save. Once MQTT confirms, the native schedule should update automatically.
- [ ] Change to `native_sync_mode: live`, change a Siemens period externally on the controller/BSB-LAN while the **dashboard remains open**. Verify that HA is updated after the MQTT state changes. Repeat with the dashboard closed: there is **no** card-side sync while the browser is closed.
- [ ] Configure an invalid `native_schedule_entity`; ensure sync reports a clear error and no other helper is changed.
- [ ] Try pointing to a YAML-defined schedule; sync must fail rather than editing the YAML schedule.
- [ ] If you have a helper with custom `data` on a time block, check that the card refuses to overwrite that day when its time ranges differ. Do **not** use your production schedule for this destructive test.
- [ ] Try BSB-LAN `24:00` as a phase end and verify it appears as `24:00:00` in the HA helper.
- [ ] Test light/dark theme and a narrow display width.

## Interpretation

`In sync` is **not** a permanent guarantee that the mirror is currently synchronized. It reflects the last read-only comparison. The card listens to HA native schedule-storage events while the dashboard is open and monitors Siemens entity states. A manual **Check** is also available. Neither comparisons nor synchronization run when the card is closed.

**For unattended pellet stove control**, a native HA schedule that is periodically mirrored by a dashboard cannot be assumed current after outages, browser closure, or unrelated changes. Use an HA backend solution or directly evaluate the BSB-LAN-derived heating state for operational control.

The mirror writes to the **native HA schedule only**. It never writes native schedule blocks back into Siemens.


## v0.1.8 acceptance checks

1. In `manual`, change P1 only in native HA, click **Check**, then click **Out of sync**. Verify exact P1 differences and matching P2 in the expanded viewer.
2. Make an extra native-HA period and verify `—` appears on the Siemens side for that slot.
3. Click the status again to collapse; neither action should write anything.
4. Make a Siemens source entity `unavailable`. **Check** must report failure and **Sync HA** must not modify the native helper.
5. If configured, set `source_health_entity` to `off` and verify sync is blocked. Test `on` afterward.
6. Only test `source_max_age_minutes` if source entity `last_updated` advances predictably; otherwise leave it unset.
7. Confirm Manual, On Save and Live modes still behave as in v0.1.6.


## v0.1.8 visual editor acceptance checks

1. Back up the current dashboard YAML. Open the existing card's visual editor and verify it reads title, current entity prefix, mode, native target, sync mode, time step, accent.
2. Change accent color via color picker; verify card appearance and YAML update. Reset to HA theme.
3. Switch from prefix to individual weekday mapping; verify all seven fields are pre-populated correctly. Switch back and confirm the intended prefix is retained.
4. Select a different native target but do NOT click Sync HA until it is verified. Clear the native target and confirm its sync mode is cleared.
5. Edit the card in YAML after using the visual editor; confirm no unknown or existing config keys are lost.
6. Verify the normal seven-day editor, Copy/Paste, Check/Sync HA, and difference viewer still work.

## Difference viewer layout regression

- [ ] With a day containing two periods, expand Out of sync; Source/P1/P2/P3 headers, Siemens, and Native HA must align in three rows. The third phase must display `—`.
- [ ] Check a mismatch containing a single period, and another with more than three native periods, if feasible; each column must remain aligned. The long row should scroll horizontally, not overlap the weekly schedule.

## v0.1.9 compact health badge acceptance checks

1. In the visual editor set **Source availability entity** to `sensor.bsb_lan_outside_temperature` (or use `source_health_entity: sensor.bsb_lan_outside_temperature`). Expect a green **Online** badge immediately to the **left** of the operating-mode badge while the temperature entity is available.
2. With `native_sync_mode: manual`, disconnect only BSB-LAN (not the Siemens controller). When the faster BSB-LAN temperature entity becomes `unavailable`, expect a red **Offline** badge and **Sync HA** disabled even if the MQTT schedule strings still hold their old values.
3. Once the temperature entity recovers, expect **Online**. If the MQTT entities are *still* unavailable, **Sync HA** must **remain disabled** even though the badge reads Online (this badge checks only the configured health entity).
4. A missing or `unknown` source-health entity must show **Offline**. For a `binary_sensor.*` or `input_boolean.*`, `off` must also show **Offline**.
5. Remove the source-health entity from the card config: the health badge must disappear entirely, while native comparison and schedule safety checks continue to work.
6. Check that the old separate source-status row does not appear, that the operating-mode badge is preserved, and that detailed schedule differences still display correctly.
