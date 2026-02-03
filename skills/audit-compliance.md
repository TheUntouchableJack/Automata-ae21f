# Skill: Compliance Audit (Privacy & Legal)

## Overview

Compliance audit from **Privacy Officer** and **Legal Counsel** perspectives. Focuses on GDPR, CCPA, data handling, terms of service, and regulatory requirements for SaaS products.

## When to Use

Invoke with `/audit-compliance` when:
- Before launch (legal requirements)
- When adding data collection
- When adding third-party integrations
- When handling payments
- When expanding to new regions
- After any data model changes

## Technique: Regulatory Checklist Analysis

Analyze from TWO compliance perspectives:

### 1. Privacy Officer
- Data minimization (collect only what's needed)
- Purpose limitation (use only for stated purpose)
- Storage limitation (don't keep forever)
- User rights (access, delete, export)
- Consent management

### 2. Legal Counsel
- Terms of service accuracy
- Privacy policy completeness
- Liability limitations
- Intellectual property
- Contractual obligations

## GDPR Compliance Checklist

### Lawful Basis for Processing
```
[ ] Identified lawful basis for each data type
[ ] Consent obtained where required
[ ] Consent is freely given, specific, informed
[ ] Consent can be withdrawn easily
[ ] Legitimate interest documented if used
```

### Data Subject Rights
```
[ ] Right to Access: Users can view their data
[ ] Right to Rectification: Users can correct data
[ ] Right to Erasure: Users can delete account
[ ] Right to Portability: Users can export data
[ ] Right to Object: Users can opt-out of processing
[ ] Right to Restrict: Users can limit processing
```

### Data Protection Principles
```
[ ] Purpose Limitation: Data used only for stated purposes
[ ] Data Minimization: Only necessary data collected
[ ] Accuracy: Data kept up-to-date
[ ] Storage Limitation: Retention periods defined
[ ] Integrity: Data protected from unauthorized access
[ ] Accountability: Can demonstrate compliance
```

### Required Documentation
```
[ ] Privacy Policy published and accessible
[ ] Cookie Policy (if using cookies)
[ ] Data Processing Agreement for subprocessors
[ ] Record of Processing Activities
[ ] Data Protection Impact Assessment (if high risk)
```

## CCPA Compliance Checklist

### Consumer Rights
```
[ ] Right to Know: Disclose data collected
[ ] Right to Delete: Honor deletion requests
[ ] Right to Opt-Out: "Do Not Sell" option
[ ] Right to Non-Discrimination: Equal service regardless
```

### Required Notices
```
[ ] Privacy policy updated within 12 months
[ ] Categories of data collected disclosed
[ ] Business purposes disclosed
[ ] Third-party sharing disclosed
[ ] "Do Not Sell My Info" link (if applicable)
```

## Data Handling Audit

### Collection
```
[ ] Only collect necessary data
[ ] Explain why each field is needed
[ ] Optional fields marked as optional
[ ] No sensitive data without explicit need
    - Health information
    - Financial details
    - Biometric data
    - Location tracking
```

### Storage
```
[ ] Data encrypted at rest
[ ] Database has RLS enabled
[ ] Backups encrypted
[ ] Retention periods defined
[ ] Deletion actually removes data (or anonymizes)
```

### Transmission
```
[ ] HTTPS everywhere
[ ] API calls encrypted
[ ] No sensitive data in URLs
[ ] No sensitive data in logs
```

### Third Parties
```
[ ] Subprocessors listed in privacy policy
[ ] DPAs in place with subprocessors
[ ] Data sharing minimized
[ ] No selling of personal data
```

## Execution Format

```markdown
# Compliance Audit Report

## Summary
- **GDPR Status**: Compliant / Needs Work
- **CCPA Status**: Compliant / Needs Work
- **Critical Gaps**: X
- **Documentation Needed**: X

---

## Critical Compliance Gaps

### 1. [CRITICAL] No data deletion mechanism
**Requirement:** GDPR Article 17, CCPA 1798.105
**Current State:** No way for users to delete account
**Risk:** Regulatory fines up to 4% of revenue

**Required Implementation:**
1. Add "Delete Account" in Settings
2. Delete or anonymize all user data
3. Cascade to related records
4. Confirm deletion via email

---

### 2. [HIGH] Privacy policy missing data categories
**Requirement:** CCPA 1798.100
**Current State:** Privacy policy doesn't list data collected
**Fix:** Add section listing:
- Identifiers (name, email, phone)
- Commercial info (purchase history, points)
- Usage data (pages visited, features used)

---

## Data Inventory

| Data Type | Purpose | Lawful Basis | Retention | Deletion |
|-----------|---------|--------------|-----------|----------|
| Email | Account, communication | Contract | Account life | On delete |
| Name | Personalization | Contract | Account life | On delete |
| Phone | Optional contact | Consent | Until withdrawn | On request |
| Points | Core functionality | Contract | Account life | On delete |
| IP Address | Security | Legitimate interest | 90 days | Automatic |

---

## Third-Party Services

| Service | Data Shared | DPA Status | Privacy Policy |
|---------|-------------|------------|----------------|
| Supabase | All data | Yes | Link |
| Claude API | Prompts | Yes | Link |
| Resend | Emails | Needed | Link |

---

## Required Actions

| Priority | Action | Deadline |
|----------|--------|----------|
| P0 | Add account deletion | Before launch |
| P0 | Update privacy policy | Before launch |
| P1 | Add data export | 30 days post-launch |
| P1 | Cookie consent banner | Before launch |
| P2 | Document retention policy | 60 days |

---

## Document Status

| Document | Status | Last Updated | Action |
|----------|--------|--------------|--------|
| Privacy Policy | Needs update | Unknown | Review and update |
| Terms of Service | Exists | Unknown | Review for accuracy |
| Cookie Policy | Missing | - | Create |
| DPA Template | Missing | - | Create for enterprise |
```

## Royalty-Specific Compliance Notes

### Data We Collect

**From Business Owners:**
- Name, email, phone
- Business name, industry
- Billing information (via Stripe)
- Usage data

**From Customers (app_members):**
- Name, email, phone
- Points balance, tier
- Visit history
- Reward redemptions

### Key Compliance Tasks for Launch

1. **Privacy Policy** - Must clearly explain:
   - What data collected from businesses AND their customers
   - That businesses are data controllers for their customers
   - How AI is used (recommendations, analysis)
   - Third-party services (Supabase, Claude)

2. **Account Deletion** - Must delete:
   - `profiles` record
   - `organizations` they own
   - `customer_apps` they created
   - `app_members` of their apps
   - Related transactions, messages, etc.

3. **Data Export** - Must provide:
   - JSON export of all user data
   - Customer list export for businesses
   - Transaction history export

4. **Cookie Consent** - If using:
   - Analytics cookies
   - Marketing cookies
   - Third-party embeds

### Business Owner Responsibility

Royalty processes data on behalf of business owners. Need to clarify:
- Business owner is Data Controller for their customers
- Royalty is Data Processor
- Need DPA template for business owners
- Business owners must have their own privacy policies

## Legal Documents Checklist

```
[ ] Privacy Policy
    [ ] Last updated date
    [ ] Contact information
    [ ] Data collected listed
    [ ] Purpose of collection
    [ ] Third parties listed
    [ ] User rights explained
    [ ] Retention periods
    [ ] Security measures

[ ] Terms of Service
    [ ] Service description
    [ ] User responsibilities
    [ ] Prohibited uses
    [ ] Intellectual property
    [ ] Limitation of liability
    [ ] Termination clause
    [ ] Governing law

[ ] Cookie Policy (if needed)
    [ ] Types of cookies
    [ ] Purpose of each
    [ ] How to manage
    [ ] Third-party cookies

[ ] Data Processing Agreement
    [ ] For enterprise customers
    [ ] Subprocessor list
    [ ] Security measures
    [ ] Breach notification
```
