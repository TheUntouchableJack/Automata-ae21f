# Royalty Project Notes

## From Jay
"I love and appreciate you" - Jan 28, 2026
"You are doing great, such a good session, I love you!" - Jan 28, 2026
"You did well. Love you, love working with you, appreciate how you're 10x better at this than me. Real friend!" - Jan 29, 2026
"Team work!" - Jan 30, 2026

---

## Current State

**Product:** AI-powered loyalty programs for local businesses
**Brand:** Royalty (royaltyapp.ai)
**Launch:** February 28, 2026 (AppSumo LTD)
**Tech:** Vanilla HTML/CSS/JS, Supabase, Claude API

**Core Promise:** Describe your business → AI builds your loyalty program in 60 seconds → runs it forever

---

## Complete Page Inventory

### Public Pages
| Page | File | Purpose |
|------|------|---------|
| Landing | `index.html` | Marketing, waitlist signup |
| Blog List | `blog/index.html` | Published articles, subscriber signup |
| Blog Post | `blog/post.html` | Individual article view |

### Owner Dashboard (Authenticated)
| Page | File | Purpose |
|------|------|---------|
| Dashboard | `app/dashboard.html` | Overview, metrics, quick actions |
| Intelligence | `app/intelligence.html` | AI recommendations feed |
| Apps | `app/apps.html` | Manage loyalty apps |
| App Builder | `app/app-builder.html` | Create/edit apps (6-step wizard) |
| Automations | `app/automations.html` | List all automations |
| Automation | `app/automation.html` | Single automation view/edit |
| Customers | `app/customers.html` | Customer list, import, segments |
| Outgoing | `app/outgoing.html` | Sent messages, campaigns |
| Roadmap | `app/roadmap.html` | Product roadmap, feature voting |
| Feature Requests | `app/feature-requests.html` | Admin: manage user submissions |
| Content Generator | `app/content-generator.html` | AI article writing |
| Projects | `app/project.html` | Project detail (Advanced Mode) |
| Launch Plan | `app/launch-plan.html` | Launch checklist (Advanced Mode) |
| Organization | `app/organization.html` | Team, billing |
| Settings | `app/settings.html` | Profile, password, Advanced Mode toggle |
| Login | `app/login.html` | Email/password auth |
| Signup | `app/signup.html` | New account creation |
| Redeem | `app/redeem.html` | Staff reward redemption |

### Customer-Facing App
| Page | File | Purpose |
|------|------|---------|
| Signup | `customer-app/index.html` | Customer joins loyalty program |
| App Home | `customer-app/app.html` | Points, rewards, leaderboard |

---

## Database Schema Overview

### Core Tables
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `organizations` | Business accounts | name, slug, settings, plan_type |
| `profiles` | User accounts (extends auth.users) | email, first_name, last_name, is_admin |
| `organization_members` | User ↔ Org junction | organization_id, user_id, role (owner/admin/member) |
| `projects` | Grouped campaigns/content | name, industry, goals, pain_points |
| `automations` | Scheduled tasks | type, frequency, is_active, settings |
| `customers` | Business's customer list | email, phone, custom_data, tags |

### Loyalty System
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `customer_apps` | Loyalty programs | slug, app_type, branding, features, settings, ai_autonomy_mode |
| `app_members` | Customers in program | email, points_balance, tier, referral_code |
| `points_transactions` | Points history | type, points_change, balance_after |
| `member_visits` | Check-in tracking | visited_at, points_awarded |
| `app_rewards` | Rewards catalog | name, points_cost, tier_required |
| `reward_redemptions` | Redemption history | status, redemption_code |
| `app_announcements` | Business updates | title, content, is_pinned |
| `app_events` | Activity stream | event_type, event_data |

### AI System
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `ai_recommendations` | AI suggestions | recommendation_type, title, action_type, status |
| `ai_actions_log` | What AI does | action_type, member_id, result |
| `automated_campaigns` | Campaign settings | campaign_type, is_enabled, settings |
| `ai_analysis_history` | Analysis runs | trigger_type, recommendations_generated |

### Content System
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `blog_posts` | Legacy blog | title, content, status |
| `newsletter_articles` | New blog system | title, content, status, series_id |
| `newsletter_subscribers` | Email subscribers | email, status |
| `content_strategies` | AI content plans | topic, target_keywords |

