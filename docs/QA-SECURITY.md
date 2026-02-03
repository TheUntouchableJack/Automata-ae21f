# Automata — QA, Security & Testing Protocol

## The Mandate

**Nothing ships without validation.**

Every feature — new, edited, or changed — passes through this protocol. No exceptions. No "it should work." No "I'll test it later." The cost of a bug in production is 10x the cost of catching it in development.

---

## The Testing Pyramid

```
                    ╱╲
                   ╱  ╲
                  ╱ E2E ╲          ← Few, slow, expensive (critical paths only)
                 ╱──────╲
                ╱        ╲
               ╱Integration╲       ← More, test component interactions
              ╱────────────╲
             ╱              ╲
            ╱   Unit Tests   ╲     ← Many, fast, cheap (logic & functions)
           ╱──────────────────╲
```

**Reality check:** We're a startup. We can't test everything. So we test *what matters*:
- Authentication flows
- Data isolation (RLS)
- Payment/billing logic
- Core automation engine
- Customer data integrity

---

## Pre-Development Checklist

Before writing a single line of code:

- [ ] **Understand** — Can I explain this feature in one sentence?
- [ ] **Scope** — What exactly is changing? What's NOT changing?
- [ ] **Dependencies** — What existing code does this touch?
- [ ] **Edge cases** — What could go wrong? (List at least 3)
- [ ] **Security surface** — Does this touch auth, data access, or user input?
- [ ] **Rollback plan** — If this breaks, how do we undo it?

---

## During Development

### Debugging Methodology

**Don't guess. Investigate.**

```
1. REPRODUCE    → Can you make it fail consistently?
2. ISOLATE      → What's the smallest code path that fails?
3. INSPECT      → What are the actual values at each step?
4. HYPOTHESIZE  → What could cause this specific behavior?
5. TEST         → Change ONE thing and verify
6. DOCUMENT     → Why did it fail? How did you fix it?
```

### Debugging Tools & Techniques

**Console & Logging**
```javascript
// Bad: console.log(data)
// Good: console.log('[CustomerUpload] Parsed rows:', { count: rows.length, sample: rows[0] })

// Use structured logging
const log = (context, message, data = {}) => {
  console.log(`[${context}] ${message}`, JSON.stringify(data, null, 2));
};
```

**Supabase Debugging**
```javascript
// Always check for errors explicitly
const { data, error } = await supabase.from('customers').select('*');
if (error) {
  console.error('[DB] Query failed:', { 
    table: 'customers', 
    error: error.message,
    code: error.code,
    details: error.details 
  });
  throw error;
}
```

**Network Inspection**
- Use browser DevTools → Network tab
- Check request payloads and response bodies
- Look for 4xx/5xx status codes
- Verify auth headers are present

**State Debugging (React)**
```javascript
// Use React DevTools
// Add debug boundaries
useEffect(() => {
  console.log('[State] automations changed:', automations);
}, [automations]);
```

### Code Review Checklist (Self-Review Before Commit)

- [ ] Does this do what the feature requires?
- [ ] Are there any hardcoded values that should be config/env?
- [ ] Are all errors handled gracefully?
- [ ] Are there any `console.log` statements that should be removed?
- [ ] Is there any commented-out code that should be deleted?
- [ ] Are variable/function names clear and consistent?
- [ ] Is there any duplicated logic that should be abstracted?
- [ ] Are TypeScript types/interfaces complete (if applicable)?

---

## Security Protocol

### The Golden Rules

1. **Never trust client input.** Validate everything server-side.
2. **Never expose secrets.** No API keys, no service role keys in client code.
3. **Always use RLS.** Every table, no exceptions.
4. **Principle of least privilege.** Users access only what they need.
5. **Audit everything.** Log security-relevant actions.

### Row Level Security (RLS) — Supabase

**RLS is non-negotiable.** Every table must have RLS enabled with appropriate policies.

#### Standard Policy Patterns

**Business-scoped data (customers, automations, etc.)**
```sql
-- Enable RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own business's customers
CREATE POLICY "Users can view own business customers" ON customers
  FOR SELECT
  USING (business_id = auth.jwt() ->> 'business_id');

-- Policy: Users can only insert to their own business
CREATE POLICY "Users can insert own business customers" ON customers
  FOR INSERT
  WITH CHECK (business_id = auth.jwt() ->> 'business_id');

-- Policy: Users can only update their own business's customers
CREATE POLICY "Users can update own business customers" ON customers
  FOR UPDATE
  USING (business_id = auth.jwt() ->> 'business_id')
  WITH CHECK (business_id = auth.jwt() ->> 'business_id');

-- Policy: Users can only delete their own business's customers
CREATE POLICY "Users can delete own business customers" ON customers
  FOR DELETE
  USING (business_id = auth.jwt() ->> 'business_id');
```

**User profile data**
```sql
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE
  USING (id = auth.uid());
```

#### RLS Testing Protocol

**CRITICAL: Test RLS with multiple users**

