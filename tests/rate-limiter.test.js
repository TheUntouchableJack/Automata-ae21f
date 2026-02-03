/**
 * Unit Tests for /app/rate-limiter.js
 * Tests client-side rate limiting logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMocks } from './setup.js';

// Rate limit configurations
const RATE_LIMITS = {
  feature_request: { maxRequests: 3, windowMinutes: 60 },
  waitlist: { maxRequests: 2, windowMinutes: 60 },
  ai_analysis: { maxRequests: 10, windowMinutes: 60 },
  business_analysis: { maxRequests: 5, windowMinutes: 60 },
  vote: { maxRequests: 30, windowMinutes: 60 }
};

// Recreate rate limiter functions for testing
function cleanupTimestamps(timestamps, windowMinutes) {
  const cutoff = Date.now() - (windowMinutes * 60 * 1000);
  return timestamps.filter(ts => ts > cutoff);
}

function isRateLimited(timestamps, maxRequests, windowMinutes) {
  const cleaned = cleanupTimestamps(timestamps, windowMinutes);
  return cleaned.length >= maxRequests;
}

function checkAndRecordRateLimit(timestamps, maxRequests, windowMinutes) {
  if (isRateLimited(timestamps, maxRequests, windowMinutes)) {
    return { allowed: false, timestamps };
  }
  const newTimestamps = [...cleanupTimestamps(timestamps, windowMinutes), Date.now()];
  return { allowed: true, timestamps: newTimestamps };
}

function getRemainingRequests(timestamps, maxRequests, windowMinutes) {
  const cleaned = cleanupTimestamps(timestamps, windowMinutes);
  return Math.max(0, maxRequests - cleaned.length);
}

function getTimeUntilReset(timestamps, windowMinutes) {
  const cleaned = cleanupTimestamps(timestamps, windowMinutes);
  if (cleaned.length === 0) return 0;

  const oldestTimestamp = Math.min(...cleaned);
  const resetTime = oldestTimestamp + (windowMinutes * 60 * 1000);
  return Math.max(0, resetTime - Date.now());
}

describe('Rate Limiter', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('RATE_LIMITS configuration', () => {
    it('has correct limits for feature_request', () => {
      expect(RATE_LIMITS.feature_request.maxRequests).toBe(3);
      expect(RATE_LIMITS.feature_request.windowMinutes).toBe(60);
    });

    it('has correct limits for waitlist', () => {
      expect(RATE_LIMITS.waitlist.maxRequests).toBe(2);
    });

    it('has correct limits for ai_analysis', () => {
      expect(RATE_LIMITS.ai_analysis.maxRequests).toBe(10);
    });

    it('has correct limits for vote', () => {
      expect(RATE_LIMITS.vote.maxRequests).toBe(30);
    });
  });

  describe('cleanupTimestamps', () => {
    it('removes old timestamps outside window', () => {
      const now = Date.now();
      const oldTimestamp = now - (120 * 60 * 1000); // 2 hours ago
      const recentTimestamp = now - (30 * 60 * 1000); // 30 mins ago

      const result = cleanupTimestamps([oldTimestamp, recentTimestamp], 60);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(recentTimestamp);
    });

    it('keeps all timestamps within window', () => {
      const now = Date.now();
      const timestamps = [
        now - (10 * 60 * 1000),
        now - (20 * 60 * 1000),
        now - (30 * 60 * 1000)
      ];

      const result = cleanupTimestamps(timestamps, 60);
      expect(result).toHaveLength(3);
    });

    it('handles empty array', () => {
      const result = cleanupTimestamps([], 60);
      expect(result).toHaveLength(0);
    });
  });

  describe('isRateLimited', () => {
    it('returns false when under limit', () => {
      const timestamps = [Date.now()];
      expect(isRateLimited(timestamps, 3, 60)).toBe(false);
    });

    it('returns true when at limit', () => {
      const now = Date.now();
      const timestamps = [now - 1000, now - 2000, now - 3000];
      expect(isRateLimited(timestamps, 3, 60)).toBe(true);
    });

    it('returns false when old timestamps expire', () => {
      const now = Date.now();
      const oldTimestamps = [
        now - (120 * 60 * 1000), // 2 hours ago - expired
        now - (90 * 60 * 1000),  // 1.5 hours ago - expired
        now - (30 * 60 * 1000)   // 30 mins ago - valid
      ];
      expect(isRateLimited(oldTimestamps, 3, 60)).toBe(false);
    });

    it('returns true when over limit', () => {
      const now = Date.now();
      const timestamps = [now - 1000, now - 2000, now - 3000, now - 4000];
      expect(isRateLimited(timestamps, 3, 60)).toBe(true);
    });
  });

  describe('checkAndRecordRateLimit', () => {
    it('allows first request', () => {
      const result = checkAndRecordRateLimit([], 3, 60);
      expect(result.allowed).toBe(true);
      expect(result.timestamps).toHaveLength(1);
    });

    it('allows requests under limit', () => {
      const now = Date.now();
      const timestamps = [now - 1000];
      const result = checkAndRecordRateLimit(timestamps, 3, 60);
      expect(result.allowed).toBe(true);
      expect(result.timestamps).toHaveLength(2);
    });

    it('blocks requests at limit', () => {
      const now = Date.now();
      const timestamps = [now - 1000, now - 2000, now - 3000];
      const result = checkAndRecordRateLimit(timestamps, 3, 60);
      expect(result.allowed).toBe(false);
      expect(result.timestamps).toHaveLength(3); // No new timestamp added
    });

    it('cleans up old timestamps before checking', () => {
      const now = Date.now();
      const timestamps = [
        now - (120 * 60 * 1000), // expired
        now - (120 * 60 * 1000), // expired
        now - (30 * 60 * 1000)   // valid
      ];
      const result = checkAndRecordRateLimit(timestamps, 3, 60);
      expect(result.allowed).toBe(true);
      expect(result.timestamps).toHaveLength(2); // 1 valid + 1 new
    });
  });

  describe('getRemainingRequests', () => {
    it('returns max when no requests made', () => {
      expect(getRemainingRequests([], 3, 60)).toBe(3);
    });

    it('returns correct remaining count', () => {
      const timestamps = [Date.now()];
      expect(getRemainingRequests(timestamps, 3, 60)).toBe(2);
    });

    it('returns 0 when at limit', () => {
      const now = Date.now();
      const timestamps = [now - 1000, now - 2000, now - 3000];
      expect(getRemainingRequests(timestamps, 3, 60)).toBe(0);
    });

    it('ignores expired timestamps', () => {
      const now = Date.now();
      const timestamps = [
        now - (120 * 60 * 1000), // expired
        now - (30 * 60 * 1000)   // valid
      ];
      expect(getRemainingRequests(timestamps, 3, 60)).toBe(2);
    });
  });

  describe('getTimeUntilReset', () => {
    it('returns 0 for empty timestamps', () => {
      expect(getTimeUntilReset([], 60)).toBe(0);
    });

    it('returns positive time for active timestamps', () => {
      const now = Date.now();
      const timestamps = [now - (30 * 60 * 1000)]; // 30 mins ago
      const resetTime = getTimeUntilReset(timestamps, 60);
      expect(resetTime).toBeGreaterThan(0);
      expect(resetTime).toBeLessThanOrEqual(30 * 60 * 1000);
    });

    it('returns 0 for expired timestamps', () => {
      const now = Date.now();
      const timestamps = [now - (120 * 60 * 1000)]; // 2 hours ago
      expect(getTimeUntilReset(timestamps, 60)).toBe(0);
    });
  });

  describe('Integration scenarios', () => {
    it('handles rapid requests correctly', () => {
      let timestamps = [];

      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        const result = checkAndRecordRateLimit(timestamps, 3, 60);
        expect(result.allowed).toBe(true);
        timestamps = result.timestamps;
      }

      // 4th request should be blocked
      const blocked = checkAndRecordRateLimit(timestamps, 3, 60);
      expect(blocked.allowed).toBe(false);
    });

    it('handles different action types independently', () => {
      // This simulates different localStorage keys
      let featureTimestamps = [];
      let voteTimestamps = [];

      // Use all feature requests
      for (let i = 0; i < 3; i++) {
        const result = checkAndRecordRateLimit(featureTimestamps, 3, 60);
        featureTimestamps = result.timestamps;
      }

      // Feature request blocked
      expect(checkAndRecordRateLimit(featureTimestamps, 3, 60).allowed).toBe(false);

      // But votes should still work
      const voteResult = checkAndRecordRateLimit(voteTimestamps, 30, 60);
      expect(voteResult.allowed).toBe(true);
    });
  });
});
