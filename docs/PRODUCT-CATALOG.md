# Automata Product Catalog

**Last Updated:** January 31, 2026
**Purpose:** Comprehensive reference for development planning and feature roadmap

---

## Table of Contents
1. [Product Overview](#1-product-overview)
2. [Architecture Summary](#2-architecture-summary)
3. [Multi-Tenancy Model](#3-multi-tenancy-model)
4. [Pages Inventory](#4-pages-inventory)
5. [Database Tables](#5-database-tables)
6. [Customer App System](#6-customer-app-system)
7. [AI Intelligence System](#7-ai-intelligence-system)
8. [Shared Components](#8-shared-components)
9. [What's Built vs. What's Planned](#9-whats-built-vs-whats-planned)

---

## 1. Product Overview

**Automata MVP** is an AI-powered customer automation platform enabling organizations to scale meaningful customer relationships through:
- Intelligent automations
- Customer-facing loyalty/rewards apps
- AI-powered business recommendations

**Tech Stack:** Vanilla HTML/CSS/JavaScript + Supabase (PostgreSQL + Auth)

---

## 2. Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                         AUTOMATA                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│   │   Client A  │    │   Client B  │    │   Client C  │        │
│   │ (Coffee Co) │    │  (Gym Inc)  │    │  (Blogger)  │        │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘        │
│          │                  │                  │                │
│   ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐        │
│   │ Customer    │    │ Customer    │    │ Subscriber  │        │
│   │ App:        │    │ App:        │    │ App:        │        │
│   │ Loyalty     │    │ Membership  │    │ Newsletter  │        │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘        │
│          │                  │                  │                │
│   ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐        │
│   │ App Members │    │ App Members │    │ App Members │        │
│   │ (Customers) │    │ (Customers) │    │(Subscribers)│        │
│   │ ISOLATED    │    │ ISOLATED    │    │ ISOLATED    │        │
│   └─────────────┘    └─────────────┘    └─────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Multi-Tenancy Model

### Hierarchy
```
Automata (Platform)
└── Organizations (Clients - e.g., Coffee Shop, Gym, Your Blog)
    ├── Projects (Campaigns, Initiatives)
    │   └── Automations (Scheduled content/emails)
    ├── Customers (Client's CRM - their customer database)
    └── Customer Apps (Public-facing apps for client's customers)
        └── App Members (Customers who join the app - ISOLATED)
```

### Data Isolation Guarantees

| Level | Scope | How Isolated |
|-------|-------|--------------|
| **Organization** | All data belongs to one org | RLS policies: `organization_id` filter on every query |
| **Customer App** | App belongs to one org | `app_id` + `organization_id` foreign key |
| **App Members** | Members belong to one app | `app_id` filter - members NEVER cross apps |
| **Points/Rewards** | Transactions per app | `app_id` + `member_id` composite |

### Key Isolation Rules
1. **Coffee Shop's customers NEVER see Gym's customers**
2. **Each app has its own member database** (`app_members` table)
3. **Points don't transfer between apps**
4. **RLS enforces at database level** - even if code has bugs, data stays isolated

---

## 4. Pages Inventory

### Public Pages (No Auth)
| Page | Path | Status |
|------|------|--------|
| Landing | `/index.html` | ✅ Built |
| Blog | `/blog/` | ✅ Built |
| Pricing | `/pricing.html` | ✅ Built |
| Customer App Landing | `/customer-app/index.html` | ✅ Built |
| Customer App | `/customer-app/app.html` | ✅ Built |

### Authenticated App Pages
| Page | Path | Status |
|------|------|--------|
| Dashboard | `/app/dashboard.html` | ✅ Built |
| Intelligence (AI) | `/app/intelligence.html` | ✅ Built |
| Project Detail | `/app/project.html` | ✅ Built |
| Automations | `/app/automations.html` | ✅ Built |
| Automation Detail | `/app/automation.html` | ✅ Built |
| Apps | `/app/apps.html` | ✅ Built |
| App Builder | `/app/app-builder.html` | ✅ Built |
| Customers | `/app/customers.html` | ✅ Built |
| Organization | `/app/organization.html` | ✅ Built |
| Settings | `/app/settings.html` | ✅ Built |
| Roadmap | `/app/roadmap.html` | ✅ Built |
| Feature Requests | `/app/feature-requests.html` | ✅ Built |

---

## 5. Database Tables

### Core Structure
| Table | Purpose | Key Fields |
|-------|---------|------------|
| `organizations` | Client accounts | `id`, `name`, `plan_type`, `settings` |
| `profiles` | User accounts | `id`, `email`, `is_admin` |
| `organization_members` | User ↔ Org link | `user_id`, `organization_id`, `role` |
| `projects` | Client initiatives | `organization_id`, `name`, `industry` |
| `automations` | Scheduled tasks | `project_id`, `type`, `frequency`, `is_active` |
| `customers` | Client's CRM | `organization_id`, `email`, `phone`, `tags` |

### Customer App Tables
| Table | Purpose | Key Fields |
|-------|---------|------------|
| `customer_apps` | App definitions | `organization_id`, `slug`, `app_type`, `features` |
| `app_members` | App user accounts | `app_id`, `email`, `pin_hash`, `tier`, `points_balance` |
| `points_transactions` | Points ledger | `app_id`, `member_id`, `type`, `points_change` |
| `app_rewards` | Reward catalog | `app_id`, `name`, `points_cost`, `is_active` |
| `reward_redemptions` | Redemption history | `member_id`, `reward_id`, `status`, `redemption_code` |

### AI & Analytics
| Table | Purpose |
|-------|---------|
| `ai_recommendations` | AI-generated insights |
| `ai_analysis_history` | Analysis run tracking |
| `audit_logs` | Action audit trail |

---

## 6. Customer App System

### App Types Available
1. **Loyalty Program** - Points per visit/scan
2. **Rewards Club** - Redeem points for prizes
3. **VIP Membership** - Tier-based perks
4. **Custom** - Build your own

### Builder Flow (6 Steps)
1. Basics → 2. Features → 3. Settings → 4. Branding → 5. QR Code → 6. Preview

### Features Toggle
- Points system (scan/purchase)
- Leaderboard (opt-in public profiles)
- Rewards catalog
- Menu/products
- Announcements
- Referral program

### Tier System
Bronze (default) → Silver → Gold → Platinum (configurable thresholds)

---

## 7. AI Intelligence System

### Current Capabilities
- Analyze org data (customers, projects, automations)
- Generate recommendations with confidence scores
- Action payloads for one-click implementation
- Track implementation outcomes

### Recommendation Types
- `opportunity` - Growth opportunities
- `efficiency` - Optimization suggestions
- `risk` - Risk alerts
- `growth` - Expansion ideas
- `automation` - Automation suggestions

---

## 8. Shared Components

### JavaScript Modules
| Module | Purpose |
|--------|---------|
| `auth.js` | Supabase authentication |
| `utils.js` | Common utilities, RPC wrappers |
| `sidebar.js` | Navigation component |
| `plan-limits.js` | Usage tracking |
| `audit-log.js` | Action logging |
| `soft-delete.js` | Soft delete with undo |
| `undo-toast.js` | Undo notifications |
| `danger-modal.js` | Delete confirmations |
| `coaching.js` | Onboarding tooltips |
| `rate-limiter.js` | Client-side rate limiting |

### i18n Support
8 languages: English, Spanish, French, German, Italian, Portuguese, Chinese, Arabic (RTL)

---

## 9. What's Built vs. What's Planned

### ✅ Fully Built
- Multi-tenant organization system
- Project & automation management
- Customer database with CSV import
- Customer app builder (loyalty/rewards)
- App member system with points/tiers
- AI recommendation engine
- Audit logging & soft delete
- Rate limiting
- 8-language i18n

### 🚧 Partially Built
- Blog automation (generates posts, needs AI content)
- Email automation (structure exists, needs sending)
- Newsletter system (database ready, needs UI)

### 📋 Planned / Not Started
- **Blogger App** - Content creation automation
- **Newsletter Management** - Subscriber lists, sending
- **Email Service Integration** - Actual email delivery
- **Payment Processing** - Stripe integration
- **Mobile Apps** - Native iOS/Android

---

## Development Guidelines

### Adding New Features
1. **i18n**: Update ALL 8 language files
2. **Cache Busting**: Increment `?v=X` on modified files
3. **RLS**: Add proper Row Level Security policies
4. **Audit**: Log significant actions to audit_logs
5. **Validation**: Add input validation (client + server)
6. **XSS**: Always use `escapeHtml()` for user content

### Security Checklist
- [ ] RLS policies on new tables
- [ ] Input validation on forms
- [ ] Rate limiting on public endpoints
- [ ] escapeHtml on innerHTML usage
- [ ] No secrets in client code

---

*This catalog is the source of truth for Automata's current state. Update when adding significant features.*