```javascript
// Test script: Verify data isolation
async function testRLSIsolation() {
  // 1. Create two test users in different businesses
  const userA = await createTestUser('business_a');
  const userB = await createTestUser('business_b');
  
  // 2. User A creates a customer
  const customerA = await supabase
    .from('customers')
    .insert({ name: 'Test Customer', business_id: 'business_a' })
    .auth(userA.token);
  
  // 3. User B tries to read User A's customer
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerA.id)
    .auth(userB.token);
  
  // 4. MUST return empty — if data exists, RLS is broken!
  assert(data.length === 0, 'RLS VIOLATION: User B can see User A data');
  
  // 5. User B tries to update User A's customer
  const updateResult = await supabase
    .from('customers')
    .update({ name: 'Hacked!' })
    .eq('id', customerA.id)
    .auth(userB.token);
  
  // 6. MUST fail or affect 0 rows
  assert(updateResult.data.length === 0, 'RLS VIOLATION: User B can update User A data');
}
```

#### RLS Audit Checklist

For EVERY table, verify:

| Check | Status |
|-------|--------|
| RLS is enabled | ☐ |
| SELECT policy exists and uses business_id/user_id | ☐ |
| INSERT policy exists with WITH CHECK | ☐ |
| UPDATE policy exists with both USING and WITH CHECK | ☐ |
| DELETE policy exists (or is intentionally omitted) | ☐ |
| Tested with two different users | ☐ |
| Cross-business access returns empty/fails | ☐ |

### Input Validation

**Never trust. Always validate.**

```javascript
// Server-side validation example
function validateCustomerInput(input) {
  const errors = [];
  
  // Required fields
  if (!input.email || typeof input.email !== 'string') {
    errors.push('Email is required');
  }
  
  // Format validation
  if (input.email && !isValidEmail(input.email)) {
    errors.push('Invalid email format');
  }
  
  // Length limits (prevent DB overflow)
  if (input.name && input.name.length > 255) {
    errors.push('Name too long (max 255 characters)');
  }
  
  // Sanitization (prevent injection)
  if (input.notes) {
    input.notes = sanitizeHtml(input.notes);
  }
  
  // Type coercion
  if (input.age) {
    input.age = parseInt(input.age, 10);
    if (isNaN(input.age) || input.age < 0 || input.age > 150) {
      errors.push('Invalid age');
    }
  }
  
  return { valid: errors.length === 0, errors, sanitized: input };
}
```

### API Security Checklist

- [ ] All endpoints require authentication (except public ones)
- [ ] Rate limiting is implemented on sensitive endpoints
- [ ] CORS is configured to allow only known origins
- [ ] Sensitive data is never logged
- [ ] Passwords are hashed (bcrypt, Argon2)
- [ ] JWT tokens have reasonable expiration
- [ ] Refresh token rotation is implemented
- [ ] Failed login attempts are rate-limited

### Environment Variables

```bash
# .env.local (NEVER commit this file)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co    # OK to expose
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx                   # OK to expose (with RLS)
SUPABASE_SERVICE_ROLE_KEY=xxx                       # NEVER expose to client
SENDGRID_API_KEY=xxx                                # Server-side only
TWILIO_AUTH_TOKEN=xxx                               # Server-side only
```

**Rules:**
- `NEXT_PUBLIC_*` = OK for client
- Everything else = server-side only
- Service role key = only in secure server functions
- Rotate keys immediately if exposed

---

## Regression Testing

### What is Regression?

When new code breaks old functionality. The silent killer of products.

### Regression Test Suite

Maintain a list of critical paths that must work after ANY change:

#### Authentication Flows
- [ ] Sign up with email/password
- [ ] Sign in with email/password
- [ ] Sign out
- [ ] Password reset flow
- [ ] Session persistence across refresh
- [ ] Redirect to login when unauthenticated

#### Customer Data
- [ ] Upload CSV with valid data
- [ ] Upload CSV with malformed data (error handling)
- [ ] Manual customer entry
- [ ] Edit existing customer
- [ ] Delete customer
- [ ] Custom columns persist correctly
- [ ] Search/filter customers

#### Automations
- [ ] View AI proposals
- [ ] Approve automation
- [ ] Edit automation before approval
- [ ] Activate/deactivate automation
- [ ] Delete automation
- [ ] Automation triggers correctly (schedule/event)

#### Communications
- [ ] Email sends via SendGrid
- [ ] SMS sends via Twilio
- [ ] Personalization tokens replaced correctly
- [ ] Unsubscribe link works
- [ ] Message tracking records delivery

#### Data Isolation (Run after ANY DB change)
- [ ] User A cannot see User B's customers
- [ ] User A cannot see User B's automations
- [ ] User A cannot modify User B's data
- [ ] New tables have RLS enabled and tested

### Running Regression Tests

**Before every PR/merge:**
```bash
# Run the regression suite
npm run test:regression

# Or manually walk through critical paths
# Document: PASS / FAIL / SKIP with reason
```

