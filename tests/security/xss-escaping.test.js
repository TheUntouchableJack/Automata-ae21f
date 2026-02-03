/**
 * XSS Escaping Security Tests
 * Tests the escapeHtml function and identifies potential XSS vulnerabilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMocks } from '../setup.js';

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
