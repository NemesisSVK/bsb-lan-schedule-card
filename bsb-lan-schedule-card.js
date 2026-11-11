/**
 * BSB-LAN MQTT Schedule Card for Home Assistant
 *
 * Editable weekly schedule card for Siemens heating schedules exposed by
 * BSB-LAN as writable Home Assistant text entities (typically via MQTT Discovery).
 *
 * @version 0.1.9
 */

const BSB_SCHEDULE_CARD_VERSION = '0.1.9';
const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DISABLED_PERIOD = '##:##-##:##';
const CLIPBOARD_PREFIX = 'BSB-LAN-SCHEDULE:v1|';
const CARD_CLIPBOARD_KEY = '__BSB_LAN_SCHEDULE_CARD_CLIPBOARD_V1__';
const INVALID_STATES = new Set(['unknown', 'unavailable', 'none', '']);
const JS_DAY_TO_INDEX = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };

class BSBLANScheduleCard extends HTMLElement {
    static getConfigElement() {
        return document.createElement('bsb-lan-schedule-card-editor');
    }

    static getStubConfig(hass) {
        // Prefer a real seven-day prefix if it is present, otherwise offer a
        // documented example which the visual editor can replace.
        let found = 'text.bsb_lan_heating_schedule_1_';
        const entities = hass?.states || {};
        const mon = Object.keys(entities).filter(id => id.startsWith('text.') && id.endsWith('_monday'));
        for (const candidate of mon) {
            const prefix = candidate.slice(0, -'monday'.length);
            if (DAY_KEYS.every(day => entities[`${prefix}${day}`])) {
                found = prefix;
                break;
            }
        }
        return { title: 'BSB-LAN Heating Schedule', entity_prefix: found, time_step: 10 };
    }

    constructor() {
        super();
        this._config = null;
        this._hass = null;
        this._entities = {};
        this._editingDay = null;
        this._draft = null;
        this._sourceAtOpen = null;
        this._dirty = false;
        this._conflict = false;
        this._saving = false;
        this._expectedValue = null;
        this._saveMessage = '';
        this._lastRelevantSignature = null;
        this._saveTimer = null;
        this._clockTimer = null;
        this._nativeSyncing = false;
        this._nativeSyncStatus = '';
        this._nativeSyncError = false;
        this._nativeSyncTimer = null;
        this._nativeQueued = false;
        this._nativeObservedSignature = null;
        this._nativeChecking = false;
        this._nativeCheckTimer = null;
        this._nativeCheckQueued = false;
        this._nativeCheckGeneration = 0;
        this._nativeStatusState = 'unchecked';
        this._nativeDiffDays = [];
        this._nativeDiffDetails = [];
        this._nativeDiffExpanded = false;
        this._nativeStorageId = null;
        this._nativeUnsubscribe = null;
        this._nativeSubscriptionPending = false;
        this._nativeSubscriptionConnection = null;
        this._nativeSubscriptionFailedConnection = null;
    }

    setConfig(config) {
        if (!config) {
            throw new Error('Configuration is required');
        }

        const timeStep = Number(config.time_step ?? 10);
        if (!Number.isInteger(timeStep) || timeStep < 1 || timeStep > 60) {
            throw new Error('time_step must be an integer between 1 and 60 minutes');
        }

        let modeEntity = null;
        if (config.mode_entity !== undefined && config.mode_entity !== null && config.mode_entity !== false) {
            if (typeof config.mode_entity !== 'string' || !config.mode_entity.trim()) {
                throw new Error('mode_entity must be a Home Assistant entity ID, or omitted');
            }
            modeEntity = config.mode_entity.trim();
        }

        let accentColor = null;
        if (config.accent_color !== undefined && config.accent_color !== null && config.accent_color !== '') {
            if (typeof config.accent_color !== 'string' || !config.accent_color.trim()) {
                throw new Error('accent_color must be a valid CSS color string');
            }
            accentColor = config.accent_color.trim();
            if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('color', accentColor)) {
                throw new Error(`accent_color is not a valid CSS color: ${accentColor}`);
            }
        }

        // Native HA schedule mirroring is explicitly opt-in. This card only
        // operates while an HA dashboard containing it is open.
        let nativeScheduleEntity = null;
        if (config.native_schedule_entity !== undefined && config.native_schedule_entity !== null && config.native_schedule_entity !== '') {
            if (typeof config.native_schedule_entity !== 'string' ||
                !/^schedule\.[a-z0-9_]+$/.test(config.native_schedule_entity.trim())) {
                throw new Error('native_schedule_entity must be a schedule.* entity ID');
            }
            nativeScheduleEntity = config.native_schedule_entity.trim();
        }

        // Optional fail-closed source-availability input. Accept any HA entity domain.
        // Binary sensors and input booleans additionally require 'on'.
        let sourceHealthEntity = null;
        if (config.source_health_entity !== undefined && config.source_health_entity !== null && config.source_health_entity !== '') {
            if (typeof config.source_health_entity !== 'string' ||
                !/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(config.source_health_entity.trim())) {
                throw new Error('source_health_entity must be a Home Assistant entity ID');
            }
            sourceHealthEntity = config.source_health_entity.trim();
        }

        // HA last_updated is NOT a guaranteed source heartbeat. Off by default.
        const maxSourceAge = config.source_max_age_minutes == null || config.source_max_age_minutes === ''
            ? null : Number(config.source_max_age_minutes);
        if (maxSourceAge !== null && (!Number.isFinite(maxSourceAge) || maxSourceAge <= 0)) {
            throw new Error('source_max_age_minutes must be a positive number, or omitted');
        }

        const nativeSyncMode = config.native_sync_mode ?? 'manual';
        if (!['manual', 'on_save', 'live'].includes(nativeSyncMode)) {
            throw new Error('native_sync_mode must be manual, on_save, or live');
        }
        if (!nativeScheduleEntity && config.native_sync_mode !== undefined) {
            throw new Error('native_sync_mode requires native_schedule_entity');
        }

        this._config = {
            ...config,
            title: config.title || 'BSB-LAN Heating Schedule',
            time_step: timeStep,
            mode_entity: modeEntity,
            accent_color: accentColor,
            native_schedule_entity: nativeScheduleEntity,
            native_sync_mode: nativeSyncMode,
            source_health_entity: sourceHealthEntity,
            source_max_age_minutes: maxSourceAge,
        };

        this.style.setProperty(
            '--bsb-accent-color',
            accentColor || 'var(--primary-color, #03a9f4)'
        );

        this._entities = this._resolveEntities(config);
        this._editingDay = null;
        this._draft = null;
        this._sourceAtOpen = null;
        this._dirty = false;
        this._conflict = false;
        this._saving = false;
        this._expectedValue = null;
        this._saveMessage = '';
        this._lastRelevantSignature = null;
        this._nativeObservedSignature = null;
        this._nativeSyncStatus = '';
        this._nativeSyncError = false;
        this._nativeStatusState = 'unchecked';
        this._nativeDiffDays = [];
        this._nativeDiffDetails = [];
        this._nativeDiffExpanded = false;
        this._nativeStorageId = null;
        this._nativeCheckGeneration++;
        this._nativeQueued = false;
        this._clearNativeSyncTimer();
        this._clearNativeCheckTimer();
        if (!nativeScheduleEntity) this._stopNativeSubscription();

