/**
 * venues.hours shape normalization
 *
 * The regression this pins: an unrecognized hours object used to fall through
 * the customer app's per-day lookup and render "Closed" seven days a week on
 * the public venue page. See js/venue-hours.js for the full history.
 *
 * VenueHours is an IIFE over `window`, so a side-effect import populates
 * globalThis.VenueHours under jsdom.
 */

import { describe, it, expect } from 'vitest';
import '../js/venue-hours.js';

const VenueHours = globalThis.VenueHours;

// Guard against a vacuous pass: if the import ever stops populating the
// global, every assertion below would throw rather than silently succeed —
// but make the reason explicit.
describe('VenueHours module', () => {
    it('is exposed on the global after import', () => {
        expect(VenueHours).toBeDefined();
        expect(typeof VenueHours.normalize).toBe('function');
        expect(VenueHours.DAY_KEYS).toHaveLength(7);
    });
});

describe('normalize() — the four shapes on disk', () => {
    it('Shape A (abbreviated day names) reads as a schedule with expanded keys', () => {
        const r = VenueHours.normalize({ mon: '5pm-2am', fri: '4pm-2am' });
        expect(r.kind).toBe('schedule');
        expect(r.days.monday).toEqual({ label: '5pm-2am' });
        expect(r.days.friday).toEqual({ label: '4pm-2am' });
        // Days absent from the object are closed, not undefined.
        expect(r.days.sunday).toBeNull();
    });

    it('Shape B (full day names, open/close) reads as a schedule', () => {
        const r = VenueHours.normalize({
            monday: { open: '17:00', close: '02:00' },
            sunday: null
        });
        expect(r.kind).toBe('schedule');
        expect(r.days.monday).toEqual({ open: '17:00', close: '02:00' });
        expect(r.days.sunday).toBeNull();
    });

    it('Shape C (legacy {text}) reads as text, not a schedule', () => {
        const r = VenueHours.normalize({ text: 'Mon-Thu: 5PM - 12AM\nSun: Closed' });
        expect(r.kind).toBe('text');
        expect(r.text).toBe('Mon-Thu: 5PM - 12AM\nSun: Closed');
        expect(r.days).toBeNull();
    });

    it('a JSON string is parsed and recursed (double-encoded values exist in the wild)', () => {
        const r = VenueHours.normalize('{"monday":{"open":"09:00","close":"17:00"}}');
        expect(r.kind).toBe('schedule');
        expect(r.days.monday).toEqual({ open: '09:00', close: '17:00' });
    });

    it('a JSON string wrapping Shape C still reads as text', () => {
        const r = VenueHours.normalize('{"text":"Open late"}');
        expect(r.kind).toBe('text');
        expect(r.text).toBe('Open late');
    });
});

describe('normalize() — the regression guard', () => {
    // Each of these used to reach the day-grid renderer and produce seven
    // "Closed" rows on a public page.
    const junk = [
        ['empty object', {}],
        ['null', null],
        ['undefined', undefined],
        ['array', []],
        ['populated array', [1, 2, 3]],
        ['unrecognized keys', { foo: 1 }],
        ['number', 42],
        ['boolean', true],
        ['empty string', ''],
        ['whitespace string', '   '],
        ['empty text field', { text: '' }],
        ['whitespace text field', { text: '   ' }]
    ];

    it.each(junk)('%s → empty', (_label, input) => {
        const r = VenueHours.normalize(input);
        expect(r.kind).toBe('empty');
        expect(r.days).toBeNull();
        expect(r.text).toBeNull();
    });

    it('unparseable non-JSON string is preserved as text, not discarded', () => {
        const r = VenueHours.normalize('Mon-Fri 9-5');
        expect(r.kind).toBe('text');
        expect(r.text).toBe('Mon-Fri 9-5');
    });

    it('a malformed JSON-looking string degrades to text rather than throwing', () => {
        const r = VenueHours.normalize('{not json');
        expect(r.kind).toBe('text');
        expect(r.text).toBe('{not json');
    });
});

