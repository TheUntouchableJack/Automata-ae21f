// ===== Venue hours — single source of truth for shape =====
//
// Loaded by BOTH the customer app (customer-app/social.html) and the owner's
// venue admin (app/venues.html), for the same reason /js/venue-categories.js
// exists: those two surfaces disagreed about a stored value and the
// disagreement silently destroyed the owner's work.
//
// The history, because it explains every decision below. Migration
// 20260225000001_social_venue_discovery.sql documents venues.hours as
//
//     {"mon": "5pm-2am", ...}
//
// in a DDL comment. Nothing has ever written that shape. Two later authors
// each read the column and invented their own:
//
//   Shape A  {"mon": "5pm-2am"}                  — documented, never written
//   Shape B  {"monday": {"open":"17:00","close":"02:00"}}  — seeded demo venues
//   Shape C  {"text": "Mon-Thu: 5PM - 12AM\n..."} — what the admin textarea
//            produced for every venue the owner typed by hand, because its
//            placeholder taught free text and saveVenue() wrapped anything
//            that failed JSON.parse in {text: ...}
//
// The reader only understood B. Shape C fell through its per-day lookup, so
// every hand-added venue rendered "Closed" seven days a week on the public
// page — under a green "Venue added" toast. Seeded venues used Shape B and
// rendered fine, so the feature looked like it worked.
//
// normalize() is total: every possible input maps to exactly one kind, and
// unrecognized objects map to 'empty' rather than falling through into a
// seven-day grid of "Closed". That last line is the bug fix.
(function (global) {
    'use strict';

    // Canonical day order. The renderer, the editor, and readHoursFromForm()
    // all iterate this — a second hand-written day list is how the category
    // slugs drifted in the first place.
    var DAYS = [
        { key: 'monday',    abbr: 'mon', label: 'Monday' },
        { key: 'tuesday',   abbr: 'tue', label: 'Tuesday' },
        { key: 'wednesday', abbr: 'wed', label: 'Wednesday' },
        { key: 'thursday',  abbr: 'thu', label: 'Thursday' },
        { key: 'friday',    abbr: 'fri', label: 'Friday' },
        { key: 'saturday',  abbr: 'sat', label: 'Saturday' },
        { key: 'sunday',    abbr: 'sun', label: 'Sunday' }
    ];

    var DAY_KEYS = DAYS.map(function (d) { return d.key; });
    var ABBR_TO_KEY = DAYS.reduce(function (acc, d) { acc[d.abbr] = d.key; return acc; }, {});

    function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    // A stored day value becomes one of:
    //   null                        — explicitly closed
    //   {open:'HH:MM', close:'HH:MM'} — renderable AND editable in <input type="time">
    //   {label:'5pm-2am'}           — renderable, NOT editable (Shape A free text)
    function normalizeDay(value) {
        if (value === null || value === undefined || value === '') return null;

        if (typeof value === 'string') {
            var trimmed = value.trim();
            return trimmed ? { label: trimmed } : null;
        }

        if (isPlainObject(value)) {
            if (typeof value.label === 'string' && value.label.trim()) {
                return { label: value.label.trim() };
            }
            var open = typeof value.open === 'string' ? value.open.trim() : '';
            var close = typeof value.close === 'string' ? value.close.trim() : '';
            if (open && close) return { open: open, close: close };
        }

        // Anything else ({} , {open:'17:00'} with no close, numbers, arrays)
        // carries no renderable information. Treat as closed rather than
        // inventing hours.
        return null;
    }

    function buildSchedule(raw, keyFor) {
        var days = {};
        for (var i = 0; i < DAYS.length; i++) {
            var storedKey = keyFor(DAYS[i]);
            days[DAYS[i].key] = Object.prototype.hasOwnProperty.call(raw, storedKey)
                ? normalizeDay(raw[storedKey])
                : null;
        }
        return { kind: 'schedule', days: days, text: null };
    }

    var EMPTY = function () { return { kind: 'empty', days: null, text: null }; };

    // raw -> { kind:'schedule'|'text'|'empty', days, text }
    //
    // Recognition order matters. A JSON *string* is parsed and recursed
    // because openVenueModal() used to write JSON.stringify() back into a
    // textarea, so double-encoded values exist in the wild.
    function normalize(raw, _depth) {
        var depth = _depth || 0;

        if (raw === null || raw === undefined) return EMPTY();

        if (typeof raw === 'string') {
            var s = raw.trim();
            if (!s) return EMPTY();
            // Only JSON-looking strings are re-parsed; a bare "Mon-Fri 9-5"
            // stored as a plain string is legacy free text.
            if (depth < 2 && (s.charAt(0) === '{' || s.charAt(0) === '[')) {
                try {
                    return normalize(JSON.parse(s), depth + 1);
                } catch (e) {
                    return { kind: 'text', days: null, text: s };
                }
            }
            return { kind: 'text', days: null, text: s };
        }

        if (!isPlainObject(raw)) return EMPTY();

        var keys = Object.keys(raw);
        if (keys.length === 0) return EMPTY();

        // Shape C — legacy free text.
        if (typeof raw.text === 'string') {
            var t = raw.text.trim();
            return t ? { kind: 'text', days: null, text: t } : EMPTY();
        }

        // Shape B — full day names. Present if ANY full day name appears, so a
        // venue open only on Friday still reads as a schedule.
        var hasFullDay = DAY_KEYS.some(function (k) {
            return Object.prototype.hasOwnProperty.call(raw, k);
        });
        if (hasFullDay) {
            return buildSchedule(raw, function (d) { return d.key; });
        }

        // Shape A — abbreviated day names. Expanded to full keys; string values
        // become {label} because "5pm-2am" cannot go in <input type="time">.
        var hasAbbrDay = Object.keys(ABBR_TO_KEY).some(function (a) {
            return Object.prototype.hasOwnProperty.call(raw, a);
        });
        if (hasAbbrDay) {
            return buildSchedule(raw, function (d) { return d.abbr; });
        }

        // Unrecognized object. THE FIX: fall through to 'empty' so the caller
        // renders no Hours section, instead of a seven-day grid of "Closed".
        return EMPTY();
    }

    // True when at least one day carries a value that <input type="time"> cannot
    // hold — Shape A labels. The editor routes these to the legacy banner
    // alongside Shape C rather than silently dropping them.
    function hasUneditableDays(normalized) {
        if (!normalized || normalized.kind !== 'schedule') return false;
        return DAY_KEYS.some(function (k) {
            var d = normalized.days[k];
            return !!d && typeof d.label === 'string';
        });
    }

    // 'HH:MM' -> '5 PM' / '5:30 PM'. Mirrors social.js formatTime(), which stays
    // where it is; this copy exists so the admin can render the same strings
    // without importing the customer app.
    function formatTime(time24) {
        if (!time24 || typeof time24 !== 'string') return '';
        var parts = time24.split(':');
        var h = Number(parts[0]);
        var m = Number(parts[1]);
        if (!isFinite(h) || !isFinite(m)) return time24;
        var ampm = h >= 12 ? 'PM' : 'AM';
        var hour12 = h % 12 || 12;
        return m ? hour12 + ':' + String(m).padStart(2, '0') + ' ' + ampm
                 : hour12 + ' ' + ampm;
    }

    // Bars close after midnight, so close < open is the norm here, not an
    // error. Used to render the "+1 day" chip.
    function isOvernight(span) {
        if (!span || !span.open || !span.close) return false;
        return span.close <= span.open;
    }

    function todayKey(now) {
        var d = now || new Date();
        var js = d.getDay(); // 0 = Sunday
        return DAY_KEYS[js === 0 ? 6 : js - 1];
    }

    global.VenueHours = {
        DAYS: DAYS,
        DAY_KEYS: DAY_KEYS,
        normalize: normalize,
        normalizeDay: normalizeDay,
        hasUneditableDays: hasUneditableDays,
        formatTime: formatTime,
        isOvernight: isOvernight,
        todayKey: todayKey
    };
})(typeof window !== 'undefined' ? window : globalThis);
