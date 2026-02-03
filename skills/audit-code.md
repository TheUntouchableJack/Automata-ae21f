# Skill: Code Review Audit

## Overview

Code quality audit from a **Senior Code Reviewer** perspective. Focuses on maintainability, readability, patterns, technical debt, and best practices.

## When to Use

Invoke with `/audit-code` when:
- After completing a feature
- Before merging significant changes
- When onboarding to unfamiliar code
- During refactoring planning
- When code feels "messy"

## Technique: Systematic Code Analysis

Analyze code quality across dimensions:

### 1. Readability
- Can a new developer understand this?
- Are names self-documenting?
- Is complexity hidden appropriately?

### 2. Maintainability
- Can this be safely modified?
- Are changes localized?
- Is the code DRY?

### 3. Reliability
- Will this break unexpectedly?
- Are edge cases handled?
- Is error handling robust?

### 4. Performance
- Any obvious inefficiencies?
- N+1 queries?
- Unnecessary re-renders/recomputes?

## Audit Checklist

### Naming & Clarity
```
[ ] Variables describe what they hold
[ ] Functions describe what they do
[ ] Boolean names are questions (isActive, hasPermission)
[ ] No abbreviations except common ones (id, url, api)
[ ] No magic numbers (use named constants)
[ ] No single-letter variables (except i in loops)
```

### Function Design
```
[ ] Functions do one thing
[ ] Functions < 50 lines (ideally < 20)
[ ] Max 3-4 parameters
[ ] No side effects in getters
[ ] Return early for edge cases
[ ] Consistent return types
```

### Code Structure
```
[ ] Related code grouped together
[ ] Imports organized (external, internal, relative)
[ ] No deeply nested conditionals (> 3 levels)
[ ] Guard clauses over nested if/else
[ ] Consistent file organization
```

### DRY (Don't Repeat Yourself)
```
[ ] No copy-pasted code blocks
[ ] Shared utilities extracted
[ ] Configuration not hardcoded
[ ] Constants defined once
[ ] Common patterns abstracted
```

### Error Handling
```
[ ] All async operations have try/catch
[ ] Errors logged with context
[ ] User-friendly error messages
[ ] Errors don't expose internals
[ ] Fallback behavior defined
```

### Comments & Documentation
```
[ ] Complex logic has explanatory comments
[ ] No commented-out code
[ ] No TODO/FIXME in production paths
[ ] Function purpose clear (from name or JSDoc)
[ ] Non-obvious decisions documented
```

### Security (Basic)
```
[ ] User input sanitized (escapeHtml)
[ ] No eval() or innerHTML with user data
[ ] No secrets in code
[ ] Proper auth checks
```

### Performance (Basic)
```
[ ] No unnecessary loops
[ ] No N+1 queries (batch fetches)
[ ] Event listeners cleaned up
[ ] Large lists paginated or virtualized
[ ] Images optimized
```

## Execution Format

```markdown
# Code Review Audit

## Summary
- **Files Reviewed**: X
- **Issues Found**: X
- **Technical Debt Items**: X
- **Code Health Score**: X/10

---

## Critical Issues

### 1. [CRITICAL] SQL injection vulnerability
**File:** app/customers.js:156
**Code:**
```javascript
// BAD: String interpolation in query
const { data } = await supabase
  .from('customers')
  .select('*')
  .filter('name', 'eq', userInput) // This is actually safe in Supabase
```
**Note:** False alarm - Supabase parameterizes this. But document the pattern.

---

## Code Quality Issues

### 1. [HIGH] Function too long (87 lines)
**File:** app/app-builder.js:renderStep()
**Problem:** Hard to understand and modify
**Suggestion:** Break into renderStepHeader, renderStepContent, renderStepFooter

---

### 2. [MEDIUM] Duplicate code
**Files:**
- app/customers.js:showModal() (lines 45-67)
- app/automations.js:showModal() (lines 89-111)
- app/projects.js:showModal() (lines 34-56)

**Pattern:** Same modal open/close logic repeated
**Suggestion:** Extract to AppUtils.modal.show(config)

---

### 3. [MEDIUM] Magic numbers
**File:** app/dashboard.js:142
```javascript
// BAD
if (points > 1000) { ... }
if (tier === 3) { ... }

// GOOD
const GOLD_TIER_THRESHOLD = 1000;
const MAX_TIER = 3;
if (points > GOLD_TIER_THRESHOLD) { ... }
```

---

### 4. [LOW] Inconsistent naming
**Files:** Various
```javascript
// Mixed conventions
const customerList = [];     // camelCase
const customer_data = {};    // snake_case
const CustomerName = '';     // PascalCase (should be class)
```
**Suggestion:** Standardize on camelCase for variables

---

## Technical Debt Inventory

| Item | Location | Effort | Impact | Priority |
|------|----------|--------|--------|----------|
| Extract modal utility | 3 files | 2hr | High | P1 |
| Break up renderStep | app-builder.js | 1hr | Medium | P2 |
| Add constants file | New file | 30min | Medium | P2 |
| Fix naming conventions | Throughout | 1hr | Low | P3 |

---

## Positive Patterns Observed

- [x] Consistent use of async/await
- [x] Good error handling in auth.js
- [x] escapeHtml used for user content
- [x] Supabase queries properly structured
- [x] i18n system well implemented

---

## Recommendations

### Quick Wins (< 30 min each)
1. Add CONSTANTS object for magic numbers
2. Remove commented-out code in dashboard.js
3. Add JSDoc to complex functions

### Medium Effort (1-2 hours)
1. Extract modal utility
2. Standardize error handling pattern
3. Add loading state utility

### Larger Refactors (When time permits)
1. Break up large files (app-builder.js)
2. Create component library for common UI
3. Add TypeScript for critical paths
```

## Royalty-Specific Code Patterns

### Approved Patterns

**Supabase Queries:**
```javascript
// GOOD: Use RPC for complex operations
const { data, error } = await supabase.rpc('award_points', {
  p_member_id: memberId,
  p_points: 100
});

// GOOD: Handle errors
if (error) {
  console.error('Failed to award points:', error);
  showToast('error', t('errors.points_failed'));
  return;
}
```

**Event Handling:**
```javascript
// GOOD: Event delegation
document.addEventListener('click', (e) => {
  if (e.target.matches('.delete-btn')) {
    handleDelete(e.target.dataset.id);
  }
});
```

**i18n:**
```javascript
// GOOD: All user-facing text through i18n
showToast('success', t('customers.created'));

// BAD: Hardcoded strings
showToast('success', 'Customer created!');
```

### Files to Watch

High-complexity files needing extra review:
- `app/app-builder.js` - Complex wizard logic
- `app/intelligence.js` - AI integration
- `app/customers.js` - Data manipulation
- `customer-app/app.js` - Public-facing

### Common Issues in This Codebase

1. **Missing await** - Async calls without await
2. **Stale closures** - Event handlers with old values
3. **i18n gaps** - New strings not in all languages
4. **Cache busting** - Forgetting to increment ?v=
5. **Console.log** - Debug statements left in

## Quick Code Health Check

```bash
# Find TODO/FIXME comments
grep -rn "TODO\|FIXME" app/

# Find console.log statements
grep -rn "console.log" app/*.js

# Find long functions (rough estimate)
awk '/^function|^const.*=.*=>|^async function/{n=NR} NR-n>50{print FILENAME":"n}' app/*.js

# Find duplicate code patterns
# (manual review recommended)
```