        if (this._hass) {
            this._render();
            this._ensureNativeSubscription();
            if (this.isConnected && nativeScheduleEntity) this._queueNativeCheck();
        }
    }

    _resolveEntities(config) {
        const result = {};

        if (config.entities && typeof config.entities === 'object' && !Array.isArray(config.entities)) {
            for (const day of DAY_KEYS) {
                result[day] = config.entities[day];
            }
        } else if (config.entity_prefix && typeof config.entity_prefix === 'string') {
            for (const day of DAY_KEYS) {
                result[day] = `${config.entity_prefix}${day}`;
            }
        } else {
            throw new Error('Define either entities: { monday: ..., ... } or entity_prefix');
        }

        for (const day of DAY_KEYS) {
            const entityId = result[day];
            if (!entityId || typeof entityId !== 'string') {
                throw new Error(`Missing entity for ${day}`);
            }
            if (!entityId.startsWith('text.')) {
                throw new Error(`Entity for ${day} must be a text.* entity: ${entityId}`);
            }
        }

        return result;
    }

    set hass(hass) {
        this._hass = hass;
        if (!this._config) return;

        const modeEntity = this._resolveModeEntityId();
        const signatureParts = DAY_KEYS
            .map(day => `${this._entities[day]}=${hass.states[this._entities[day]]?.state ?? '__missing__'}`);
        if (modeEntity) {
            signatureParts.push(`${modeEntity}=${hass.states[modeEntity]?.state ?? '__missing__'}`);
        }
        if (this._config.source_health_entity) {
            const health = this._config.source_health_entity;
            signatureParts.push(`${health}=${hass.states[health]?.state ?? '__missing__'}`);
        }
        const signature = signatureParts.join('|');

        this._ensureClockTimer();
        this._ensureNativeSubscription();

        let internalStateChanged = false;

        if (this._editingDay) {
            const raw = this._getEntityState(this._editingDay);

            if (this._saving && this._expectedValue && raw === this._expectedValue) {
                this._nativeAfterConfirmedSave();
                this._clearSaveTimer();
                this._editingDay = null;
                this._draft = null;
                this._sourceAtOpen = null;
                this._dirty = false;
                this._conflict = false;
                this._saving = false;
                this._expectedValue = null;
                this._saveMessage = '';
                internalStateChanged = true;
            } else if (!this._saving && raw !== this._sourceAtOpen) {
                if (this._dirty) {
                    if (!this._conflict) {
                        this._conflict = true;
                        internalStateChanged = true;
                    }
                } else {
                    const parsed = this._parseSchedule(raw);
                    if (parsed.valid) {
                        this._draft = parsed.phases;
                        this._sourceAtOpen = raw;
                        this._conflict = false;
                        internalStateChanged = true;
                    }
                }
            }
        }

        if (signature !== this._lastRelevantSignature || internalStateChanged) {
            this._lastRelevantSignature = signature;
            this._render();
        }

        // Watching MQTT entity *state changes* is enough for live mode. The
        // hass setter also receives many unrelated HA updates; ignore those.
        const sourceSignature = this._nativeSourceSignature();
        if (this._nativeObservedSignature !== sourceSignature) {
            const wasInitialized = this._nativeObservedSignature !== null;
            this._nativeObservedSignature = sourceSignature;
            if (this._config.native_schedule_entity && !this._nativeSyncing) {
                this._nativeSyncStatus = wasInitialized
                    ? 'Checking after Siemens change…'
                    : 'Checking HA schedule…';
                this._nativeStatusState = 'checking';
                this._nativeSyncError = false;
                this._nativeDiffDays = [];
                this._nativeDiffDetails = [];
                this._render();
                if (this.isConnected) this._queueNativeCheck();
            }
            if (this.isConnected && this._config.native_sync_mode === 'live') {
                this._queueNativeSync();
            }
        }
    }

    getCardSize() {
        // Compact week + one inline editor when open.
        return this._editingDay ? 6 : 3;
    }

    getGridOptions() {
        return {
            columns: 12,
            min_rows: this._editingDay ? 5 : 3,
        };
    }

    connectedCallback() {
        this._ensureClockTimer();
        this._ensureNativeSubscription();
        if (this._hass && this._config?.native_schedule_entity) {
            this._queueNativeCheck();
            // In live mode, the dashboard actively mirrors Siemens to HA.
            if (this._config.native_sync_mode === 'live') this._queueNativeSync();
        }
    }

    disconnectedCallback() {
        this._clearSaveTimer();
        this._clearNativeSyncTimer();
        this._clearNativeCheckTimer();
        this._nativeCheckGeneration++;
        this._stopNativeSubscription();
        if (this._clockTimer) {
            clearInterval(this._clockTimer);
            this._clockTimer = null;
        }
    }

    _ensureClockTimer() {
        if (this._clockTimer) return;
        this._clockTimer = setInterval(() => {
            // Avoid rebuilding form controls while the user is editing.
            // The timer is only needed to move the active-period highlight.
            if (this._hass && this._config && !this._editingDay) {
                this._render();
            }
        }, 30000);
    }

    _clearSaveTimer() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
    }

    _getEntityState(day) {
        const entityId = this._entities[day];
        const stateObj = this._hass?.states?.[entityId];
        return stateObj ? String(stateObj.state ?? '') : '__missing__';
    }

    _resolveModeEntityId() {
        const configured = this._config?.mode_entity;
        return typeof configured === 'string' && configured.trim()
            ? configured.trim()
            : null;
    }

    _getModeInfo() {
        const entityId = this._resolveModeEntityId();
        if (!entityId) return null;

        const stateObj = this._hass?.states?.[entityId];
        if (!stateObj) {
            return { entityId, code: null, label: 'Unavailable', className: 'mode-unavailable', raw: '__missing__' };
        }

        const raw = String(stateObj.state ?? '').trim();
        if (INVALID_STATES.has(raw.toLowerCase()) || raw.startsWith('65535')) {
            return { entityId, code: null, label: 'Unavailable', className: 'mode-unavailable', raw };
        }

        const match = raw.match(/^(-?\d+)/);
        const code = match ? Number(match[1]) : NaN;
        const modes = {
            0: { label: 'Protection', className: 'mode-protection' },
            1: { label: 'Automatic', className: 'mode-automatic' },
            2: { label: 'Reduced', className: 'mode-reduced' },
            3: { label: 'Comfort', className: 'mode-comfort' },
        };
        const mapped = modes[code];
        if (!mapped) {
            return { entityId, code: Number.isFinite(code) ? code : null, label: raw || 'Unknown', className: 'mode-unavailable', raw };
        }

        return { entityId, code, label: mapped.label, className: mapped.className, raw };
    }

    _getActivePhaseIndex(phases, dayIndex, modeInfo) {
        if (dayIndex !== this._getTodayIndex() || modeInfo?.code !== 1) return -1;

        const now = new Date();
        const current = now.getHours() * 60 + now.getMinutes();
        return phases.findIndex(phase => {
            if (!phase.enabled) return false;
            const start = this._timeToMinutes(phase.start);
            const end = this._timeToMinutes(phase.end);
            return Number.isFinite(start) && Number.isFinite(end) && current >= start && current < end;
        });
    }

    _parseSchedule(raw) {
        const normalized = String(raw ?? '').trim();

        if (normalized === '__missing__') {
            return { valid: false, error: 'Entity not found', phases: [] };
        }
        if (INVALID_STATES.has(normalized.toLowerCase())) {
            return { valid: false, error: `Entity state is ${normalized || 'empty'}`, phases: [] };
        }

        const tokens = normalized.split(/\s+/).filter(Boolean);
        if (tokens.length > 3) {
            return { valid: false, error: 'Expected at most 3 periods', phases: [] };
        }

        const phases = [];
        for (let i = 0; i < 3; i++) {
            const token = tokens[i] || DISABLED_PERIOD;

            if (token === DISABLED_PERIOD) {
                phases.push({ enabled: false, start: '', end: '' });
                continue;
            }

            const match = token.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
            if (!match || !this._isValidTime(match[1], false) || !this._isValidTime(match[2], true)) {
                return { valid: false, error: `Invalid period: ${token}`, phases: [] };
            }

            phases.push({ enabled: true, start: match[1], end: match[2] });
        }

        // Siemens time programs require periods to be filled sequentially:
        // Phase 1 is mandatory; Phase 3 cannot exist unless Phase 2 exists.
        if (!phases[0].enabled) {
            return { valid: false, error: 'Phase 1 is required by the Siemens controller', phases: [] };
        }
        if (!phases[1].enabled && phases[2].enabled) {
            return { valid: false, error: 'Invalid Siemens schedule: Phase 3 cannot be enabled while Phase 2 is disabled', phases: [] };
        }

        return { valid: true, error: '', phases };
    }

    _isValidTime(value, allow24 = false) {
        if (!/^\d{2}:\d{2}$/.test(value || '')) return false;
        const [h, m] = value.split(':').map(Number);
        if (allow24 && h === 24 && m === 0) return true;
        return h >= 0 && h <= 23 && m >= 0 && m <= 59;
    }

    _timeToMinutes(value) {
        if (!this._isValidTime(value, true)) return NaN;
        const [h, m] = value.split(':').map(Number);
        return h * 60 + m;
    }

    _serializeDraft() {
        return this._draft
            .map(phase => phase.enabled ? `${phase.start}-${phase.end}` : DISABLED_PERIOD)
            .join(' ');
    }

    _validateDraft() {
        if (!this._draft || this._draft.length !== 3) {
            return 'Internal editor state is invalid.';
        }

        if (!this._draft[0].enabled) {
            return 'Phase 1 is required by the Siemens controller.';
        }
        if (!this._draft[1].enabled && this._draft[2].enabled) {
            return 'Phase 3 requires Phase 2 to be enabled.';
        }

        let previousEnabled = null;

        for (let i = 0; i < this._draft.length; i++) {
            const phase = this._draft[i];
            const number = i + 1;

            if (!phase.enabled) continue;

            if (!this._isValidTime(phase.start, false)) {
                return `Phase ${number} has an invalid start time.`;
            }
            if (!this._isValidTime(phase.end, true)) {
                return `Phase ${number} has an invalid end time.`;
            }

            const start = this._timeToMinutes(phase.start);
            const end = this._timeToMinutes(phase.end);

            if (start >= end) {
                return `Phase ${number} end (${phase.end}) must be later than its start (${phase.start}).`;
            }

            if (previousEnabled && start < previousEnabled.end) {
                return `Phase ${number} overlaps Phase ${previousEnabled.number}: it starts at ${phase.start}, before Phase ${previousEnabled.number} ends at ${previousEnabled.endText}.`;
            }

            previousEnabled = { number, end, endText: phase.end };
        }

        return '';
    }

    _formatPhase(phase) {
        return phase.enabled ? `${phase.start}–${phase.end}` : '—';
    }

    _escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    _getTodayIndex() {
        return JS_DAY_TO_INDEX[new Date().getDay()];
    }

    _openEditor(day) {
        if (this._saving) return;

        if (this._editingDay && this._editingDay !== day && this._dirty) {
            this._saveMessage = 'Save or cancel the current day before editing another day.';
            this._render();
            return;
        }

        if (this._editingDay === day) {
            if (!this._dirty) {
                this._cancelEditor();
            }
            return;
        }

        const raw = this._getEntityState(day);
        const parsed = this._parseSchedule(raw);
        if (!parsed.valid) {
            this._editingDay = day;
            this._draft = null;
            this._sourceAtOpen = raw;
            this._dirty = false;
            this._conflict = false;
            this._saveMessage = parsed.error;
            this._render();
            return;
        }

        this._editingDay = day;
        this._draft = parsed.phases.map(p => ({ ...p }));
        this._sourceAtOpen = raw;
        this._dirty = false;
        this._conflict = false;
        this._saving = false;
        this._expectedValue = null;
        this._saveMessage = '';
        this._render();
    }

    _cancelEditor() {
        if (this._saving) return;
        this._editingDay = null;
        this._draft = null;
        this._sourceAtOpen = null;
        this._dirty = false;
        this._conflict = false;
        this._expectedValue = null;
        this._saveMessage = '';
        this._render();
    }

    _markDirty() {
        this._dirty = this._draft ? this._serializeDraft() !== this._sourceAtOpen : false;
        this._saveMessage = '';
    }

    _reloadExternal() {
        if (!this._editingDay) return;
        const raw = this._getEntityState(this._editingDay);
        const parsed = this._parseSchedule(raw);
        if (!parsed.valid) {
            this._saveMessage = parsed.error;
            this._render();
            return;
        }
        this._draft = parsed.phases.map(p => ({ ...p }));
        this._sourceAtOpen = raw;
        this._dirty = false;
        this._conflict = false;
        this._saveMessage = '';
        this._render();
    }

    _encodeClipboardSchedule() {
        return `${CLIPBOARD_PREFIX}${this._serializeDraft()}`;
    }

    _decodeClipboardSchedule(text) {
        const raw = String(text ?? '').trim();
        if (!raw.startsWith(CLIPBOARD_PREFIX)) {
            return { valid: false, error: 'Clipboard does not contain a compatible BSB-LAN schedule.' };
        }

        const payload = raw.slice(CLIPBOARD_PREFIX.length).trim();
        const parsed = this._parseSchedule(payload);
        if (!parsed.valid) {
            return { valid: false, error: `Clipboard schedule is invalid: ${parsed.error}` };
        }

        return { valid: true, phases: parsed.phases, value: payload };
    }

    async _copySchedule() {
        if (!this._draft || this._saving) return;

        const validationError = this._validateDraft();
        if (validationError) {
            this._saveMessage = `Copy failed: ${validationError}`;
            this._render();
            return;
        }

        const encoded = this._encodeClipboardSchedule();
        const sourceDay = this._editingDay;
        window[CARD_CLIPBOARD_KEY] = {
            text: encoded,
            sourceDay,
        };

        let systemClipboardWritten = false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(encoded);
                systemClipboardWritten = true;
            }
        } catch (err) {
            console.debug('BSB-LAN Schedule Card: System clipboard write unavailable', err);
        }

        const sourceName = sourceDay ? DAY_NAMES[DAY_KEYS.indexOf(sourceDay)] : 'day';
        this._saveMessage = systemClipboardWritten
            ? `${sourceName} schedule copied.`
            : `${sourceName} schedule copied to the card clipboard.`;
        this._render();
    }

    async _pasteSchedule() {
        if (!this._draft || this._saving || this._conflict) return;

        let decoded = null;

        // Prefer the in-page clipboard. This guarantees that Copy -> open another
        // day -> Paste uses the most recently copied schedule even if browser
        // clipboard permissions are unavailable or the OS clipboard changed.
        const localClipboard = window[CARD_CLIPBOARD_KEY];
        if (localClipboard?.text) {
            const candidate = this._decodeClipboardSchedule(localClipboard.text);
            if (candidate.valid) {
                decoded = candidate;
            }
        }

        // If there is no in-page copy, try the system clipboard. The tagged text
        // format allows safe copy/paste between card instances or dashboards.
        if (!decoded) {
            try {
                if (navigator.clipboard?.readText) {
                    const clipboardText = await navigator.clipboard.readText();
                    const candidate = this._decodeClipboardSchedule(clipboardText);
                    if (candidate.valid) {
                        decoded = candidate;
                    }
                }
            } catch (err) {
                console.debug('BSB-LAN Schedule Card: System clipboard read unavailable', err);
            }
        }

        if (!decoded) {
            this._saveMessage = 'Paste failed: no compatible BSB-LAN schedule was found in the clipboard.';
            this._render();
            return;
        }

        this._draft = decoded.phases.map(phase => ({ ...phase }));
        this._markDirty();

        const clipboardMeta = window[CARD_CLIPBOARD_KEY];
        const sourceDay = clipboardMeta?.text === `${CLIPBOARD_PREFIX}${decoded.value}`
            ? clipboardMeta.sourceDay
            : null;
        const sourceName = sourceDay && DAY_KEYS.includes(sourceDay)
            ? DAY_NAMES[DAY_KEYS.indexOf(sourceDay)]
            : null;

        if (this._dirty) {
            this._saveMessage = sourceName
                ? `${sourceName} schedule pasted. Review and Save to apply it.`
                : 'Schedule pasted. Review and Save to apply it.';
        } else {
            this._saveMessage = sourceName
                ? `${sourceName} schedule pasted; it is identical to the current day.`
                : 'Pasted schedule is identical to the current day.';
        }
        this._render();
    }

    _keepLocalAfterConflict() {
        if (!this._editingDay) return;
        // User explicitly chooses to keep the local draft and overwrite the newer
        // controller value on Save, so use the current external state as the new base.
        this._sourceAtOpen = this._getEntityState(this._editingDay);
        this._conflict = false;
        this._dirty = true;
        this._saveMessage = '';
        this._render();
    }

    async _saveEditor() {
        if (!this._editingDay || !this._draft || this._saving) return;

        const validationError = this._validateDraft();
        if (validationError) {
            this._saveMessage = validationError;
            this._render();
            return;
        }

        const value = this._serializeDraft();
        const entityId = this._entities[this._editingDay];

        this._saving = true;
        this._expectedValue = value;
        this._saveMessage = 'Saving…';
        this._conflict = false;
        this._render();

        try {
            await this._hass.callService('text', 'set_value', {
                entity_id: entityId,
                value,
            });

            // The hass setter may already have processed the matching MQTT
            // confirmation and closed the editor while the service awaited.
            // Do not re-enter the waiting state after that confirmation.
            if (!this._saving || !this._editingDay) return;

            // In most BSB-LAN setups the state echo is effectively immediate.
            // If it is slower, keep the editor open and wait for a matching HA state.
            if (this._getEntityState(this._editingDay) === value) {
                this._nativeAfterConfirmedSave();
                this._clearSaveTimer();
                this._editingDay = null;
                this._draft = null;
                this._sourceAtOpen = null;
                this._dirty = false;
                this._saving = false;
                this._expectedValue = null;
                this._saveMessage = '';
                this._lastRelevantSignature = null;
                this._render();
                return;
            }

            this._saveMessage = 'Command sent — waiting for BSB-LAN to confirm the new value…';
            this._render();

            this._clearSaveTimer();
            this._saveTimer = setTimeout(() => {
                if (this._saving) {
                    this._saving = false;
                    this._saveMessage = 'Command was sent, but the entity has not confirmed the new value yet.';
                    this._render();
                }
            }, 10000);
        } catch (err) {
            console.error('BSB-LAN Schedule Card: Failed to save schedule', err);
            this._saving = false;
            this._expectedValue = null;
            this._saveMessage = `Save failed: ${err?.message || err}`;
            this._render();
        }
    }

    // ── Optional native HA schedule mirroring (one-way BSB-LAN -> HA) ──

    _nativeSourceSignature() {
        const parts = DAY_KEYS.map(day => `${day}:${this._getEntityState(day)}`);
        if (this._config?.source_health_entity) {
            const id = this._config.source_health_entity;
            parts.push(`${id}:${this._hass?.states?.[id]?.state ?? '__missing__'}`);
        }
        return parts.join('|');
    }

    _clearNativeSyncTimer() {
        if (this._nativeSyncTimer) {
            clearTimeout(this._nativeSyncTimer);
            this._nativeSyncTimer = null;
        }
    }

    _clearNativeCheckTimer() {
        if (this._nativeCheckTimer) {
            clearTimeout(this._nativeCheckTimer);
            this._nativeCheckTimer = null;
        }
    }

    _queueNativeCheck() {
        if (!this._config?.native_schedule_entity || !this._hass || !this.isConnected) return;
        this._clearNativeCheckTimer();
        this._nativeCheckTimer = setTimeout(() => {
            this._nativeCheckTimer = null;
            if (this.isConnected) void this._checkNativeSchedule();
        }, 350);
    }

    _stopNativeSubscription() {
        if (this._nativeUnsubscribe) {
            try { this._nativeUnsubscribe(); } catch (error) {
                console.debug('BSB-LAN Schedule Card: unsubscribe failed', error);
            }
        }
        this._nativeUnsubscribe = null;
        this._nativeSubscriptionConnection = null;
    }

    _ensureNativeSubscription() {
        if (!this.isConnected || !this._hass || !this._config?.native_schedule_entity) return;
        const connection = this._hass.connection;
        if (!connection?.subscribeMessage || this._nativeSubscriptionPending ||
            this._nativeSubscriptionFailedConnection === connection ||
            (this._nativeUnsubscribe && this._nativeSubscriptionConnection === connection)) return;
        this._stopNativeSubscription();
        this._nativeSubscriptionPending = true;
        this._nativeSubscriptionConnection = connection;
        Promise.resolve().then(() => connection.subscribeMessage(event => {
            if (!this.isConnected || !this._config?.native_schedule_entity) return;
            const changes = Array.isArray(event) ? event : event?.event;
            if (Array.isArray(changes) && this._nativeStorageId &&
                !changes.some(change => change?.schedule_id === this._nativeStorageId)) return;
            // schedule/subscribe receives changes even if schedule.* stays on/off.
            // This is a read-only check in manual mode, not a sync request.
            this._queueNativeCheck();
        }, { type: 'schedule/subscribe' })).then(unsubscribe => {
            this._nativeSubscriptionPending = false;
            if (!this.isConnected || connection !== this._hass?.connection ||
                !this._config?.native_schedule_entity) {
                if (typeof unsubscribe === 'function') unsubscribe();
                this._nativeSubscriptionConnection = null;
                return;
            }
            this._nativeUnsubscribe = typeof unsubscribe === 'function' ? unsubscribe : null;
            this._nativeSubscriptionFailedConnection = null;
        }).catch(error => {
            this._nativeSubscriptionPending = false;
            this._nativeSubscriptionConnection = null;
            this._nativeSubscriptionFailedConnection = connection;
            console.debug('BSB-LAN Schedule Card: HA schedule change subscription unavailable; manual Check remains available', error);
        });
    }

    async _checkNativeSchedule() {
        if (!this._config?.native_schedule_entity || !this._hass || !this.isConnected) return;
        if (this._nativeSyncing || this._nativeChecking) {
            this._nativeCheckQueued = true;
            return;
        }
        const generation = this._nativeCheckGeneration;
        const target = this._config.native_schedule_entity;
        const signature = this._nativeSourceSignature();
        this._nativeChecking = true;
        this._nativeStatusState = 'checking';
        this._nativeSyncStatus = 'Checking HA schedule…';
        this._nativeSyncError = false;
        this._render();
        try {
            const desiredDays = this._nativeReadSiemensDays();
            const items = await this._hass.callWS({ type: 'schedule/list' });
            if (!Array.isArray(items)) throw new Error('schedule/list returned an unexpected response.');
            const item = await this._nativeFindStorageItem(items);
            if (generation !== this._nativeCheckGeneration || target !== this._config?.native_schedule_entity ||
                !this.isConnected) return;
            this._nativeStorageId = item.id;
            if (signature !== this._nativeSourceSignature()) {
                this._nativeCheckQueued = true;
                return;
            }
            const changedDays = DAY_KEYS.filter(day =>
                !this._nativeTimesEqual(item[day] ?? [], desiredDays[day]));
            this._nativeDiffDays = changedDays;
            this._nativeDiffDetails = this._nativeBuildDifferenceDetails(item, desiredDays);
            if (!changedDays.length) this._nativeDiffExpanded = false;
            this._nativeStatusState = changedDays.length ? 'different' : 'synced';
            this._nativeSyncStatus = changedDays.length
                ? `Out of sync (${changedDays.length} day${changedDays.length === 1 ? '' : 's'})`
                : 'In sync';
        } catch (error) {
            if (generation !== this._nativeCheckGeneration || target !== this._config?.native_schedule_entity ||
                !this.isConnected) return;
            this._nativeStatusState = 'error';
            this._nativeSyncStatus = `HA check failed: ${error?.message || error}`;
            this._nativeSyncError = true;
            this._nativeDiffDays = [];
            this._nativeDiffDetails = [];
            this._nativeDiffExpanded = false;
            console.warn('BSB-LAN Schedule Card: HA schedule comparison failed', error);
        } finally {
            this._nativeChecking = false;
            this._render();
            if (this._nativeCheckQueued) {
                this._nativeCheckQueued = false;
                if (this.isConnected) this._queueNativeCheck();
            }
        }
    }

    _nativeAfterConfirmedSave() {
        if (this._config?.native_schedule_entity) this._queueNativeCheck();
        if (['on_save', 'live'].includes(this._config?.native_sync_mode) &&
            this._config.native_schedule_entity) {
            this._queueNativeSync();
        }
    }

    _queueNativeSync() {
        if (!this._config?.native_schedule_entity || !this._hass || !this.isConnected) return;
        this._clearNativeSyncTimer();
        // Debounce several BSB-LAN MQTT updates arriving together.
        this._nativeSyncTimer = setTimeout(() => {
            this._nativeSyncTimer = null;
            if (this.isConnected) void this._syncNativeSchedule(false);
        }, 1200);
    }

    _nativeTimeToHA(timeText) {
        // Home Assistant expects HH:MM:SS; 24:00:00 is valid as an end.
        return `${timeText}:00`;
    }

    // A source health entity is an availability *proxy*, not proof of a live
    // connection to the Siemens controller. Keep its badge separate from
    // MQTT schedule validity: Online/Offline describes this entity only.
    _getHealthIndicator() {
        const id = this._config?.source_health_entity;
        if (!id) return null;
        const entity = this._hass?.states?.[id];
        if (!entity) {
            return { online: false, code: 'missing',
                reason: `Source health guard ${id} is missing. No HA changes made.`,
                state: '__missing__', entityId: id };
        }
        const state = String(entity.state ?? '').trim().toLowerCase();
        if (INVALID_STATES.has(state)) {
            return { online: false, code: state === 'unavailable' ? 'offline' : 'unknown',
                reason: `Source health guard ${id} is ${state || 'empty'}. No HA changes made.`,
                state: state || '__empty__', entityId: id };
        }
        if (/^(binary_sensor|input_boolean)\./.test(id) && state !== 'on') {
            return { online: false, code: 'inactive',
                reason: `Source health guard ${id} is ${state} (expected on). No HA changes made.`,
                state, entityId: id };
        }
        return { online: true, code: 'ready',
            reason: `${id} is ${entity.state}; entity availability is not proof of Siemens communication.`,
            state, entityId: id };
    }

    _getSourceReadiness() {
        if (!this._config || !this._hass) {
            return { code: 'unknown', label: 'Source: Unknown', reason: 'Home Assistant state is not loaded.', ready: false };
        }
        const healthId = this._config.source_health_entity;
        const health = this._getHealthIndicator();
        if (health && !health.online) {
            return { code: health.code, label: 'Source: Offline',
                reason: health.reason, ready: false };
        }

        // MQTT availability can lag behind the faster BSB-LAN integration.
        // Distinguish transport/unknown states from malformed controller values.
        for (const day of DAY_KEYS) {
            const id = this._entities[day];
            const raw = this._getEntityState(day);
            if (raw === '__missing__' || INVALID_STATES.has(String(raw).trim().toLowerCase())) {
                return { code: 'mqtt', label: 'Source: MQTT unavailable',
                    reason: `${DAY_NAMES[DAY_KEYS.indexOf(day)]}: ${this._parseSchedule(raw).error}. No HA changes made.`, ready: false };
            }
            const parsed = this._parseSchedule(raw);
            if (!parsed.valid) {
                return { code: 'invalid', label: 'Source: Invalid schedule',
                    reason: `${DAY_NAMES[DAY_KEYS.indexOf(day)]}: ${parsed.error}. No HA changes made.`, ready: false };
            }
            let previousEnd = 0;
            for (const phase of parsed.phases) {
                if (!phase.enabled) continue;
                const start = this._timeToMinutes(phase.start);
                const end = this._timeToMinutes(phase.end);
                if (start >= end || start < previousEnd) {
                    return { code: 'invalid', label: 'Source: Invalid schedule',
                        reason: `${day}: invalid or overlapping Siemens periods. No HA changes made.`, ready: false };
                }
                previousEnd = end;
            }
        }

        // last_updated is NOT a heartbeat and remains optional by default.
        const maxAge = this._config.source_max_age_minutes;
        if (maxAge != null) {
            const now = Date.now();
            for (const day of DAY_KEYS) {
                const id = this._entities[day];
                const updated = this._hass.states?.[id]?.last_updated;
                const at = updated ? Date.parse(updated) : NaN;
                if (!Number.isFinite(at)) {
                    return { code: 'stale', label: 'Source: Age unknown',
                        reason: `${day}: no valid last_updated timestamp for ${id}. No HA changes made.`, ready: false };
                }
                const age = now - at;
                if (age > maxAge * 60000 || age < -120000) {
                    return { code: 'stale', label: 'Source: Stale',
                        reason: `${day}: ${id} last_updated is outside ${maxAge} minute freshness limit. No HA changes made.`, ready: false };
                }
            }
        }
        return healthId
            ? { code: 'ready', label: 'Source: Available', ready: true,
                reason: `${healthId} is available; all seven MQTT schedule days are valid. This does not independently verify Siemens communication.` }
            : { code: 'unmonitored', label: 'Source: Unmonitored', ready: true,
                reason: 'All seven MQTT schedule days are valid, but no independent availability entity is configured.' };
    }

    _assertNativeSourceHealthy() {
        const status = this._getSourceReadiness();
        if (!status.ready) throw new Error(status.reason);
    }

    _nativeReadSiemensDays() {
        this._assertNativeSourceHealthy();
        const result = {};
        for (const day of DAY_KEYS) {
            const parsed = this._parseSchedule(this._getEntityState(day));
            if (!parsed.valid) {
                throw new Error(`${DAY_NAMES[DAY_KEYS.indexOf(day)]}: ${parsed.error}. No HA changes made.`);
            }
            let previousEnd = 0;
            const blocks = [];
            for (const phase of parsed.phases) {
                if (!phase.enabled) continue;
                const start = this._timeToMinutes(phase.start);
                const end = this._timeToMinutes(phase.end);
                if (start >= end || start < previousEnd) {
                    throw new Error(`${day}: invalid or overlapping Siemens periods. No HA changes made.`);
                }
                previousEnd = end;
                blocks.push({ from: this._nativeTimeToHA(phase.start), to: this._nativeTimeToHA(phase.end) });
            }
            result[day] = blocks;
        }
        return result;
    }

    _nativeTimesEqual(existing, desired) {
        if (!Array.isArray(existing) || existing.length !== desired.length) return false;
        // Only compare time blocks; keep additional data on *unchanged* days.
        const normalize = value => {
            if (typeof value !== 'string') return '';
            return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
        };
        return existing.every((block, i) =>
            normalize(block.from) === desired[i].from && normalize(block.to) === desired[i].to
        );
    }

    _nativeBuildDifferenceDetails(item, desiredDays) {
        const normalized = value => typeof value === 'string'
            ? (/^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value)
            : '';
        return DAY_KEYS.filter(day => !this._nativeTimesEqual(item[day] ?? [], desiredDays[day]))
            .map(day => {
                const actual = Array.isArray(item[day]) ? item[day] : [];
                const desired = desiredDays[day];
                const count = Math.max(actual.length, desired.length);
                const phases = Array.from({ length: count }, (_, idx) => {
                    const siemens = desired[idx] || null;
                    const native = actual[idx] || null;
                    const fmt = block => block ? `${normalized(block.from).slice(0,5)}–${normalized(block.to).slice(0,5)}` : '—';
                    return {
                        siemens: fmt(siemens),
                        native: fmt(native),
                        different: fmt(siemens) !== fmt(native),
                    };
                });
                return { day, phases };
            });
    }

    async _nativeFindStorageItem(items) {
        const entityId = this._config.native_schedule_entity;
        if (!this._hass.states[entityId]) {
            throw new Error(`Native schedule ${entityId} was not found in Home Assistant.`);
        }
        // Query entity registry; this handles renamed schedule entity IDs.
        // Do not guess by the entity slug if a different internal ID is known.
        let internalId = null;
        try {
            const registry = await this._hass.callWS({
                type: 'config/entity_registry/get',
                entity_id: entityId,
            });
            internalId = registry?.unique_id ?? null;
        } catch (error) {
            // The original ID may still match; don't assume it does.
            console.debug('BSB-LAN Schedule Card: Entity registry lookup unavailable', error);
        }
        if (!internalId) {
            throw new Error(`Could not resolve the internal schedule ID for ${entityId} from Home Assistant's entity registry. Refusing to guess a writable target.`);
        }
        const item = items.find(entry => entry?.id === internalId);
        if (!item) {
            throw new Error(`${entityId} is not a matching UI-created schedule helper, or its registry ID could not be resolved. YAML schedules cannot be updated through schedule/update.`);
        }
        return item;
    }

    async _syncNativeSchedule(manual = true) {
        if (!this._config?.native_schedule_entity || !this._hass) return;
        if (this._nativeSyncing) {
            this._nativeQueued = true;
            return;
        }
        this._clearNativeSyncTimer();
        this._nativeSyncing = true;
        this._nativeSyncError = false;
        this._nativeStatusState = 'checking';
        this._nativeSyncStatus = 'Checking HA schedule…';
        this._render();

        try {
            // Snapshot the *confirmed Siemens states*, never the unsaved editor draft.
            const snapshotSignature = this._nativeSourceSignature();
            const desiredDays = this._nativeReadSiemensDays();
            const items = await this._hass.callWS({ type: 'schedule/list' });
            if (!Array.isArray(items)) throw new Error('schedule/list returned an unexpected response.');
            const item = await this._nativeFindStorageItem(items);
            if (!item.name || typeof item.name !== 'string') {
                throw new Error('Target schedule has no valid name. Refusing update.');
            }

            const replacementDays = {};
            const changedDays = [];
            for (const day of DAY_KEYS) {
                const existing = item[day] ?? [];
                if (this._nativeTimesEqual(existing, desiredDays[day])) {
                    replacementDays[day] = existing;  // retain custom `data`
                } else {
                    if (!Array.isArray(existing)) throw new Error(`Target ${day} data is invalid.`);
                    if (existing.some(block => block?.data && Object.keys(block.data).length)) {
                        throw new Error(`Native ${day} has custom block data. Refusing to erase it; remove/migrate that data before syncing.`);
                    }
                    replacementDays[day] = desiredDays[day];
                    changedDays.push(day);
                }
            }

            if (changedDays.length === 0) {
                this._nativeSyncStatus = 'In sync';
                this._nativeStatusState = 'synced';
                this._nativeDiffDays = [];
                this._nativeDiffDetails = [];
                this._nativeDiffExpanded = false;
                return;
            }

            // Prevent writing an obsolete snapshot if the MQTT state changed
            // during async WebSocket/registry lookups.
            if (snapshotSignature !== this._nativeSourceSignature()) {
                this._nativeQueued = true;
                throw new Error('Siemens schedule changed during sync. Please retry.');
            }

            // HA storage collection update requires the complete item fields.
            // Keeping all seven days prevents accidental deletion of other days.
            const payload = {
                type: 'schedule/update',
                schedule_id: item.id,
                name: item.name,
                ...replacementDays,
            };
            if (item.icon) payload.icon = item.icon;

            await this._hass.callWS(payload);

            // Read back the updated helper; do not claim success on WS ack alone.
            const checkedItems = await this._hass.callWS({ type: 'schedule/list' });
            const checked = Array.isArray(checkedItems)
                ? checkedItems.find(entry => entry.id === item.id)
                : null;
            if (!checked || DAY_KEYS.some(day =>
                !this._nativeTimesEqual(checked[day] ?? [], desiredDays[day]))) {
                throw new Error('Update was sent, but native schedule readback did not match Siemens.');
            }
            this._nativeSyncStatus = `HA updated (${changedDays.length} day${changedDays.length === 1 ? '' : 's'}); verifying…`;
            this._nativeStatusState = 'checking';
            this._nativeDiffDays = [];
            this._nativeDiffDetails = [];
        } catch (error) {
            this._nativeSyncStatus = `HA sync failed: ${error?.message || error}`;
            this._nativeStatusState = 'error';
            this._nativeSyncError = true;
            console.error('BSB-LAN Schedule Card: Native sync failed', error);
        } finally {
            this._nativeSyncing = false;
            this._render();
            if (this.isConnected && !this._nativeSyncError) this._queueNativeCheck();
            if (this._nativeQueued) {
                this._nativeQueued = false;
                // Automatically retry if source changed midway, not when the
                // target is malformed or permissions are absent.
                if (this.isConnected && ['on_save', 'live'].includes(this._config.native_sync_mode)) {
                    this._queueNativeSync();
                }
            }
        }
    }

    _buildTimeOptions(selected, allow24) {
        const step = this._config.time_step;
        const values = [];
        const max = allow24 ? 1440 : 1439;

        for (let minutes = 0; minutes <= max; minutes += step) {
            if (minutes === 1440 && !allow24) break;
            const h = Math.floor(minutes / 60);
            const m = minutes % 60;
            values.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
        }

        if (allow24 && !values.includes('24:00')) {
            values.push('24:00');
        }

        // Preserve an existing off-grid controller value instead of silently
        // quantizing it. New choices still follow time_step.
        if (selected && !values.includes(selected) && this._isValidTime(selected, allow24)) {
            values.push(selected);
            values.sort((a, b) => this._timeToMinutes(a) - this._timeToMinutes(b));
        }

        const placeholder = `<option value="" ${selected ? '' : 'selected'}>--:--</option>`;
        const options = values.map(value =>
            `<option value="${value}" ${value === selected ? 'selected' : ''}>${value}</option>`
        ).join('');

        return placeholder + options;
    }

    _renderError(message) {
        if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
            <ha-card>
                <div class="fatal-error">
                    <strong>BSB-LAN Schedule Card</strong><br>
                    ${this._escapeHtml(message)}
                </div>
            </ha-card>
            <style>${this._getStyles()}</style>
        `;
    }

    _render() {
        if (!this._config || !this._hass) return;
        if (!this.shadowRoot) this.attachShadow({ mode: 'open' });

        const todayIndex = this._getTodayIndex();
        const modeInfo = this._getModeInfo();
        let rowsHtml = '';

        for (let i = 0; i < DAY_KEYS.length; i++) {
            const day = DAY_KEYS[i];
            const raw = this._getEntityState(day);
            const parsed = this._parseSchedule(raw);
            const isToday = i === todayIndex;
            const isOpen = this._editingDay === day;
            const entityExists = raw !== '__missing__';

            let periodsHtml;
            let rowClass = 'week-row';
            if (isToday) rowClass += ' today';
            if (isOpen) rowClass += ' open';
            if (!parsed.valid) rowClass += ' invalid';

            if (parsed.valid) {
                const activePhase = this._getActivePhaseIndex(parsed.phases, i, modeInfo);
                periodsHtml = parsed.phases.map((phase, idx) => {
                    const isActive = idx === activePhase;
                    const title = isActive ? `Phase ${idx + 1} — active now` : `Phase ${idx + 1}`;
                    return `<span class="period period-${idx + 1} ${isActive ? 'active-period' : ''}" title="${title}">${this._escapeHtml(this._formatPhase(phase))}</span>`;
                }).join('');
            } else {
                periodsHtml = `<span class="period-error">${this._escapeHtml(entityExists ? parsed.error : 'Entity not found')}</span>`;
            }

            rowsHtml += `
                <div class="${rowClass}" data-day="${day}" role="button" tabindex="0"
                     aria-label="Edit ${DAY_NAMES[i]} schedule">
                    <span class="day-label">${DAY_LABELS[i]}</span>
                    <div class="periods">${periodsHtml}</div>
                    <span class="chevron">${isOpen ? '▴' : '▾'}</span>
                </div>
            `;

            if (isOpen) {
                rowsHtml += this._renderEditor(day, i);
            }
        }

        const modeBadgeHtml = modeInfo ? `
            <span class="mode-badge ${modeInfo.className}" title="${this._escapeHtml(modeInfo.raw)} · ${this._escapeHtml(modeInfo.entityId)}">
                ${this._escapeHtml(modeInfo.label)}
            </span>` : '';

        const diffNames = this._nativeDiffDays.map(day => DAY_NAMES[DAY_KEYS.indexOf(day)]).join(', ');
        const nativeStatusTitle = this._nativeStatusState === 'different'
            ? `Different days: ${diffNames}. Checks compare time blocks only. No changes made.`
            : this._nativeStatusState === 'synced'
                ? 'All seven days match by time blocks (at last comparison).'
                : this._nativeSyncStatus;
        const statusIsDifferent = this._nativeStatusState === 'different' && this._nativeDiffDetails.length > 0;
        const statusValue = this._escapeHtml(this._nativeSyncStatus || 'Not checked');
        const statusClass = `native-sync-status native-status-${this._nativeStatusState} ${this._nativeSyncError ? 'native-sync-error' : ''}`;
        const statusHtml = statusIsDifferent
            ? `<button class="${statusClass} native-diff-trigger" title="${this._escapeHtml(nativeStatusTitle)} — click to compare periods"
                       aria-expanded="${this._nativeDiffExpanded}" aria-controls="native-diff-panel">${statusValue} ${this._nativeDiffExpanded ? '▴' : '▾'}</button>`
            : `<span class="${statusClass}" title="${this._escapeHtml(nativeStatusTitle)}" role="status">${statusValue}</span>`;
        const diffDetailsHtml = this._nativeDiffExpanded && statusIsDifferent ? `
            <div class="native-diff-panel" id="native-diff-panel">
                <div class="native-diff-intro">Different periods (read-only comparison)</div>
                ${this._nativeDiffDetails.map(item => {
                    // Every row must render the *same* number of columns as the
                    // grid header. Otherwise P2/P3 data flows into the next row.
                    // Native HA may have >3 blocks, in which case allow more columns.
                    const columnCount = Math.max(3, item.phases.length);
                    const phases = Array.from({length: columnCount}, (_, index) =>
                        item.phases[index] || {siemens: '—', native: '—', different: false});
                    return `
                    <div class="native-diff-day">
                        <div class="native-diff-day-name">${this._escapeHtml(DAY_NAMES[DAY_KEYS.indexOf(item.day)])}</div>
                        <div class="native-diff-grid" style="grid-template-columns:64px repeat(${columnCount}, minmax(80px, 1fr))">
                            <div class="native-diff-label">Source</div>
                            ${phases.map((p,idx) => `<div class="native-diff-col-heading">P${idx + 1}</div>`).join('')}
                            <div class="native-diff-label">Siemens</div>
                            ${phases.map(p=>`<div class="${p.different ? 'native-diff-changed' : ''}">${this._escapeHtml(p.siemens)}</div>`).join('')}
                            <div class="native-diff-label">Native HA</div>
                            ${phases.map(p=>`<div class="${p.different ? 'native-diff-changed' : ''}">${this._escapeHtml(p.native)}</div>`).join('')}
                        </div>
                    </div>`;
                }).join('')}
            </div>
        ` : '';
        const sourceReadiness = this._getSourceReadiness();
        // A compact header badge reports ONLY the configured health entity.
        // MQTT schedule validity and optional freshness remain independent
        // write safeguards, surfaced through the existing sync error/status.
        const healthIndicator = this._getHealthIndicator();
        const healthBadgeHtml = healthIndicator ? `
            <span class="mode-badge health-${healthIndicator.online ? 'online' : 'offline'}"
                  title="${this._escapeHtml(healthIndicator.reason)}" role="status">
                ${healthIndicator.online ? 'Online' : 'Offline'}
            </span>` : '';
        const nativeSyncHtml = this._config.native_schedule_entity ? `
            <div class="native-sync-bar">
                <span class="native-sync-target" title="${this._escapeHtml(this._config.native_schedule_entity)}">Native HA: ${this._escapeHtml(this._config.native_schedule_entity)}</span>
                ${statusHtml}
                <button class="secondary-button native-check-button" title="Read and compare both schedules without modifying anything"
                    ${(this._nativeSyncing || this._nativeChecking) ? 'disabled' : ''}>${this._nativeChecking ? 'Checking…' : 'Check'}</button>
                <button class="secondary-button native-sync-button" title="Copy confirmed Siemens weekly schedule to native Home Assistant helper (not unsaved edits)"
                    ${(!sourceReadiness.ready || this._nativeSyncing || this._nativeChecking || this._saving || this._dirty || (this._nativeStatusState === 'synced' || this._nativeStatusState === 'error')) ? 'disabled' : ''}>${this._nativeSyncing ? 'Syncing…' : 'Sync HA'}</button>
            </div>
            ${diffDetailsHtml}
        ` : '';

        this.shadowRoot.innerHTML = `
            <style>${this._getStyles()}</style>
            <ha-card>
                <div class="card-header">
                    <span class="title">${this._escapeHtml(this._config.title)}</span>
                    <span class="header-badges">${healthBadgeHtml}${modeBadgeHtml}</span>
                </div>
                ${nativeSyncHtml}
                <div class="column-headings">
                    <span></span>
                    <span>Phase 1</span>
                    <span>Phase 2</span>
                    <span>Phase 3</span>
                    <span></span>
                </div>
                <div class="week-grid">${rowsHtml}</div>
            </ha-card>
        `;

        this._bindEvents();
    }

    _renderEditor(day, dayIndex) {
        if (!this._draft) {
            return `
                <div class="day-editor error-editor">
                    <div class="editor-title">${DAY_NAMES[dayIndex]}</div>
                    <div class="message error-message">${this._escapeHtml(this._saveMessage || 'Unable to parse this schedule.')}</div>
                    <div class="editor-actions">
                        <button class="secondary-button cancel-button">Close</button>
                    </div>
                </div>
            `;
        }

        const phaseRows = this._draft.map((phase, index) => {
            const number = index + 1;
            const phase3Locked = index === 2 && !this._draft[1].enabled;
            const controlsDisabled = !phase.enabled || this._saving;

            let enableControl;
            if (index === 0) {
                enableControl = `
                    <span class="required-control" title="Phase 1 is mandatory on Siemens time programs">Required</span>
                `;
            } else {
                const disabled = this._saving || phase3Locked;
                const title = phase3Locked
                    ? 'Phase 3 requires Phase 2'
                    : `${phase.enabled ? 'Disable' : 'Enable'} Phase ${number}`;
                enableControl = `
                    <label class="phase-toggle ${phase3Locked ? 'locked' : ''}" title="${title}">
                        <input type="checkbox" class="phase-enabled" data-phase="${index}" ${phase.enabled ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
                        <span class="toggle-track"><span class="toggle-thumb"></span></span>
                        <span class="toggle-label">${phase.enabled ? 'On' : 'Off'}</span>
                    </label>
                `;
            }

            return `
                <div class="phase-row">
                    <span class="phase-label">Phase ${number}</span>
                    <select class="time-select" data-phase="${index}" data-field="start" ${controlsDisabled ? 'disabled' : ''}>
                        ${this._buildTimeOptions(phase.start, false)}
                    </select>
                    <span class="arrow">→</span>
                    <select class="time-select" data-phase="${index}" data-field="end" ${controlsDisabled ? 'disabled' : ''}>
                        ${this._buildTimeOptions(phase.end, true)}
                    </select>
                    ${enableControl}
                </div>
            `;
        }).join('');

        const conflictHtml = this._conflict ? `
            <div class="conflict-box">
                <div class="conflict-title">Siemens schedule changed while you were editing.</div>
                <div class="conflict-detail"><span>Controller now</span><code>${this._escapeHtml(this._getEntityState(day))}</code></div>
                <div class="conflict-detail"><span>Your draft</span><code>${this._escapeHtml(this._serializeDraft())}</code></div>
                <div class="conflict-help">Reload to use the controller value, or keep your draft and overwrite it when you Save.</div>
                <div class="conflict-actions">
                    <button class="secondary-button reload-button">Reload Siemens</button>
                    <button class="secondary-button keep-button">Keep my edits</button>
                </div>
            </div>
        ` : '';

        const validationError = this._dirty ? this._validateDraft() : '';
        const displayMessage = this._saveMessage || validationError;
        const messageIsError = Boolean(validationError) ||
                               displayMessage.startsWith('Save failed') ||
                               displayMessage.startsWith('Copy failed') ||
                               displayMessage.startsWith('Paste failed');
        const messageClass = messageIsError ? 'error-message' : 'info-message';

        const messageHtml = displayMessage
            ? `<div class="message ${messageClass}">${this._escapeHtml(displayMessage)}</div>`
            : '';

        return `
            <div class="day-editor ${this._dirty ? 'dirty' : ''}">
                <div class="editor-title-row">
                    <span class="editor-title">${DAY_NAMES[dayIndex]}</span>
                    ${this._dirty ? '<span class="dirty-badge">UNSAVED</span>' : ''}
                </div>
                ${conflictHtml}
                <div class="phase-grid">${phaseRows}</div>
                ${messageHtml}
                <div class="editor-actions">
                    <div class="editor-actions-left">
                        <button class="secondary-button copy-button" ${(this._saving || Boolean(validationError)) ? 'disabled' : ''} title="Copy this day schedule">Copy</button>
                        <button class="secondary-button paste-button" ${(this._saving || this._conflict) ? 'disabled' : ''} title="Paste a compatible BSB-LAN schedule into this editor">Paste</button>
                    </div>
                    <div class="editor-actions-right">
                        <button class="secondary-button cancel-button" ${this._saving ? 'disabled' : ''}>Cancel</button>
                        <button class="primary-button save-button" ${(!this._dirty || this._saving || this._conflict || Boolean(validationError)) ? 'disabled' : ''}>
                            ${this._saving ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    _bindEvents() {
        const diffButton = this.shadowRoot.querySelector('.native-diff-trigger');
        if (diffButton) diffButton.addEventListener('click', event => {
            event.stopPropagation();
            this._nativeDiffExpanded = !this._nativeDiffExpanded;
            this._render();
        });
        const checkButton = this.shadowRoot.querySelector('.native-check-button');
        if (checkButton) checkButton.addEventListener('click', event => {
            event.stopPropagation();
            if (!this._nativeSyncing && !this._nativeChecking) {
                this._clearNativeCheckTimer();
                void this._checkNativeSchedule();
            }
        });
        const syncButton = this.shadowRoot.querySelector('.native-sync-button');
        if (syncButton) syncButton.addEventListener('click', event => {
            event.stopPropagation();
            if (!this._nativeSyncing && !this._nativeChecking && !this._saving && !this._dirty &&
                this._nativeStatusState !== 'synced' && this._getSourceReadiness().ready) {
                void this._syncNativeSchedule(true);
            }
        });

        this.shadowRoot.querySelectorAll('.week-row').forEach(row => {
            const open = () => this._openEditor(row.dataset.day);
            row.addEventListener('click', open);
            row.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                }
            });
        });

        this.shadowRoot.querySelectorAll('.time-select').forEach(select => {
            select.addEventListener('change', event => {
                if (!this._draft) return;
                const phase = Number(event.target.dataset.phase);
                const field = event.target.dataset.field;
                this._draft[phase][field] = event.target.value;
                this._markDirty();
                this._render();
            });
        });

        this.shadowRoot.querySelectorAll('.phase-enabled').forEach(input => {
            input.addEventListener('change', event => {
                if (!this._draft) return;
                const phase = Number(event.target.dataset.phase);

                // Phase 1 has no checkbox. If Phase 2 is disabled, Siemens cannot
                // retain Phase 3, so disable Phase 3 in the draft at the same time.
                this._draft[phase].enabled = event.target.checked;
                if (phase === 1 && !event.target.checked) {
                    this._draft[2].enabled = false;
                }

                this._markDirty();
                this._render();
            });
        });

        const copy = this.shadowRoot.querySelector('.copy-button');
        if (copy) {
            copy.addEventListener('click', event => {
                event.stopPropagation();
                this._copySchedule();
            });
        }

        const paste = this.shadowRoot.querySelector('.paste-button');
        if (paste) {
            paste.addEventListener('click', event => {
                event.stopPropagation();
                this._pasteSchedule();
            });
        }

        this.shadowRoot.querySelectorAll('.cancel-button').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                this._cancelEditor();
            });
        });

        const save = this.shadowRoot.querySelector('.save-button');
        if (save) {
            save.addEventListener('click', event => {
                event.stopPropagation();
                this._saveEditor();
            });
        }

        const reload = this.shadowRoot.querySelector('.reload-button');
        if (reload) {
            reload.addEventListener('click', event => {
                event.stopPropagation();
                this._reloadExternal();
            });
        }

        const keep = this.shadowRoot.querySelector('.keep-button');
        if (keep) {
            keep.addEventListener('click', event => {
                event.stopPropagation();
                this._keepLocalAfterConflict();
            });
        }
    }

    _getStyles() {
        return `
            :host {
                --bsb-row-height: 32px;
                --bsb-day-width: 42px;
                --bsb-row-hover: color-mix(in srgb, var(--bsb-accent-color, var(--primary-color, #03a9f4)) 10%, transparent);
                --bsb-today-bg: color-mix(in srgb, var(--bsb-accent-color, var(--primary-color, #03a9f4)) 8%, transparent);
                --bsb-editor-bg: color-mix(in srgb, var(--bsb-accent-color, var(--primary-color, #03a9f4)) 5%, transparent);
                display: block;
            }

            ha-card {
                overflow: hidden;
            }

            .card-header {
                padding: 12px 16px 7px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }

            .title {
                min-width: 0;
                font-size: var(--ha-font-size-l, 16px);
                font-weight: var(--ha-font-weight-medium, 500);
                color: var(--primary-text-color);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .header-badges {
                display: inline-flex;
                flex: 0 0 auto;
                align-items: center;
                gap: 5px;
            }
            .health-online {
                color: var(--success-color, #4caf50);
                background: color-mix(in srgb, var(--success-color, #4caf50) 10%, transparent);
            }
            .health-offline {
                color: var(--error-color, #db4437);
                background: color-mix(in srgb, var(--error-color, #db4437) 10%, transparent);
            }

            .native-sync-bar {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 2px 12px 8px;
                flex-wrap: wrap;
                font-size: 9px;
                border-bottom: 1px solid var(--divider-color);
            }

            .native-sync-target {
                color: var(--secondary-text-color);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 100%;
            }

            .native-sync-status {
                color: var(--secondary-text-color);
                flex: 1 1 auto;
                text-align: right;
                min-width: 90px;
            }

            .native-status-synced {
                color: var(--success-color, #4caf50);
                font-weight: 700;
            }

            .native-status-different {
                color: var(--warning-color, #ff9800);
                font-weight: 700;
            }

            .native-sync-error {
                color: var(--error-color, #db4437);
                flex-basis: 100%;
                order: 3;
                text-align: left;
                overflow-wrap: anywhere;
            }

            .native-sync-button,
            .native-check-button {
                flex: 0 0 auto;
                font-size: 9px;
                min-height: 26px;
                padding: 0 9px;
            }

            .native-diff-trigger {
                flex: 1 1 auto;
                min-width: 90px;
                padding: 4px 6px;
                min-height: 24px;
                text-align: right;
                cursor: pointer;
                background: color-mix(in srgb, var(--warning-color, #ff9800) 8%, transparent);
                border-radius: 4px;
            }
            .native-diff-trigger:hover,
            .native-diff-trigger:focus-visible {
                background: color-mix(in srgb, var(--warning-color, #ff9800) 16%, transparent);
            }
            .native-diff-panel {
                overflow-x: auto;
                flex-basis: 100%;
                width: 100%;
                padding: 7px 2px 0;
                border-top: 1px solid var(--divider-color);
                color: var(--primary-text-color);
            }
            .native-diff-intro {
                font-size: 9px;
                color: var(--secondary-text-color);
                margin-bottom: 6px;
            }
            .native-diff-day {
                margin: 6px 0;
            }
            .native-diff-day-name {
                font-size: 10px;
                font-weight: 700;
                margin-bottom: 3px;
            }
            .native-diff-grid {
                display: grid;
                grid-template-columns: 64px repeat(3, minmax(80px, 1fr));
                gap: 4px 5px;
                align-items: center;
                text-align: center;
                font-variant-numeric: tabular-nums;
                font-size: 9px;
                line-height: 1.4;
                width: 100%;
                min-width: max-content;
            }
            .native-diff-grid > div {
                min-width: 0;
                white-space: nowrap;
            }
            .native-diff-label {
                text-align: left;
                color: var(--secondary-text-color);
            }
            .native-diff-col-heading {
                font-weight: 600;
                color: var(--secondary-text-color);
            }
            .native-diff-changed {
                color: var(--warning-color, #ff9800);
                font-weight: 650;
                background: color-mix(in srgb, var(--warning-color, #ff9800) 8%, transparent);
                border-radius: 3px;
            }

            .mode-badge {
                flex: 0 0 auto;
                padding: 3px 7px;
                border-radius: 999px;
                font-size: 9px;
                font-weight: 700;
                letter-spacing: 0.25px;
                line-height: 1.2;
                border: 1px solid currentColor;
                user-select: none;
            }

            .mode-automatic {
                color: var(--info-color, #2196f3);
                background: color-mix(in srgb, var(--info-color, #2196f3) 11%, transparent);
            }

            .mode-comfort {
                color: var(--success-color, #4caf50);
                background: color-mix(in srgb, var(--success-color, #4caf50) 10%, transparent);
            }

            .mode-reduced {
                color: var(--warning-color, #ff9800);
                background: color-mix(in srgb, var(--warning-color, #ff9800) 10%, transparent);
            }

            .mode-protection {
                color: var(--secondary-text-color);
                background: var(--secondary-background-color, rgba(127,127,127,0.10));
            }

            .mode-unavailable {
                color: var(--error-color, #db4437);
                background: color-mix(in srgb, var(--error-color, #db4437) 10%, transparent);
            }

            .column-headings {
                display: grid;
                grid-template-columns: var(--bsb-day-width) repeat(3, minmax(0, 1fr)) 18px;
                gap: 4px;
                align-items: center;
                padding: 0 12px 3px;
                color: var(--secondary-text-color);
                font-size: 9px;
                line-height: 1;
                text-align: center;
                text-transform: uppercase;
                letter-spacing: 0.35px;
                user-select: none;
            }

            .week-grid {
                padding: 0 8px 10px;
            }

            .week-row {
                display: grid;
                grid-template-columns: var(--bsb-day-width) minmax(0, 1fr) 18px;
                gap: 4px;
                align-items: center;
                min-height: var(--bsb-row-height);
                padding: 0 4px;
                border-top: 1px solid var(--divider-color);
                cursor: pointer;
                border-radius: 4px;
                transition: background 0.12s ease;
                outline: none;
            }

            .week-row:hover,
            .week-row:focus-visible {
                background: var(--bsb-row-hover);
            }

            .week-row.today {
                background: var(--bsb-today-bg);
            }

            .week-row.open {
                background: var(--bsb-row-hover);
                border-bottom-left-radius: 0;
                border-bottom-right-radius: 0;
            }

            .week-row.invalid {
                color: var(--error-color, #db4437);
            }

            .day-label {
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.4px;
                color: var(--primary-text-color);
            }

            .today .day-label {
                color: var(--bsb-accent-color, var(--primary-color, #03a9f4));
            }

            .periods {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 4px;
                min-width: 0;
            }

            .period {
                min-width: 0;
                text-align: center;
                font-size: 10.5px;
                font-weight: 500;
                font-variant-numeric: tabular-nums;
                color: var(--primary-text-color);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .period.active-period {
                color: var(--success-color, #4caf50);
                font-weight: 700;
                background: color-mix(in srgb, var(--success-color, #4caf50) 13%, transparent);
                box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--success-color, #4caf50) 32%, transparent);
                border-radius: 4px;
                padding: 2px 3px;
            }

            .period-error {
                grid-column: 1 / -1;
                font-size: 10px;
                color: var(--error-color, #db4437);
            }

            .chevron {
                justify-self: center;
                color: var(--secondary-text-color);
                font-size: 10px;
                user-select: none;
            }

            .day-editor {
                padding: 9px 8px 10px;
                margin: 0 4px 4px;
                background: var(--bsb-editor-bg);
                border: 1px solid var(--divider-color);
                border-top: 0;
                border-radius: 0 0 6px 6px;
            }

            .editor-title-row {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 7px;
            }

            .editor-title {
                font-size: 12px;
                font-weight: 600;
                color: var(--primary-text-color);
            }

            .dirty-badge {
                font-size: 8px;
                font-weight: 700;
                letter-spacing: 0.5px;
                color: var(--warning-color, #ff9800);
            }

            .phase-grid {
                display: flex;
                flex-direction: column;
                gap: 5px;
            }

            .phase-row {
                display: grid;
                grid-template-columns: 52px minmax(76px, 1fr) 12px minmax(76px, 1fr) 58px;
                gap: 5px;
                align-items: center;
            }

            .phase-label {
                font-size: 10px;
                font-weight: 600;
                color: var(--secondary-text-color);
            }

            .arrow {
                text-align: center;
                color: var(--secondary-text-color);
                font-size: 11px;
            }

            .time-select {
                box-sizing: border-box;
                width: 100%;
                min-width: 0;
                height: 30px;
                padding: 0 5px;
                border: 1px solid var(--divider-color);
                border-radius: 5px;
                background: var(--card-background-color, var(--ha-card-background));
                color: var(--primary-text-color);
                font: inherit;
                font-size: 11px;
                font-variant-numeric: tabular-nums;
            }

            .time-select:focus {
                outline: 1px solid var(--bsb-accent-color, var(--primary-color, #03a9f4));
                border-color: var(--bsb-accent-color, var(--primary-color, #03a9f4));
            }

            .time-select:disabled {
                opacity: 0.42;
            }

            .phase-toggle {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 5px;
                cursor: pointer;
                user-select: none;
            }

            .phase-toggle input {
                position: absolute;
                opacity: 0;
                pointer-events: none;
            }

            .toggle-track {
                position: relative;
                width: 26px;
                height: 14px;
                border-radius: 999px;
                background: var(--disabled-color, rgba(127,127,127,0.35));
                transition: background 0.15s ease;
                flex: 0 0 auto;
            }

            .toggle-thumb {
                position: absolute;
                width: 10px;
                height: 10px;
                top: 2px;
                left: 2px;
                border-radius: 50%;
                background: var(--card-background-color, #fff);
                box-shadow: 0 1px 2px rgba(0,0,0,0.28);
                transition: transform 0.15s ease;
            }

            .phase-toggle input:checked + .toggle-track {
                background: var(--bsb-accent-color, var(--primary-color, #03a9f4));
            }

            .phase-toggle input:checked + .toggle-track .toggle-thumb {
                transform: translateX(12px);
            }

            .toggle-label {
                width: 18px;
                font-size: 8.5px;
                color: var(--secondary-text-color);
                text-align: left;
            }

            .phase-toggle.locked {
                opacity: 0.42;
                cursor: default;
            }

            .required-control {
                justify-self: end;
                padding: 2px 5px;
                border: 1px solid var(--divider-color);
                border-radius: 999px;
                font-size: 8px;
                font-weight: 600;
                color: var(--secondary-text-color);
                white-space: nowrap;
                user-select: none;
            }

            .editor-actions,
            .conflict-actions,
            .editor-actions-left,
            .editor-actions-right {
                display: flex;
                gap: 7px;
            }

            .conflict-actions,
            .editor-actions-right {
                justify-content: flex-end;
            }

            .editor-actions {
                justify-content: space-between;
                align-items: center;
                margin-top: 9px;
            }

            .editor-actions-left,
            .editor-actions-right {
                align-items: center;
            }

            button {
                border: 0;
                border-radius: 6px;
                min-height: 30px;
                padding: 0 12px;
                font: inherit;
                font-size: 10px;
                font-weight: 600;
                cursor: pointer;
            }

            button:disabled {
                cursor: default;
                opacity: 0.45;
            }

            .primary-button {
                background: var(--bsb-accent-color, var(--primary-color, #03a9f4));
                color: var(--text-primary-color, #fff);
            }

            .secondary-button {
                background: var(--secondary-background-color, rgba(127,127,127,0.14));
                color: var(--primary-text-color);
            }

            .message {
                margin-top: 7px;
                font-size: 9.5px;
                line-height: 1.35;
            }

            .error-message {
                color: var(--error-color, #db4437);
            }

            .info-message {
                color: var(--secondary-text-color);
            }

            .conflict-box {
                margin-bottom: 8px;
                padding: 7px;
                border-radius: 5px;
                background: color-mix(in srgb, var(--warning-color, #ff9800) 12%, transparent);
                color: var(--primary-text-color);
                font-size: 9.5px;
                line-height: 1.35;
            }

            .conflict-title {
                font-weight: 700;
                margin-bottom: 5px;
            }

            .conflict-detail {
                display: grid;
                grid-template-columns: 72px minmax(0, 1fr);
                gap: 5px;
                align-items: baseline;
                margin-top: 3px;
            }

            .conflict-detail span {
                color: var(--secondary-text-color);
            }

            .conflict-detail code {
                overflow-wrap: anywhere;
                font-size: 9px;
                color: var(--primary-text-color);
            }

            .conflict-help {
                margin-top: 5px;
                color: var(--secondary-text-color);
            }

            .conflict-actions {
                margin-top: 7px;
            }

            .fatal-error {
                padding: 16px;
                color: var(--error-color, #db4437);
                font-size: 12px;
            }

            @media (max-width: 430px) {
                :host {
                    --bsb-day-width: 34px;
                }

                .card-header {
                    padding-left: 12px;
                    padding-right: 12px;
                }

                .mode-badge {
                    font-size: 8px;
                    padding: 3px 6px;
                }

                .column-headings {
                    padding-left: 8px;
                    padding-right: 8px;
                    font-size: 8px;
                }

                .week-grid {
                    padding-left: 4px;
                    padding-right: 4px;
                }

                .day-label {
                    font-size: 9px;
                }

                .period {
                    font-size: 9.5px;
                }

                .phase-row {
                    grid-template-columns: 42px minmax(68px, 1fr) 10px minmax(68px, 1fr) 50px;
                    gap: 3px;
                }

                .phase-label,
                .time-select,
                .required-control {
                    font-size: 9px;
                }

                .toggle-label {
                    display: none;
                }

                .time-select {
                    padding-left: 2px;
                    padding-right: 2px;
                }
            }
        `;
    }
}

