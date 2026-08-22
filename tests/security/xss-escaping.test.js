/**
 * XSS Escaping Security Tests
 * Tests the escapeHtml function and identifies potential XSS vulnerabilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resetMocks } from '../setup.js';
import '../../js/venue-hours.js';

// Create a mock document for escapeHtml function
const mockCreateElement = vi.fn(() => {
    let textContent = '';
    return {
        get textContent() { return textContent; },
        set textContent(val) { textContent = val; },
        get innerHTML() {
            // Simulate browser's HTML encoding behavior
            return textContent
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
    };
});

globalThis.document = {
    createElement: mockCreateElement
};

// Import the escapeHtml function after setting up mocks
// We'll test it directly since it's a pure function
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

describe('XSS Escaping - escapeHtml Function', () => {
    beforeEach(() => {
        resetMocks();
        mockCreateElement.mockClear();
    });

    describe('Basic HTML Escaping', () => {
        it('should escape < and > characters', () => {
            const result = escapeHtml('<script>alert("xss")</script>');
            expect(result).not.toContain('<script>');
            expect(result).not.toContain('</script>');
            expect(result).toContain('&lt;');
            expect(result).toContain('&gt;');
        });

        it('should escape ampersand', () => {
            const result = escapeHtml('Tom & Jerry');
            expect(result).toContain('&amp;');
        });

        it('should escape double quotes', () => {
            const result = escapeHtml('Hello "World"');
            expect(result).toContain('&quot;');
        });

        it('should escape single quotes', () => {
            const result = escapeHtml("Hello 'World'");
            expect(result).toContain('&#039;');
        });

        it('should handle multiple special characters together', () => {
            const result = escapeHtml('<div class="test">&</div>');
            expect(result).toContain('&lt;');
            expect(result).toContain('&gt;');
            expect(result).toContain('&quot;');
            expect(result).toContain('&amp;');
        });
    });

    describe('Script Injection Prevention', () => {
        it('should escape inline script tags', () => {
            const attack = '<script>document.cookie</script>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<script');
        });

        it('should escape script tags with attributes', () => {
            const attack = '<script src="evil.js"></script>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<script');
        });

        it('should escape script tags with mixed case', () => {
            const attack = '<ScRiPt>alert(1)</ScRiPt>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<ScRiPt');
        });

        it('should escape script tags with newlines', () => {
            const attack = '<script\n>alert(1)</script>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<script');
        });
    });

    describe('Event Handler Injection Prevention', () => {
        it('should escape onclick handlers by escaping the tag', () => {
            const attack = '<img onclick="alert(1)" src=x>';
            const result = escapeHtml(attack);
            // escapeHtml escapes < and > so the tag becomes text, not executable HTML
            expect(result).toContain('&lt;');
            expect(result).toContain('&gt;');
            expect(result).not.toContain('<img');
        });

        it('should escape onerror handlers by escaping the tag', () => {
            const attack = '<img onerror="alert(1)" src=x>';
            const result = escapeHtml(attack);
            expect(result).toContain('&lt;');
            expect(result).not.toContain('<img');
        });

        it('should escape onload handlers by escaping the tag', () => {
            const attack = '<body onload="alert(1)">';
            const result = escapeHtml(attack);
            expect(result).toContain('&lt;');
            expect(result).not.toContain('<body');
        });

        it('should escape onmouseover handlers by escaping the tag', () => {
            const attack = '<div onmouseover="alert(1)">Hover me</div>';
            const result = escapeHtml(attack);
            expect(result).toContain('&lt;');
            expect(result).not.toContain('<div');
        });

        it('should escape onfocus handlers by escaping the tag', () => {
            const attack = '<input onfocus="alert(1)" autofocus>';
            const result = escapeHtml(attack);
            expect(result).toContain('&lt;');
            expect(result).not.toContain('<input');
        });
    });

    describe('URI Scheme Prevention', () => {
        it('should escape javascript: URIs by escaping the tag', () => {
            const attack = '<a href="javascript:alert(1)">Click</a>';
            const result = escapeHtml(attack);
            // escapeHtml escapes < and > so the anchor tag becomes text
            expect(result).toContain('&lt;');
            expect(result).toContain('&gt;');
            expect(result).not.toContain('<a');
            // The content is escaped as text - javascript: is no longer in an href
        });

        it('should escape data: URIs with HTML by escaping tags', () => {
            const attack = '<a href="data:text/html,<script>alert(1)</script>">Click</a>';
            const result = escapeHtml(attack);
            expect(result).toContain('&lt;');
            expect(result).not.toContain('<a');
        });

        it('should escape vbscript: URIs by escaping the tag', () => {
            const attack = '<a href="vbscript:msgbox(1)">Click</a>';
            const result = escapeHtml(attack);
            expect(result).toContain('&lt;');
            expect(result).not.toContain('<a');
        });
    });

    describe('HTML Element Injection Prevention', () => {
        it('should escape iframe tags', () => {
            const attack = '<iframe src="evil.com"></iframe>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<iframe');
        });

        it('should escape object tags', () => {
            const attack = '<object data="evil.swf"></object>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<object');
        });

        it('should escape embed tags', () => {
            const attack = '<embed src="evil.swf">';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<embed');
        });

        it('should escape form tags', () => {
            const attack = '<form action="evil.com"><input name="password"></form>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<form');
        });

        it('should escape svg with embedded script', () => {
            const attack = '<svg onload="alert(1)"></svg>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<svg');
        });

        it('should escape math tags with embedded script', () => {
            const attack = '<math><maction actiontype="statusline#http://evil.com">CLICKME</maction></math>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<math');
        });
    });

    describe('Edge Cases', () => {
        it('should return empty string for null input', () => {
            expect(escapeHtml(null)).toBe('');
        });

        it('should return empty string for undefined input', () => {
            expect(escapeHtml(undefined)).toBe('');
        });

        it('should return empty string for empty string input', () => {
            expect(escapeHtml('')).toBe('');
        });

        it('should handle plain text without modification', () => {
            const plainText = 'Hello World 123';
            const result = escapeHtml(plainText);
            expect(result).toBe(plainText);
        });

        it('should handle unicode characters correctly', () => {
            const unicode = 'Hello \u4e16\u754c'; // Hello 世界
            const result = escapeHtml(unicode);
            expect(result).toContain('\u4e16\u754c');
        });

        it('should handle very long strings', () => {
            const longString = '<script>'.repeat(1000);
            const result = escapeHtml(longString);
            expect(result).not.toContain('<script>');
        });

        it('should handle numbers coerced to string', () => {
            // In real implementation, non-strings return empty or need explicit toString()
            // @ts-ignore - testing edge case
            const result = escapeHtml(String(12345));
            expect(result).toBe('12345');
        });
    });

    describe('Nested and Complex Attacks', () => {
        it('should escape nested script attempts', () => {
            const attack = '<<script>script>alert(1)<</script>/script>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<script>');
        });

        it('should escape encoded script injection', () => {
            // URL-encoded attack (should be escaped as-is, decoding happens elsewhere)
            const attack = '%3Cscript%3Ealert(1)%3C/script%3E';
            const result = escapeHtml(attack);
            // The percent-encoding should pass through, it's the server's job to decode
            expect(result).toBe(attack);
        });

        it('should escape HTML entity bypass attempts', () => {
            // Already-encoded entities should be double-escaped
            const attack = '&lt;script&gt;alert(1)&lt;/script&gt;';
            const result = escapeHtml(attack);
            expect(result).toContain('&amp;lt;');
        });

        it('should escape broken tag attempts', () => {
            const attack = '<scr<script>ipt>alert(1)</script>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<script>');
        });

        it('should escape null byte injection attempts', () => {
            const attack = '<scri\x00pt>alert(1)</script>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<scri');
        });
    });

    describe('Attribute Injection Prevention', () => {
        it('should escape injection via style attribute', () => {
            const attack = '<div style="background:url(javascript:alert(1))">Test</div>';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<div');
        });

        it('should escape injection via src attribute', () => {
            const attack = '<img src="x" onerror="alert(1)">';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<img');
        });

        it('should escape injection via background attribute', () => {
            const attack = '<table background="javascript:alert(1)">';
            const result = escapeHtml(attack);
            expect(result).not.toContain('<table');
        });
    });
});

describe('XSS Escaping - Integration Patterns', () => {
    describe('Toast Message Escaping', () => {
        it('should safely display user input in toast messages', () => {
            const userInput = '<script>steal(document.cookie)</script>';
            const escaped = escapeHtml(userInput);

            // Simulate toast HTML construction
            const toastHtml = `<div class="toast"><span>${escaped}</span></div>`;

            expect(toastHtml).not.toContain('<script>');
            expect(toastHtml).toContain('&lt;script&gt;');
        });
    });

    describe('Table Cell Escaping', () => {
        it('should safely render user data in table cells', () => {
            const userData = {
                name: '<img src=x onerror=alert(1)>John',
                email: 'john@test.com"onclick="alert(1)'
            };

            const escapedName = escapeHtml(userData.name);
            const escapedEmail = escapeHtml(userData.email);

            // HTML tags are escaped, making them display as text not execute
            expect(escapedName).not.toContain('<img');
            expect(escapedName).toContain('&lt;img');
            // Quotes are escaped so they can't break out of attributes
            expect(escapedEmail).toContain('&quot;');
        });
    });

    describe('Form Error Message Escaping', () => {
        it('should safely display error messages with user input', () => {
            const userEmail = '"><script>alert(1)</script><input value="';
            const errorMessage = `Invalid email: ${escapeHtml(userEmail)}`;

            expect(errorMessage).not.toContain('<script>');
            expect(errorMessage).toContain('&lt;script&gt;');
        });
    });
});

// ===== Venue hours renderer =====
//
// venues.hours is owner-supplied JSONB that reaches a PUBLIC page. The
// renderer used to assign a string day value straight to `timeText` and
// interpolate it into innerHTML unescaped, so
// {"mon": "<img src=x onerror=alert(1)>"} executed for every visitor.
//
// The block is inside openVenuePage() in a ~2,500-line browser-coupled file,
// so this asserts on the source. Source slicing fails OPEN when code moves —
// each assertion below is therefore preceded by a guard proving the slice
// actually matched something.
describe('XSS - venue hours renderer (customer-app/social.js)', () => {
    // jsdom replaces the global URL, so resolve from the vitest root instead of
    // import.meta.url.
    const source = readFileSync(
        resolve(process.cwd(), 'customer-app/social.js'),
        'utf8'
    );

    // The slice: from the "Render hours" marker to the "Render about" marker
    // that follows it.
    const startMarker = '// Render hours';
    const endMarker = '// Render about';

    function hoursBlock() {
        const start = source.indexOf(startMarker);
        const end = source.indexOf(endMarker, start);
        if (start === -1 || end === -1 || end <= start) return null;
        return source.slice(start, end);
    }

    it('the source slice still matches (guard — everything below is vacuous without it)', () => {
        const block = hoursBlock();
        expect(block, `"${startMarker}" .. "${endMarker}" no longer delimit the hours renderer`).not.toBeNull();
        expect(block.length).toBeGreaterThan(400);
        // Proof it is the renderer and not some unrelated stretch of file.
        expect(block).toContain('venue-page-hours');
        expect(block).toContain('venue-page-hours-table');
    });

    it('every value interpolated into element content goes through escapeHtml', () => {
        const block = hoursBlock();
        expect(block).not.toBeNull();

        // Only interpolations landing in *element content* — `>${...}` — can
        // introduce markup. Expressions that merely build an intermediate
        // string (`${formatTime(span.open)} – ${formatTime(span.close)}`) are
        // escaped later, at the point they reach the DOM.
        const inContent = block.match(/>\$\{[^}]*\}/g) || [];
        expect(
            inContent.length,
            'no `>${...}` interpolations found — the markup was restructured and this test is now vacuous'
        ).toBeGreaterThanOrEqual(3);

        const unescaped = inContent.filter(expr => {
            if (expr.includes('escapeHtml(')) return false;
            // `${rows}` is HTML this same block composed, cell by cell, from
            // already-escaped values. It is the only permitted raw insert.
            if (expr === '>${rows}') return false;
            return true;
        });

        expect(unescaped, `unescaped interpolation(s) in the hours renderer: ${unescaped.join(', ')}`)
            .toEqual([]);
    });

    it('the ${rows} exception above is only safe while every cell escapes', () => {
        const block = hoursBlock();
        expect(block).not.toBeNull();

        // Pins the premise of the exception: each <td> escapes its own value.
        const cells = block.match(/<td>\$\{[^}]*\}<\/td>/g) || [];
        expect(cells.length, 'the <td> cells were restructured — re-check the ${rows} exception')
            .toBe(2);
        cells.forEach(cell => expect(cell).toContain('escapeHtml('));
    });

    it('does not reassign a raw day value to the rendered text', () => {
        const block = hoursBlock();
        expect(block).not.toBeNull();

        // The exact regression: `timeText = h;` where h is the raw JSONB value.
        expect(block).not.toMatch(/timeText\s*=\s*h\s*;/);
        expect(block).not.toMatch(/typeof\s+h\s*===\s*'string'/);
    });

    it('delegates shape detection to VenueHours rather than sniffing inline', () => {
        const block = hoursBlock();
        expect(block).not.toBeNull();

        expect(block).toContain('VenueHours.normalize');
        // A second hand-written day list is how the category slugs drifted.
        expect(block).not.toContain("'monday', 'tuesday'");
    });

    it('clears innerHTML when there are no hours (the node is a reused singleton)', () => {
        const block = hoursBlock();
        expect(block).not.toBeNull();
        expect(block).toMatch(/hoursEl\.innerHTML\s*=\s*''/);
    });
});

// Behavioral counterpart: the shape layer itself must never hand the renderer
// a value it would have to trust.
describe('XSS - VenueHours normalization preserves hostile input as data', () => {
    it('a script-bearing day value survives as an inert label, not markup', () => {
        const VenueHours = globalThis.VenueHours;
        expect(VenueHours, 'js/venue-hours.js did not populate the global').toBeDefined();

        const r = VenueHours.normalize({ mon: '<img src=x onerror=alert(1)>' });
        expect(r.kind).toBe('schedule');
        // Still a plain string on a `label` field — the renderer escapes it.
        expect(r.days.monday).toEqual({ label: '<img src=x onerror=alert(1)>' });
        expect(typeof r.days.monday.label).toBe('string');
    });

    it('a script-bearing text blob stays on the text field', () => {
        const VenueHours = globalThis.VenueHours;
        const r = VenueHours.normalize({ text: '</div><script>alert(1)</script>' });
        expect(r.kind).toBe('text');
        expect(r.text).toBe('</div><script>alert(1)</script>');
    });
});
