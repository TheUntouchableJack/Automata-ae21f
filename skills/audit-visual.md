# Skill: Visual QA Audit

## Overview

Visual quality assurance audit using **Playwright MCP** for automated browser testing. Captures screenshots, validates responsive layouts, tests i18n rendering, and verifies UI states across all app pages.

## Usage

```
/audit-visual              # Quick - Critical flows only (5-7 min)
/audit-visual full         # All 26 pages, all breakpoints (20-30 min)
/audit-visual journey      # Golden path - AI analyzer → signup → app creation → customer experience
/audit-visual [area]       # Targeted: auth, dashboard, customer-app, etc.
/audit-visual responsive   # All pages at 375/768/1024/1440px
/audit-visual i18n         # All pages in 8 languages (incl. RTL Arabic)
```

## When to Use

Invoke with `/audit-visual` when:
- After building new UI components or pages
- Before launch (visual regression baseline)
- When touching CSS/layout code
- After i18n translation updates
- When users report display issues
- As part of `/audit full` (comprehensive audit)

## Prerequisites

1. **Dev server running**: `npm run dev` (localhost:5173)
2. **Manual login first**: For dashboard pages, log in manually before running tests
3. **Browser available**: Playwright MCP must be configured

## Area Targeting

| Area | Pages Tested |
|------|--------------|
| `journey` | **Golden path**: landing AI → signup → dashboard → app builder → customer app |
| `auth` | login, signup |
| `dashboard` | dashboard, intelligence |
| `customer-app` | customer-app/index, customer-app/app |
| `app-builder` | app-builder (all 6 steps) |
| `settings` | settings, organization |
| `customers` | customers, outgoing |
| `automations` | automations, automation |
| `content` | roadmap, feature-requests, knowledgebase, faqs |
| `public` | index (landing), blog/index, blog/post |

## Test Configuration

### Breakpoints
```javascript
const BREAKPOINTS = {
  mobile: { width: 375, height: 812, label: 'Mobile' },
  tablet: { width: 768, height: 1024, label: 'Tablet' },
  desktop: { width: 1024, height: 768, label: 'Desktop' },
  wide: { width: 1440, height: 900, label: 'Wide' }
};
```

### Languages (i18n)
```javascript
const LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar'];
const RTL_LANGUAGES = ['ar'];  // Arabic needs special RTL checks
```

### Base URL
```javascript
const BASE_URL = 'http://localhost:5173';
```

## Audit Checklist

### Page Load Tests
```
[ ] Page loads without JavaScript errors (browser_console_messages)
[ ] All images load (no broken images)
[ ] CSS loads and applies correctly
[ ] i18n translations render (no missing [data-i18n] keys)
[ ] No console errors or warnings
```

### Responsive Layout Tests
```
[ ] No horizontal scroll at any breakpoint
[ ] Navigation accessible (hamburger on mobile)
[ ] Content readable (text not truncated unexpectedly)
[ ] Touch targets adequate on mobile (44x44px min)
[ ] Tables convert to cards or scroll on mobile
[ ] Modals fit within viewport
[ ] Forms usable on mobile
```

### i18n Tests
```
[ ] All [data-i18n] elements show translated text (not keys)
[ ] RTL layout correct for Arabic (dir="rtl")
[ ] Text direction changes appropriately
[ ] No text overflow from longer translations (German, French)
[ ] Language switcher works on all pages
[ ] Numbers and dates formatted per locale
```

### Component State Tests
```
[ ] Loading states visible during data fetch
[ ] Empty states render when no data
[ ] Error states display with retry option
[ ] Success states show feedback (toasts, confirmations)
[ ] Disabled states during form submission
[ ] Hover states on interactive elements
```

## Critical User Flows

### Flow 0: Golden Path Journey (Complete New User Experience)

The full end-to-end flow simulating a real user's first experience with Royalty.

**Invoke with:** `/audit-visual journey`

