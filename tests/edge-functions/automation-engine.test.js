/**
 * Tests for automation engine condition evaluator
 * Tests the evaluateCondition logic from automation-engine/index.ts
 */
import { describe, it, expect } from 'vitest';

// Reproduce evaluateCondition from automation-engine/index.ts
function evaluateCondition(condition, member, eventData) {
  if (!condition || Object.keys(condition).length === 0) {
    return true; // No condition = always match
  }

  for (const [key, value] of Object.entries(condition)) {
    switch (key) {
      case 'tier':
        if (Array.isArray(value)) {
          if (!value.includes(member.tier)) return false;
        } else if (member.tier !== value) {
          return false;
        }
        break;
      case 'visit_count':
      case 'visit_count_eq':
        if (member.visit_count !== value) return false;
        break;
      case 'visit_count_gte':
        if (member.visit_count < value) return false;
        break;
      case 'visit_count_lte':
        if (member.visit_count > value) return false;
        break;
      case 'streak_days':
        if (member.current_streak < value) return false;
        break;
      case 'points_balance_gte':
        if (member.points_balance < value) return false;
        break;
      case 'days_since_visit': {
        if (!member.last_visit_at) break;
        const lastVisit = new Date(member.last_visit_at);
        const daysSince = Math.floor((Date.now() - lastVisit.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSince < value) return false;
        break;
      }
      case 'days_since_join': {
        const joinDate = new Date(member.joined_at);
        const daysSince = Math.floor((Date.now() - joinDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSince < value) return false;
        break;
      }
      case 'amount_gte':
        if (!eventData?.amount || eventData.amount < value) return false;
        break;
      case 'direction':
        if (eventData?.direction !== value) return false;
        break;
      case 'milestones':
        if (eventData?.milestone && !value.includes(eventData.milestone)) return false;
        break;
      default:
        if (eventData && eventData[key] !== value) return false;
    }
  }

  return true;
}

const baseMember = {
  id: 'member-1',
  email: 'test@example.com',
  first_name: 'Test',
  tier: 'silver',
  points_balance: 250,
  visit_count: 12,
  current_streak: 3,
  last_visit_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
  joined_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
};

describe('Automation Engine — Condition Evaluator', () => {
  describe('Empty conditions', () => {
    it('should return true for null condition', () => {
      expect(evaluateCondition(null, baseMember)).toBe(true);
    });

    it('should return true for empty object condition', () => {
      expect(evaluateCondition({}, baseMember)).toBe(true);
    });
  });

  describe('Tier matching', () => {
    it('should match exact tier', () => {
      expect(evaluateCondition({ tier: 'silver' }, baseMember)).toBe(true);
    });

    it('should reject non-matching tier', () => {
      expect(evaluateCondition({ tier: 'gold' }, baseMember)).toBe(false);
    });

    it('should match tier from array', () => {
      expect(evaluateCondition({ tier: ['silver', 'gold'] }, baseMember)).toBe(true);
    });

    it('should reject tier not in array', () => {
      expect(evaluateCondition({ tier: ['gold', 'platinum'] }, baseMember)).toBe(false);
    });
  });

  describe('Visit count conditions', () => {
    it('should match exact visit count', () => {
      expect(evaluateCondition({ visit_count_eq: 12 }, baseMember)).toBe(true);
    });

    it('should reject non-matching visit count', () => {
      expect(evaluateCondition({ visit_count_eq: 10 }, baseMember)).toBe(false);
    });

    it('should match visit_count_gte when equal', () => {
      expect(evaluateCondition({ visit_count_gte: 12 }, baseMember)).toBe(true);
    });

    it('should match visit_count_gte when greater', () => {
      expect(evaluateCondition({ visit_count_gte: 5 }, baseMember)).toBe(true);
    });

    it('should reject visit_count_gte when less', () => {
      expect(evaluateCondition({ visit_count_gte: 20 }, baseMember)).toBe(false);
    });

    it('should match visit_count_lte when equal', () => {
      expect(evaluateCondition({ visit_count_lte: 12 }, baseMember)).toBe(true);
    });

    it('should reject visit_count_lte when greater', () => {
      expect(evaluateCondition({ visit_count_lte: 5 }, baseMember)).toBe(false);
    });
  });

  describe('Streak conditions', () => {
    it('should match streak at threshold', () => {
      expect(evaluateCondition({ streak_days: 3 }, baseMember)).toBe(true);
    });

    it('should reject streak below threshold', () => {
      expect(evaluateCondition({ streak_days: 5 }, baseMember)).toBe(false);
    });
  });

  describe('Points conditions', () => {
    it('should match points_balance_gte', () => {
      expect(evaluateCondition({ points_balance_gte: 200 }, baseMember)).toBe(true);
    });

    it('should reject points_balance_gte when below', () => {
      expect(evaluateCondition({ points_balance_gte: 500 }, baseMember)).toBe(false);
    });
  });

  describe('Time-based conditions', () => {
    it('should match days_since_visit when enough days passed', () => {
      expect(evaluateCondition({ days_since_visit: 3 }, baseMember)).toBe(true);
    });

    it('should reject days_since_visit when too recent', () => {
      expect(evaluateCondition({ days_since_visit: 10 }, baseMember)).toBe(false);
    });

    it('should pass days_since_visit when no last_visit_at', () => {
      const memberNoVisit = { ...baseMember, last_visit_at: null };
      expect(evaluateCondition({ days_since_visit: 3 }, memberNoVisit)).toBe(true);
    });

    it('should match days_since_join', () => {
      expect(evaluateCondition({ days_since_join: 30 }, baseMember)).toBe(true);
    });

    it('should reject days_since_join when too new', () => {
      expect(evaluateCondition({ days_since_join: 90 }, baseMember)).toBe(false);
    });
  });

  describe('Event-based conditions', () => {
    it('should match amount_gte', () => {
      expect(evaluateCondition({ amount_gte: 50 }, baseMember, { amount: 100 })).toBe(true);
    });

    it('should reject amount_gte when below', () => {
      expect(evaluateCondition({ amount_gte: 200 }, baseMember, { amount: 100 })).toBe(false);
    });

    it('should match direction', () => {
      expect(evaluateCondition({ direction: 'up' }, baseMember, { direction: 'up' })).toBe(true);
    });

    it('should reject wrong direction', () => {
      expect(evaluateCondition({ direction: 'up' }, baseMember, { direction: 'down' })).toBe(false);
    });

    it('should match milestone in list', () => {
      expect(evaluateCondition({ milestones: [500, 1000] }, baseMember, { milestone: 500 })).toBe(true);
    });

    it('should reject milestone not in list', () => {
      expect(evaluateCondition({ milestones: [500, 1000] }, baseMember, { milestone: 250 })).toBe(false);
    });
  });

  describe('Combined conditions', () => {
    it('should require ALL conditions to match (AND logic)', () => {
      expect(evaluateCondition(
        { tier: 'silver', visit_count_gte: 10, points_balance_gte: 200 },
        baseMember
      )).toBe(true);
    });

    it('should fail if any condition fails', () => {
      expect(evaluateCondition(
        { tier: 'gold', visit_count_gte: 10 }, // tier doesn't match
        baseMember
      )).toBe(false);
    });
  });
});
