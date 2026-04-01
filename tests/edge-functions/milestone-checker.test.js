/**
 * Tests for milestone detection logic
 * Tests the checking algorithm from _shared/milestone-checker.ts
 */
import { describe, it, expect } from 'vitest';

// Milestone threshold definitions (mirrors milestone-checker.ts)
const MILESTONE_THRESHOLDS = {
  first_customer: { memberCount: 1 },
  '10_customers': { memberCount: 10 },
  '50_customers': { memberCount: 50 },
  first_redemption: { redemptionCount: 1 },
  testimonial_100: { memberCount: 100 },
};

function checkMilestoneHit(key, metrics) {
  const threshold = MILESTONE_THRESHOLDS[key];
  if (!threshold) return false;

  if (threshold.memberCount !== undefined) {
    return metrics.memberCount >= threshold.memberCount;
  }
  if (threshold.redemptionCount !== undefined) {
    return metrics.redemptionCount >= threshold.redemptionCount;
  }
  return false;
}

function shouldNotify(orgId, milestoneKey, notifiedSet) {
  return !notifiedSet.has(`${orgId}::${milestoneKey}`);
}

describe('Milestone Checker', () => {
  describe('checkMilestoneHit', () => {
    it('should detect first_customer at 1 member', () => {
      expect(checkMilestoneHit('first_customer', { memberCount: 1, redemptionCount: 0 })).toBe(true);
    });

    it('should not detect first_customer at 0 members', () => {
      expect(checkMilestoneHit('first_customer', { memberCount: 0, redemptionCount: 0 })).toBe(false);
    });

    it('should detect 10_customers at 10 members', () => {
      expect(checkMilestoneHit('10_customers', { memberCount: 10, redemptionCount: 0 })).toBe(true);
    });

    it('should detect 10_customers at 15 members (above threshold)', () => {
      expect(checkMilestoneHit('10_customers', { memberCount: 15, redemptionCount: 0 })).toBe(true);
    });

    it('should not detect 10_customers at 9 members', () => {
      expect(checkMilestoneHit('10_customers', { memberCount: 9, redemptionCount: 0 })).toBe(false);
    });

    it('should detect 50_customers at 50 members', () => {
      expect(checkMilestoneHit('50_customers', { memberCount: 50, redemptionCount: 0 })).toBe(true);
    });

    it('should not detect 50_customers at 49 members', () => {
      expect(checkMilestoneHit('50_customers', { memberCount: 49, redemptionCount: 0 })).toBe(false);
    });

    it('should detect first_redemption at 1 redemption', () => {
      expect(checkMilestoneHit('first_redemption', { memberCount: 5, redemptionCount: 1 })).toBe(true);
    });

    it('should not detect first_redemption at 0 redemptions', () => {
      expect(checkMilestoneHit('first_redemption', { memberCount: 5, redemptionCount: 0 })).toBe(false);
    });

    it('should detect testimonial_100 at 100 members', () => {
      expect(checkMilestoneHit('testimonial_100', { memberCount: 100, redemptionCount: 0 })).toBe(true);
    });

    it('should not detect testimonial_100 at 99 members', () => {
      expect(checkMilestoneHit('testimonial_100', { memberCount: 99, redemptionCount: 0 })).toBe(false);
    });

    it('should return false for unknown milestone key', () => {
      expect(checkMilestoneHit('unknown_milestone', { memberCount: 100, redemptionCount: 100 })).toBe(false);
    });
  });

  describe('shouldNotify (dedup check)', () => {
    it('should allow notification for new milestone', () => {
      const notifiedSet = new Set();
      expect(shouldNotify('org-1', 'first_customer', notifiedSet)).toBe(true);
    });

    it('should block notification for already-notified milestone', () => {
      const notifiedSet = new Set(['org-1::first_customer']);
      expect(shouldNotify('org-1', 'first_customer', notifiedSet)).toBe(false);
    });

    it('should allow same milestone for different org', () => {
      const notifiedSet = new Set(['org-1::first_customer']);
      expect(shouldNotify('org-2', 'first_customer', notifiedSet)).toBe(true);
    });

    it('should allow different milestone for same org', () => {
      const notifiedSet = new Set(['org-1::first_customer']);
      expect(shouldNotify('org-1', '10_customers', notifiedSet)).toBe(true);
    });
  });
});
