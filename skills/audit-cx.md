# Skill: Customer Experience Audit

## Overview

Customer experience audit from **Customer Success Manager** and **Support Operations** perspectives. Focuses on user journey, support burden, error messages, onboarding, documentation, and self-service capabilities.

## When to Use

Invoke with `/audit-cx` when:
- Before launch (support readiness)
- After adding new features
- When support tickets increase
- When users report confusion
- Planning self-service improvements
- Optimizing onboarding

## Technique: Customer Journey Analysis

Analyze from TWO CX perspectives:

### 1. Customer Success Manager
- User journey friction points
- Onboarding completion rate
- Feature adoption
- Churn signals
- Delight moments

### 2. Support Operations
- Common support requests
- Self-service coverage
- Response time needs
- Escalation paths
- Documentation gaps

## Audit Checklist

### Onboarding
```
[ ] Clear first action after signup
[ ] Progress indicator for multi-step setup
[ ] Skip options for optional steps
[ ] Success celebration at completion
[ ] Quick win within first 5 minutes
[ ] Help available without leaving flow
```

### Error Messages
```
[ ] Explains what went wrong
[ ] Suggests how to fix it
[ ] Uses plain language (no tech jargon)
[ ] Provides support contact for stuck users
[ ] Doesn't blame the user
[ ] Actionable (button/link to resolution)
```

### Self-Service
```
[ ] FAQ covers top 10 questions
[ ] Search finds relevant help
[ ] Contextual help in-app
[ ] Video tutorials for complex features
[ ] Status page for outages
```

### Documentation
```
[ ] Getting started guide
[ ] Feature documentation
[ ] Troubleshooting guide
[ ] API documentation (if applicable)
[ ] Up-to-date with current UI
```

### Support Readiness
```
[ ] Support contact easily findable
[ ] Ticket system functional
[ ] Response time expectations set
[ ] Escalation path defined
[ ] Canned responses prepared
```

### Feedback Loops
```
[ ] Way to report bugs
[ ] Feature request submission
[ ] Satisfaction surveys
[ ] NPS measurement
[ ] User interviews scheduled
```

## Execution Format

```markdown
# Customer Experience Audit

## Summary
- **Onboarding Score**: X/10
- **Self-Service Coverage**: X%
- **Support Readiness**: X/10
- **Error Message Quality**: X/10

---

## User Journey Analysis

### Critical Path: First Loyalty App

1. **Signup** → Low friction ✓
2. **Email Verification** → Potential drop-off point
3. **Dashboard** → Unclear next step ⚠️
4. **App Builder** → 6 steps, good progress indicator ✓
5. **Publish** → Success! But then what? ⚠️
6. **First Customer** → No guidance provided ✗

### Friction Points

| Step | Issue | Impact | Fix |
|------|-------|--------|-----|
| Post-signup | No clear CTA | High drop-off | Add "Create Your First App" button |
| Post-publish | No next steps | Confusion | Add "Share with customers" guide |
| First visit | Empty dashboard | Discouraging | Add sample data or tutorial |

---

## Error Message Review

### 1. [POOR] Generic error
**Location:** app/auth.js login failure
**Current:** "An error occurred"
**Better:** "That email/password combination didn't work. Double-check your credentials or [reset your password]."

---

### 2. [POOR] Technical jargon
**Location:** app/customers.js import failure
**Current:** "CSV parse error at row 15"
**Better:** "Row 15 has a problem. Make sure each row has name, email, and phone separated by commas."

---

### 3. [GOOD] Actionable error
**Location:** app/app-builder.js validation
**Current:** "Please enter a business name to continue"
**Assessment:** Clear, specific, tells user what to do ✓

---

## Self-Service Gaps

### FAQ Coverage
| Question | Covered | Location |
|----------|---------|----------|
| How do customers earn points? | ✗ | Need to add |
| How do I change my app colors? | ✗ | Need to add |
| Can I import existing customers? | ✓ | Help docs |
| How do I see my analytics? | ✗ | Need to add |
| What happens when customers redeem? | ✗ | Need to add |

### Missing Help Content
1. Video: "Creating your first loyalty app"
2. Guide: "Getting your first 10 customers"
3. FAQ: "Understanding your dashboard"
4. Troubleshooting: "Customer can't login"

---

## Support Burden Prediction

### Expected High-Volume Questions

| Question | Current Answer | Recommendation |
|----------|----------------|----------------|
| "How do I share my app?" | None | Add share modal post-publish |
| "Where's my QR code?" | Hidden | Make QR prominent |
| "Customer forgot PIN" | RPC exists | Add owner-facing reset |
| "How do tiers work?" | Implicit | Add tier explanation page |

### Proactive Measures
1. **Tooltip tour** on first dashboard visit
2. **Email sequence** with tips after signup
3. **In-app announcements** for new features
4. **Contextual help** icons next to complex features

---

## Onboarding Flow Audit

### Current Flow
```
Signup → Verify Email → Dashboard → ???
```

### Recommended Flow
```
Signup → Verify Email → Welcome Modal →
Create First App (guided) → Publish →
Share Guide → Success Email
```

### Onboarding Checklist UI
```
[ ] Create your first loyalty app
[ ] Customize your branding
[ ] Add your first reward
[ ] Share with a customer
[ ] Award first points
```

---

## Recommended Actions

| Priority | Action | Impact | Effort |
|----------|--------|--------|--------|
| P0 | Add post-signup CTA | High | Low |
| P0 | Write top 10 FAQs | High | Medium |
| P1 | Improve error messages (5 critical) | Medium | Low |
| P1 | Add onboarding checklist | High | Medium |
| P2 | Create video tutorial | Medium | High |
| P2 | Build tooltip tour | Medium | Medium |
```