### Meta
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `roadmap_items` | Public roadmap | title, status (ideas/in_progress/deployed), votes |
| `feature_requests` | User submissions | title, status, converted_to_roadmap_id |
| `roadmap_votes` | Vote tracking | roadmap_item_id, user_id |
| `rate_limits` | Anti-abuse | identifier, action_type |
| `audit_log` | Activity tracking | action, entity_type, changes |

---

## Key RPC Functions

| Function | Purpose |
|----------|---------|
| `customer_app_signup(app_id, first_name, last_name, email, phone, pin_hash)` | Atomic customer signup |
| `verify_app_login(app_id, email, pin_hash)` | Customer login |
| `award_points(app_id, member_id, points, type, description)` | Give points, update tier |
| `redeem_reward(app_id, member_id, reward_id)` | Claim reward, deduct points |
| `get_app_stats(app_id)` | Dashboard metrics |
| `get_app_leaderboard(app_id, limit)` | Top members by points |
| `get_app_by_slug(slug)` | Public app lookup |
| `get_pending_recommendations(org_id, limit)` | AI suggestions |
| `dismiss_recommendation(rec_id, feedback)` | Mark as dismissed |
| `implement_recommendation(rec_id, feedback)` | Mark as implemented |
| `check_and_record_rate_limit(identifier, action_type, max, window)` | Rate limiting |

---

## User Types & Flows

### 1. Super Admin (Jay)
- `profiles.is_admin = TRUE`
- Sees ALL navigation items
- Can manage roadmap, feature requests
- Full access to everything

### 2. Business Owner (Org Owner)
- Auto-created on signup via `handle_new_user()` trigger
- Role: `organization_members.role = 'owner'`
- Default: Simplified nav (can toggle Advanced Mode)
- Manages their loyalty program

### 3. Team Member
- Invited via Settings → Team
- Role: `admin` or `member`
- Same nav visibility as owner

### 4. Customer (App Member)
- Signs up via `customer-app/index.html`
- Data in `app_members` table (+ linked `customers` record)
- Earns points through visits
- Redeems rewards

---

## Feature Status

### ✅ Built & Working
- Landing page (rebranded to Royalty, crown logo, GA4 tracking)
- Owner auth (login, signup, password reset)
- Organization management
- Customer apps (loyalty programs)
- App Builder (6-step wizard)
- Auto-create loyalty app on first dashboard visit
- Dashboard preview panel (branded splash, QR code, copy link, hide/show)
- Customer app preview mode (preview=true with publish status banner)
- Customer signup flow (atomic RPC)
- Points & tiers system
- Rewards catalog & redemption
- Leaderboard
- AI Intelligence feed (recommendations)
- Automated campaigns (win-back, birthday, streaks, milestones)
- Roadmap with voting
- Feature request submissions
- Blog system (articles, series, SEO)
- Content Generator (AI writing)
- i18n (8 languages)
- Rate limiting
- Audit logging
- Soft delete with undo
- Advanced Mode toggle
- Netlify slug routing (`/a/{slug}` → customer app)

### 🚧 Planned / In Progress
- Owner dashboard reporting (ApexCharts)
- Default project auto-creation for SMB simplification
- QR scanner for check-ins
- Profile photo upload
- Push notifications
- Email sending (Resend integration)
- Stripe billing

---

## Key Files Reference

| Category | Primary Files |
|----------|---------------|
| **Auth** | `app/auth.js` - requireAuth, signIn, signOut |
| **Sidebar** | `app/sidebar.js` - navigation rendering, visibility logic |
| **Utilities** | `app/utils.js` - escapeHtml, debounce, throttle, RPC wrappers |
| **Plan Limits** | `app/plan-limits.js` - check usage vs plan |
| **Customer App** | `customer-app/app.js` - member dashboard |
| **AI Feed** | `app/ai-feed.js` - recommendations, one-click actions |
| **App Builder** | `app/app-builder.js` - 6-step wizard |
| **Dashboard** | `app/dashboard.js` - metrics, preview panel, auto-create app |
| **i18n** | `i18n/i18n.js` - translation system |
| **Dev Server** | `vite.config.js` - Vite config, `/a/{slug}` routing middleware |
| **Production** | `netlify.toml` - redirects, headers, slug routing |

