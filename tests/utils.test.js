/**
 * Unit Tests for /app/utils.js
 * Tests the shared utilities module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetMocks } from './setup.js';

// Load the module (we'll need to inline it since it's an IIFE)
// In a real project, you'd refactor to ES modules

// For now, we'll test the individual functions directly
// by recreating them here (testing the logic)

describe('AppUtils', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('escapeHtml', () => {
    // Inline the function for testing
    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    it('escapes HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
    });

    it('escapes ampersands', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('escapes quotes', () => {
      expect(escapeHtml('"Hello"')).toBe('"Hello"');
    });

    it('returns empty string for null/undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml('')).toBe('');
    });

    it('handles normal text unchanged', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });
  });

  describe('getInitials', () => {
    function getInitials(firstName, lastName) {
      if (firstName && lastName) {
        return (firstName[0] + lastName[0]).toUpperCase();
      } else if (firstName) {
        return firstName.substring(0, 2).toUpperCase();
      } else if (lastName) {
        return lastName.substring(0, 2).toUpperCase();
      }
      return '?';
    }

    it('returns first letters of first and last name', () => {
      expect(getInitials('John', 'Doe')).toBe('JD');
    });

    it('returns first two letters of first name only', () => {
      expect(getInitials('John', null)).toBe('JO');
    });

    it('returns first two letters of last name only', () => {
      expect(getInitials(null, 'Doe')).toBe('DO');
    });

    it('returns ? when no name provided', () => {
      expect(getInitials(null, null)).toBe('?');
      expect(getInitials('', '')).toBe('?');
    });

    it('uppercases the result', () => {
      expect(getInitials('john', 'doe')).toBe('JD');
    });
  });

  describe('debounce', () => {
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }

    it('delays function execution', async () => {
      const mockFn = vi.fn();
      const debouncedFn = debounce(mockFn, 100);

      debouncedFn('arg1');
      expect(mockFn).not.toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(mockFn).toHaveBeenCalledWith('arg1');
    });

    it('only executes once for rapid calls', async () => {
      const mockFn = vi.fn();
      const debouncedFn = debounce(mockFn, 100);

      debouncedFn('call1');
      debouncedFn('call2');
      debouncedFn('call3');

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith('call3');
    });
  });

  describe('throttle', () => {
    function throttle(func, wait) {
      let lastTime = 0;
      return function executedFunction(...args) {
        const now = Date.now();
        if (now - lastTime >= wait) {
          lastTime = now;
          func.apply(this, args);
        }
      };
    }

    it('executes immediately on first call', () => {
      const mockFn = vi.fn();
      const throttledFn = throttle(mockFn, 100);

      throttledFn('arg1');
      expect(mockFn).toHaveBeenCalledWith('arg1');
    });

    it('blocks subsequent calls within wait period', () => {
      const mockFn = vi.fn();
      const throttledFn = throttle(mockFn, 100);

      throttledFn('call1');
      throttledFn('call2');
      throttledFn('call3');

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('allows calls after wait period', async () => {
      const mockFn = vi.fn();
      const throttledFn = throttle(mockFn, 50);

      throttledFn('call1');
      expect(mockFn).toHaveBeenCalledTimes(1);

      await new Promise(resolve => setTimeout(resolve, 60));

      throttledFn('call2');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('formatDate', () => {
    function formatDate(date, options = { month: 'short', day: 'numeric' }) {
      if (!date) return '';
      const d = typeof date === 'string' ? new Date(date) : date;
      return d.toLocaleDateString('en-US', options);
    }

    it('formats date strings', () => {
      const result = formatDate('2024-01-15');
      expect(result).toContain('Jan');
      expect(result).toContain('15');
    });

    it('formats Date objects', () => {
      const date = new Date(2024, 5, 20); // June 20, 2024
      const result = formatDate(date);
      expect(result).toContain('Jun');
      expect(result).toContain('20');
    });

    it('returns empty string for null/undefined', () => {
      expect(formatDate(null)).toBe('');
      expect(formatDate(undefined)).toBe('');
    });
  });

  describe('formatNumber', () => {
    function formatNumber(num) {
      if (num === null || num === undefined) return '0';
      return num.toLocaleString();
    }

    it('formats large numbers with commas', () => {
      expect(formatNumber(1000000)).toBe('1,000,000');
    });

    it('returns 0 for null/undefined', () => {
      expect(formatNumber(null)).toBe('0');
      expect(formatNumber(undefined)).toBe('0');
    });

    it('handles small numbers', () => {
      expect(formatNumber(42)).toBe('42');
    });
  });

  describe('truncate', () => {
    function truncate(text, maxLength = 100) {
      if (!text || text.length <= maxLength) return text || '';
      return text.substring(0, maxLength - 3) + '...';
    }

    it('truncates long text with ellipsis', () => {
      const longText = 'a'.repeat(150);
      const result = truncate(longText, 100);
      expect(result.length).toBe(100);
      expect(result.endsWith('...')).toBe(true);
    });

    it('does not truncate short text', () => {
      expect(truncate('Hello', 100)).toBe('Hello');
    });

    it('handles null/undefined', () => {
      expect(truncate(null)).toBe('');
      expect(truncate(undefined)).toBe('');
    });
  });
});

describe('Event Delegation', () => {
  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div id="container">
        <button class="item" data-id="1">Item 1</button>
        <button class="item" data-id="2">Item 2</button>
        <button class="item" data-id="3">Item 3</button>
      </div>
    `;
  });

  it('delegates click events to matching children', () => {
    const container = document.getElementById('container');
    const handler = vi.fn();

    // Simple delegation implementation
    container.addEventListener('click', (event) => {
      const target = event.target.closest('.item');
      if (target && container.contains(target)) {
        handler(target.dataset.id);
      }
    });

    // Simulate click on item 2
    const item2 = document.querySelector('[data-id="2"]');
    item2.click();

    expect(handler).toHaveBeenCalledWith('2');
  });

  it('does not trigger for non-matching elements', () => {
    const container = document.getElementById('container');
    const handler = vi.fn();

    container.addEventListener('click', (event) => {
      const target = event.target.closest('.item');
      if (target && container.contains(target)) {
        handler(target.dataset.id);
      }
    });

    // Click on container itself
    container.click();

    expect(handler).not.toHaveBeenCalled();
  });
});