## Royalty-Specific CX Context

### User Types & Journeys

**Business Owner Journey:**
1. Hears about Royalty (AppSumo, referral)
2. Signs up (60 seconds!)
3. Creates loyalty app
4. Shares with customers
5. Monitors dashboard
6. Responds to AI recommendations

**Customer Journey:**
1. Sees loyalty program at business
2. Signs up via phone
3. Earns points from visits
4. Checks leaderboard/rewards
5. Redeems reward
6. Refers friends

### Critical CX Moments

**Make or Break:**
- First 5 minutes after signup
- First app publish
- First customer signup
- First AI recommendation

**Delight Opportunities:**
- Instant app preview
- Confetti on first customer
- Milestone celebrations (10, 100, 1000 customers)
- Smart recommendations that work

### Support Channels

**Current:**
- Roadmap for feature requests
- Feature request form
- (No dedicated support yet)

**Recommended for Launch:**
- AI support in customer app
- Email support for owners
- FAQ/Help center
- Status page

### Error Message Templates

**Authentication:**
```javascript
const authErrors = {
  'invalid_credentials': 'That email/password combination didn\'t work. [Reset password]',
  'email_not_confirmed': 'Please check your email and click the confirmation link.',
  'rate_limited': 'Too many attempts. Please wait a few minutes and try again.',
};
```

**Form Validation:**
```javascript
const validationErrors = {
  'required': 'This field is required',
  'email_invalid': 'Please enter a valid email address',
  'too_short': 'Must be at least {min} characters',
  'too_long': 'Must be no more than {max} characters',
};
```

**API Errors:**
```javascript
const apiErrors = {
  'network_error': 'Connection problem. Check your internet and try again.',
  'server_error': 'Something went wrong on our end. We\'ve been notified.',
  'not_found': 'That item no longer exists. It may have been deleted.',
  'permission_denied': 'You don\'t have permission to do that.',
};
```

## Pre-Launch CX Checklist

```
Onboarding:
[ ] Clear CTA after signup
[ ] Onboarding checklist visible
[ ] Empty states guide to action
[ ] First success within 5 minutes

Self-Service:
[ ] Top 10 FAQs written
[ ] Help links in-app
[ ] Troubleshooting guide
[ ] Getting started guide

Support:
[ ] Support email monitored
[ ] Canned responses ready
[ ] Escalation path defined
[ ] Response time SLA set

Feedback:
[ ] Feature request system live
[ ] Bug report method clear
[ ] NPS survey scheduled (30 days)
[ ] User interview list started
```

## Support Metrics to Track

- **Time to First Value**: Minutes from signup to first app created
- **Onboarding Completion**: % who finish setup checklist
- **Support Ticket Rate**: Tickets per 100 users
- **First Response Time**: Hours to first support reply
- **Resolution Time**: Hours to ticket resolution
- **Self-Service Rate**: % issues resolved without human
- **NPS Score**: Net Promoter Score
- **CSAT**: Customer Satisfaction rating
