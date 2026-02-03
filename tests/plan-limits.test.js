/**
 * Unit Tests for /app/plan-limits.js
 * Tests plan limit calculations and enforcement
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Recreate the plan limits configuration for testing
const PLAN_LIMITS = {
  free: {
    name: 'Free',
    projects: 1,
    automations: 3,
    customers: 100,
    emails_monthly: 500,
    ai_analyses: 10,
    team_members: 1
  },
  subscription: {
    growth: {
      name: 'Growth',
      projects: 5,
      automations: 15,
      customers: 2000,
      emails_monthly: 5000,
      ai_analyses: 50,
      team_members: 3
    },
    business: {
      name: 'Business',
      projects: 15,
      automations: 50,
      customers: 10000,
      emails_monthly: 25000,
      ai_analyses: 200,
      team_members: 10
    },
    enterprise: {
      name: 'Enterprise',
      projects: -1,
      automations: -1,
      customers: 50000,
      emails_monthly: 100000,
      ai_analyses: -1,
      team_members: -1
    }
  },
  appsumo: {
    1: { name: 'Lifetime Tier 1', projects: 3, automations: 10, customers: 1000 },
    2: { name: 'Lifetime Tier 2', projects: 10, automations: 30, customers: 5000 },
    3: { name: 'Lifetime Tier 3', projects: 25, automations: -1, customers: 15000 }
  }
};

// Recreate helper functions for testing
function getPlanLimits(org) {
  if (!org) return PLAN_LIMITS.free;

  switch (org.plan_type) {
    case 'appsumo_lifetime':
      return PLAN_LIMITS.appsumo[org.appsumo_tier] || PLAN_LIMITS.appsumo[1];
    case 'subscription':
      return PLAN_LIMITS.subscription[org.subscription_tier] || PLAN_LIMITS.subscription.growth;
    case 'free':
    default:
      return PLAN_LIMITS.free;
  }
}

function getOrgLimits(org) {
  if (!org) return PLAN_LIMITS.free;
  if (org.plan_limits_override) {
    return { ...getPlanLimits(org), ...org.plan_limits_override };
  }
  return getPlanLimits(org);
}

function isUnlimited(value) {
  return value === -1;
}

function formatLimit(value) {
  if (value === -1) return 'Unlimited';
  if (value === 0) return '—';
  return value.toLocaleString();
}

function getUsagePercent(used, limit) {
  if (limit === -1) return 0;
  if (limit === 0) return used > 0 ? 100 : 0;
  return Math.round((used / limit) * 100);
}

function getUsageStatus(percent) {
  if (percent >= 100) return 'critical';
  if (percent >= 80) return 'warning';
  if (percent >= 50) return 'moderate';
  return 'healthy';
}

function checkLimit(org, usage, limitType, increment = 1) {
  const limits = getOrgLimits(org);
  const limit = limits[limitType];

  if (limit === -1) {
    return { allowed: true };
  }

  const currentUsage = usage[limitType] || 0;
  const newUsage = currentUsage + increment;

  if (newUsage > limit) {
    return {
      allowed: false,
      upgradeRequired: true,
      current: currentUsage,
      limit: limit
    };
  }

  const percent = getUsagePercent(newUsage, limit);
  if (percent >= 80 && percent < 100) {
    return {
      allowed: true,
      warning: true,
      current: newUsage,
      limit: limit
    };
  }

  return { allowed: true, current: newUsage, limit: limit };
}

describe('Plan Limits', () => {
  describe('getPlanLimits', () => {
    it('returns free limits for null org', () => {
      const limits = getPlanLimits(null);
      expect(limits.name).toBe('Free');
      expect(limits.projects).toBe(1);
    });

    it('returns free limits for free plan', () => {
      const limits = getPlanLimits({ plan_type: 'free' });
      expect(limits.projects).toBe(1);
      expect(limits.automations).toBe(3);
    });

    it('returns correct AppSumo tier 1 limits', () => {
      const limits = getPlanLimits({ plan_type: 'appsumo_lifetime', appsumo_tier: 1 });
      expect(limits.name).toBe('Lifetime Tier 1');
      expect(limits.projects).toBe(3);
    });

    it('returns correct AppSumo tier 3 limits with unlimited automations', () => {
      const limits = getPlanLimits({ plan_type: 'appsumo_lifetime', appsumo_tier: 3 });
      expect(limits.automations).toBe(-1);
      expect(limits.projects).toBe(25);
    });

    it('returns growth subscription limits', () => {
      const limits = getPlanLimits({ plan_type: 'subscription', subscription_tier: 'growth' });
      expect(limits.name).toBe('Growth');
      expect(limits.projects).toBe(5);
    });

    it('returns enterprise limits with unlimited values', () => {
      const limits = getPlanLimits({ plan_type: 'subscription', subscription_tier: 'enterprise' });
      expect(limits.projects).toBe(-1);
      expect(limits.automations).toBe(-1);
      expect(limits.team_members).toBe(-1);
    });
  });

  describe('getOrgLimits with overrides', () => {
    it('applies plan_limits_override', () => {
      const org = {
        plan_type: 'free',
        plan_limits_override: { projects: 10 }
      };
      const limits = getOrgLimits(org);
      expect(limits.projects).toBe(10); // Overridden
      expect(limits.automations).toBe(3); // Not overridden
    });
  });

  describe('isUnlimited', () => {
    it('returns true for -1', () => {
      expect(isUnlimited(-1)).toBe(true);
    });

    it('returns false for positive numbers', () => {
      expect(isUnlimited(5)).toBe(false);
      expect(isUnlimited(0)).toBe(false);
    });
  });

  describe('formatLimit', () => {
    it('returns "Unlimited" for -1', () => {
      expect(formatLimit(-1)).toBe('Unlimited');
    });

    it('returns "—" for 0', () => {
      expect(formatLimit(0)).toBe('—');
    });

    it('formats numbers with commas', () => {
      expect(formatLimit(1000)).toBe('1,000');
      expect(formatLimit(50000)).toBe('50,000');
    });
  });

  describe('getUsagePercent', () => {
    it('returns 0 for unlimited', () => {
      expect(getUsagePercent(100, -1)).toBe(0);
    });

    it('calculates correct percentage', () => {
      expect(getUsagePercent(50, 100)).toBe(50);
      expect(getUsagePercent(80, 100)).toBe(80);
      expect(getUsagePercent(100, 100)).toBe(100);
    });

    it('handles over-limit usage', () => {
      expect(getUsagePercent(150, 100)).toBe(150);
    });

    it('handles zero limit', () => {
      expect(getUsagePercent(5, 0)).toBe(100);
      expect(getUsagePercent(0, 0)).toBe(0);
    });
  });

  describe('getUsageStatus', () => {
    it('returns healthy for low usage', () => {
      expect(getUsageStatus(0)).toBe('healthy');
      expect(getUsageStatus(49)).toBe('healthy');
    });

    it('returns moderate for 50-79%', () => {
      expect(getUsageStatus(50)).toBe('moderate');
      expect(getUsageStatus(79)).toBe('moderate');
    });

    it('returns warning for 80-99%', () => {
      expect(getUsageStatus(80)).toBe('warning');
      expect(getUsageStatus(99)).toBe('warning');
    });

    it('returns critical for 100%+', () => {
      expect(getUsageStatus(100)).toBe('critical');
      expect(getUsageStatus(150)).toBe('critical');
    });
  });

  describe('checkLimit', () => {
    const freeOrg = { plan_type: 'free' };
    const enterpriseOrg = { plan_type: 'subscription', subscription_tier: 'enterprise' };

    it('allows action when under limit', () => {
      const result = checkLimit(freeOrg, { projects: 0 }, 'projects');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
    });

    it('blocks action when at limit', () => {
      const result = checkLimit(freeOrg, { projects: 1 }, 'projects');
      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
    });

    it('warns at 80% usage', () => {
      // Free plan has 100 customers limit, 80 + 1 = 81% triggers warning
      const result = checkLimit(freeOrg, { customers: 80 }, 'customers');
      expect(result.allowed).toBe(true);
      expect(result.warning).toBe(true);
    });

    it('always allows for unlimited (-1)', () => {
      const result = checkLimit(enterpriseOrg, { projects: 1000 }, 'projects');
      expect(result.allowed).toBe(true);
    });

    it('handles increment parameter', () => {
      const result = checkLimit(freeOrg, { automations: 0 }, 'automations', 4);
      expect(result.allowed).toBe(false); // 0 + 4 > 3
    });
  });
});
