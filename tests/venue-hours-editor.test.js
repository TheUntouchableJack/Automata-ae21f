/**
 * The hours editor in app/venues.html — round-trip and non-destructive save.
 *
 * These are the two behaviours the plan calls out as manual browser checks,
 * because the bug they guard against is invisible: a venue whose hours the
 * owner never touched must come back out of the form byte-identical, and
 * "closed every day" must not collapse into "never entered".
 *
 * The editor lives in an inline <script> in venues.html, so the block is
 * sliced out and executed here. Slicing fails OPEN, so this file EXECUTES the
 * result rather than asserting on its text: if the slice stops defining these
 * functions, every test below throws rather than passing vacuously.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../js/venue-hours.js';

const START = '// ===== Hours editor =====';
const END = '// ===== Missing-coordinates choice modal =====';

const html = readFileSync(resolve(process.cwd(), 'app/venues.html'), 'utf8');
const start = html.indexOf(START);
const end = html.indexOf(END, start);
const editorSource = start !== -1 && end > start ? html.slice(start, end) : null;

const MARKUP = `
    <div id="hours-legacy-banner" style="display: none;">
        <button id="hours-legacy-dismiss"></button>
        <pre id="hours-legacy-text"></pre>
    </div>
    <div class="hours-grid" id="venue-hours-grid"></div>
    <button id="hours-copy-monday"></button>
`;

// Rebuilds the editor against a fresh DOM and returns its functions plus the
// module-level state they read, mirroring how venues.html holds it.
function loadEditor() {
    document.body.innerHTML = MARKUP;

    const factory = new Function('window', 'document', 'state', `
        'use strict';
        let legacyHoursDismissed = false;
        ${editorSource}
        return {
            populateHoursForm,
            readHoursFromForm,
            serializeHoursForm,
            resolveHoursForSave,
            copyMondayToAllDays,
            dismissLegacyHours,
            syncHoursRow,
            hoursInput,
            get snapshot() { return hoursFormSnapshot; },
            get dismissed() { return legacyHoursDismissed; }
        };
    `);

    return factory(window, document, {});
}

describe('hours editor — source slice', () => {
    it('the editor block is still where this test expects it', () => {
        expect(editorSource, `"${START}" .. "${END}" no longer delimit the hours editor in app/venues.html`)
            .not.toBeNull();
        expect(editorSource.length).toBeGreaterThan(1000);
        expect(editorSource).toContain('function readHoursFromForm');
        expect(editorSource).toContain('function populateHoursForm');
    });
});

describe('hours editor — populate + read round-trip', () => {
    let editor;
    beforeEach(() => { editor = loadEditor(); });

    it('builds one row per day, from VenueHours.DAYS', () => {
        editor.populateHoursForm(null);
        expect(document.querySelectorAll('#venue-hours-grid .hours-row')).toHaveLength(7);
        expect(editor.hoursInput('sunday', 'open')).not.toBeNull();
    });

    it('a Shape B schedule survives populate → read unchanged', () => {
        const stored = {
            monday: { open: '16:00', close: '02:00' },
            tuesday: null, wednesday: null, thursday: null,
            friday: { open: '16:00', close: '02:00' },
            saturday: { open: '12:00', close: '02:00' },
            sunday: null
        };
        editor.populateHoursForm(stored);
        const { hours, error } = editor.readHoursFromForm();

        expect(error).toBeNull();
        expect(hours).toEqual(stored);
    });

    it('an overnight span round-trips (16:00 → 02:00 is not an error)', () => {
        editor.populateHoursForm({ friday: { open: '16:00', close: '02:00' } });

        expect(editor.hoursInput('friday', 'open').value).toBe('16:00');
        expect(editor.hoursInput('friday', 'close').value).toBe('02:00');
        expect(document.getElementById('hours-friday-nextday').style.display).toBe('inline-block');

        const { hours, error } = editor.readHoursFromForm();
        expect(error).toBeNull();
        expect(hours.friday).toEqual({ open: '16:00', close: '02:00' });
    });

    it('midnight close (00:00) is overnight, not blank', () => {
        editor.populateHoursForm({ friday: { open: '16:00', close: '00:00' } });
        expect(editor.hoursInput('friday', 'close').value).toBe('00:00');
        expect(document.getElementById('hours-friday-nextday').style.display).toBe('inline-block');
        expect(editor.readHoursFromForm().hours.friday).toEqual({ open: '16:00', close: '00:00' });
    });

    it('no raw JSON is ever placed in the form', () => {
        editor.populateHoursForm({ monday: { open: '09:00', close: '17:00' } });
        const values = window.VenueHours.DAY_KEYS.flatMap(k => [
            editor.hoursInput(k, 'open').value,
            editor.hoursInput(k, 'close').value
        ]);
        values.forEach(v => {
            expect(v).not.toContain('{');
            expect(v).not.toContain('"');
        });
    });
});

describe('hours editor — "closed all week" vs "never touched"', () => {
    let editor;
    beforeEach(() => { editor = loadEditor(); });

    it('an untouched grid reads as null (render no Hours section)', () => {
        editor.populateHoursForm(null);
        expect(editor.readHoursFromForm().hours).toBeNull();
    });

    it('all seven ticked Closed reads as seven explicit nulls, NOT null', () => {
        editor.populateHoursForm(null);
        window.VenueHours.DAY_KEYS.forEach(k => {
            editor.hoursInput(k, 'closed').checked = true;
            editor.syncHoursRow(k);
        });

        const { hours } = editor.readHoursFromForm();
        // The owner said "we are shut". Collapsing this to null would throw
        // their answer away on the next save.
        expect(hours).not.toBeNull();
        expect(Object.keys(hours)).toHaveLength(7);
        window.VenueHours.DAY_KEYS.forEach(k => expect(hours[k]).toBeNull());
    });

    it('reopening an all-closed venue shows all seven ticked, not blank', () => {
        const allClosed = {};
        window.VenueHours.DAY_KEYS.forEach(k => { allClosed[k] = null; });

        editor.populateHoursForm(allClosed);
        window.VenueHours.DAY_KEYS.forEach(k => {
            expect(editor.hoursInput(k, 'closed').checked, `${k} should be ticked`).toBe(true);
        });
        expect(editor.readHoursFromForm().hours).toEqual(allClosed);
    });
});

describe('hours editor — validation', () => {
    let editor;
    beforeEach(() => { editor = loadEditor(); });

    it('blocks a row with an opening time and no closing time', () => {
        editor.populateHoursForm(null);
        editor.hoursInput('monday', 'open').value = '17:00';
        editor.syncHoursRow('monday');

        const { hours, error } = editor.readHoursFromForm();
        expect(error).toMatch(/Monday/);
        expect(hours).toBeNull();
    });

    it('blocks a row with a closing time and no opening time', () => {
        editor.populateHoursForm(null);
        editor.hoursInput('tuesday', 'close').value = '02:00';
        editor.syncHoursRow('tuesday');
        expect(editor.readHoursFromForm().error).toMatch(/Tuesday/);
    });

    it('blocks open === close as genuinely ambiguous', () => {
        editor.populateHoursForm(null);
        editor.hoursInput('friday', 'open').value = '17:00';
        editor.hoursInput('friday', 'close').value = '17:00';
        editor.syncHoursRow('friday');
        expect(editor.readHoursFromForm().error).toMatch(/same/i);
    });

    it('surfaces the error inline on the offending row', () => {
        editor.populateHoursForm(null);
        editor.hoursInput('monday', 'open').value = '17:00';
        editor.syncHoursRow('monday');
        editor.readHoursFromForm();
        expect(document.getElementById('hours-monday-error').textContent).not.toBe('');
    });
});

describe('hours editor — Copy Monday to all days', () => {
    let editor;
    beforeEach(() => { editor = loadEditor(); });

    it('copies open, close, and the closed flag to the other six days', () => {
        editor.populateHoursForm(null);
        editor.hoursInput('monday', 'open').value = '16:00';
        editor.hoursInput('monday', 'close').value = '02:00';
        editor.syncHoursRow('monday');

        editor.copyMondayToAllDays();

        const { hours } = editor.readHoursFromForm();
        window.VenueHours.DAY_KEYS.forEach(k => {
            expect(hours[k], `${k}`).toEqual({ open: '16:00', close: '02:00' });
        });
    });

    it('is disabled while Monday is ticked Closed', () => {
        editor.populateHoursForm(null);
        editor.hoursInput('monday', 'closed').checked = true;
        editor.syncHoursRow('monday');

        // One click would otherwise set the venue shut all week — reintroducing
        // by hand the exact failure this editor exists to remove.
        expect(document.getElementById('hours-copy-monday').disabled).toBe(true);
    });

    it('refuses to copy a closed Monday even if called directly', () => {
        editor.populateHoursForm({ tuesday: { open: '09:00', close: '17:00' } });
        editor.hoursInput('monday', 'closed').checked = true;
        editor.syncHoursRow('monday');

        editor.copyMondayToAllDays();

        expect(editor.readHoursFromForm().hours.tuesday).toEqual({ open: '09:00', close: '17:00' });
    });
});

describe('hours editor — legacy free text is preserved, not silently dropped', () => {
    let editor;
    beforeEach(() => { editor = loadEditor(); });

    it('Shape C surfaces in the banner as text, with the grid left blank', () => {
        editor.populateHoursForm({ text: 'Mon-Thu: 5PM - 12AM\nSun: Closed' });

        expect(document.getElementById('hours-legacy-banner').style.display).toBe('block');
        expect(document.getElementById('hours-legacy-text').textContent)
            .toBe('Mon-Thu: 5PM - 12AM\nSun: Closed');
        expect(editor.readHoursFromForm().hours).toBeNull();
    });

    it('the banner uses textContent, so markup in stored hours stays inert', () => {
        editor.populateHoursForm({ text: '<img src=x onerror=alert(1)>' });
        const pre = document.getElementById('hours-legacy-text');
        expect(pre.textContent).toBe('<img src=x onerror=alert(1)>');
        expect(pre.querySelector('img')).toBeNull();
    });

    it('Shape A labels route to the banner (a time input cannot hold "5pm-2am")', () => {
        editor.populateHoursForm({ mon: '5pm-2am', tue: '5pm-2am' });

        expect(document.getElementById('hours-legacy-text').textContent).toContain('Monday: 5pm-2am');
        expect(editor.hoursInput('monday', 'open').value).toBe('');
    });

    it('dismissing the banner sets the flag that allows the value to be cleared', () => {
        editor.populateHoursForm({ text: 'Open late' });
        expect(editor.dismissed).toBe(false);

        editor.dismissLegacyHours();

        expect(editor.dismissed).toBe(true);
        expect(document.getElementById('hours-legacy-banner').style.display).toBe('none');
    });
});

describe('hours editor — resolveHoursForSave (the no-op edit)', () => {
    let editor;
    beforeEach(() => { editor = loadEditor(); });

    // Venue writes are not audit-logged, so venues.hours is the only copy.
    // Every shape must survive an edit that never touched the grid — the owner
    // changed a phone number and hit Save.
    const shapes = [
        ['Shape A (abbreviated)', { mon: '5pm-2am' }],
        ['Shape B (schedule)', { monday: { open: '16:00', close: '02:00' }, sunday: null }],
        ['Shape C (legacy text)', { text: 'Mon-Thu: 5PM - 12AM' }],
        ['mixed schedule + label', { monday: { open: '16:00', close: '02:00' }, friday: '5pm-2am' }],
        ['unrecognized object', { foo: 1 }],
        ['empty object', {}],
        ['all seven closed', {
            monday: null, tuesday: null, wednesday: null, thursday: null,
            friday: null, saturday: null, sunday: null
        }]
    ];

    it.each(shapes)('%s is written back byte-identical when the grid is untouched', (_label, stored) => {
        editor.populateHoursForm(stored);

        const resolved = editor.resolveHoursForSave(editor.readHoursFromForm(), stored, false);

        // Identity, not equality: the original object goes to the DB unchanged.
        expect(resolved).toBe(stored);
    });

    it('a mixed schedule+label venue does NOT lose its label to the grid', () => {
        // The dangerous case: populate fills Monday from the editable span, so
        // a naive "read the grid and save it" would drop Friday's "5pm-2am".
        const stored = { monday: { open: '16:00', close: '02:00' }, friday: '5pm-2am' };
        editor.populateHoursForm(stored);

        const fromGrid = editor.readHoursFromForm().hours;
        expect(fromGrid.friday, 'the grid cannot represent the label').toBeNull();

        const resolved = editor.resolveHoursForSave({ hours: fromGrid }, stored, false);
        expect(resolved).toBe(stored);
        expect(resolved.friday).toBe('5pm-2am');
    });

    it('entering hours replaces the stored value', () => {
        const stored = { text: 'Open late' };
        editor.populateHoursForm(stored);

        editor.hoursInput('monday', 'open').value = '17:00';
        editor.hoursInput('monday', 'close').value = '02:00';
        editor.syncHoursRow('monday');

        const resolved = editor.resolveHoursForSave(editor.readHoursFromForm(), stored, false);
        expect(resolved).not.toBe(stored);
        expect(resolved.monday).toEqual({ open: '17:00', close: '02:00' });
    });

    it('dismissing the banner clears the stored value even with an untouched grid', () => {
        const stored = { text: 'Open late' };
        editor.populateHoursForm(stored);
        editor.dismissLegacyHours();

        const resolved = editor.resolveHoursForSave(editor.readHoursFromForm(), stored, true);
        expect(resolved).toBeNull();
    });

    it('a new venue with nothing entered saves null, not an empty grid', () => {
        editor.populateHoursForm(null);
        expect(editor.resolveHoursForSave(editor.readHoursFromForm(), null, false)).toBeNull();
    });

    it('ticking all seven Closed on a fresh venue saves seven nulls', () => {
        editor.populateHoursForm(null);
        window.VenueHours.DAY_KEYS.forEach(k => {
            editor.hoursInput(k, 'closed').checked = true;
            editor.syncHoursRow(k);
        });

        const resolved = editor.resolveHoursForSave(editor.readHoursFromForm(), null, false);
        expect(resolved).not.toBeNull();
        expect(Object.keys(resolved)).toHaveLength(7);
    });
});
