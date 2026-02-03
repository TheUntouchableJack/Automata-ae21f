# Automata Architecture & Development Guidelines

> Last updated: January 2026
> This document defines coding standards, architectural patterns, and best practices for the Automata codebase.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [File Structure](#file-structure)
3. [JavaScript Patterns](#javascript-patterns)
4. [CSS Guidelines](#css-guidelines)
5. [HTML & Components](#html--components)
6. [Internationalization (i18n)](#internationalization-i18n)
7. [Data & Supabase](#data--supabase)
8. [Common Pitfalls](#common-pitfalls)
9. [Adding New Features](#adding-new-features)
10. [Technical Debt Tracker](#technical-debt-tracker)

---

## Architecture Overview

### Stack
- **Frontend**: Vanilla HTML/CSS/JavaScript (no framework)
- **Backend**: Supabase (Postgres + Auth + RLS)
- **Hosting**: Netlify (static site deployment)
- **i18n**: Custom IIFE module supporting 8 languages

### Key Characteristics
| Aspect | Current State | Implication |
|--------|--------------|-------------|
| Build System | None | No bundling, no minification - cache bust manually |
| State Management | Global variables | Each page manages its own state |
| Component System | None | HTML duplicated across pages |
| Type Safety | None | No TypeScript, no JSDoc |
| Testing | None | Manual QA only |

### File Statistics
- ~7,300 lines of JavaScript across 15 files
- ~4,800 lines of CSS across 5 files
- ~2,600 lines of translations across 8 JSON files

---

## File Structure

```
/Automata
├── index.html              # Landing page
├── pricing.html            # Pricing page
├── script.js               # Landing page JS
├── styles.css              # Global design system
│
├── /app/                   # Authenticated app pages
│   ├── *.html              # Page templates
│   ├── *.js                # Page-specific logic
│   ├── *.css               # Page-specific styles
│   ├── auth.js             # SHARED: Authentication utilities
│   ├── plan-limits.js      # SHARED: Plan/usage logic
│   ├── celebrate.js        # SHARED: Celebration effects
│   ├── danger-modal.js     # SHARED: Destructive action modal
│   ├── icon-library.js     # SHARED: Automation icons
│   └── templates-library.js # SHARED: Automation templates
│
├── /i18n/                  # Internationalization
│   ├── i18n.js             # i18n module
│   ├── i18n.css            # Language selector styles
│   └── {lang}.json         # Translation files (8 languages)
│
├── /blog/                  # Public blog
├── /automations/           # Public automations showcase
└── /database/              # SQL schemas
```

### Naming Conventions
- **HTML files**: Lowercase, single word or hyphenated (`project.html`, `danger-modal.html`)
- **JS files**: Lowercase, match HTML name (`project.js`, `dashboard.js`)
- **CSS files**: Lowercase, match primary component (`project.css`, `danger-modal.css`)
- **Shared JS**: Descriptive name indicating purpose (`plan-limits.js`, `icon-library.js`)

---

## JavaScript Patterns

### Global State Pattern (Current)

Each page uses global variables for state. This is intentional for simplicity but requires discipline.

```javascript
// ✅ Good: Clear state declaration at file top
let currentUser = null;
let currentProject = null;
let isEditing = false;

// ❌ Bad: State scattered throughout file
function saveProject() {
    let savedData = {}; // Don't create implicit state here
}
```

### Initialization Pattern

Every app page should follow this structure:

```javascript
// 1. State declarations
let currentUser = null;
let currentOrganization = null;

// 2. Main initialization function
async function initPageName() {
    try {
        currentUser = await requireAuth();
        await loadUserInfo();
        await loadOrganization();
        await loadPageData();
        setupEventListeners();
    } catch (error) {
        console.error('Init failed:', error);
        // Show user-friendly error
    }
}

// 3. Data loading functions
async function loadPageData() { /* ... */ }

// 4. Rendering functions
function renderContent(data) { /* ... */ }

// 5. Event handlers
function setupEventListeners() { /* ... */ }

// 6. Document ready
document.addEventListener('DOMContentLoaded', initPageName);
```

### Using Shared Utilities

```javascript
// ✅ Good: Use existing shared utilities
const user = await requireAuth();           // from auth.js
const limits = await getOrgLimits(orgId);   // from plan-limits.js
celebrate();                                 // from celebrate.js
DangerModal.show(config);                   // from danger-modal.js
const icon = ICON_LIBRARY['birthday'];      // from icon-library.js

// ❌ Bad: Duplicating functionality
async function loadUserInfo() { /* Don't recreate this */ }
```

### Event Listener Best Practices

```javascript
// ✅ Good: Event delegation for dynamic content
document.getElementById('projects-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.project-card');
    if (card) handleProjectClick(card.dataset.id);
});

// ❌ Bad: Attaching to each element (memory leak risk)
document.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', () => handleProjectClick(card.dataset.id));
});
```

### Modal Pattern

```javascript
// Opening a modal
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// Closing a modal
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// Always handle escape key and overlay clicks
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeActiveModal();
});
```

### Script Loading Order

Scripts must be loaded in this order in HTML:

```html
<!-- 1. External libraries first -->
<script src="https://cdn.jsdelivr.net/.../supabase-js@2"></script>
<script src="https://cdn.jsdelivr.net/.../confetti.browser.min.js"></script>

<!-- 2. i18n system (before page JS) -->
<script src="../i18n/i18n.js"></script>

<!-- 3. Shared utilities -->
<script src="auth.js?v=2"></script>
<script src="celebrate.js?v=2"></script>
<script src="danger-modal.js?v=1"></script>
<script src="plan-limits.js?v=1"></script>

<!-- 4. Page-specific JS last -->
<script src="dashboard.js?v=5"></script>
```

### Cache Busting

**CRITICAL**: Always increment version numbers when modifying JS files.

```html
<!-- When you modify auth.js, update ALL pages that use it -->
<script src="auth.js?v=2"></script>  <!-- Change to ?v=3 -->
```

Files and their current versions:
- `auth.js?v=2`
- `celebrate.js?v=2`
- `danger-modal.js?v=1`
- `plan-limits.js?v=1`
- `dashboard.js?v=5`
- `script.js?v=3`

---

## CSS Guidelines

### Design System Variables

Always use CSS custom properties from `styles.css`:

```css
/* ✅ Good: Use variables */
.my-component {
    background: var(--color-bg);
    color: var(--color-text);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    transition: var(--transition-base);
}

/* ❌ Bad: Hardcoded values */
.my-component {
    background: #ffffff;
    color: #1e293b;
    border-radius: 12px;
}
```

### Available Variables

```css
/* Colors */
--color-primary: #6366f1;
--color-secondary: #1e293b;
--color-accent: #10b981;
--color-bg, --color-bg-secondary, --color-bg-tertiary
--color-text, --color-text-secondary, --color-text-muted
--color-border, --color-border-light
--color-error: #ef4444;
--color-success: #10b981;
--color-warning: #f59e0b;

/* Shadows */
--shadow-xs through --shadow-xl
--shadow-card, --shadow-card-hover

/* Radii */
--radius-sm: 8px, --radius-md: 10px, --radius-lg: 12px
--radius-xl: 16px, --radius-2xl: 24px, --radius-full: 9999px

/* Transitions */
--transition-fast: 150ms ease;
--transition-base: 200ms ease;
--transition-slow: 300ms ease;
```

### Button Classes

```html
<!-- Primary action -->
<button class="btn btn-primary">Save</button>

<!-- Secondary action -->
<button class="btn btn-secondary">Cancel</button>

<!-- Danger action -->
<button class="btn btn-danger">Delete</button>

<!-- Ghost/text button -->
<button class="btn btn-ghost">Learn More</button>

<!-- Size modifiers -->
<button class="btn btn-primary btn-small">Small</button>
<button class="btn btn-primary btn-large">Large</button>
```

### Responsive Breakpoints

```css
/* Mobile-first approach */
.component { /* Mobile styles */ }

@media (min-width: 768px) {
    .component { /* Tablet styles */ }
}

@media (min-width: 1024px) {
    .component { /* Desktop styles */ }
}
```

---

## HTML & Components

### Common Patterns to Reuse

#### Modal Structure
```html
<div class="modal-overlay" id="my-modal">
    <div class="modal">
        <div class="modal-header">
            <h2 data-i18n="modal.title">Modal Title</h2>
            <button class="modal-close" onclick="closeModal('my-modal')">
                <svg><!-- X icon --></svg>
            </button>
        </div>
        <div class="modal-body">
            <!-- Content -->
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal('my-modal')"
                    data-i18n="modal.cancel">Cancel</button>
            <button class="btn btn-primary" data-i18n="modal.confirm">Confirm</button>
        </div>
    </div>
</div>
```

#### Form Field
```html
<div class="form-group">
    <label for="field-id" data-i18n="form.fieldLabel">Field Label</label>
    <input type="text" id="field-id" name="fieldName"
           data-i18n-placeholder="form.fieldPlaceholder"
           placeholder="Placeholder text">
    <span class="form-helper" data-i18n="form.fieldHelper">Helper text</span>
</div>
```

#### Empty State
```html
<div class="empty-state">
    <div class="empty-state-icon">
        <svg><!-- Relevant icon --></svg>
    </div>
    <h3 data-i18n="page.noItems">No items yet</h3>
    <p data-i18n="page.noItemsDesc">Create your first item to get started</p>
    <button class="btn btn-primary" data-i18n="page.createFirst">Create First Item</button>
</div>
```

#### Loading State
```html
<div class="loading-container" id="loading">
    <div class="loading-spinner"></div>
</div>
```

### Accessibility Requirements

```html
<!-- Modals need ARIA attributes -->
<div class="modal-overlay" id="my-modal" role="dialog" aria-modal="true"
     aria-labelledby="modal-title">
    <div class="modal">
        <h2 id="modal-title">Title</h2>
    </div>
</div>

<!-- Buttons need accessible labels -->
<button aria-label="Close modal" class="modal-close">×</button>

<!-- Form fields need labels -->
<label for="email">Email</label>
<input type="email" id="email" name="email">
```

---

## Internationalization (i18n)

### How i18n Works

1. `i18n.js` auto-detects language (localStorage > browser > 'en')
2. Loads `/i18n/{lang}.json` translation file
3. Replaces content of all `[data-i18n]` elements
4. Fires `i18n:ready` event when complete
5. Fires `i18n:changed` event when language switches

### Using i18n in HTML

```html
<!-- Basic text replacement -->
<h1 data-i18n="page.title">Default English Text</h1>

<!-- Placeholder replacement -->
<input data-i18n-placeholder="form.email" placeholder="Enter email">

<!-- Attribute replacement -->
<button data-i18n="button.save" data-i18n-attr="title" title="Save changes">
    Save
</button>
```

### Using i18n in JavaScript

```javascript
// Get a translation
const text = I18n.t('page.title');

// With replacements
const greeting = I18n.t('messages.hello', { name: 'Jay' });
// "Hello {name}!" → "Hello Jay!"

// Get current language
const lang = I18n.getCurrentLanguage(); // 'en', 'es', etc.

// Listen for language changes
window.addEventListener('i18n:ready', () => {
    // i18n is loaded, can access translations
});

window.addEventListener('i18n:changed', () => {
    // User switched languages, update dynamic content
});
```

### Adding New Translations

**CRITICAL**: When adding new i18n keys, you MUST update ALL 8 language files:
- `en.json` (English)
- `es.json` (Spanish)
- `fr.json` (French)
- `de.json` (German)
- `it.json` (Italian)
- `pt.json` (Portuguese)
- `zh.json` (Chinese)
- `ar.json` (Arabic)

```json
// Example: Adding a new feature section
{
    "newFeature": {
        "title": "New Feature",
        "description": "Description of the feature",
        "buttonText": "Try It"
    }
}
```

### i18n Limitations

| Limitation | Workaround |
|------------|------------|
| No plural support | Use neutral phrasing ("Items: 5" not "5 items") |
| No date formatting | Dates stay in English/numeric format |
| No number formatting | Numbers stay as-is |
| Dynamic content not translated | Generate content in JS using `I18n.t()` |
| `textContent` replaces innerHTML | Don't nest elements inside `data-i18n` elements |

### The innerHTML Problem

**CRITICAL**: The i18n system uses `element.textContent = translation`, which destroys child elements.

```html
<!-- ❌ BROKEN: Child span will be destroyed -->
<span data-i18n="hero.title">
    One <span class="highlight">person</span>.
</span>

<!-- ✅ CORRECT: Separate the elements -->
<span id="title-container">
    One <span class="highlight" id="rotating-word">person</span>.
</span>
<!-- Then handle "One" and "." separately in JS using I18n.t() -->
```

---

## Data & Supabase

### Supabase Client

The Supabase client is initialized in `auth.js` and available globally:

```javascript
// Available everywhere after auth.js loads
const { data, error } = await supabase
    .from('table_name')
    .select('*')
    .eq('column', 'value');
```

### Common Query Patterns

```javascript
// Select with related data
const { data: projects } = await supabase
    .from('projects')
    .select('*, automations(count)')
    .eq('organization_id', orgId)
    .order('updated_at', { ascending: false });

// Insert
const { data, error } = await supabase
    .from('projects')
    .insert([{ name: 'New Project', organization_id: orgId }])
    .select()
    .single();

// Update
const { error } = await supabase
    .from('projects')
    .update({ name: 'Updated Name' })
    .eq('id', projectId);

// Delete
const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId);
```

### Error Handling

```javascript
// ✅ Good: Always handle errors
const { data, error } = await supabase.from('projects').select('*');
if (error) {
    console.error('Failed to load projects:', error);
    showErrorToast('Failed to load projects. Please try again.');
    return;
}

// ❌ Bad: Ignoring errors
const { data } = await supabase.from('projects').select('*');
renderProjects(data); // data might be null!
```

### Authentication Flow

```javascript
// Check if user is authenticated (redirects if not)
const user = await requireAuth();

// Get user profile with org membership
const profile = await getUserProfile(user.id);

// Sign out
await signOut();
```

---

## Common Pitfalls

### 1. Forgetting Cache Busting
```html
<!-- After modifying dashboard.js, MUST update version -->
<script src="dashboard.js?v=5"></script>  <!-- Change to ?v=6 -->
```

### 2. Adding i18n to Only One Language
```javascript
// ❌ Adding to en.json only will break other languages
// ✅ Always update all 8 language files
```

### 3. Nesting Elements Inside data-i18n
```html
<!-- ❌ Child elements will be destroyed -->
<span data-i18n="text">Hello <strong>world</strong></span>

<!-- ✅ Keep them separate -->
<span data-i18n="hello">Hello</span> <strong data-i18n="world">world</strong>
```

### 4. Not Using Event Delegation
```javascript
// ❌ Memory leak when content is re-rendered
cards.forEach(card => card.addEventListener('click', handler));

// ✅ Use event delegation on stable parent
container.addEventListener('click', (e) => {
    if (e.target.closest('.card')) handler(e);
});
```

### 5. Ignoring Supabase Errors
```javascript
// ❌ Will crash if error occurs
const { data } = await supabase.from('table').select('*');
data.forEach(item => /* ... */);

// ✅ Check error first
const { data, error } = await supabase.from('table').select('*');
if (error) { handleError(error); return; }
data.forEach(item => /* ... */);
```

### 6. Not Cleaning Up Modal State
```javascript
// ❌ Form keeps old values when reopened
openModal('edit-modal');

// ✅ Reset form when opening
function openEditModal(item) {
    document.getElementById('edit-form').reset();
    // Populate with item data
    openModal('edit-modal');
}
```

### 7. Hardcoding Colors/Sizes
```css
/* ❌ Inconsistent with design system */
.my-thing { background: #6366f1; border-radius: 12px; }

/* ✅ Use CSS variables */
.my-thing { background: var(--color-primary); border-radius: var(--radius-lg); }
```

---

## Adding New Features

### Checklist for New Pages

1. [ ] Create HTML file with proper structure
2. [ ] Create JS file following initialization pattern
3. [ ] Create CSS file (if needed) or use global styles
4. [ ] Add all text to i18n files (ALL 8 languages)
5. [ ] Add script tags in correct order
6. [ ] Add cache version to new JS files
7. [ ] Test in multiple languages
8. [ ] Test on mobile breakpoints
9. [ ] Test authentication flow (logged in/out)

### Checklist for New Components

1. [ ] Check if similar component exists (reuse!)
2. [ ] Use CSS variables for all colors/sizes
3. [ ] Add i18n attributes to all user-facing text
4. [ ] Use semantic HTML with ARIA attributes
5. [ ] Handle loading and error states
6. [ ] Use event delegation for dynamic content
7. [ ] Test RTL layout (Arabic)

### Checklist for i18n Changes

1. [ ] Update ALL 8 language files
2. [ ] Test language switcher
3. [ ] If using dynamic content, listen for `i18n:changed`
4. [ ] Don't nest elements inside `data-i18n` elements
5. [ ] Provide fallback text in HTML

---

## Technical Debt Tracker

### High Priority (Address Soon)

| Issue | Impact | Effort |
|-------|--------|--------|
| Duplicate `loadUserInfo()` in 5 files | Bug risk, maintenance | Medium |
| No error boundaries | Poor UX on failures | Medium |
| Missing ARIA attributes on modals | Accessibility compliance | Low |
| Some hardcoded colors in CSS | Design inconsistency | Low |

### Medium Priority (Plan For)

| Issue | Impact | Effort |
|-------|--------|--------|
| No type safety (TypeScript/JSDoc) | Bug risk at scale | High |
| No automated tests | Regression risk | High |
| N+1 queries on projects page | Performance | Medium |
| No caching layer | Unnecessary API calls | Medium |

### Low Priority (Nice to Have)

| Issue | Impact | Effort |
|-------|--------|--------|
| No service worker | No offline support | Medium |
| Sequential script loading | Slower page load | Medium |
| No code splitting | Larger initial load | High |

---

## Quick Reference

### File Versions to Update
When you modify these files, update their version in ALL HTML files that include them:

```
auth.js?v=2
celebrate.js?v=2
danger-modal.js?v=1
plan-limits.js?v=1
dashboard.js?v=5
project.js (check current)
script.js?v=3
```

### CSS Variable Cheatsheet
```
Colors:     --color-primary, --color-secondary, --color-accent
            --color-bg, --color-text, --color-border
            --color-error, --color-success, --color-warning

Shadows:    --shadow-xs, --shadow-sm, --shadow-md, --shadow-lg, --shadow-xl

Radii:      --radius-sm (8px), --radius-md (10px), --radius-lg (12px)
            --radius-xl (16px), --radius-2xl (24px), --radius-full

Transitions: --transition-fast (150ms), --transition-base (200ms)
             --transition-slow (300ms)
```

### i18n Languages
`en` `es` `fr` `de` `it` `pt` `zh` `ar`

---

*This document should be updated when architectural decisions are made or patterns change.*