describe('normalize() — "closed all week" survives', () => {
    it('all seven days explicitly null reads as a schedule, NOT empty', () => {
        const raw = {};
        VenueHours.DAY_KEYS.forEach(k => { raw[k] = null; });

        const r = VenueHours.normalize(raw);
        // The owner said something ("we are shut"). Collapsing this to `empty`
        // would silently drop their answer and render no Hours section.
        expect(r.kind).toBe('schedule');
        VenueHours.DAY_KEYS.forEach(k => expect(r.days[k]).toBeNull());
    });

    it('a single open day among six nulls still reads as a schedule', () => {
        const raw = { monday: null, tuesday: null, wednesday: null, thursday: null,
                      friday: { open: '16:00', close: '02:00' },
                      saturday: null, sunday: null };
        const r = VenueHours.normalize(raw);
        expect(r.kind).toBe('schedule');
        expect(r.days.friday).toEqual({ open: '16:00', close: '02:00' });
    });
});

describe('normalizeDay() — partial and malformed spans', () => {
    it('a span missing close is closed, not half-open', () => {
        expect(VenueHours.normalizeDay({ open: '17:00' })).toBeNull();
    });

    it('a span missing open is closed', () => {
        expect(VenueHours.normalizeDay({ close: '02:00' })).toBeNull();
    });

    it('an empty day object is closed', () => {
        expect(VenueHours.normalizeDay({})).toBeNull();
    });

    it('a string day value becomes a non-editable label', () => {
        expect(VenueHours.normalizeDay('5pm-2am')).toEqual({ label: '5pm-2am' });
    });

    it('an explicit {label} passes through', () => {
        expect(VenueHours.normalizeDay({ label: 'Sunset til late' }))
            .toEqual({ label: 'Sunset til late' });
    });
});

describe('overnight spans — the norm for bars, never an error', () => {
    it('16:00 → 02:00 round-trips and reads as overnight', () => {
        const r = VenueHours.normalize({ friday: { open: '16:00', close: '02:00' } });
        expect(r.days.friday).toEqual({ open: '16:00', close: '02:00' });
        expect(VenueHours.isOvernight(r.days.friday)).toBe(true);
    });

    it('16:00 → 00:00 round-trips and reads as overnight (midnight, not blank)', () => {
        const r = VenueHours.normalize({ friday: { open: '16:00', close: '00:00' } });
        expect(r.days.friday).toEqual({ open: '16:00', close: '00:00' });
        expect(VenueHours.isOvernight(r.days.friday)).toBe(true);
    });

    it('09:00 → 17:00 is not overnight', () => {
        expect(VenueHours.isOvernight({ open: '09:00', close: '17:00' })).toBe(false);
    });

    it('open === close reads as overnight (and the editor blocks it as ambiguous)', () => {
        expect(VenueHours.isOvernight({ open: '17:00', close: '17:00' })).toBe(true);
    });

    it('a label span is not overnight (nothing to compare)', () => {
        expect(VenueHours.isOvernight({ label: '5pm-2am' })).toBe(false);
    });
});

describe('hasUneditableDays()', () => {
    it('true when any day carries a free-text label', () => {
        const r = VenueHours.normalize({ mon: '5pm-2am' });
        expect(VenueHours.hasUneditableDays(r)).toBe(true);
    });

    it('false for a pure open/close schedule', () => {
        const r = VenueHours.normalize({ monday: { open: '17:00', close: '02:00' } });
        expect(VenueHours.hasUneditableDays(r)).toBe(false);
    });

    it('false for text and empty kinds', () => {
        expect(VenueHours.hasUneditableDays(VenueHours.normalize({ text: 'x' }))).toBe(false);
        expect(VenueHours.hasUneditableDays(VenueHours.normalize({}))).toBe(false);
    });
});

describe('formatTime()', () => {
    it('formats on-the-hour without minutes', () => {
        expect(VenueHours.formatTime('17:00')).toBe('5 PM');
        expect(VenueHours.formatTime('09:00')).toBe('9 AM');
    });

    it('formats with minutes when present', () => {
        expect(VenueHours.formatTime('17:30')).toBe('5:30 PM');
    });

    it('midnight and noon do not collapse to 0', () => {
        expect(VenueHours.formatTime('00:00')).toBe('12 AM');
        expect(VenueHours.formatTime('12:00')).toBe('12 PM');
    });

    it('returns empty for blank input', () => {
        expect(VenueHours.formatTime('')).toBe('');
        expect(VenueHours.formatTime(null)).toBe('');
    });
});

describe('todayKey()', () => {
    it('maps JS Sunday (0) to the last slot, not the first', () => {
        // 2026-08-23 is a Sunday.
        expect(VenueHours.todayKey(new Date(2026, 7, 23))).toBe('sunday');
    });

    it('maps Monday to the first slot', () => {
        expect(VenueHours.todayKey(new Date(2026, 7, 24))).toBe('monday');
    });
});
