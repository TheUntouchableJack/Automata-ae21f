/**
 * Tests for sequence processing logic
 * Tests the step advancement, delay enforcement, and skip conditions
 * from royalty-self-growth/processOnboardingSequences
 */
import { describe, it, expect } from 'vitest';

// Reproduce skip condition logic from royalty-self-growth
function checkSkipCondition(condition, orgMetrics) {
  switch (condition) {
    case 'has_customer_app':
      return orgMetrics.appCount > 0;
    case 'has_used_ai':
      return orgMetrics.aiPromptCount > 0;
    case 'has_customers':
      return orgMetrics.memberCount > 0;
    case 'has_ten_members':
      return orgMetrics.memberCount >= 10;
    case 'has_resubscribed':
      return orgMetrics.subscriptionStatus === 'active';
    default:
      return false;
  }
}

// Reproduce delay check logic
function isStepReady(state, step) {
  const startedAt = new Date(state.started_at);
  const hoursElapsed = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60);
  return hoursElapsed >= step.delay_hours;
}

// Reproduce rate limit check
function isRateLimited(state) {
  if (!state.last_sent_at) return false;
  const lastSent = new Date(state.last_sent_at);
  const hoursSinceLast = (Date.now() - lastSent.getTime()) / (1000 * 60 * 60);
  return hoursSinceLast < 20; // 20h buffer
}

// Find next step
function getNextStep(steps, currentStep) {
  return steps.find(s => s.step === currentStep + 1) || null;
}

