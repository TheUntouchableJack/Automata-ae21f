# Skill: Audit

## Overview

Context-aware multi-perspective audit system. Runs before starting a feature (understand the landscape) and after completing it (validate quality). Analyzes from 10 expert perspectives to catch issues early.

## Usage

```
/audit              # Smart audit - detects changed files and audits them
/audit full         # Comprehensive audit of entire codebase (pre-launch)
/audit [area]       # Target specific area: auth, customers, customer-app, dashboard, etc.
/audit quick        # Fast audit - security + code + QA only
```

## When to Use

- **Before starting a feature**: Run `/audit [area]` to understand existing state
- **After completing a feature**: Run `/audit` to validate your changes
- **Weekly ritual**: Run `/audit full` every Monday
- **Pre-launch**: Run `/audit full` before deployment

## The 10 Perspectives

| Perspective | Focus Areas |
|-------------|-------------|
| **Security** | Auth, RLS, injection, rate limiting, secrets |
| **Architecture** | Performance, database, scaling, caching |
| **QA** | Test coverage, edge cases, data validation, regressions |
| **Design** | UX flows, UI consistency, accessibility, mobile |
| **Code** | Quality, DRY, patterns, maintainability, tech debt |
| **Compliance** | GDPR, CCPA, privacy policy, terms, data handling |
| **Business** | Unit economics, pricing, GTM, competitive position |
| **AI** | Prompt safety, cost optimization, hallucination risks |
| **CX** | Support burden, FAQ coverage, error messages, onboarding |
| **Visual** | Responsive layouts, i18n rendering, UI states, screenshots |

## Execution Process

### Step 1: Context Detection

```bash
# Check for uncommitted changes
git status --porcelain

# Get recently modified files
git diff --name-only HEAD~5

# Identify feature area from file paths
```

**Area Detection Rules:**
- Files in `customer-app/` → Customer-facing app
- Files in `app/auth.js`, `app/login.html` → Authentication
- Files in `database/` → Database/schema changes
- Files with `customer` in name → Customer management
- Files with `automation` in name → Automation system
- Files in `app/dashboard.*` → Dashboard/reporting

### Step 2: Run Relevant Audits

Based on detected area, weight perspectives:

| Area | Primary Perspectives | Secondary |
|------|---------------------|-----------|
| `customer-app` | Security, Design, CX, Visual | QA, Compliance |
| `auth` | Security, Code, Compliance | QA, Visual |
| `database` | Security, Architecture, Code | QA |
| `dashboard` | Design, Architecture, QA, Visual | Code |
| `automation` | Code, QA, Architecture | AI |
| `payments/billing` | Security, Compliance, Business | QA, Code |
| `ai/intelligence` | AI, Security, CX | Code |
| `i18n` | Visual, Code | QA |
| `css/styles` | Visual, Design | QA |
| `full` | ALL perspectives equally | - |

### Step 3: Generate Report

## Output Format

```markdown
# Audit Report
**Area:** [Detected or specified area]
**Files Analyzed:** [count]
**Generated:** [timestamp]

---

## Executive Summary

### Launch Readiness: X/10

### Critical Issues: X
### High Priority: X
### Medium Priority: X
### Passed Checks: X

---

## Critical Issues (Fix Immediately)

### 1. [SECURITY] Issue title
**File:** path/to/file.js:123
**Risk:** What could go wrong
**Fix:** How to fix it
```
// Code example if helpful
```

---

## High Priority (Fix Before Merge)

### 2. [QA] Issue title
...

---

## Medium Priority (Fix This Sprint)

### 3. [DESIGN] Issue title
...

---

## Passed Checks

- [SECURITY] RLS enabled on all tables
- [CODE] No console.log statements
- [COMPLIANCE] Privacy policy link present
...

---

## Perspective Details

<details>
<summary>Security Audit (X issues)</summary>

[Detailed security findings...]

</details>

<details>
<summary>Design Audit (X issues)</summary>

[Detailed design findings...]

</details>

...

---

## Recommended Actions

| Priority | Issue | Effort | File |
|----------|-------|--------|------|
| P0 | Fix RLS policy | 10min | schema.sql |
| P1 | Add input validation | 30min | customers.js |
| P2 | Improve error message | 5min | auth.js |

```

## Quick Reference: What Each Perspective Checks

### Security (via /security-audit)
- [ ] RLS on all tables
- [ ] Rate limiting on public endpoints
- [ ] Input sanitization (escapeHtml)
- [ ] No secrets in client code
- [ ] Auth flows secure

### Architecture (via /review-architecture)
- [ ] N+1 query problems
- [ ] Missing indexes
- [ ] Caching opportunities
- [ ] Bundle size reasonable
- [ ] Error handling consistent

### QA (via /audit-qa)
- [ ] Edge cases handled (empty, null, max length)
- [ ] Error states have UI
- [ ] Loading states present
- [ ] Form validation complete
- [ ] Browser compatibility

### Design (via /audit-design)
- [ ] Mobile responsive
- [ ] Accessibility (labels, contrast, keyboard)
- [ ] Consistent spacing/typography
- [ ] User flow logical
- [ ] Error messages helpful

### Code (via /audit-code)
- [ ] No duplicate code
- [ ] Functions < 50 lines
- [ ] Clear naming
- [ ] No TODO/FIXME in critical paths
- [ ] i18n keys for all strings

### Compliance (via /audit-compliance)
- [ ] GDPR: consent, deletion, export
- [ ] Privacy policy accurate
- [ ] Cookie consent if needed
- [ ] Data retention defined
- [ ] Terms of service current

### Business (via /audit-business)
- [ ] Pricing makes sense
- [ ] Value proposition clear
- [ ] Competitive differentiation
- [ ] Unit economics viable
- [ ] GTM strategy defined

### AI (via /audit-ai)
- [ ] Prompts have safety guardrails
- [ ] Cost per operation reasonable
- [ ] Fallbacks for AI failures
- [ ] No prompt injection risks
- [ ] Output validation

### CX (via /audit-cx)
- [ ] Error messages actionable
- [ ] Help/FAQ coverage
- [ ] Onboarding flow smooth
- [ ] Support escalation path clear
- [ ] Common questions answered

### Visual (via /audit-visual)
- [ ] Pages load without JS errors
- [ ] Responsive at 375px, 768px, 1024px, 1440px
- [ ] No horizontal scroll on mobile
- [ ] i18n translations render (no missing keys)
- [ ] RTL correct for Arabic
- [ ] Empty/loading/error states present
- [ ] Critical user flows complete successfully
- [ ] Screenshots captured for documentation

## Integration with Workflow

### Before Feature Work
```
You: "I'm going to add customer import"
Claude: Let me audit the customers area first.
[Runs /audit customers]
[Shows existing issues to be aware of]
```

### After Feature Work
```
You: "Done with customer import"
Claude: Let me audit your changes.
[Runs /audit - detects changed files]
[Shows any new issues introduced]
```

### Weekly Monday Ritual
```
You: "/audit full"
[Comprehensive report of entire codebase]
[Prioritized fix list for the week]
```

## Files Always Included

Regardless of detected area, always check:
- `app/auth.js` - Authentication
- `database/schema.sql` - Core schema
- `customer-app/` - Public attack surface
- Any file with `password`, `token`, `secret`, `key` in content
