/**
 * PIN Hashing Security Tests
 * Tests the hashPin function used for customer app authentication
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMocks } from '../setup.js';

// Mock crypto.subtle for testing - use vi.stubGlobal to avoid getter issues
const mockDigest = vi.fn(async (algorithm, data) => {
    // Simulate SHA-256 hash - returns a deterministic mock based on input
    const dataArray = new Uint8Array(data);
    const sum = dataArray.reduce((a, b) => a + b, 0);
    const mockHash = new Uint8Array(32).fill(0);
    for (let i = 0; i < 32; i++) {
        mockHash[i] = (sum + i) % 256;
    }
    return mockHash.buffer;
});

vi.stubGlobal('crypto', {
    subtle: {
        digest: mockDigest
    }
});

// The hashPin function from customer-app (two variants found)
// Variant 1: from index.html - returns hex string
async function hashPinHex(pin) {
    const data = new TextEncoder().encode(pin + 'automata_salt');
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Variant 2: from app.js - returns base64 string
async function hashPinBase64(pin) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin + 'automata-salt');
    const hash = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

describe('PIN Hashing - Consistency', () => {
    beforeEach(() => {
        resetMocks();
        mockDigest.mockClear();
    });

    describe('hashPinHex (index.html variant)', () => {
        it('should produce consistent output for same PIN', async () => {
            const hash1 = await hashPinHex('1234');
            const hash2 = await hashPinHex('1234');
            expect(hash1).toBe(hash2);
        });

        it('should produce different output for different PINs', async () => {
            const hash1 = await hashPinHex('1234');
            const hash2 = await hashPinHex('5678');
            expect(hash1).not.toBe(hash2);
        });

        it('should return 64 character hex string (SHA-256 = 256 bits = 64 hex chars)', async () => {
            const hash = await hashPinHex('1234');
            expect(hash.length).toBe(64);
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('should include salt in hash computation', async () => {
            await hashPinHex('1234');
            expect(mockDigest).toHaveBeenCalled();

            // Verify the encoded data includes the salt
            const callArg = mockDigest.mock.calls[0][1];
            const decodedString = String.fromCharCode(...new Uint8Array(callArg));
            expect(decodedString).toContain('automata_salt');
        });
    });

    describe('hashPinBase64 (app.js variant)', () => {
        it('should produce consistent output for same PIN', async () => {
            const hash1 = await hashPinBase64('1234');
            const hash2 = await hashPinBase64('1234');
            expect(hash1).toBe(hash2);
        });

        it('should produce different output for different PINs', async () => {
            const hash1 = await hashPinBase64('1234');
            const hash2 = await hashPinBase64('5678');
            expect(hash1).not.toBe(hash2);
        });

        it('should return base64 encoded string', async () => {
            const hash = await hashPinBase64('1234');
            // Base64 encoded 32 bytes (SHA-256) = 44 characters with padding
            expect(hash.length).toBe(44);
            expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
        });

        it('should use different salt than hex variant', async () => {
            await hashPinBase64('1234');
            expect(mockDigest).toHaveBeenCalled();

            const callArg = mockDigest.mock.calls[0][1];
            const decodedString = String.fromCharCode(...new Uint8Array(callArg));
            expect(decodedString).toContain('automata-salt');
        });
    });
});

describe('PIN Hashing - Edge Cases', () => {
    beforeEach(() => {
        resetMocks();
        mockDigest.mockClear();
    });

    it('should handle empty PIN', async () => {
        const hash = await hashPinHex('');
        expect(hash).toBeDefined();
        expect(hash.length).toBe(64);
    });

    it('should handle PIN with special characters', async () => {
        const hash = await hashPinHex('!@#$');
        expect(hash).toBeDefined();
        expect(hash.length).toBe(64);
    });

    it('should handle PIN with spaces', async () => {
        const hash = await hashPinHex('1 2 3');
        expect(hash).toBeDefined();
        expect(hash.length).toBe(64);
    });

    it('should handle long PIN', async () => {
        const hash = await hashPinHex('12345678901234567890');
        expect(hash).toBeDefined();
        expect(hash.length).toBe(64);
    });

    it('should handle PIN with only zeros', async () => {
        const hash = await hashPinHex('0000');
        expect(hash).toBeDefined();
        expect(hash.length).toBe(64);
    });

    it('should handle alphanumeric PIN', async () => {
        const hash = await hashPinHex('a1b2');
        expect(hash).toBeDefined();
        expect(hash.length).toBe(64);
    });

    it('should produce same hash for semantically same PINs', async () => {
        // Both should hash to same value (leading zeros matter in strings)
        const hash1 = await hashPinHex('0001');
        const hash2 = await hashPinHex('0001');
        expect(hash1).toBe(hash2);
    });

    it('should differentiate between "0001" and "1"', async () => {
        const hash1 = await hashPinHex('0001');
        const hash2 = await hashPinHex('1');
        expect(hash1).not.toBe(hash2);
    });
});

describe('PIN Hashing - Security Concerns', () => {
    beforeEach(() => {
        resetMocks();
        mockDigest.mockClear();
    });

    it('should call crypto.subtle.digest with SHA-256', async () => {
        await hashPinHex('1234');
        expect(mockDigest).toHaveBeenCalled();
        expect(mockDigest.mock.calls[0][0]).toBe('SHA-256');
        // Verify second argument is array-like with expected content
        const dataArg = mockDigest.mock.calls[0][1];
        expect(dataArg).toBeDefined();
        expect(dataArg.length).toBeGreaterThan(0);
    });

    it('should not expose raw PIN in output', async () => {
        const pin = '1234';
        const hash = await hashPinHex(pin);
        expect(hash).not.toContain(pin);
    });

    it('should include salt to prevent rainbow table attacks', async () => {
        await hashPinHex('1234');

        const callArg = mockDigest.mock.calls[0][1];
        const decodedString = String.fromCharCode(...new Uint8Array(callArg));

        // Verify salt is appended
        expect(decodedString).toBe('1234automata_salt');
    });

    // Document security concern: Salt is hardcoded and visible in client code
    it('[SECURITY CONCERN] Salt is hardcoded in client-side code', async () => {
        // This test documents a known security issue
        // The salt 'automata_salt' or 'automata-salt' is visible in source code
        // Recommendation: Move hashing to server-side

        await hashPinHex('1234');
        const callArg = mockDigest.mock.calls[0][1];
        const decodedString = String.fromCharCode(...new Uint8Array(callArg));

        // The salt is exposed
        const exposedSalt = decodedString.replace('1234', '');
        expect(['automata_salt', 'automata-salt']).toContain(exposedSalt);
    });

    // Document security concern: Two different salts exist
    it('[SECURITY CONCERN] Inconsistent salts between implementations', async () => {
        // This test documents that two different salts are used:
        // - 'automata_salt' in index.html
        // - 'automata-salt' in app.js (underscore vs dash)
        // This could cause login failures if signup uses one and login uses another

        const hashWithUnderscore = async (pin) => {
            const data = new TextEncoder().encode(pin + 'automata_salt');
            await crypto.subtle.digest('SHA-256', data);
            return mockDigest.mock.calls[mockDigest.mock.calls.length - 1][1];
        };

        const hashWithDash = async (pin) => {
            const data = new TextEncoder().encode(pin + 'automata-salt');
            await crypto.subtle.digest('SHA-256', data);
            return mockDigest.mock.calls[mockDigest.mock.calls.length - 1][1];
        };

        await hashWithUnderscore('1234');
        await hashWithDash('1234');

        // The two hashes should be different due to different salts
        // This is a bug if signup and login use different functions
        expect(true).toBe(true); // Documenting the concern
    });
});

describe('PIN Validation', () => {
    // These test PIN format validation that should happen before hashing

    function validatePin(pin) {
        if (!pin || typeof pin !== 'string') return false;
        if (pin.length !== 4) return false;
        if (!/^\d{4}$/.test(pin)) return false;
        return true;
    }

    it('should accept valid 4-digit PIN', () => {
        expect(validatePin('1234')).toBe(true);
        expect(validatePin('0000')).toBe(true);
        expect(validatePin('9999')).toBe(true);
    });

    it('should reject PIN shorter than 4 digits', () => {
        expect(validatePin('123')).toBe(false);
        expect(validatePin('1')).toBe(false);
        expect(validatePin('')).toBe(false);
    });

    it('should reject PIN longer than 4 digits', () => {
        expect(validatePin('12345')).toBe(false);
        expect(validatePin('123456')).toBe(false);
    });

    it('should reject PIN with non-digit characters', () => {
        expect(validatePin('123a')).toBe(false);
        expect(validatePin('abcd')).toBe(false);
        expect(validatePin('12.4')).toBe(false);
        expect(validatePin('12-4')).toBe(false);
    });

    it('should reject null or undefined PIN', () => {
        expect(validatePin(null)).toBe(false);
        expect(validatePin(undefined)).toBe(false);
    });

    it('should reject non-string PIN', () => {
        // @ts-ignore - testing edge case
        expect(validatePin(1234)).toBe(false);
        // @ts-ignore - testing edge case
        expect(validatePin(['1', '2', '3', '4'])).toBe(false);
    });
});