```
PHASE 1: Discovery (Landing Page AI Analyzer)
1. Navigate to landing page (/)
2. Screenshot: Hero section with constellation animation
3. Scroll to discovery card
4. Click to expand discovery card details
5. Type business description: "Coffee shop in downtown Seattle"
6. Screenshot: Discovery card with input
7. Click "See What AI Suggests" or equivalent CTA
8. Wait for AI recommendations to load
9. Screenshot: Recommendations section populated
10. Verify recommendation cards render with templates

PHASE 2: Template Selection & Signup
11. Click on a recommended template card
12. Screenshot: Template preview/selection
13. Click "Use This Template" or "Get Started"
14. Verify redirect to signup page
15. Screenshot: Signup form (pre-filled if template passes data)
16. Fill signup form:
    - First name, Last name
    - Email (use test+timestamp@example.com)
    - Password
17. Complete CAPTCHA if present
18. Click signup button
19. Screenshot: Success state / confirmation
20. Handle email confirmation flow (or auto-login in dev)

PHASE 3: Dashboard Onboarding
21. Verify redirect to dashboard
22. Screenshot: Dashboard first-time state
23. Check for onboarding prompts/modals
24. Screenshot: Any welcome modal or coaching tooltip
25. Verify sidebar navigation renders
26. Check metrics cards (may show zeros for new user)
27. Screenshot: Dashboard with initial metrics

PHASE 4: Create First Loyalty App
28. Navigate to App Builder (via CTA or sidebar)
29. Screenshot: App Builder Step 1
30. Enter app details:
    - Name: "Seattle Coffee Rewards"
    - Slug: auto-generated or custom
    - App type: Loyalty
31. Click Next → Step 2: Features
32. Screenshot: Feature toggles
33. Enable: Points, Tiers, Rewards, Referrals
34. Click Next → Step 3: Settings
35. Screenshot: Points configuration
36. Configure points per visit, tier thresholds
37. Click Next → Step 4: Branding
38. Screenshot: Color picker and branding
39. Select brand colors, upload logo (or skip)
40. Click Next → Step 5: Business Info
41. Screenshot: Business details form
42. Enter business name, description
43. Click Next → Step 6: Preview
44. Screenshot: Full customer app preview
45. Click "Publish App"
46. Screenshot: Success confirmation
47. Copy the customer app URL/slug

PHASE 5: Customer App Experience
48. Open new tab or navigate to customer app URL
49. Screenshot: Customer signup page with branding
50. Verify branding matches what was configured
51. Fill customer signup:
    - First name, Last name
    - Email
    - Phone (optional)
    - PIN (4-6 digits)
52. Click Join
53. Screenshot: Welcome screen with initial points
54. Verify welcome points badge shows
55. Navigate to Rewards tab
56. Screenshot: Rewards catalog
57. Navigate to Leaderboard tab
58. Screenshot: Leaderboard (may show just this user)
59. Navigate to Activity tab
60. Screenshot: Activity feed with signup event
61. Check profile/settings area
62. Screenshot: Customer profile

PHASE 6: Owner Views Customer
63. Switch back to owner dashboard
64. Navigate to Customers page
65. Screenshot: Customer list with new signup
66. Verify new customer appears
67. Navigate to Intelligence page
68. Screenshot: AI recommendations (may suggest actions for new customer)

PHASE 7: Mobile Verification
69. Resize to mobile (375px)
70. Navigate key pages and screenshot:
    - Landing page mobile
    - Customer app mobile
    - Dashboard mobile
71. Verify hamburger menu works
72. Verify customer app is mobile-optimized

TOTAL: ~72 interactions, ~25-30 screenshots
```

**Success Criteria:**
- [ ] AI analyzer accepts input and returns recommendations
- [ ] Template selection flows to signup
- [ ] Signup completes without errors
- [ ] Dashboard loads with correct initial state
- [ ] App Builder completes all 6 steps
- [ ] App publishes successfully
- [ ] Customer app reflects owner's branding
- [ ] Customer can signup and see points
- [ ] Owner can see new customer in dashboard
- [ ] Mobile layouts work throughout

---

### Flow 1: Landing to Signup to Dashboard (Quick)
```
1. Navigate to landing page (/)
2. Verify hero section renders
3. Click signup CTA
4. Fill signup form (name, email, password)
5. Verify redirect to dashboard
6. Capture dashboard initial state
```

### Flow 2: App Builder 6-Step Wizard
```
1. Navigate to /app/app-builder.html
2. Step 1: Enter app name, select type → screenshot
3. Step 2: Toggle features → screenshot
4. Step 3: Configure points/tiers → screenshot
5. Step 4: Set branding colors → screenshot
6. Step 5: Add business info → screenshot
7. Step 6: Preview → screenshot
8. Verify progress indicators work
9. Test back button navigation
```

### Flow 3: Customer App Journey
```
1. Navigate to /customer-app/index.html?slug=demo-app
2. Complete signup (name, email, PIN)
3. Verify welcome screen with initial points
4. Navigate tabs: Rewards, Leaderboard, Activity
5. Check tier progress display
6. Verify mobile layout
```

### Flow 4: AI Intelligence Flow
```
1. Navigate to /app/intelligence.html
2. Verify recommendation cards render
3. Check filter tabs work
4. Test "Implement" button interaction
5. Test "Dismiss" button interaction
6. Verify empty state if no recommendations
```

### Flow 5: Settings & Advanced Mode
```
1. Navigate to /app/settings.html
2. Switch tabs (Profile, Security, Team)
3. Toggle Advanced Mode
4. Verify sidebar navigation changes
5. Navigate to newly visible pages
6. Toggle back to Standard Mode
7. Verify sidebar reverts
```

