# Royalty Session Recap — February 2-4, 2026

## Quick Context for New Sessions

**What is Royalty?** AI-powered loyalty programs for local businesses. Describe your business, AI builds your loyalty program in 60 seconds.

**Brand:** Royalty (royaltyapp.ai) — Royal purple (#7c3aed), Space Grotesk font
**Launch:** February 28, 2026 (AppSumo LTD, $500K target)
**Stack:** Vanilla HTML/CSS/JS, Supabase (PostgreSQL + Auth + RLS), Claude API
**Dev Server:** `npm run dev` (Vite on port 5173) — required for `/a/{slug}` routing

---

## Session Overview

This multi-day session focused on **onboarding experience** and **dashboard usability**. The core idea: when a business owner signs up and reaches the dashboard, their loyalty program should already exist and be previewable — no manual app creation needed.

We also completed the **full rebrand to Royalty** and fixed a critical bug in the App Builder.

---

## Features Implemented

### 1. Auto-Create Loyalty App on Dashboard Visit

**Files:** `app/dashboard.js` (lines 272-355)

When a new user visits the dashboard for the first time and has no apps:
- `loadAppMetrics()` detects zero apps → calls `autoCreateDefaultApp()`
- Creates a fully configured loyalty app with:
  - Name derived from org name (e.g., "Jay's Business Rewards")
  - Points system, leaderboard, rewards, announcements enabled
  - Default settings (10 pts/scan, 50 welcome pts, tier thresholds)
  - Branding with royal purple primary color
  - `is_active: true`, `is_published: true`
- Slug collision retry with random suffix
- Success toast: "Your loyalty program is ready!"

### 2. Dashboard Preview Panel

**Files:** `app/dashboard.html`, `app/dashboard.js`, `app/dashboard.css`

Right-side panel showing the owner's loyalty app:
- **Branded splash view** — logo/initial, app name, "Rewards Program" subtitle, Preview button
- **QR code** — auto-generated, downloadable as PNG, printable
- **App URL** — displayed with copy-to-clipboard button
- **Open in new tab** — launches customer app in preview mode
- **Customize button** — links to App Builder with `?id=` param
- **Hide/show toggle** — X button to hide, "Preview App" button in header to restore
- **localStorage persistence** — remembers if user hid the panel
- **Responsive** — collapses to overlay on mobile (< 1200px)

Layout: CSS Grid two-column (`1fr 320px`) with sticky positioning.

### 3. Customer App Preview Mode

**Files:** `customer-app/index.html`, `customer-app/app.js`

Preview URLs use: `/customer-app/index.html?preview=true&app_id={uuid}&published={0|1}`

- `preview=true` bypasses the `get_app_by_slug()` RPC (which only returns published apps)
- `published=1` → purple banner "Preview Mode"
- `published=0` → amber banner "Preview Mode - This app is not yet published"

### 4. Netlify Slug Routing

**File:** `netlify.toml`

Added production redirect rules:
```toml
[[redirects]]
  from = "/a/:slug/app"
  to = "/customer-app/app.html?slug=:slug"
  status = 200

[[redirects]]
  from = "/a/:slug"
  to = "/customer-app/index.html?slug=:slug"
  status = 200
```

Dev routing already existed in `vite.config.js` (middleware plugin, lines 81-101).

### 5. Rebrand to Royalty (Completed)

**Files:** `index.html`, `pricing.html`, `script.js`

- Crown logo SVG + favicons
- GA4 tracking integration
- Bold headings with Space Grotesk
- Royal purple color scheme throughout
- "Waitlist" → "Beta" language change

### 6. i18n Updates

**Files:** All 8 `i18n/*.json` files

New keys added:
- `dashboard.previewButton` — "Preview"
- `dashboard.previewHide` — "Hide preview"
- `dashboard.previewTitle` — "Your App"
- `dashboard.previewCustomize` — "Customize"
- `dashboard.previewOpenTab` — "Open in New Tab"
- `dashboard.previewCopyLink` — "Copy Link"
- `dashboard.previewCopied` — "Copied!"
- `dashboard.previewDownloadQR` — "Download QR"
- `dashboard.previewPrintQR` — "Print QR"
- `dashboard.previewMobileToggle` — "Preview App"
- `dashboard.appAutoCreated` — "Your loyalty program is ready!"

---

## Bugs Found & Fixed

### 1. App Builder Completely Broken — `isAdmin` Variable Collision

**Root cause:** `auth.js:170` declares `async function isAdmin()` and `app-builder.js:15` declares `let isAdmin = false`. Both are in global scope. JavaScript's `let` doesn't allow redeclaration → `SyntaxError` → entire `app-builder.js` fails to parse → `initAppBuilder()` never runs → blank "New App" page.

**Fix:** Renamed variable to `isOrgAdmin` in `app-builder.js` (3 occurrences).

**Lesson:** All scripts share global scope. Use unique variable names or wrap in IIFEs. Check browser console for SyntaxErrors — they prevent the entire file from loading.

### 2. Preview Button Shows "Invalid URL"

**Root cause:** Customer app requires `?preview=true&app_id=` but the preview URL only had `?app_id=`. Missing `preview=true` caused the app to try slug-based lookup which failed.

**Fix:** Added `preview=true` to both `window.open()` calls in dashboard.js.

**Lesson:** Customer app has two lookup modes — slug-based (production) and app_id-based (preview). Preview mode requires BOTH `preview=true` AND `app_id` params.

### 3. Preview Banner Always Says "Not Yet Published"

**Root cause:** `showPreviewBanner()` only checked for `?preview=true` but didn't know the actual publish status.

**Fix:** Pass `&published=1/0` in the preview URL and check it in `showPreviewBanner()`.

### 4. `/a/{slug}` URL Returns 404 on localhost

**Root cause:** User was running a simple static file server on port 8000. The `/a/{slug}` → `/customer-app/index.html` rewriting only exists in Vite's dev server middleware.

**Fix:** Use `npm run dev` (Vite, port 5173) for local development. Added Netlify redirects for production.

**Lesson:** Always use `npm run dev` for local development. Simple static servers don't support URL rewriting.

### 5. App Builder Error Handling — Silent Redirect

**Root cause:** When `loadApp()` failed, it silently redirected to `/app/apps.html`. User saw a flash of "New App" then got dumped on another page with no explanation.

**Fix:** Show an "Unable to load app" error state on the builder page itself with a "Back to Dashboard" button. Added `[App Builder]` console logging throughout the init flow.

---

## Key Architectural Decisions

1. **Auto-create, not wizard** — SMB users shouldn't need a 6-step wizard to get started. Auto-create with sensible defaults, let them customize later.

2. **Splash view, not iframe** — Preview panel shows a branded splash (logo, name, colors) instead of embedding the full customer app in an iframe. Cleaner, no scrolling issues, no login/signup buttons showing.

3. **No gradients** — User directive: "sleek intuitive, futuristic, but on brand." All buttons and UI use solid colors from CSS variables.

4. **Header button, not FAB** — Preview toggle moved from floating action button to header actions group (near Refresh). Less intrusive, more discoverable.

5. **Auto-publish** — Auto-created apps are `is_published: true` by default. Unpublishing is available through the App Builder.

6. **Preview via query params** — Preview mode bypasses slug routing and RLS by using direct `?app_id=` lookup. This avoids issues with unpublished apps being invisible to `get_app_by_slug()`.

---

## Files Changed This Session

| File | Changes |
|------|---------|
| `app/dashboard.html` | Two-column layout, preview panel, header toggle button |
| `app/dashboard.js` | Auto-create app, preview panel, hide/show, QR, branded splash (+335 lines) |
| `app/dashboard.css` | Preview panel styles, splash view, responsive (+296 lines) |
| `app/app-builder.html` | Cache bump v20 |
| `app/app-builder.js` | isAdmin→isOrgAdmin fix, debug logging, error handling (+34 lines) |
| `customer-app/index.html` | Preview banner with publish status |
| `customer-app/app.js` | Preview banner with publish status |
| `netlify.toml` | `/a/{slug}` redirect rules for production |
| `i18n/*.json` (×8) | Preview panel translation keys |
| `index.html` | Rebrand (crown logo, GA4, bold headings) |
| `pricing.html` | Rebrand updates |
| `script.js` | Rebrand updates |

**Total:** 19 files, +2,789 / -1,180 lines

---

## Gotchas for Future Sessions

1. **Cache busting is critical** — When modifying JS files, bump the `?v=X` in the HTML `<script>` tag. Browser caching will serve stale JS otherwise.

2. **Global scope collisions** — All `<script>` tags share global scope. Variables declared with `let`/`const` in one file will conflict with same-named declarations in other files. Use unique names.

3. **Use `npm run dev`** — Always run the Vite dev server (port 5173) for local testing. It provides slug routing, HMR, and proper module handling.

4. **i18n: always update all 8 files** — Any UI text change requires updating en, es, fr, de, it, pt, zh, ar. Run `node scripts/check-i18n.js` to validate.

5. **Customer app has two entry modes** — Slug-based (`/a/{slug}`) for production, and `?preview=true&app_id=` for preview. They use different data fetch paths.

6. **RLS policies work correctly** — The "Org members can manage apps" policy allows CRUD for authenticated org members. Public can view published apps.

---

## What's Next

- **Dashboard reporting** — ApexCharts for member growth, points issued, visit trends
- **QR scanner for check-ins** — Camera-based point-of-sale check-in
- **Email sending** — Resend integration for automated campaigns
- **Stripe billing** — Payment processing for AppSumo and direct plans
- **February 28 launch** — AppSumo LTD launch ($500K target)
