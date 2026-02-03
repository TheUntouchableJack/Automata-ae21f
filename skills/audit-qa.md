# Skill: QA & Regression Audit

## Overview

Quality assurance audit from a **QA Engineer** and **Regression Tester** perspective. Focuses on finding bugs, edge cases, and ensuring changes don't break existing functionality.

## When to Use

Invoke with `/audit-qa` when:
- After completing a feature
- Before merging to main
- When touching shared utilities
- After refactoring
- When modifying database schema

## Technique: Systematic Edge Case Analysis

Analyze from TWO QA perspectives:

### 1. Functional QA Engineer
- Happy path works correctly
- All form validations trigger
- Error states display properly
- Loading states present
- Success feedback shown

### 2. Regression Tester
- Existing features still work
- Shared code changes don't break consumers
- Database changes don't corrupt data
- API contract unchanged (or versioned)
- No performance regressions

## Audit Checklist

### Input Validation
```
[ ] Empty string handling
[ ] Null/undefined handling
[ ] Max length limits enforced
[ ] Min length limits enforced
[ ] Special characters handled (quotes, <>, etc.)
[ ] Unicode/emoji support or rejection
[ ] Number bounds (negative, zero, MAX_INT)
[ ] Date edge cases (past, future, invalid)
[ ] Email format validation
[ ] Phone format validation
```

### UI States
```
[ ] Loading state while fetching
[ ] Empty state when no data
[ ] Error state with retry option
[ ] Success state with feedback
[ ] Disabled state during submission
[ ] Offline state handling
```

### Browser/Device
```
[ ] Chrome (latest)
[ ] Firefox (latest)
[ ] Safari (latest + iOS)
[ ] Mobile viewport (375px)
[ ] Tablet viewport (768px)
[ ] Desktop viewport (1440px)
```

### Data Integrity
```
[ ] Form submission creates correct record
[ ] Update modifies only intended fields
[ ] Delete removes record (or soft deletes)
[ ] Relationships maintained (foreign keys)
[ ] Cascading deletes work correctly
[ ] Unique constraints enforced
```

### Concurrency
```
[ ] Double-submit prevented
[ ] Optimistic locking or last-write-wins
[ ] Race conditions in point awards
[ ] Simultaneous edits handled
```

### Error Handling
```
[ ] Network timeout handled
[ ] 4xx errors show user message
[ ] 5xx errors show generic message
[ ] Supabase errors caught and handled
[ ] Form errors displayed inline
[ ] Toast/notification for async errors
```

## Execution Format

```markdown
# QA Audit Report

## Summary
- **Test Cases Checked**: X
- **Issues Found**: X
- **Regressions Detected**: X

---

## Functional Issues

### 1. [HIGH] Missing empty state
**Location:** app/customers.js:renderCustomerList()
**Steps to Reproduce:**
1. Go to Customers page with no customers
2. Observe blank content area

**Expected:** "No customers yet" message with CTA
**Actual:** Empty white space
**Fix:** Add empty state check in render function

---

### 2. [MEDIUM] Form submits on Enter in single field
**Location:** app/app-builder.html step 1
**Steps to Reproduce:**
1. Type business name
2. Press Enter

**Expected:** Move to next field or nothing
**Actual:** Form submits prematurely
**Fix:** Add type="button" or prevent default on Enter

---

## Regression Risks

### 1. [HIGH] Shared utility change affects 5 files
**Change:** Modified escapeHtml in utils.js
**Affected Files:**
- customers.js
- automations.js
- dashboard.js
- project.js
- intelligence.js

**Risk:** XSS if function behavior changed
**Recommendation:** Add unit tests for escapeHtml

---

## Edge Cases to Test Manually

| Scenario | Expected | Status |
|----------|----------|--------|
| Customer name with emoji | Displays correctly | ? |
| 10,000 points transaction | No overflow | ? |
| 100+ customers list | Pagination works | ? |
| Delete last customer | Empty state shows | ? |

---

## Passed Checks

- [x] Form validation on signup
- [x] Loading spinner on data fetch
- [x] Error toast on API failure
- [x] Mobile responsive layout
```

## Royalty-Specific Test Cases

### Customer App
```
[ ] Signup with minimum info (just email)
[ ] Signup with full info (all fields)
[ ] Login with correct PIN
[ ] Login with wrong PIN (3x = lockout?)
[ ] Points display updates after award
[ ] Reward redemption flow complete
[ ] Leaderboard shows correct order
[ ] Check-in awards correct points
```

### App Builder
```
[ ] Complete 6-step wizard
[ ] Skip optional steps
[ ] Go back and edit steps
[ ] Preview shows correct branding
[ ] Publish creates working app
[ ] Edit existing app
```

### Dashboard
```
[ ] Metrics calculate correctly
[ ] Charts render with data
[ ] Charts handle zero/empty data
[ ] Date range filter works
[ ] Export functions work
```

### Automations
```
[ ] Create automation
[ ] Edit automation
[ ] Toggle active/inactive
[ ] Delete automation
[ ] Scheduled automations fire
```

## Quick Regression Test Suite

Before any deploy, manually verify:

1. **Auth Flow**: Login → Dashboard loads → Logout works
2. **Customer App**: Can sign up, earn points, redeem reward
3. **App Builder**: Can create new app and access it
4. **Settings**: Can change profile, toggle Advanced Mode
5. **Data**: Previous data still visible and correct

## Common Bugs in This Codebase

Based on patterns observed:

1. **Missing await** - Async Supabase calls without await
2. **Uncaught errors** - Missing try/catch on RPC calls
3. **Stale closure** - Event handlers capturing old values
4. **i18n missing** - New text not in all 8 language files
5. **Cache busting** - JS changes not reflected (increment ?v=)