describe('Sequence Processor', () => {
  const onboardingSteps = [
    { step: 1, template_key: 'welcome', delay_hours: 0, skip_condition: null },
    { step: 2, template_key: 'onboarding_create_app', delay_hours: 24, skip_condition: 'has_customer_app' },
    { step: 3, template_key: 'onboarding_meet_royal', delay_hours: 72, skip_condition: 'has_used_ai' },
    { step: 4, template_key: 'onboarding_add_customers', delay_hours: 168, skip_condition: 'has_customers' },
    { step: 5, template_key: 'onboarding_checkin', delay_hours: 336, skip_condition: 'has_ten_members' },
  ];

  describe('getNextStep', () => {
    it('should return step 2 when current is 1', () => {
      const next = getNextStep(onboardingSteps, 1);
      expect(next.step).toBe(2);
      expect(next.template_key).toBe('onboarding_create_app');
    });

    it('should return null when current is last step', () => {
      const next = getNextStep(onboardingSteps, 5);
      expect(next).toBeNull();
    });

    it('should return step 1 when current is 0 (just enrolled)', () => {
      const next = getNextStep(onboardingSteps, 0);
      expect(next.step).toBe(1);
    });
  });

  describe('isStepReady (delay enforcement)', () => {
    it('should be ready immediately for step with 0 delay', () => {
      const state = { started_at: new Date().toISOString(), last_sent_at: null };
      const step = { delay_hours: 0 };
      expect(isStepReady(state, step)).toBe(true);
    });

    it('should not be ready when delay has not passed', () => {
      const state = { started_at: new Date().toISOString(), last_sent_at: null }; // started now
      const step = { delay_hours: 24 }; // needs 24h
      expect(isStepReady(state, step)).toBe(false);
    });

    it('should be ready when delay has passed', () => {
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const state = { started_at: twoDaysAgo, last_sent_at: null };
      const step = { delay_hours: 24 };
      expect(isStepReady(state, step)).toBe(true);
    });

    it('should enforce 168h (7 day) delay for step 4', () => {
      const sixDaysAgo = new Date(Date.now() - 144 * 60 * 60 * 1000).toISOString();
      const state = { started_at: sixDaysAgo, last_sent_at: null };
      const step = { delay_hours: 168 };
      expect(isStepReady(state, step)).toBe(false); // 144h < 168h
    });

    it('should enforce 336h (14 day) delay for step 5', () => {
      const fifteenDaysAgo = new Date(Date.now() - 360 * 60 * 60 * 1000).toISOString();
      const state = { started_at: fifteenDaysAgo, last_sent_at: null };
      const step = { delay_hours: 336 };
      expect(isStepReady(state, step)).toBe(true); // 360h > 336h
    });
  });

  describe('isRateLimited', () => {
    it('should not be rate limited if never sent', () => {
      expect(isRateLimited({ last_sent_at: null })).toBe(false);
    });

    it('should be rate limited if sent 5 hours ago', () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      expect(isRateLimited({ last_sent_at: fiveHoursAgo })).toBe(true);
    });

    it('should not be rate limited if sent 21 hours ago', () => {
      const twentyOneHoursAgo = new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString();
      expect(isRateLimited({ last_sent_at: twentyOneHoursAgo })).toBe(false);
    });

    it('should be rate limited if sent 19 hours ago (under 20h buffer)', () => {
      const nineteenHoursAgo = new Date(Date.now() - 19 * 60 * 60 * 1000).toISOString();
      expect(isRateLimited({ last_sent_at: nineteenHoursAgo })).toBe(true);
    });
  });

  describe('checkSkipCondition', () => {
    it('should skip has_customer_app when org has apps', () => {
      expect(checkSkipCondition('has_customer_app', { appCount: 1 })).toBe(true);
    });

    it('should not skip has_customer_app when org has no apps', () => {
      expect(checkSkipCondition('has_customer_app', { appCount: 0 })).toBe(false);
    });

    it('should skip has_used_ai when org has AI prompts', () => {
      expect(checkSkipCondition('has_used_ai', { aiPromptCount: 5 })).toBe(true);
    });

    it('should not skip has_used_ai when no AI prompts', () => {
      expect(checkSkipCondition('has_used_ai', { aiPromptCount: 0 })).toBe(false);
    });

    it('should skip has_customers when org has members', () => {
      expect(checkSkipCondition('has_customers', { memberCount: 3 })).toBe(true);
    });

    it('should not skip has_customers when no members', () => {
      expect(checkSkipCondition('has_customers', { memberCount: 0 })).toBe(false);
    });

    it('should skip has_ten_members at 10+', () => {
      expect(checkSkipCondition('has_ten_members', { memberCount: 10 })).toBe(true);
    });

    it('should not skip has_ten_members at 9', () => {
      expect(checkSkipCondition('has_ten_members', { memberCount: 9 })).toBe(false);
    });

    it('should skip has_resubscribed when subscription active', () => {
      expect(checkSkipCondition('has_resubscribed', { subscriptionStatus: 'active' })).toBe(true);
    });

    it('should not skip has_resubscribed when canceled', () => {
      expect(checkSkipCondition('has_resubscribed', { subscriptionStatus: 'canceled' })).toBe(false);
    });

    it('should return false for unknown condition', () => {
      expect(checkSkipCondition('unknown_condition', {})).toBe(false);
    });
  });

  describe('Win-back sequence', () => {
    const winBackSteps = [
      { step: 1, template_key: 'winback_sorry', delay_hours: 24, skip_condition: 'has_resubscribed' },
      { step: 2, template_key: 'winback_miss_you', delay_hours: 168, skip_condition: 'has_resubscribed' },
      { step: 3, template_key: 'winback_offer', delay_hours: 720, skip_condition: 'has_resubscribed' },
    ];

    it('should stop win-back if customer resubscribes', () => {
      const next = getNextStep(winBackSteps, 1);
      const shouldSkip = checkSkipCondition(next.skip_condition, { subscriptionStatus: 'active' });
      expect(shouldSkip).toBe(true);
    });

    it('should continue win-back if still canceled', () => {
      const next = getNextStep(winBackSteps, 1);
      const shouldSkip = checkSkipCondition(next.skip_condition, { subscriptionStatus: 'canceled' });
      expect(shouldSkip).toBe(false);
    });

    it('should complete after step 3', () => {
      const next = getNextStep(winBackSteps, 3);
      expect(next).toBeNull();
    });
  });
});