// ── Visual Lovelace configuration editor (v0.1.8) ──────────────────
// Uses Home Assistant's own entity selectors via ha-form. It only modifies
// dashboard card configuration; it never calls Siemens or HA schedule/update.
class BSBLANScheduleCardEditor extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._config = null;
        this._hass = null;
        this._sourceMode = 'prefix';
        this._renderedMode = null;
        this._editorMessage = '';
    }

    setConfig(config) {
        if (!config) return;
        const unchanged = this._config && JSON.stringify(config) === JSON.stringify(this._config);
        if (unchanged) return;
        this._config = { ...config };
        const nextMode = config.entities && typeof config.entities === 'object' && !Array.isArray(config.entities)
            ? 'entities' : 'prefix';
        this._sourceMode = nextMode;
        if (this._renderedMode !== nextMode) this._render();
        else this._updateForm();
    }

    set hass(hass) {
        this._hass = hass;
        if (this._renderedMode === null) this._render();
        else {
            const form = this.shadowRoot?.querySelector('ha-form');
            if (form) form.hass = hass;
        }
    }

    _escape(value) {
        return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    _formSchema() {
        const labels = { title:'Card title', entity_prefix:'BSB-LAN text entity prefix',
            mode_entity:'Operating mode entity (optional)',
            native_schedule_entity:'Native HA schedule (optional)',
            native_sync_mode:'Sync mode', time_step:'Time step (minutes)',
            accent_color:'Accent CSS color (optional; empty uses HA theme)',
            source_health_entity:'Source availability entity (optional)',
            source_max_age_minutes:'Maximum source state age, minutes (optional)' };
        const fields = [ {name:'title', selector:{text:{}}} ];
        if (this._sourceMode === 'prefix') {
            fields.push({name:'entity_prefix', required:true, selector:{text:{}}});
        } else {
            for (const day of DAY_KEYS) {
                fields.push({name:`entities_${day}`, required:true,
                    selector:{entity:{filter:{domain:'text'}}}});
                labels[`entities_${day}`] = DAY_NAMES[DAY_KEYS.indexOf(day)];
            }
        }
        fields.push(
            {name:'mode_entity', selector:{entity:{filter:{domain:'select'}}}},
            {name:'time_step', selector:{number:{min:1, max:60, step:1, mode:'box'}}},
            {name:'accent_color', selector:{text:{}}},
            {name:'native_schedule_entity', selector:{entity:{filter:{domain:'schedule'}}}},
            {name:'native_sync_mode', selector:{select:{mode:'dropdown', options:[
                {value:'manual', label:'Manual (button only)'},
                {value:'on_save',label:'On confirmed Siemens save'},
                {value:'live',label:'Live while dashboard is open'},
            ]}}},
            {name:'source_health_entity', selector:{entity:{}}},
            {name:'source_max_age_minutes', selector:{number:{min:1, max:10080, step:1, mode:'box'}}},
        );
        return { fields, labels };
    }

    _formData() {
        const c=this._config||{};
        const data={
            title:c.title||'',
            mode_entity:c.mode_entity||'',
            native_schedule_entity:c.native_schedule_entity||'',
            native_sync_mode:c.native_sync_mode||'manual',
            time_step:c.time_step??10,
            accent_color:c.accent_color||'',
            source_health_entity:c.source_health_entity||'',
            source_max_age_minutes:c.source_max_age_minutes??undefined,
        };
        if(this._sourceMode==='prefix') data.entity_prefix=c.entity_prefix||'';
        else for(const day of DAY_KEYS) data[`entities_${day}`]=c.entities?.[day]||'';
        return data;
    }

    _updateForm() {
        const form=this.shadowRoot?.querySelector('ha-form');
        if(!form) return;
        const {fields,labels}=this._formSchema();
        form.hass=this._hass;
        form.schema=fields;
        form.data=this._formData();
        form.computeLabel=schema=>labels[schema.name]||schema.name;
        form.computeHelper=schema=>{
            if(schema.name==='source_max_age_minutes') return 'Optional: HA last_updated is not a guaranteed MQTT heartbeat.';
            if(schema.name==='source_health_entity') return 'Any entity: unavailable/unknown blocks sync; binary sensors/input booleans also require ON.';
            if(schema.name==='native_sync_mode') return 'Automatic sync only runs while the dashboard is open.';
            if(schema.name==='entity_prefix') return 'Append monday … sunday to this prefix.';
            return undefined;
        };
        const preview=this.shadowRoot.querySelector('.accent-swatch');
        if(preview) preview.style.backgroundColor=this._config?.accent_color||'var(--primary-color, #03a9f4)';
        const picker=this.shadowRoot.querySelector('.accent-picker');
        if(picker) picker.value=/^#[0-9a-fA-F]{6}$/.test(this._config?.accent_color||'')
            ? this._config.accent_color : '#03a9f4';
        const hint=this.shadowRoot.querySelector('.native-mode-hint');
        if(hint) hint.textContent=this._config?.native_schedule_entity
            ? 'Native HA target configured. Synchronization is one-way: Siemens → HA.'
            : 'No native HA schedule selected: no native synchronization is performed.';
    }

    _emit(config) {
        this._config={...config};
        this.dispatchEvent(new CustomEvent('config-changed', {
            detail:{config:{...config}}, bubbles:true, composed:true,
        }));
    }

    _changeSourceMode(nextMode) {
        if(nextMode===this._sourceMode || !['prefix','entities'].includes(nextMode)) return;
        const c={...this._config};
        if(nextMode==='entities') {
            const current={};
            for(const day of DAY_KEYS) current[day]=c.entities?.[day]||`${c.entity_prefix||'text.bsb_lan_heating_schedule_1_'}${day}`;
            c.entities=current;
            delete c.entity_prefix;
        } else {
            let prefix='text.bsb_lan_heating_schedule_1_';
            if(c.entities) {
                const mon=c.entities.monday||'';
                const candidate=mon.endsWith('monday') ? mon.slice(0,-'monday'.length) : '';
                if(candidate && DAY_KEYS.every(day=>c.entities[day]===`${candidate}${day}`)) {
                    prefix=candidate;
                } else {
                    // Do not silently substitute arbitrary BSB-LAN entities.
                    this._editorMessage='The current weekdays do not share one prefix. Keep individual entities, or edit them first.';
                    this._render();
                    return;
                }
            }
            c.entity_prefix=prefix;
            delete c.entities;
        }
        this._sourceMode=nextMode;
        this._editorMessage='';
        this._renderedMode=null;
        this._emit(c);
        this._render();
    }

    _changed(data) {
        if(!data || typeof data!=='object') return;
        const next={...(this._config||{})};
        const optional=['mode_entity','native_schedule_entity','accent_color','source_health_entity','source_max_age_minutes'];
        for(const key of ['title','time_step','native_sync_mode',...optional]) {
            if(!Object.prototype.hasOwnProperty.call(data,key)) continue;
            const value=data[key];
            if(optional.includes(key) && (value===''||value===null||value===undefined)) delete next[key];
            else if (key==='time_step') {
                const step=Number(value);
                if(Number.isInteger(step) && step>=1 && step<=60) next[key]=step;
            } else if(key==='source_max_age_minutes') {
                const age=Number(value);
                if(Number.isFinite(age) && age>0) next[key]=age;
            } else if(key==='native_sync_mode') {
                if(['manual','on_save','live'].includes(value)) next[key]=value;
            } else next[key]=value;
        }
        if(this._sourceMode==='prefix') {
            if(typeof data.entity_prefix==='string' && data.entity_prefix.trim()) next.entity_prefix=data.entity_prefix.trim();
            delete next.entities;
        } else {
            const entries={...(next.entities||{})};
            for(const day of DAY_KEYS) {
                const value=data[`entities_${day}`];
                if(typeof value==='string' && value.startsWith('text.')) entries[day]=value;
            }
            next.entities=entries;
            delete next.entity_prefix;
        }
        // Prevent a temporary invalid config when the native target is cleared.
        if(!next.native_schedule_entity) delete next.native_sync_mode;
        // Prevent partial/invalid CSS while an accent string is being typed.
        if(next.accent_color && typeof CSS!=='undefined' && CSS.supports && !CSS.supports('color',next.accent_color)) {
            next.accent_color=this._config?.accent_color;
        }
        if(JSON.stringify(next)!==JSON.stringify(this._config)) this._emit(next);
    }

    _render() {
        if(!this.shadowRoot || !this._config || !this._hass) return;
        this._renderedMode=this._sourceMode;
        this.shadowRoot.innerHTML=`
            <style>
                :host {display:block; color:var(--primary-text-color);}
                .editor-title {font-size:14px;font-weight:600;margin:8px 0;}
                .source-row {display:flex;align-items:center;gap:8px;padding:8px 0;}
                .source-row label {font-size:12px;flex:1;}
                select {border:1px solid var(--divider-color);border-radius:6px;padding:7px;
                    background:var(--card-background-color);color:var(--primary-text-color);}
                ha-form {display:block;margin:6px 0;}
                .accent-row {display:flex;align-items:center;gap:8px;padding:5px 0 10px;}
                .accent-swatch {width:18px;height:18px;border-radius:5px;border:1px solid var(--divider-color);}
                .accent-picker {border:0;background:transparent;width:36px;height:32px;cursor:pointer;}
                .accent-reset {border:0;border-radius:6px;padding:6px 10px;background:var(--secondary-background-color);
                    color:var(--primary-text-color);cursor:pointer;}
                .native-mode-hint,.note {color:var(--secondary-text-color);font-size:11px;line-height:1.35;}
                .note {margin:6px 0 10px;}
                .error-hint {color:var(--error-color,#db4437);font-size:11px;margin-bottom:5px;}
            </style>
            <div class="editor-title">BSB-LAN MQTT Schedule Card settings</div>
            ${this._editorMessage ? `<div class="error-hint">${this._escape(this._editorMessage)}</div>` : ''}
            <div class="source-row">
                <label for="source-choice">Schedule entities</label>
                <select id="source-choice" aria-label="Schedule entity selection method">
                    <option value="prefix" ${this._sourceMode==='prefix'?'selected':''}>Common entity prefix</option>
                    <option value="entities" ${this._sourceMode==='entities'?'selected':''}>Individual weekday entities</option>
                </select>
            </div>
            <ha-form></ha-form>
            <div class="accent-row">
                <span class="accent-swatch" aria-hidden="true"></span>
                <input class="accent-picker" type="color" aria-label="Pick accent color" />
                <button class="accent-reset" type="button">Use HA theme accent</button>
            </div>
            <div class="native-mode-hint"></div>
            <div class="note">Changing settings does not update Siemens. Sync HA remains one-way; live sync requires an open dashboard.</div>`;
        this._updateForm();
        this.shadowRoot.querySelector('#source-choice').addEventListener('change',ev=>this._changeSourceMode(ev.target.value));
        this.shadowRoot.querySelector('ha-form').addEventListener('value-changed',ev=>{
            ev.stopPropagation();
            this._changed(ev.detail?.value);
        });
        this.shadowRoot.querySelector('.accent-picker').addEventListener('input',ev=>{
            this._changed({...this._formData(),accent_color:ev.target.value});
        });
        this.shadowRoot.querySelector('.accent-reset').addEventListener('click',()=>{
            const c={...this._config};
            delete c.accent_color;
            this._emit(c);
            this._updateForm();
        });
    }
}

customElements.define('bsb-lan-schedule-card-editor', BSBLANScheduleCardEditor);

customElements.define('bsb-lan-schedule-card', BSBLANScheduleCard);

window.customCards = window.customCards || [];
window.customCards.push({
    type: 'bsb-lan-schedule-card',
    name: 'BSB-LAN MQTT Schedule Card',
    description: 'Edit Siemens/BSB-LAN weekly heating schedules exposed as Home Assistant text entities.',
    preview: true,
    configurable: true,
});

console.info(
    `%c BSB-LAN-SCHEDULE-CARD %c v${BSB_SCHEDULE_CARD_VERSION} `,
    'color: white; background: #03a9f4; font-weight: 700; padding: 2px 6px; border-radius: 4px 0 0 4px;',
    'color: #03a9f4; background: #e3f2fd; font-weight: 700; padding: 2px 6px; border-radius: 0 4px 4px 0;'
);
