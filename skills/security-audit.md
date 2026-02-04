# Skill: Security Audit

## Overview

Comprehensive security audit using **Role Stacking** - analyzing from multiple expert perspectives simultaneously to catch blind spots and create internal debate.

## When to Use

Invoke with `/security-audit` when:
- Before launching a new feature
- After writing authentication/authorization code
- When handling payments, points, or sensitive data
- Periodic codebase security review
- Before going to production

## Technique: Role Stacking

Analyze from THREE expert perspectives simultaneously:

### 1. Security Engineer (Defensive)
- Authentication & authorization flows
- Data validation & sanitization
- Secrets management
- Session handling

### 2. Penetration Tester (Offensive)
- How would I exploit this?
- Race conditions & timing attacks
- Injection vectors (SQL, XSS, command)
- Privilege escalation paths

### 3. Compliance Officer (Regulatory)
- Data privacy (GDPR, CCPA)
- Audit logging requirements
- Data retention policies
- User consent handling

## Audit Checklist

### Critical (Must Fix Before Launch)

#### Race Conditions
```
[ ] Payments use atomic transactions (BEGIN/COMMIT)
[ ] Points awards use RPC functions, not client-side updates
[ ] Inventory/quantity checks are atomic with updates
```

#### Rate Limiting
```
[ ] All public endpoints have rate limits
[ ] Start strict (100 req/min) and adjust up
[ ] Rate limiter returns proper 429 responses
```

#### Row Level Security (RLS)
```
[ ] ALL tables have RLS enabled
[ ] Policies tested for each role (anon, authenticated, service_role)
[ ] No SELECT * without org_id filter
```

#### Secrets Management
```
[ ] No API keys in client code (except Supabase anon key)
[ ] Environment variables for sensitive config
[ ] No secrets in git history
```

### High Priority

#### Input Sanitization
```
[ ] escapeHtml() on all user-provided display text
[ ] Parameterized queries (Supabase handles this)
[ ] File upload validation (type, size, content)
```

#### Authentication
```
[ ] Password hashing (bcrypt/argon2 via Supabase)
[ ] Session expiry configured appropriately
[ ] Logout invalidates session properly
```

#### HTTPS
```
[ ] All URLs use HTTPS
[ ] Redirect HTTP to HTTPS
[ ] Secure cookies (HttpOnly, SameSite, Secure flags)
```

### Medium Priority

#### CAPTCHA
```
[ ] Forms have bot protection
[ ] Rate limiting as backup
```

#### Dependencies
```
[ ] npm audit clean
[ ] Monthly dependency updates scheduled
[ ] No known vulnerable packages
```

#### Logging
```
[ ] Sensitive actions logged (login, payments, data changes)
[ ] Logs don't contain passwords/tokens
[ ] Log retention policy defined
```

## Execution Format

When running `/security-audit`, output in this format:

```markdown
# Security Audit Report

## Summary
- **Critical Issues**: X
- **High Priority**: X
- **Medium Priority**: X
- **Passed Checks**: X

---

## Perspective 1: Security Engineer

### Findings
1. [CRITICAL] Description...
   - **Location**: file:line
   - **Risk**: What could happen
   - **Fix**: How to fix it

### Passed
- Authentication flow uses Supabase Auth
- ...

---

## Perspective 2: Penetration Tester

### Attack Vectors Found
1. [HIGH] Potential race condition in...
   - **Exploit**: How to exploit
   - **Fix**: Atomic transaction

### Attempted but Failed
- SQL injection: Parameterized queries block this
- ...

---

## Perspective 3: Compliance Officer

### Compliance Gaps
1. [MEDIUM] Missing audit log for...

### Compliant
- User data deletion available
- ...

---

## Prioritized Fix List
1. [CRITICAL] Fix X immediately
2. [HIGH] Address Y before launch
3. [MEDIUM] Schedule Z for next sprint
```

## Already Implemented in Royalty

- Rate limiter (`app/rate-limiter.js`)
- XSS prevention (`AppUtils.escapeHtml` in `app/utils.js`)
- Parameterized Supabase queries (throughout codebase)
- RLS policies (`database/schema.sql`)
- Atomic RPC functions for points/signups

## Files to Always Check

- `/app/auth.js` - Authentication flows
- `/database/schema.sql` - RLS policies
- `/customer-app/` - Public-facing app (highest risk)
- Any file with `supabase.from()` - Database access
- Any file handling `points`, `payment`, `balance`
