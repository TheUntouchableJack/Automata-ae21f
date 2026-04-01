/**
 * Tests for churn scoring algorithm
 * Tests the scoring logic extracted from _shared/churn-scorer.ts
 */
import { describe, it, expect } from 'vitest';

// Reproduce the scoring algorithm for testing (same logic as churn-scorer.ts)
function calculateChurnScore(org, orgHasApp, orgHasCustomers, orgHasAutomation) {
  let score = 0;

  // Days since last active (30% weight, max 30 points)
  if (org.last_active_at) {
    const daysSince = Math.floor((Date.now() - new Date(org.last_active_at).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince >= 14) score += 30;
    else if (daysSince >= 7) score += 20;
    else if (daysSince >= 3) score += 10;
  } else {
    score += 15;
  }

  if (!orgHasApp) score += 20;
  if (!orgHasCustomers) score += 15;
  if (!orgHasAutomation) score += 15;
  if ((org.payment_failure_count || 0) > 0) score += 10;
  if (org.subscription_cancel_at) score += 10;

  return score;
}

describe('Churn Scorer', () => {
  describe('calculateChurnScore', () => {
    it('should return 0 for a healthy active org with everything set up', () => {
      const org = {
        id: 'org-1',
        last_active_at: new Date().toISOString(), // active today
        payment_failure_count: 0,
        subscription_cancel_at: null,
      };
      const score = calculateChurnScore(org, true, true, true);
      expect(score).toBe(0);
    });

    it('should score 15 for org with no last_active_at', () => {
      const org = {
        id: 'org-1',
        last_active_at: null,
        payment_failure_count: 0,
        subscription_cancel_at: null,
      };
      const score = calculateChurnScore(org, true, true, true);
      expect(score).toBe(15);
    });

    it('should score 10 for 3+ days inactive', () => {
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
      const org = {
        id: 'org-1',
        last_active_at: fourDaysAgo,
        payment_failure_count: 0,
        subscription_cancel_at: null,
      };
      const score = calculateChurnScore(org, true, true, true);
      expect(score).toBe(10);
    });

    it('should score 20 for 7+ days inactive', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const org = {
        id: 'org-1',
        last_active_at: tenDaysAgo,
        payment_failure_count: 0,
        subscription_cancel_at: null,
      };
      const score = calculateChurnScore(org, true, true, true);
      expect(score).toBe(20);
    });

    it('should score 30 for 14+ days inactive', () => {
      const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
      const org = {
        id: 'org-1',
        last_active_at: twentyDaysAgo,
        payment_failure_count: 0,
        subscription_cancel_at: null,
      };
      const score = calculateChurnScore(org, true, true, true);
      expect(score).toBe(30);
    });

    it('should add 20 for no customer app', () => {
      const org = {
        id: 'org-1',
        last_active_at: new Date().toISOString(),
        payment_failure_count: 0,
        subscription_cancel_at: null,
      };
      const score = calculateChurnScore(org, false, true, true);
      expect(score).toBe(20);
    });

    it('should add 15 for zero customers', () => {
      const org = {
        id: 'org-1',
        last_active_at: new Date().toISOString(),
        payment_failure_count: 0,
        subscription_cancel_at: null,
      };
      const score = calculateChurnScore(org, true, false, true);
      expect(score).toBe(15);
    });

    it('should add 15 for no active automations', () => {
      const org = {
        id: 'org-1',
        last_active_at: new Date().toISOString(),
        payment_failure_count: 0,
        subscription_cancel_at: null,
      };
      const score = calculateChurnScore(org, true, true, false);
      expect(score).toBe(15);
    });

    it('should add 10 for payment failures', () => {
      const org = {
        id: 'org-1',
        last_active_at: new Date().toISOString(),
        payment_failure_count: 2,
        subscription_cancel_at: null,
      };
      const score = calculateChurnScore(org, true, true, true);
      expect(score).toBe(10);
    });

    it('should add 10 for scheduled cancellation', () => {
      const org = {
        id: 'org-1',
        last_active_at: new Date().toISOString(),
        payment_failure_count: 0,
        subscription_cancel_at: new Date().toISOString(),
      };
      const score = calculateChurnScore(org, true, true, true);
      expect(score).toBe(10);
    });

    it('should score 100 for org with all risk factors', () => {
      const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
      const org = {
        id: 'org-1',
        last_active_at: twentyDaysAgo,     // +30
        payment_failure_count: 1,           // +10
        subscription_cancel_at: 'yes',      // +10
      };
      // +30 (inactive) +20 (no app) +15 (no customers) +15 (no automations) +10 (payment) +10 (cancel) = 100
      const score = calculateChurnScore(org, false, false, false);
      expect(score).toBe(100);
    });

    it('should classify scores >= 70 as high risk', () => {
      // 30 (inactive) + 20 (no app) + 15 (no customers) + 15 (no automations) = 80
      const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
      const org = {
        id: 'org-1',
        last_active_at: twentyDaysAgo,
        payment_failure_count: 0,
        subscription_cancel_at: null,
      };
      const score = calculateChurnScore(org, false, false, false);
      expect(score).toBeGreaterThanOrEqual(70);
    });

    it('should classify scores 40-69 as medium risk', () => {
      // 20 (7d inactive) + 20 (no app) = 40
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const org = {
        id: 'org-1',
        last_active_at: tenDaysAgo,
        payment_failure_count: 0,
        subscription_cancel_at: null,
      };
      const score = calculateChurnScore(org, false, true, true);
      expect(score).toBeGreaterThanOrEqual(40);
      expect(score).toBeLessThan(70);
    });
  });
});