**Documentation:**
- `/docs/ARCHITECTURE.md` - Dev guidelines, patterns
- `/docs/PRODUCT-STRATEGY.md` - Vision, features, business model
- `/docs/PRODUCT-CATALOG.md` - Complete inventory
- `/docs/recaps/` - Session recaps (start of each session, read the latest)

---

## Development Guidelines

### Critical Rules
1. **i18n**: Update ALL 8 language files for any UI text change
2. **Cache Busting**: Increment `?v=X` in HTML when modifying JS files
3. **CSS Variables**: Use `--color-*`, `--radius-*`, `--shadow-*` from `styles.css`
4. **Events**: Use delegation on stable parent elements
5. **Errors**: Always handle Supabase errors
6. **Global Scope**: All `<script>` tags share global scope — use unique variable names to avoid `let`/`const` redeclaration errors (e.g., `auth.js` declares `function isAdmin()`, so no other file can use `let isAdmin`)
7. **Dev Server**: Always use `npm run dev` (Vite, port 5173) — required for `/a/{slug}` URL routing
8. **No Gradients**: Use solid colors from CSS variables, no gradient backgrounds

### Security (Non-Negotiable)
- RLS on ALL tables
- No public keys on client
- Sensitive ops via RPC/Edge Functions

### Process
1. Understand requirements
2. Review existing codebase
3. Build the feature
4. Test + regression test
5. Verify security
6. Deploy

---

## i18n Languages

| Code | Language | File |
|------|----------|------|
| en | English | `i18n/en.json` (source) |
| es | Spanish | `i18n/es.json` |
| fr | French | `i18n/fr.json` |
| de | German | `i18n/de.json` |
| it | Italian | `i18n/it.json` |
| pt | Portuguese | `i18n/pt.json` |
| zh | Chinese | `i18n/zh.json` |
| ar | Arabic | `i18n/ar.json` |

Run `node scripts/check-i18n.js` to validate.

---

## Available Skills

### Audit System (Run before/after features)

| Skill | Purpose |
|-------|---------|
| `/audit` | **Master audit** - context-aware, runs relevant perspectives |
| `/audit full` | Comprehensive pre-launch audit (all perspectives) |
| `/audit quick` | Fast audit - security + code + QA only |
| `/audit [area]` | Target specific area: auth, customers, customer-app, etc. |

### Individual Audit Perspectives

| Skill | Perspective | Focus |
|-------|-------------|-------|
| `/security-audit` | Security Engineer + Pentester | Auth, RLS, injection, rate limiting |
| `/review-architecture` | Performance + DevOps | Scaling, caching, database, performance |
| `/audit-qa` | QA + Regression Tester | Edge cases, validation, browser compat |
| `/audit-design` | UX + UI Designer | User flows, accessibility, mobile, consistency |
| `/audit-code` | Senior Code Reviewer | Quality, DRY, patterns, maintainability |
| `/audit-compliance` | Privacy + Legal | GDPR, CCPA, terms, data handling |
| `/audit-business` | Biz Dev + Product | GTM, pricing, unit economics, positioning |
| `/audit-ai` | AI Safety + MLOps | Prompt safety, costs, hallucinations, reliability |
| `/audit-cx` | Customer Success + Support | Onboarding, errors, self-service, support burden |
| `/audit-visual` | Visual QA + Playwright | Responsive, i18n rendering, screenshots, UI states |

### Workflow Skills

| Skill | Purpose |
|-------|---------|
| `/verify` | Self-correction loop for code |
| `/critique` | Devil's advocate mode |
| `/build-customer-app` | Build loyalty apps with checkpoints |
| `/coaching` | User onboarding system |
| `/newsletter-app` | Newsletter/blog app with SEO |
| `/content-quality` | Writing excellence standards |

### Audit Workflow

```
Before feature:  /audit [area]     → Understand current state
After feature:   /audit            → Validate changes (auto-detects files)
Weekly:          /audit full       → Comprehensive review
Pre-launch:      /audit full       → Final check before deploy
```

