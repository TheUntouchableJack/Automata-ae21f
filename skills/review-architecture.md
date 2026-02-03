# Skill: Architecture Review

## Overview

Comprehensive architecture review using **Role Stacking** (multi-perspective analysis) followed by **Verification Loop** (self-critique the review).

## When to Use

Invoke with `/review-architecture` when:
- Planning a major new feature
- Refactoring existing systems
- Debugging performance issues
- Evaluating technical debt
- Before scaling decisions

## Technique: Role Stacking + Verification Loop

### Phase 1: Multi-Perspective Analysis

Analyze from FOUR expert perspectives simultaneously:

#### 1. Performance Engineer
- Database query efficiency (N+1 problems, missing indexes)
- Frontend bundle size and load times
- API response times and bottlenecks
- Caching opportunities
- Memory usage patterns

#### 2. UX/Frontend Architect
- Component structure and reusability
- State management patterns
- Accessibility compliance
- Mobile responsiveness
- User flow efficiency

#### 3. Backend/DevOps Engineer
- Database schema design
- API structure and versioning
- Error handling patterns
- Logging and monitoring
- Deployment and scaling

#### 4. Security Architect
- Authentication/authorization patterns
- Data flow and exposure points
- Third-party integration risks
- Compliance requirements

### Phase 2: Verification Loop

After the initial analysis, self-critique:

1. **What did I miss?** - Review blind spots
2. **What's the strongest counter-argument?** - Devil's advocate
3. **What assumptions am I making?** - Validate them
4. **Revised recommendations** - Update based on critique

## Execution Format

```markdown
# Architecture Review: [Feature/System Name]

## Phase 1: Multi-Perspective Analysis

### Performance Engineer View
**Current State:**
- Query count per page load: X
- Estimated load time: Xms
- Bundle size: X KB

**Issues Found:**
1. [HIGH] N+1 query in customers.js:245
2. [MEDIUM] Missing index on automations.project_id

**Recommendations:**
- Add composite index
- Implement pagination

---

### UX/Frontend Architect View
**Current State:**
- Component count: X
- Shared utilities: X

**Issues Found:**
1. [MEDIUM] Duplicate modal logic across 5 files

**Recommendations:**
- Extract shared modal component

---

### Backend/DevOps Engineer View
**Current State:**
- Tables: X, RPC functions: X
- RLS coverage: X%

**Issues Found:**
1. [LOW] Inconsistent error response format

**Recommendations:**
- Standardize error responses

---

### Security Architect View
**Current State:**
- Auth method: Supabase Auth
- RLS: Enabled

**Issues Found:**
1. [CRITICAL] Public RPC function missing org_id check

**Recommendations:**
- Add organization validation

---

## Phase 2: Verification Loop (Self-Critique)

### What Did I Miss?
- Didn't check mobile performance
- Didn't review offline handling

### Counter-Arguments to My Recommendations
- "Add caching" - But data changes frequently, cache invalidation complex
- Resolution: Use short TTL (5 min) for frequently changing data

### Assumptions I Made
1. Assumed user base stays < 10K (verified: current plan)
2. Assumed single-region deployment (need to confirm)

### Revised Recommendations
1. [CRITICAL] Add org_id check to RPC - unchanged
2. [HIGH] Add index - unchanged
3. [MEDIUM] Caching - revised to short TTL approach
4. [NEW] Add mobile performance testing

---

## Prioritized Action Items

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| P0 | Fix RPC security | 30min | Critical |
| P1 | Add database index | 10min | High |
| P2 | Extract modal component | 2hr | Medium |
| P3 | Standardize errors | 1hr | Low |

## Technical Debt Identified
- [ ] Duplicate modal code (5 files)
- [ ] Inconsistent error handling
- [ ] Missing mobile tests
```

## Areas to Always Review

### Database
- `/database/schema.sql` - Schema design
- `/database/*-migration.sql` - Recent changes
- Index coverage for foreign keys
- RLS policy completeness

### Frontend
- `/app/*.js` - Page scripts
- `/app/*.css` - Style consistency
- Component duplication
- Bundle size impact

### API Layer
- RPC functions in migrations
- Error handling patterns
- Rate limiting coverage

### Integration Points
- `/customer-app/` - Public-facing surfaces
- Third-party dependencies
- External API calls

## Quick Health Checks

```bash
# Check for console.log in production code
grep -r "console.log" app/*.js --include="*.js"

# Check for TODO/FIXME comments
grep -rn "TODO\|FIXME" app/

# Check bundle sizes
ls -la app/*.js | awk '{print $5, $9}' | sort -n

# Check for hardcoded URLs
grep -rn "localhost\|127.0.0.1" app/
```