**After every deployment:**
- Smoke test critical paths in production
- Check error monitoring (Sentry, LogRocket)
- Verify no spike in error rates

---

## Stress Testing & Performance

### Load Testing Basics

**Tools:** k6, Artillery, or simple scripts

```javascript
// Example: k6 load test for customer list endpoint
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // Ramp up to 20 users
    { duration: '1m', target: 20 },   // Stay at 20
    { duration: '10s', target: 0 },   // Ramp down
  ],
};

export default function () {
  const res = http.get('https://api.automata.com/customers', {
    headers: { Authorization: `Bearer ${__ENV.TEST_TOKEN}` },
  });
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  
  sleep(1);
}
```

### Performance Benchmarks

| Endpoint/Action | Target | Unacceptable |
|-----------------|--------|--------------|
| Page load (LCP) | < 2.5s | > 4s |
| API response (simple) | < 200ms | > 1s |
| API response (complex) | < 500ms | > 2s |
| CSV upload (1000 rows) | < 5s | > 15s |
| AI proposal generation | < 10s | > 30s |

### Database Performance

```sql
-- Check slow queries
SELECT query, mean_time, calls
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Check missing indexes
SELECT relname, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch
FROM pg_stat_user_tables
WHERE seq_scan > idx_scan
ORDER BY seq_tup_read DESC;
```

**Index Strategy:**
- Index all foreign keys (`business_id`, `customer_id`, etc.)
- Index columns used in WHERE clauses
- Index columns used in ORDER BY
- Composite indexes for common query patterns

---

## Error Handling Standards

### Frontend Errors

```javascript
// Global error boundary
class ErrorBoundary extends React.Component {
  componentDidCatch(error, errorInfo) {
    // Log to monitoring service
    logError(error, { context: errorInfo, user: getCurrentUser() });
  }
  
  render() {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}

// API call pattern
async function fetchCustomers() {
  try {
    const { data, error } = await supabase.from('customers').select('*');
    if (error) throw error;
    return data;
  } catch (error) {
    logError(error, { context: 'fetchCustomers' });
    showToast('Failed to load customers. Please try again.');
    return [];
  }
}
```

### Error Logging Requirements

Every logged error must include:
- Timestamp
- Error message and stack trace
- User ID (if authenticated)
- Business ID (if applicable)
- Request context (endpoint, params)
- Environment (dev/staging/prod)

### User-Facing Error Messages

| Internal Error | User Message |
|----------------|--------------|
| `PGRST301` (RLS) | "You don't have access to this resource." |
| `23505` (unique violation) | "This email is already registered." |
| Network timeout | "Connection lost. Please check your internet." |
| 500 error | "Something went wrong. We've been notified." |
| Validation error | Specific field-level feedback |

**Never expose:**
- Stack traces
- Database column names
- Internal IDs
- System architecture details

---

## Post-Deployment Monitoring

### Health Checks

```javascript
// /api/health endpoint
export default function handler(req, res) {
  const checks = {
    database: await checkDatabase(),
    sendgrid: await checkSendGrid(),
    twilio: await checkTwilio(),
  };
  
  const allHealthy = Object.values(checks).every(c => c.status === 'ok');
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
}
```

### Monitoring Checklist

- [ ] Error tracking (Sentry) configured
- [ ] Uptime monitoring (Pingdom, UptimeRobot)
- [ ] Database connection pool monitoring
- [ ] API response time tracking
- [ ] Email/SMS delivery rates
- [ ] Alerts for error rate spikes

---

## The QA Checklist (Use For Every Feature)

### Before Development
- [ ] Requirements are clear and documented
- [ ] Edge cases are identified
- [ ] Security surface is understood

### During Development
- [ ] Code is self-reviewed
- [ ] Errors are handled gracefully
- [ ] Logging is in place for debugging
- [ ] No secrets in client code

### Before Merge
- [ ] Feature works as specified
- [ ] Regression tests pass
- [ ] RLS policies tested (if DB changes)
- [ ] Input validation complete
- [ ] Error messages are user-friendly
- [ ] Performance is acceptable

### After Deployment
- [ ] Smoke test in production
- [ ] Monitor error rates
- [ ] Verify no RLS violations in logs
- [ ] Check performance metrics

---

## Quick Reference: Common Issues & Fixes

| Symptom | Likely Cause | Check |
|---------|--------------|-------|
| Empty data returned | RLS blocking | Check policies, verify business_id |
| 401 Unauthorized | Token expired/missing | Check auth state, refresh token |
| 403 Forbidden | RLS policy violation | User accessing wrong business's data |
| Slow queries | Missing index | Check query plan with EXPLAIN |
| Data not persisting | Transaction rollback | Check for errors in the full flow |
| UI not updating | State not synced | Verify setState/revalidation called |

---

*"The cost of catching a bug in development is 1x. In QA, 10x. In production, 100x. After a customer finds it, 1000x."*
