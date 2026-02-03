# Portable Development Skills & Audit Framework

A comprehensive collection of development practices, audit systems, and skills extracted from production app development. Drop this into any project to establish professional-grade development workflows.

---

## Quick Start

Copy these files to your project:
- `CLAUDE.md` - Project-specific instructions (customize for your app)
- `skills/` folder - All audit and workflow skills
- This document as reference

---

## Table of Contents

1. [Multi-Perspective Audit System](#multi-perspective-audit-system)
2. [Development Guidelines](#development-guidelines)
3. [Security Patterns](#security-patterns)
4. [Error Handling Patterns](#error-handling-patterns)
5. [i18n Workflow](#i18n-workflow)
6. [Code Quality Checklist](#code-quality-checklist)
7. [Onboarding Flow Patterns](#onboarding-flow-patterns)
8. [Database Patterns](#database-patterns)

---

## Multi-Perspective Audit System

### Overview

Run audits from different expert perspectives to catch issues a single viewpoint would miss. Each perspective has specific focus areas and deliverables.

### Audit Perspectives

| Perspective | Focus Areas | When to Use |
|-------------|-------------|-------------|
| Security | Auth, XSS, injection, rate limiting, RLS | Before launch, after auth changes |
| Architecture | Performance, scaling, caching, database | Before major features, quarterly |
| QA | Edge cases, validation, browser compat | After features, before release |
| UX/Design | User flows, accessibility, mobile, consistency | After UI changes |
| Code Quality | DRY, patterns, maintainability | Weekly, before PRs |
| Compliance | GDPR, CCPA, terms, data handling | Before launch, quarterly |
| Business | GTM, pricing, unit economics | Before launch, pivots |
| AI Safety | Prompt safety, costs, hallucinations | When using AI features |
| Customer Success | Onboarding, errors, self-service | After user testing |

### Master Audit Command

```
/audit              # Context-aware, runs relevant perspectives
/audit full         # Comprehensive pre-launch (all perspectives)
/audit quick        # Fast: security + code + QA only
/audit [area]       # Target specific area: auth, api, ui, etc.
```

### Security Audit Template

```markdown
## Security Audit Report

### Authentication
- [ ] Session management secure
- [ ] Password policies enforced
- [ ] Rate limiting on auth endpoints
- [ ] CSRF protection enabled
- [ ] Secure cookie flags set

### Authorization
- [ ] Row Level Security (RLS) on all tables
- [ ] API endpoints check permissions
- [ ] No privilege escalation paths
- [ ] Admin routes protected

### Data Handling
- [ ] Input validation on all user data
- [ ] Output encoding (XSS prevention)
- [ ] SQL injection prevention (parameterized queries)
- [ ] Sensitive data encrypted at rest
- [ ] PII handling compliant

### Infrastructure
- [ ] HTTPS enforced
- [ ] Security headers set
- [ ] Dependency vulnerabilities scanned
- [ ] Secrets not in code
- [ ] Error messages don't leak info

### Findings
| Issue | Severity | Location | Recommendation |
|-------|----------|----------|----------------|
| ... | HIGH/MED/LOW | file:line | ... |
```

### Code Quality Audit Template

```markdown
## Code Quality Audit Report

### Patterns & Consistency
- [ ] Consistent naming conventions
- [ ] DRY principle followed
- [ ] Single responsibility per function
- [ ] Error handling consistent
- [ ] Event delegation used where appropriate

### Memory & Performance
- [ ] No memory leaks (event listeners cleaned up)
- [ ] No unnecessary re-renders
- [ ] Large lists virtualized
- [ ] Images optimized
- [ ] Lazy loading implemented

### Maintainability
- [ ] Functions under 50 lines
- [ ] Clear variable names
- [ ] Complex logic commented
- [ ] No magic numbers
- [ ] Configuration externalized

### Findings
| Issue | Type | Location | Fix |
|-------|------|----------|-----|
| ... | Leak/Pattern/Performance | file:line | ... |
```

### QA Audit Template

```markdown
## QA Audit Report

### Edge Cases
- [ ] Empty states handled
- [ ] Error states display properly
- [ ] Loading states shown
- [ ] Null/undefined handled
- [ ] Network failures graceful

### Form Validation
- [ ] Required fields enforced
- [ ] Input formats validated
- [ ] Error messages helpful
- [ ] Success feedback shown
- [ ] Double-submit prevented

### Browser Compatibility
- [ ] Chrome/Firefox/Safari/Edge tested
- [ ] Mobile browsers tested
- [ ] Touch interactions work
- [ ] Keyboard navigation works

### Responsive Design
- [ ] 375px (mobile) layout correct
- [ ] 768px (tablet) layout correct
- [ ] 1024px (laptop) layout correct
- [ ] 1440px (desktop) layout correct

### Findings
| Issue | Severity | Steps to Reproduce | Expected |
|-------|----------|-------------------|----------|
| ... | HIGH/MED/LOW | 1. Go to... | Should... |
```

---

## Development Guidelines

### Critical Rules

1. **Read before write** - Always read existing code before modifying
2. **Minimal changes** - Only change what's necessary
3. **Security first** - Validate input, escape output, check permissions
4. **Error handling** - Every async operation needs error handling
5. **Test the flow** - Click through features after changes

### Code Style

```javascript
// Good: Clear, single responsibility
async function createUser(email, name) {
    validateEmail(email);
    const user = await db.users.insert({ email, name });
    await sendWelcomeEmail(user);
    return user;
}

// Bad: Doing too much, unclear
async function createUserAndDoStuff(data) {
    // 200 lines of mixed concerns
}
```

### Event Handling

```javascript
// Good: Event delegation
container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    handleAction(btn.dataset.action);
});

// Bad: Listeners on dynamic elements
items.forEach(item => {
    item.addEventListener('click', handler); // Memory leak risk
});
```

### Async Operations

```javascript
// Good: Proper error handling
async function fetchData() {
    try {
        const { data, error } = await supabase.from('items').select('*');
        if (error) throw error;
        return { success: true, data };
    } catch (err) {
        console.error('Fetch failed:', err);
        return { success: false, error: err.message };
    }
}

// Bad: Silent failures
async function fetchData() {
    const { data } = await supabase.from('items').select('*');
    return data; // What if error?
}
```

---

## Security Patterns

### Input Validation

```javascript
// Validate and sanitize user input
function validateOnboardingData(rawData) {
    if (!rawData || typeof rawData !== 'string') {
        return { isValid: false, data: null };
    }

    try {
        const parsed = JSON.parse(rawData);

        // Type checking
        if (typeof parsed !== 'object' || parsed === null) {
            return { isValid: false, data: null };
        }

        // Length limits
        let text = '';
        if (typeof parsed.text === 'string') {
            text = parsed.text.trim().substring(0, 500);
        }

        // Whitelist validation
        const validOptions = ['option1', 'option2', 'option3'];
        const option = validOptions.includes(parsed.option) ? parsed.option : '';

        return { isValid: true, data: { text, option } };
    } catch (e) {
        return { isValid: false, data: null };
    }
}
```

### XSS Prevention

```javascript
// Always escape user content in HTML
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Use when rendering user content
element.innerHTML = `<p>${escapeHtml(userInput)}</p>`;
```

### Rate Limiting

```javascript
// Simple rate limiter
const rateLimits = new Map();

function checkRateLimit(identifier, maxAttempts, windowMs) {
    const now = Date.now();
    const key = `${identifier}`;
    const attempts = rateLimits.get(key) || [];

    // Clean old attempts
    const validAttempts = attempts.filter(t => now - t < windowMs);

    if (validAttempts.length >= maxAttempts) {
        return false; // Rate limited
    }

    validAttempts.push(now);
    rateLimits.set(key, validAttempts);
    return true;
}
```

### Authorization Checks

```javascript
// Always verify before operations
async function deleteItem(itemId, userId) {
    // Verify ownership
    const { data: item } = await db.from('items')
        .select('user_id')
        .eq('id', itemId)
        .single();

    if (!item || item.user_id !== userId) {
        return { success: false, error: 'unauthorized' };
    }

    // Proceed with delete
    await db.from('items').delete().eq('id', itemId);
    return { success: true };
}
```

---

## Error Handling Patterns

### Structured Error Responses

```javascript
// Return consistent error objects
async function createResource(data) {
    // Validation
    if (!data.name) {
        return { success: false, error: 'name_required' };
    }

    // Database operation
    try {
        const { data: result, error } = await db.from('resources').insert(data).select().single();

        if (error) {
            console.error('DB error:', error);
            return { success: false, error: error.message };
        }

        return { success: true, data: result };
    } catch (err) {
        console.error('Unexpected error:', err);
        return { success: false, error: 'unexpected_error' };
    }
}
```

### User-Friendly Error Display

```javascript
function showError(errorCode) {
    const messages = {
        'name_required': 'Please enter a name',
        'unauthorized': 'You don\'t have permission to do this',
        'network_error': 'Connection failed. Please try again.',
        'unexpected_error': 'Something went wrong. Please try again.'
    };

    const message = messages[errorCode] || messages.unexpected_error;

    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.innerHTML = `
        <span>${escapeHtml(message)}</span>
        <button onclick="this.parentElement.remove()">Dismiss</button>
    `;

    document.body.prepend(banner);
}
```

### Retry Logic

```javascript
async function fetchWithRetry(fn, maxRetries = 3, delay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === maxRetries - 1) throw err;
            await new Promise(r => setTimeout(r, delay * (i + 1)));
        }
    }
}
```

---

## i18n Workflow

### Setup

1. Create language files: `i18n/en.json`, `i18n/es.json`, etc.
2. Use flat or nested structure:

```json
{
    "common": {
        "save": "Save",
        "cancel": "Cancel",
        "loading": "Loading..."
    },
    "auth": {
        "login": "Log In",
        "logout": "Log Out"
    }
}
```

### HTML Integration

```html
<!-- Use data attributes -->
<button data-i18n="common.save">Save</button>
<p data-i18n="auth.welcomeMessage">Welcome back!</p>
```

### JavaScript Integration

```javascript
const I18n = {
    locale: 'en',
    translations: {},

    async load(locale) {
        const response = await fetch(`/i18n/${locale}.json`);
        this.translations = await response.json();
        this.locale = locale;
        this.applyTranslations();
    },

    t(key) {
        return key.split('.').reduce((obj, k) => obj?.[k], this.translations) || key;
    },

    applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            el.textContent = this.t(key);
        });
    }
};
```

### Workflow for Adding New Text

1. Add English text with `data-i18n` attribute
2. Add key to `en.json`
3. Add translations to all other language files
4. Run validation: `node scripts/check-i18n.js`

### i18n Validation Script

```javascript
// scripts/check-i18n.js
const fs = require('fs');
const path = require('path');

const i18nDir = './i18n';
const languages = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar'];

const enKeys = new Set();
const en = JSON.parse(fs.readFileSync(path.join(i18nDir, 'en.json')));

function collectKeys(obj, prefix = '') {
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null) {
            collectKeys(value, fullKey);
        } else {
            enKeys.add(fullKey);
        }
    }
}

collectKeys(en);

for (const lang of languages.filter(l => l !== 'en')) {
    const file = path.join(i18nDir, `${lang}.json`);
    const translations = JSON.parse(fs.readFileSync(file));
    const langKeys = new Set();
    collectKeys(translations, '', langKeys);

    const missing = [...enKeys].filter(k => !langKeys.has(k));
    if (missing.length) {
        console.log(`${lang}: Missing ${missing.length} keys`);
        missing.forEach(k => console.log(`  - ${k}`));
    }
}
```

---

## Code Quality Checklist

### Before Every PR

- [ ] No console.log left in code (except intentional debug logs)
- [ ] No commented-out code
- [ ] Error handling on all async operations
- [ ] Loading states for async UI
- [ ] Mobile responsive checked
- [ ] i18n keys added for new text
- [ ] Cache versions bumped for changed JS/CSS

### Weekly Review

- [ ] Check for event listener leaks
- [ ] Review error handling coverage
- [ ] Audit dependency versions
- [ ] Review security headers
- [ ] Check for hardcoded values

### Before Launch

- [ ] Run full security audit
- [ ] Run full QA audit
- [ ] Performance profiling done
- [ ] Error tracking configured
- [ ] Analytics implemented
- [ ] SEO meta tags set
- [ ] Legal pages present (privacy, terms)

---

## Onboarding Flow Patterns

### Multi-Step Flow with Progress

```javascript
async function runOnboardingFlow() {
    const steps = document.querySelectorAll('.step-item');
    let result = null;

    for (let i = 0; i < steps.length; i++) {
        // Animate step
        const icon = steps[i].querySelector('.step-icon');
        icon.classList.add('active');

        // Do actual work on specific step
        if (i === 2) {
            result = await performMainAction();
            if (!result.success) {
                icon.classList.add('error');
                showError(result.error);
                return;
            }
        }

        // Mark complete
        await new Promise(r => setTimeout(r, 800));
        icon.classList.remove('active');
        icon.classList.add('complete');
    }

    showSuccess();
}
```

### Duplicate Prevention

```javascript
async function performOnboardingAction() {
    // Check if already in progress
    if (sessionStorage.getItem('action_in_progress') === 'true') {
        return;
    }

    // Check if already completed
    const { data: existing } = await db.from('items')
        .select('id')
        .eq('user_id', userId)
        .eq('source', 'onboarding')
        .single();

    if (existing) {
        // Already done, skip to next step
        return { success: true, data: existing };
    }

    // Mark in progress
    sessionStorage.setItem('action_in_progress', 'true');

    try {
        // Do the work
        const result = await createItem();
        return result;
    } finally {
        sessionStorage.removeItem('action_in_progress');
    }
}
```

### Progress Persistence

```javascript
// Save progress to localStorage
function saveProgress(step, data) {
    const progress = JSON.parse(localStorage.getItem('onboarding_progress') || '{}');
    progress.currentStep = step;
    progress.data = { ...progress.data, ...data };
    progress.updatedAt = Date.now();
    localStorage.setItem('onboarding_progress', JSON.stringify(progress));
}

// Resume from progress
function resumeOnboarding() {
    const progress = JSON.parse(localStorage.getItem('onboarding_progress') || '{}');

    // Check if progress is stale (> 24 hours)
    if (progress.updatedAt && Date.now() - progress.updatedAt > 86400000) {
        localStorage.removeItem('onboarding_progress');
        return null;
    }

    return progress;
}
```

---

## Database Patterns

### Soft Delete

```sql
-- Add soft delete column
ALTER TABLE items ADD COLUMN deleted_at TIMESTAMPTZ;

-- Create soft delete function
CREATE OR REPLACE FUNCTION soft_delete_item(item_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE items SET deleted_at = NOW() WHERE id = item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS policy to hide deleted items
CREATE POLICY "Hide deleted items" ON items
    FOR SELECT USING (deleted_at IS NULL);
```

### Undo Support

```javascript
// Store undo data temporarily
async function softDeleteItem(id) {
    const { data: item } = await db.from('items').select('*').eq('id', id).single();

    // Soft delete
    await db.from('items').update({ deleted_at: new Date() }).eq('id', id);

    // Store for undo (30 second window)
    const undoId = `undo_${id}_${Date.now()}`;
    sessionStorage.setItem(undoId, JSON.stringify(item));

    // Show undo toast
    showUndoToast('Item deleted', async () => {
        await db.from('items').update({ deleted_at: null }).eq('id', id);
        sessionStorage.removeItem(undoId);
    });

    // Clean up after window expires
    setTimeout(() => sessionStorage.removeItem(undoId), 30000);
}
```

### Audit Logging

```sql
-- Audit log table
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    changes JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Log changes automatically
CREATE OR REPLACE FUNCTION log_changes()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, changes)
    VALUES (
        auth.uid(),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        jsonb_build_object('old', row_to_json(OLD), 'new', row_to_json(NEW))
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Skill Templates

### Security Audit Skill

```markdown
# /security-audit

Run a comprehensive security audit of the codebase.

## Checklist

### Authentication
- [ ] Password hashing (bcrypt/argon2)
- [ ] Session management
- [ ] Rate limiting on login
- [ ] Account lockout policy
- [ ] Password reset flow secure

### Authorization
- [ ] RLS policies on all tables
- [ ] API endpoint authorization
- [ ] Admin routes protected
- [ ] No privilege escalation

### Data Security
- [ ] Input validation
- [ ] Output encoding (XSS)
- [ ] SQL injection prevention
- [ ] File upload restrictions
- [ ] Sensitive data encryption

### Infrastructure
- [ ] HTTPS only
- [ ] Security headers
- [ ] CORS configured
- [ ] Secrets management
- [ ] Dependency audit

## Report Format

| Finding | Severity | Location | Recommendation |
|---------|----------|----------|----------------|
```

### Code Review Skill

```markdown
# /code-review

Review code for quality, patterns, and potential issues.

## Focus Areas

1. **Logic errors** - Off-by-one, null checks, edge cases
2. **Memory leaks** - Event listeners, subscriptions, timers
3. **Security** - Input validation, output encoding
4. **Performance** - N+1 queries, unnecessary renders
5. **Maintainability** - Clear names, single responsibility

## Report Format

| Issue | Type | Location | Suggestion |
|-------|------|----------|------------|
```

### QA Checklist Skill

```markdown
# /qa-checklist

Generate QA checklist for a feature.

## Template

### Happy Path
- [ ] Feature works as described
- [ ] Success feedback shown
- [ ] Data persists correctly

### Error Cases
- [ ] Invalid input rejected
- [ ] Network error handled
- [ ] Empty state displayed
- [ ] Error messages helpful

### Edge Cases
- [ ] Very long text
- [ ] Special characters
- [ ] Multiple rapid clicks
- [ ] Browser back button
- [ ] Page refresh mid-flow

### Cross-Browser
- [ ] Chrome
- [ ] Firefox
- [ ] Safari
- [ ] Mobile Safari
- [ ] Mobile Chrome

### Accessibility
- [ ] Keyboard navigation
- [ ] Screen reader friendly
- [ ] Color contrast adequate
- [ ] Focus indicators visible
```

---

## Usage

1. Copy this document to your project's `docs/` folder
2. Copy relevant skill templates to `skills/` folder
3. Customize CLAUDE.md with project-specific details
4. Run `/audit` before major releases
5. Review checklist before PRs

---

## License

MIT - Use freely in any project.