## Playwright MCP Tools Used

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Load pages |
| `browser_resize` | Test different breakpoints |
| `browser_snapshot` | Accessibility tree analysis (better than screenshot for finding elements) |
| `browser_take_screenshot` | Visual captures for report |
| `browser_click` | User flow interactions |
| `browser_type` | Form input |
| `browser_fill_form` | Multiple form fields |
| `browser_evaluate` | i18n switching, trigger states |
| `browser_console_messages` | Check for JS errors |
| `browser_wait_for` | Wait for content to load |

## Execution Process

### Step 1: Verify Environment
```bash
# Ensure dev server is running
curl -s http://localhost:5173 > /dev/null && echo "Server ready"
```

### Step 2: Quick Mode Tests
For `/audit-visual` (quick mode):

1. Landing page at desktop breakpoint
2. Login page at mobile + desktop
3. Dashboard at mobile + desktop
4. Customer app signup + dashboard
5. App Builder step 1 + step 6 (preview)
6. Console errors check on each page

### Step 3: Full Mode Tests
For `/audit-visual full`:

All 26 pages × 4 breakpoints = 104 screenshots + state tests

### Step 4: Capture Screenshots

Screenshot naming convention:
```
.playwright-mcp/screenshots/{timestamp}/
├── page-load/
│   ├── landing-desktop-en.png
│   ├── landing-mobile-en.png
│   └── ...
├── responsive/
│   ├── dashboard-375.png
│   ├── dashboard-768.png
│   └── ...
├── i18n/
│   ├── landing-ar.png (RTL)
│   └── ...
├── flows/
│   ├── signup-step1.png
│   └── ...
├── states/
│   ├── customers-empty.png
│   └── ...
└── findings/
    ├── issue-001-overflow.png
    └── ...
```

## Output Format

```markdown
# Visual QA Audit Report

**Generated:** {timestamp}
**Coverage Mode:** {quick|full|targeted}
**Pages Tested:** X
**Screenshots Captured:** X

---

## Executive Summary

### Visual Health Score: X/10

| Category | Passed | Failed | Warnings |
|----------|--------|--------|----------|
| Page Load | X | X | X |
| Responsive | X | X | X |
| i18n | X | X | X |
| States | X | X | X |
| Flows | X | X | X |

---

## Critical Issues (Fix Immediately)

### 1. [RESPONSIVE] Horizontal scroll on Customers page at 375px
**Screenshot:** `findings/issue-001-customers-overflow.png`
**Breakpoint:** Mobile (375px)
**Element:** `.customers-table`
**Expected:** Table converts to cards or horizontal scroll contained
**Actual:** Page-level horizontal scroll appears
**Fix:** Add `overflow-x: auto` to table container or use responsive card pattern

---

### 2. [I18N] Missing translation key on Dashboard
**Screenshot:** `findings/issue-002-missing-i18n.png`
**Language:** All
**Element:** `[data-i18n="dashboard.newMetric"]`
**Expected:** Translated text
**Actual:** Shows raw key "dashboard.newMetric"
**Fix:** Add key to all 8 language files in i18n/

---

## High Priority (Fix Before Merge)

### 3. [STATE] Missing empty state on Automations page
**Screenshot:** `states/automations-empty.png`
**Condition:** No automations exist
**Expected:** Empty state with CTA to create first automation
**Actual:** Blank content area
**Fix:** Add empty state render in automations.js

---

## Medium Priority (Fix This Sprint)

### 4. [A11Y] Low contrast on metric labels
**Screenshot:** `findings/issue-004-contrast.png`
**Element:** `.metric-label`
**Current Ratio:** 2.8:1
**Required:** 4.5:1 (WCAG AA)
**Fix:** Change color from #999 to #666 or darker

---

## Passed Checks

### Page Load
- [x] Landing page loads without JS errors
- [x] Dashboard loads without JS errors
- [x] All images load successfully
- [x] CSS applies correctly

### Responsive
- [x] Landing page readable at 375px
- [x] Navigation collapses to hamburger on mobile
- [x] Touch targets meet 44x44px minimum
- [x] No horizontal scroll on login page

### i18n
- [x] Arabic renders RTL correctly
- [x] Language switcher functions
- [x] No overflow from German translations
- [x] Chinese characters render correctly

### User Flows
- [x] Signup flow completes successfully
- [x] Customer app signup flow works
- [x] App Builder wizard navigates all steps
- [x] Settings toggle Advanced Mode works

---

## Screenshots Index

| File | Description | Status |
|------|-------------|--------|
| `page-load/landing-desktop-en.png` | Landing page baseline | OK |
| `page-load/dashboard-desktop-en.png` | Dashboard baseline | OK |
| `responsive/customers-375.png` | Customers mobile view | ISSUE |
| `i18n/landing-ar.png` | Landing Arabic RTL | OK |
| `flows/signup-complete.png` | Signup success | OK |

---

## Recommendations

1. **Add responsive table component** - Several pages have tables that overflow on mobile
2. **Audit all i18n keys** - Run `node scripts/check-i18n.js` to find missing translations
3. **Create reusable empty state component** - Inconsistent empty states across pages
4. **Review color palette** - Some grays below WCAG contrast requirements

---

## Re-test Commands

After fixing issues, re-run targeted audit:
```
/audit-visual responsive  # Re-check responsive issues
/audit-visual i18n        # Re-check translations
/audit-visual customers   # Re-check specific area
```
```

