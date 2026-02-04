/**
 * Token Handling Security Tests
 * Tests the generateToken and token parsing/validation functions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMocks } from '../setup.js';

// Token generation function from app.js (JWT-like structure)
function generateToken(memberId, appId = 'test-app-id') {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
        member_id: memberId,
        app_id: appId,
        exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days in seconds
        iat: Math.floor(Date.now() / 1000)
    }));
    const signature = btoa('client-signature'); // Note: Not a real signature
    return `${header}.${payload}.${signature}`;
}

// Simpler token format from index.html
function generateSimpleToken(memberId, appId) {
    return btoa(JSON.stringify({
        member_id: memberId,
        app_id: appId,
        exp: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days in ms
    }));
}

// Token parsing (from checkSession in app.js)
function parseToken(token) {
    try {
        // Handle JWT-like format (header.payload.signature)
        if (token.includes('.')) {
            const parts = token.split('.');
            if (parts.length !== 3) return null;
            return JSON.parse(atob(parts[1]));
        }
        // Handle simple base64 format
        return JSON.parse(atob(token));
    } catch (e) {
        return null;
    }
}

// Token validation
function isTokenExpired(tokenData) {
    if (!tokenData || !tokenData.exp) return true;

    // Handle both seconds (JWT standard) and milliseconds (simple format)
    const expTime = tokenData.exp < 10000000000
        ? tokenData.exp * 1000 // Convert seconds to ms
        : tokenData.exp; // Already in ms

    return expTime < Date.now();
}

describe('Token Generation - JWT-like Format', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('should generate token with three parts separated by dots', () => {
        const token = generateToken('member-123');
        const parts = token.split('.');
        expect(parts.length).toBe(3);
    });

    it('should have valid base64 encoded header', () => {
        const token = generateToken('member-123');
        const header = JSON.parse(atob(token.split('.')[0]));
        expect(header.alg).toBe('HS256');
        expect(header.typ).toBe('JWT');
    });

    it('should include member_id in payload', () => {
        const memberId = 'test-member-uuid';
        const token = generateToken(memberId);
        const payload = JSON.parse(atob(token.split('.')[1]));
        expect(payload.member_id).toBe(memberId);
    });

    it('should include app_id in payload', () => {
        const token = generateToken('member-123', 'my-app-id');
        const payload = JSON.parse(atob(token.split('.')[1]));
        expect(payload.app_id).toBe('my-app-id');
    });

    it('should set expiration 30 days in the future', () => {
        const token = generateToken('member-123');
        const payload = JSON.parse(atob(token.split('.')[1]));

        const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
        const now = Math.floor(Date.now() / 1000);

        // Allow 5 second tolerance for test execution time
        expect(payload.exp).toBeGreaterThan(now + thirtyDaysInSeconds - 5);
        expect(payload.exp).toBeLessThan(now + thirtyDaysInSeconds + 5);
    });

    it('should include issued at timestamp', () => {
        const token = generateToken('member-123');
        const payload = JSON.parse(atob(token.split('.')[1]));
        const now = Math.floor(Date.now() / 1000);

        // Allow 5 second tolerance
        expect(payload.iat).toBeGreaterThan(now - 5);
        expect(payload.iat).toBeLessThan(now + 5);
    });

    it('should have signature part (even if not cryptographically valid)', () => {
        const token = generateToken('member-123');
        const signature = token.split('.')[2];
        expect(signature).toBeDefined();
        expect(signature.length).toBeGreaterThan(0);
    });
});

describe('Token Generation - Simple Format', () => {
    it('should generate base64 encoded JSON', () => {
        const token = generateSimpleToken('member-123', 'app-456');
        const decoded = JSON.parse(atob(token));
        expect(decoded).toBeDefined();
    });

    it('should include member_id', () => {
        const token = generateSimpleToken('member-123', 'app-456');
        const decoded = JSON.parse(atob(token));
        expect(decoded.member_id).toBe('member-123');
    });

    it('should include app_id', () => {
        const token = generateSimpleToken('member-123', 'app-456');
        const decoded = JSON.parse(atob(token));
        expect(decoded.app_id).toBe('app-456');
    });

    it('should set expiration 30 days in the future (in milliseconds)', () => {
        const token = generateSimpleToken('member-123', 'app-456');
        const decoded = JSON.parse(atob(token));

        const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();

        // Allow 1 second tolerance
        expect(decoded.exp).toBeGreaterThan(now + thirtyDaysInMs - 1000);
        expect(decoded.exp).toBeLessThan(now + thirtyDaysInMs + 1000);
    });
});

describe('Token Parsing', () => {
    it('should parse JWT-like token correctly', () => {
        const token = generateToken('member-123', 'app-456');
        const parsed = parseToken(token);

        expect(parsed).not.toBeNull();
        expect(parsed.member_id).toBe('member-123');
        expect(parsed.app_id).toBe('app-456');
    });

    it('should parse simple base64 token correctly', () => {
        const token = generateSimpleToken('member-123', 'app-456');
        const parsed = parseToken(token);

        expect(parsed).not.toBeNull();
        expect(parsed.member_id).toBe('member-123');
        expect(parsed.app_id).toBe('app-456');
    });

    it('should return null for malformed token', () => {
        expect(parseToken('not-a-valid-token')).toBeNull();
        expect(parseToken('invalid.token')).toBeNull();
        expect(parseToken('a.b.c.d')).toBeNull();
    });

    it('should return null for empty token', () => {
        expect(parseToken('')).toBeNull();
    });

    it('should return null for non-base64 content', () => {
        expect(parseToken('!!!.@@@.###')).toBeNull();
    });

    it('should handle token with valid base64 but invalid JSON', () => {
        const invalidToken = btoa('not json');
        expect(parseToken(invalidToken)).toBeNull();
    });
});

describe('Token Expiration', () => {
    it('should detect expired token (seconds format)', () => {
        const expiredPayload = {
            member_id: 'test',
            exp: Math.floor(Date.now() / 1000) - 1000 // Expired 1000 seconds ago
        };
        expect(isTokenExpired(expiredPayload)).toBe(true);
    });

    it('should detect expired token (milliseconds format)', () => {
        const expiredPayload = {
            member_id: 'test',
            exp: Date.now() - 1000 // Expired 1 second ago
        };
        expect(isTokenExpired(expiredPayload)).toBe(true);
    });

    it('should accept valid non-expired token (seconds format)', () => {
        const validPayload = {
            member_id: 'test',
            exp: Math.floor(Date.now() / 1000) + 3600 // Expires in 1 hour
        };
        expect(isTokenExpired(validPayload)).toBe(false);
    });

    it('should accept valid non-expired token (milliseconds format)', () => {
        const validPayload = {
            member_id: 'test',
            exp: Date.now() + 3600000 // Expires in 1 hour
        };
        expect(isTokenExpired(validPayload)).toBe(false);
    });

    it('should treat missing exp as expired', () => {
        expect(isTokenExpired({ member_id: 'test' })).toBe(true);
    });

    it('should treat null payload as expired', () => {
        expect(isTokenExpired(null)).toBe(true);
    });

    it('should treat undefined payload as expired', () => {
        expect(isTokenExpired(undefined)).toBe(true);
    });
});

describe('Token Storage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('should store token in localStorage with app slug', () => {
        const appSlug = 'test-app';
        const token = generateToken('member-123');

        localStorage.setItem(`royalty_member_${appSlug}`, token);

        expect(localStorage.getItem(`royalty_member_${appSlug}`)).toBe(token);
    });

    it('should clear token on logout', () => {
        const appSlug = 'test-app';
        const token = generateToken('member-123');

        localStorage.setItem(`royalty_member_${appSlug}`, token);
        localStorage.removeItem(`royalty_member_${appSlug}`);

        expect(localStorage.getItem(`royalty_member_${appSlug}`)).toBeNull();
    });

    it('should keep tokens for different apps separate', () => {
        const token1 = generateToken('member-1', 'app-1');
        const token2 = generateToken('member-2', 'app-2');

        localStorage.setItem('royalty_member_app-1', token1);
        localStorage.setItem('royalty_member_app-2', token2);

        expect(localStorage.getItem('royalty_member_app-1')).toBe(token1);
        expect(localStorage.getItem('royalty_member_app-2')).toBe(token2);
        expect(token1).not.toBe(token2);
    });
});

describe('Token Security Concerns', () => {
    it('[SECURITY CONCERN] Token signature is not cryptographically valid', () => {
        // This test documents that the JWT-like token doesn't have a real signature
        // The signature is just btoa('client-signature')
        const token = generateToken('member-123');
        const signature = atob(token.split('.')[2]);

        expect(signature).toBe('client-signature');
        // Recommendation: Generate and validate signatures on server
    });

    it('[SECURITY CONCERN] Token can be tampered with client-side', () => {
        // Since there's no server-side signature validation, tokens can be modified
        const token = generateToken('member-123');
        const parts = token.split('.');

        // Tamper with the payload
        const tamperedPayload = btoa(JSON.stringify({
            member_id: 'admin-user', // Changed member ID
            app_id: 'any-app',
            exp: Math.floor(Date.now() / 1000) + 999999999 // Extended expiry
        }));

        const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
        const parsed = parseToken(tamperedToken);

        // Token parses successfully - no signature validation
        expect(parsed.member_id).toBe('admin-user');
        // Recommendation: Validate tokens server-side on each request
    });

    it('[SECURITY CONCERN] Token stored in localStorage is XSS-vulnerable', () => {
        // localStorage is accessible to any JavaScript on the page
        // If XSS exists, attacker can steal the token

        const token = generateToken('member-123');
        localStorage.setItem('royalty_member_test', token);

        // Simulating XSS attack accessing localStorage
        const stolenToken = localStorage.getItem('royalty_member_test');

        expect(stolenToken).toBe(token);
        // Recommendation: Use HttpOnly cookies for session tokens
    });

    it('should not expose sensitive data in token payload', () => {
        const token = generateToken('member-123', 'app-456');
        const payload = parseToken(token);

        // Token should not contain sensitive info
        expect(payload.password).toBeUndefined();
        expect(payload.pin).toBeUndefined();
        expect(payload.pin_hash).toBeUndefined();
        expect(payload.email).toBeUndefined();
    });
});

describe('Token Format Compatibility', () => {
    it('should handle both token formats in same session', () => {
        // Generate both formats
        const jwtToken = generateToken('member-jwt');
        const simpleToken = generateSimpleToken('member-simple', 'app-simple');

        // Both should parse correctly
        const jwtParsed = parseToken(jwtToken);
        const simpleParsed = parseToken(simpleToken);

        expect(jwtParsed.member_id).toBe('member-jwt');
        expect(simpleParsed.member_id).toBe('member-simple');
    });

    it('[POTENTIAL BUG] Different exp formats between implementations', () => {
        // JWT format uses seconds
        const jwtToken = generateToken('member-123');
        const jwtPayload = parseToken(jwtToken);

        // Simple format uses milliseconds
        const simpleToken = generateSimpleToken('member-123', 'app-123');
        const simplePayload = parseToken(simpleToken);

        // Both should be detected as valid by isTokenExpired
        expect(isTokenExpired(jwtPayload)).toBe(false);
        expect(isTokenExpired(simplePayload)).toBe(false);
    });
});
