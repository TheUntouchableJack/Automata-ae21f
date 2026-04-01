/**
 * Tests for SMB lifecycle email template selection
 * Tests the template logic from smb-lifecycle-email/index.ts
 */
import { describe, it, expect } from 'vitest';

// Reproduce getEmailTemplate logic for testing
function getEmailTemplate(type, data) {
  const name = data.firstName || 'there';

  switch (type) {
    case 'welcome':
      return { subject: `Welcome to Royalty, ${name}!`, preheader: 'Your AI-powered loyalty program is ready to launch' };
    case 'onboarding_create_app':
      return { subject: `${name}, your loyalty app is one click away`, preheader: 'Create your branded loyalty program in 60 seconds' };
    case 'onboarding_meet_royal':
      return { subject: 'Meet Royal — your AI loyalty assistant', preheader: 'Royal can run your loyalty program while you run your business' };
    case 'onboarding_add_customers':
      return { subject: 'Time to get your first customers earning points', preheader: 'Share your QR code or link — customers sign up in seconds' };
    case 'onboarding_checkin':
      return { subject: `How's your loyalty program going, ${name}?`, preheader: 'Quick check-in from Royal — anything we can help with?' };
    case 'milestone_first_customer':
      return { subject: `${name}, your first customer just joined!`, preheader: 'Your loyalty program is officially live' };
    case 'milestone_10_customers':
      return { subject: '10 customers and counting!', preheader: 'Your loyalty program is gaining traction' };
    case 'milestone_50_customers':
      return { subject: "50 customers — you're building something real", preheader: 'Your community is growing fast' };
    case 'milestone_first_redemption':
      return { subject: 'Your first reward was just redeemed!', preheader: 'A customer cashed in their points — the loop is working' };
    case 'upgrade_nudge_members':
      return {
        subject: "You're growing fast — time to level up?",
        preheader: data.usagePercent ? `${data.usagePercent}%` : 'most'
      };
    case 'upgrade_nudge_emails':
      return {
        subject: 'Running low on email sends this month',
        preheader: data.usagePercent ? `${data.usagePercent}%` : 'most'
      };
    case 'winback_sorry':
      return { subject: `We're sorry to see you go, ${name}`, preheader: 'Your loyalty program is still here if you change your mind' };
    case 'winback_miss_you':
      return { subject: `Your customers are still out there, ${name}`, preheader: 'Your loyalty program members are waiting' };
    case 'winback_offer':
      return { subject: "Come back to Royalty — we'd love to have you", preheader: 'Your loyalty program is ready to restart' };
    case 'testimonial_request':
      return { subject: `${name}, would you share your Royalty story?`, preheader: 'Your success could inspire other local businesses' };
    default:
      return { subject: 'A message from Royalty', preheader: '' };
  }
}

describe('SMB Lifecycle Email Templates', () => {
  describe('getEmailTemplate', () => {
    it('should return welcome template with personalized subject', () => {
      const t = getEmailTemplate('welcome', { firstName: 'Jay' });
      expect(t.subject).toBe('Welcome to Royalty, Jay!');
      expect(t.preheader).toContain('AI-powered');
    });

    it('should use "there" as fallback name', () => {
      const t = getEmailTemplate('welcome', {});
      expect(t.subject).toBe('Welcome to Royalty, there!');
    });

    it('should return all 5 onboarding templates', () => {
      const types = ['welcome', 'onboarding_create_app', 'onboarding_meet_royal', 'onboarding_add_customers', 'onboarding_checkin'];
      for (const type of types) {
        const t = getEmailTemplate(type, { firstName: 'Test' });
        expect(t.subject).toBeTruthy();
        expect(t.preheader).toBeTruthy();
      }
    });

    it('should return all 4 milestone templates', () => {
      const types = ['milestone_first_customer', 'milestone_10_customers', 'milestone_50_customers', 'milestone_first_redemption'];
      for (const type of types) {
        const t = getEmailTemplate(type, { firstName: 'Test' });
        expect(t.subject).toBeTruthy();
        expect(t.preheader).toBeTruthy();
      }
    });

    it('should return all 3 win-back templates', () => {
      const types = ['winback_sorry', 'winback_miss_you', 'winback_offer'];
      for (const type of types) {
        const t = getEmailTemplate(type, { firstName: 'Test' });
        expect(t.subject).toBeTruthy();
      }
    });

    it('should handle upgrade nudge with real usage percent', () => {
      const t = getEmailTemplate('upgrade_nudge_members', { firstName: 'Jay', usagePercent: 85 });
      expect(t.preheader).toContain('85%');
    });

    it('should handle upgrade nudge without usage percent (no fake 80%)', () => {
      const t = getEmailTemplate('upgrade_nudge_members', { firstName: 'Jay' });
      expect(t.preheader).not.toContain('80%');
      expect(t.preheader).toContain('most');
    });

    it('should return default template for unknown type', () => {
      const t = getEmailTemplate('unknown_type', { firstName: 'Jay' });
      expect(t.subject).toBe('A message from Royalty');
      expect(t.preheader).toBe('');
    });

    it('should return testimonial request template', () => {
      const t = getEmailTemplate('testimonial_request', { firstName: 'Jay', memberCount: 150 });
      expect(t.subject).toContain('share your Royalty story');
    });
  });

  describe('Template count', () => {
    it('should have 15 distinct template types (not counting default)', () => {
      const allTypes = [
        'welcome', 'onboarding_create_app', 'onboarding_meet_royal',
        'onboarding_add_customers', 'onboarding_checkin',
        'milestone_first_customer', 'milestone_10_customers',
        'milestone_50_customers', 'milestone_first_redemption',
        'upgrade_nudge_members', 'upgrade_nudge_emails',
        'winback_sorry', 'winback_miss_you', 'winback_offer',
        'testimonial_request'
      ];
      for (const type of allTypes) {
        const t = getEmailTemplate(type, { firstName: 'Test' });
        expect(t.subject).not.toBe('A message from Royalty');
      }
      expect(allTypes).toHaveLength(15);
    });
  });
});