## Pages Inventory (26 Total)

### Public Pages (5)
| Page | URL | Priority |
|------|-----|----------|
| Landing | `/` | Critical |
| Login | `/app/login.html` | Critical |
| Signup | `/app/signup.html` | Critical |
| Blog Index | `/blog/index.html` | Medium |
| Blog Post | `/blog/post.html` | Medium |

### Dashboard Pages (19)
| Page | URL | Priority |
|------|-----|----------|
| Dashboard | `/app/dashboard.html` | Critical |
| Intelligence | `/app/intelligence.html` | High |
| Apps | `/app/apps.html` | High |
| App Builder | `/app/app-builder.html` | Critical |
| Automations | `/app/automations.html` | High |
| Automation | `/app/automation.html` | Medium |
| Customers | `/app/customers.html` | High |
| Outgoing | `/app/outgoing.html` | Medium |
| Roadmap | `/app/roadmap.html` | Medium |
| Feature Requests | `/app/feature-requests.html` | Low |
| Organization | `/app/organization.html` | Medium |
| Settings | `/app/settings.html` | High |
| Content Generator | `/app/content-generator.html` | Low |
| Project | `/app/project.html` | Low |
| Launch Plan | `/app/launch-plan.html` | Low |
| Redeem | `/app/redeem.html` | Medium |
| Support | `/app/support.html` | Medium |
| FAQs | `/app/faqs.html` | Low |
| Knowledgebase | `/app/knowledgebase.html` | Low |

### Customer App Pages (2)
| Page | URL | Priority |
|------|-----|----------|
| Customer Signup | `/customer-app/index.html?slug=demo` | Critical |
| Customer Dashboard | `/customer-app/app.html` | Critical |

## Edge Cases to Test

### Empty States
| Page | Trigger | Expected |
|------|---------|----------|
| Customers | No customers | "No customers yet" + Add button |
| Automations | No automations | "Create your first automation" CTA |
| Intelligence | No recommendations | "All caught up!" message |
| Apps | No apps | "Create your first app" CTA |
| Outgoing | No messages | "No messages sent yet" |

### Error States
| Scenario | Trigger | Expected |
|----------|---------|----------|
| Network error | Disconnect network | "Connection lost" toast |
| 404 | Invalid app slug | "App not found" page |
| Auth expired | Session timeout | Redirect to login |
| API error | Supabase returns error | Error toast with retry |

### Loading States
| Page | Element | Expected |
|------|---------|----------|
| Dashboard | Metrics cards | Skeleton loader or spinner |
| Customers | Customer list | Spinner or skeleton rows |
| Intelligence | Recommendations | Card skeleton |
| Leaderboard | Rankings | Shimmer animation |

## Common Visual Bugs in This Codebase

Based on patterns observed:

1. **Table overflow on mobile** - Tables in customers.js, automations.js need responsive patterns
2. **Modal z-index conflicts** - Multiple modals can layer incorrectly
3. **Sidebar collapse** - Mobile hamburger menu inconsistent across pages
4. **i18n text overflow** - German/French translations often 20-30% longer than English
5. **RTL alignment** - Some icons don't flip correctly for Arabic
6. **Focus states** - Some custom buttons missing visible focus ring
7. **Empty states** - Many pages lack proper empty state design

## Quick Visual Test Checklist

Before any deploy, visually verify:

```
[ ] Landing page hero renders correctly
[ ] Login form centered and styled
[ ] Dashboard metrics display values
[ ] Sidebar navigation functional
[ ] Customer app signup works
[ ] Mobile navigation accessible (hamburger)
[ ] Arabic RTL renders correctly
[ ] No console errors on any page
```

## Integration with Master Audit

When changed files include:
- `*.css` files → Include visual audit (responsive, layout)
- `*.html` files → Include visual audit (structure, content)
- `i18n/*.json` files → Include i18n visual tests
- `customer-app/*` → Include customer app visual tests
- `app/sidebar.*` → Test navigation at all breakpoints

For `/audit full`, Visual perspective runs as one of 10 audit perspectives.