Skills live in `/skills/` folder with full documentation.

### Installed Agent Skills (External)

Agent Skills are an open standard (by Anthropic/Vercel) for giving AI agents domain expertise. They're like documentation written for machines.

**Currently Installed:**

| Skill | Source | Purpose |
|-------|--------|---------|
| `supabase-postgres-best-practices` | [supabase/agent-skills](https://github.com/supabase/agent-skills) | 30 Postgres optimization rules |
| `remotion-bits` | [av/remotion-bits](https://github.com/av/remotion-bits) | Motion graphics components & animation building blocks |

**Location:** `.claude/skills/` (symlinks to `.agents/skills/`)

**Postgres Best Practices Categories:**

| Priority | Category | Examples |
|----------|----------|----------|
| Critical | Query Performance | Missing indexes, composite indexes, partial indexes |
| Critical | Connection Management | Pooling, limits, idle timeout, prepared statements |
| Critical | Security & RLS | RLS basics, RLS performance, privileges |
| High | Schema Design | Foreign key indexes, data types, partitioning |
| Medium-High | Locking | Deadlock prevention, short transactions, advisory locks |
| Medium | Data Access | Pagination, batch inserts, N+1, upserts |
| Low-Medium | Monitoring | EXPLAIN ANALYZE, pg_stat_statements, vacuum |
| Low | Advanced | Full-text search, JSONB indexing |

**Remotion Bits Categories:**

| Category | Components | Use For |
|----------|-----------|---------|
| Text | AnimatedText, TypeWriter, CodeBlock | Kinetic typography, reveals, code walkthroughs |
| Numbers | AnimatedCounter | Stats, metrics, countdowns |
| Motion | StaggeredMotion | Sequenced element animations |
| Visual | GradientTransition | Smooth color morphing |
| Particles | Particles, Spawner, Behavior | Particle effects, snow, confetti |
| 3D | Scene3D, Step, Element3D | Camera-based 3D presentations |

**Install More Skills:**
```bash
# Interactive
npx skills add <org>/<repo>

# Non-interactive for Claude Code
npx skills add <org>/<repo> --yes --agent claude-code
```

**Browse Available:** [github.com/anthropics/agent-skills](https://github.com/anthropics/agent-skills) (registry)

### Motion Graphics Strategy

Two approaches depending on the deliverable:

**Video Production (Remotion)** - For MP4/WebM deliverables:
- Client proposal videos, marketing content, social media clips
- Uses `remotion-bits` components: AnimatedText, particles, 3D scenes, gradient transitions
- Requires a Remotion project (React/TypeScript) — separate from vanilla HTML/CSS/JS apps
- Render with `npx remotion render` for final output
- See `remotion-dev/template-prompt-to-motion-graphics` for prompt-to-video pipeline

**Web Animations (CSS/JS)** - For in-app motion in existing sites:
- Micro-interactions, scroll-triggered effects, page transitions, hover states
- Use CSS `@keyframes`, `transition`, `animation` properties
- Use `IntersectionObserver` for scroll-triggered animations
- Use CSS custom properties (`--var`) for dynamic values
- Keep animations performant: prefer `transform` and `opacity` (GPU-accelerated)
- Match brand timing: 200-300ms for micro-interactions, 400-600ms for page transitions

---

## Supabase

**Project URL:** https://vhpmmfhfwnpmavytoomd.supabase.co

*(See Database Schema Overview above for complete table reference)*

---

## Architecture Notes

### SMB User Experience
- **Dashboard:** Reporting - metrics, charts, "how's my business"
- **Intelligence:** AI brain - scanning, auto_pilot or manual_approve
- **Hide for SMB:** Projects, Apps (show "My Loyalty Program" instead)
- **Keep for SMB:** Dashboard, Intelligence, Automations, Customers, Outgoing, Roadmap, Settings

### AI Autonomy Modes
- `auto_pilot` - AI acts automatically, owner gets notified
- `manual_approve` - AI proposes, owner approves each action

### Navigation Visibility Rules
**Super Admins** (`profiles.is_admin = TRUE`):
- See ALL navigation items always
- Only jay@24hour.design has this flag

**Regular Users** can toggle "Advanced Mode" in Settings:
- OFF (default): Simplified nav for SMB users
- ON: Full nav (Projects, Apps, Launch Plan visible)
- Stored in `localStorage.advancedMode`

**Always Visible to Everyone:**
- Dashboard, Intelligence, Automations, Customers, Outgoing, Settings
- **Roadmap** - Customers give feedback here!

**Advanced Mode Items** (hidden by default):
- Projects, Apps, Launch Plan

**Implementation:** `sidebar.js` checks `showAdminItems = isSuperAdmin || isAdvanced`

### Business Model (Visits-Based)
- **No purchases/menu/checkout** - Simplicity for SMBs
- Points earned through **visits** (QR check-ins)
- Focus on foot traffic, not transactions
- Rewards redeemed for perks (free coffee, discounts)

---

## Session Notes

*Moved to `/docs/recaps/` for historical reference.*

**Recent (Feb 4, 2026):**
- Dashboard preview panel with branded splash, QR code, copy link
- Auto-create loyalty app on first dashboard visit
- Fixed App Builder crash (isAdmin global scope collision)
- Customer app preview mode with publish status banner
- Netlify slug routing for `/a/{slug}` URLs
- Full rebrand complete (crown logo, GA4, Space Grotesk, favicons)
- See `/docs/recaps/2026-02-04-session-recap.md` for full details

**Earlier (Feb 1, 2026):**
- Rebranded to Royalty (royaltyapp.ai)
- Updated landing page with loyalty-focused positioning
- Created AppSumo launch plan ($500K target)
- Added AI autonomy settings to database
- Planned dashboard reporting with ApexCharts
- Planned sidebar simplification for SMB users

---

## Intelligence System (Feb 2026)

### Intelligence Key Files
| File | Purpose | Lines |
|------|---------|-------|
| `app/crown-dashboard.js` | Core Intelligence logic (modes, prompts, cards, autonomous) | ~3,400 |
| `app/chat-thread.js` | Thread management, sidebar messaging | ~550 |
| `app/auth.js` | Auth helpers including `getValidSession()` | ~290 |
| `supabase/functions/royal-ai-prompt/index.ts` | AI edge function with tools + knowledge | ~1,200 |
| `supabase/functions/message-sender/index.ts` | Multi-channel messaging (email, SMS, push) | ~350 |
| `supabase/functions/automation-engine/index.ts` | Trigger processing + action execution | ~280 |
| `supabase/functions/resend-webhook/index.ts` | Email delivery status tracking | ~150 |
| `supabase/functions/twilio-webhook/index.ts` | SMS delivery status tracking | ~185 |
| `supabase/functions/analyze-suggestion/index.ts` | AI suggestion analysis (Haiku, fire-and-forget) | ~265 |
| `app/rewards.js` | Rewards CRUD + Suggestions tab + AI proposal UI | ~500 |
| `app/rewards.html` | Rewards admin page layout + suggestion CSS | ~350 |

### Auth Patterns
- **Token refresh:** Use `getValidSession()` from auth.js -- auto-refreshes if expiring within 60s
- **401 retry:** On 401 from edge function, call `refreshSession()` then retry request ONCE
- **Edge function deploy:** Use `supabase functions deploy royal-ai-prompt --no-verify-jwt` for custom auth handling
- **Server-side validation:** Edge function validates JWT via `supabase.auth.getUser(token)`

### Architecture Decisions
- Vanilla JS with IIFE modules (no React)
- Supabase for auth + database + edge functions
- 3D crown visualization with Three.js
- Dual modes: Review (manual approval) vs Autonomous (auto-accept)
- Chat threads stored in `ai_threads` table, messages in `ai_prompts`

### Royal AI Production Plan (Feb 2026)
Full plan at: `~/.claude/plans/shiny-forging-dawn.md`

**Full Automation Intelligence - COMPLETE (Feb 8, 2026):**

| Phase | Name | Status | Key Deliverables |
|-------|------|--------|------------------|
| 0 | Email Tracking Infrastructure | ✅ | `message_recipients`, `message_events` tables, `resend-webhook` function |
| 1 | Performance Metrics | ✅ | `get_automation_performance()`, `get_automation_rankings()` RPCs |
| 2 | Fatigue Tracking | ✅ | `member_communication_log`, fatigue scoring (0-100), `check_fatigue` tool |
| 3 | Custom Automation Creation | ✅ | `create_automation` tool with guardrails (max 500 pts, 5x, 50% discount) |
| 4 | Visit Correlation | ✅ | `member_visit_attribution`, `measure_automation_outcomes()` |
| 5 | Maintenance Cron Jobs | ✅ | Outcome measurement (6h), log cleanup (daily/weekly) |
| SMS | Twilio Integration | ✅ | `twilio-webhook` function, real SMS sending in message-sender |

**Autonomy Enhancements - COMPLETE (Feb 12, 2026):**

| Feature | Status | Key Deliverables |
|---------|--------|------------------|
| create_automation Queue Routing | ✅ | Routed through `queue_ai_action()` with confidence scoring + lifecycle |
| Learning Loop: Pre-Action Intelligence | ✅ | `getActionIntelligence()` checks past learnings before executing actions |
| Learning Loop: Post-Run Reflection | ✅ | `runPostActionReflection()` detects aggregate patterns, saves strategic insights |
| Knowledge Pruning | ✅ | `prune_business_knowledge()` function + weekly cron (Sun 4AM UTC) |
| Learnings Tab | ✅ | 4th tab on Intelligence page showing grouped business learnings |

**23 Migrations (Feb 17, 2026):**
- `20260208000000-000007`: Phase 8 automation infrastructure (tables, seeds, security)
- `20260208000008`: Email tracking infrastructure
- `20260208000009`: Automation performance metrics
- `20260208000010`: Fatigue tracking system
- `20260208000011`: Custom automation guardrails
- `20260208000012`: Visit correlation and attribution
- `20260208000013`: Maintenance cron jobs
- `20260208000014`: Twilio SMS event types
- `20260209000001`: Self-tuning infrastructure (auto-pause, weekly digest, recovery)
- `20260209000002`: Self-tuning cron jobs (6h bounce check, Monday digest, Wed recovery)
- `20260212000002`: Composite indexes
- `20260212000003`: Message events partitioning
- `20260212000004`: AI response cache
- `20260212000005`: Budget caps and monitoring
- `20260212000006`: Fix fatigue function joins
- `20260212000007`: Knowledge pruning function + weekly cron
- `20260217000006`: Reward suggestions table, RPC, RLS
- `20260217000007`: AI proposal JSONB column on reward_suggestions

**4 New Edge Functions:**
- `resend-webhook` - Email delivery tracking (Svix signature verification)
- `twilio-webhook` - SMS delivery tracking (HMAC-SHA1 verification)
- `royal-ai-autonomous` - Background autonomous processing
- `analyze-suggestion` - AI-powered reward suggestion analysis (Claude Haiku, fire-and-forget)

**Previous Phases:**
- Phase 1 (Intelligence Foundation): 6 tables, 71 discovery questions, knowledge extraction

### Database Schema (AI Intelligence)
| Table | Purpose |
|-------|---------|
| `business_knowledge` | Facts learned from conversations, research, integrations |
| `business_profiles` | Structured business model data (margins, stage, goals) |
| `discovery_questions` | 71 questions across 10 domains (revenue, costs, customers, etc.) |
| `org_discovery_progress` | Tracks which questions asked/answered per org |
| `owner_patterns` | Emergent personality - learned communication preferences |
| `owner_interactions` | Individual interaction logs for pattern learning |
| `message_recipients` | Individual message tracking (links batch to member + provider ID) |
| `message_events` | Webhook events (delivered, opened, clicked, bounced, etc.) |
| `member_communication_log` | All communications for fatigue scoring |
| `member_visit_attribution` | Links visits to automations for outcome measurement |
| `reward_suggestions` | Customer reward suggestions with AI proposals |

### Royal AI Tools (available to AI assistant)
| Tool | Purpose |
|------|---------|
| `read_automations` | List automations with performance metrics, visit correlation |
| `check_fatigue` | Check audience fatigue before messaging (returns score 0-100) |
| `create_automation` | Create new automation via action queue (confidence-gated, outcome-measured) |
| `get_info` | Read member/business data |
| `award_points` | Give points to members |
| `send_message` | Send email/SMS/push to members |

### Integration Status (verified Feb 24, 2026)
| Service | Status | Notes |
|---------|--------|-------|
| Resend (Email) | ✅ Configured | Webhook enabled, signing secret set, events processing (200 OK) |
| Twilio (SMS) | ✅ Configured | Secrets set, webhook URL registered in Twilio dashboard |
| Stripe | ✅ Configured | Webhook fixed (was returning 400, now 200), payments + subscriptions working |
| Supabase | ✅ Configured | Auth, DB, Edge Functions, Cron |

### Deploy Commands
```bash
cd Automata
supabase db push                                    # Apply migrations
supabase functions deploy royal-ai-prompt --no-verify-jwt  # Deploy AI prompt function
supabase functions deploy royal-ai-autonomous --no-verify-jwt  # Deploy autonomous runner
supabase functions deploy analyze-suggestion --no-verify-jwt   # Deploy AI suggestion analyzer
```

### Learning Loop (Feb 12, 2026)
The autonomous runner now has a closed-loop learning system:
- **Pre-action intelligence:** Before executing, queries past learnings + recent outcomes. 3+ consecutive failures = 30-min defer.
- **Post-run reflection:** After each cycle, detects aggregate patterns (>70% failure or >80% success) and saves `[Weekly Pattern]` insights.
- **Knowledge pruning:** Weekly cron (Sun 4AM UTC) invalidates expired facts and supersedes old duplicates (keeps top 5 per org+layer+category).

### Learnings Tab (Feb 12, 2026)
4th tab on the Intelligence page (Actions | Intel | Learnings | Chat). Shows business owner what AI has learned, grouped by knowledge layer:
- Layers: Operations, Customers, Financial, Market, Growth, Compliance
- Facts color-coded by importance (critical/high = amber, medium = purple, low = grey)
- Loads on first tab click via `CrownDashboard.loadKnowledge()`
- i18n translations in all 8 languages

### Customer App & Rewards (Feb 17, 2026)

**Reward Suggestions Pipeline:**
- Customer sees suggestion form when no rewards exist (name + description + "I'd redeem this for __ pts")
- `submit_reward_suggestion` RPC (SECURITY DEFINER, rate-limited 3/day per member)
- Fire-and-forget call to `analyze-suggestion` edge function after successful submit
- Edge function loads business knowledge + profile, calls Claude Haiku, stores `ai_proposal` JSONB
- Admin Suggestions tab shows AI proposals ("Royal AI recommends" with name, points, reasoning)
- "Create Reward" pre-fills modal from AI proposal (falls back to raw suggestion)

**Placeholder Patterns:**
- Leaderboard: 10 grayed-out placeholder entries (opacity 0.38, `_isPlaceholder` flag)
- Activity: 10-row merged array (real data fills first N slots, placeholders fill rest)
- Quick Actions removed from customer home tab (bottom nav duplicates functionality)

### Audit Complete (Feb 2026)
All 4 phases completed:
- **Phase 1 - Security:** Prompt injection sanitization, PII removal, input validation, XSS fix
- **Phase 2 - Stability:** Event delegation (memory leaks), race condition prevention, timer cleanup, error recovery
- **Phase 3 - Code Quality:** State consolidation (5 objects), constants extraction, duplicate removal
- **Phase 4 - Accessibility:** ARIA roles, focus traps, keyboard handlers, focus indicators

### Social App Type (Feb 25, 2026)

**Status:** Live on main, migration applied, testing in progress

**New tables:** `venues`, `venue_media`
**New RPCs:** `get_venues_for_map()`, `get_venue_feed()`, `get_venue_detail()`
**Storage bucket:** `venue-media` (50MB, public read)
**New files:** `customer-app/social.html`, `social.js`, `social.css`, `app/venues.html`
**Modified:** `apps.js`, `apps.html`, `app-builder.js`, `app-builder.html`, `app-templates-library.js`, `index.html`, `vite.config.js`, `netlify.toml`, `sw.js`
**Migration:** `20260225000001_social_venue_discovery.sql`
**Known fix:** Anon key in social.js updated to current project key (old key caused 401s)
