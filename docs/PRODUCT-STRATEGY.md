# Royalty — Product Strategy

## Vision

**"AI that runs your loyalty program while you run your business."**

Royalty enables local businesses to build meaningful, scalable customer relationships through AI-powered loyalty programs. Users describe their business, AI builds a complete loyalty program in 60 seconds, and then runs it forever—automatically.

**People first.** With all the automation and AI, the most important thing remains relationships and connection. We use tools to serve people.

---

## Core Concept

### The 1-Click Loyalty Program

Traditional approach: Buy loyalty software → Configure everything manually → Hope customers use it

Royalty approach: Describe your business → AI builds your program → Customers scan QR → AI optimizes forever

### Example Flow

1. Business owner describes: "Coffee shop in Austin, 200 regulars"
2. AI builds: points system, tier levels, rewards catalog, QR check-ins
3. Owner shares QR code at checkout
4. Customers scan, earn points, level up
5. AI runs campaigns: win-back, birthday rewards, streak bonuses
6. Owner gets weekly summary: "Here's what I did for you"

---

## Target Users

- **Local businesses** with repeat customers
  - Restaurants and cafes
  - Salons and spas
  - Gyms and fitness studios
  - Retail stores
- **Multi-location businesses** (Scale tier)

**Goal:** Give any local business a sophisticated loyalty program that runs itself.

---

## Core Features

### Loyalty Program Components
- **Points system:** Earn on visits, purchases, referrals
- **Tier system:** Bronze → Silver → Gold → Platinum
- **Rewards catalog:** Business defines what customers can redeem
- **QR check-ins:** Customers scan to earn, no app download needed
- **Referral program:** Unique links, both parties earn

### AI Intelligence
- **Auto-pilot mode:** AI acts automatically, owner gets notified
- **Manual approve mode:** AI proposes, owner reviews each action
- Campaigns: win-back, birthday, streak bonuses, tier motivation, milestones, referral nudges
- Weekly insights: "3 customers came back, 2 upgraded to Gold"

### Dashboard (Reporting)
- Total members, today's check-ins, new this week
- Growth charts, tier distribution
- Activity feed: recent joins, visits, redemptions

### Communication Channels
- In-app notifications
- Email (via SendGrid)
- SMS (via Twilio) - future

---

## Technical Architecture

### Stack
- **Frontend:** Vanilla HTML/CSS/JS
- **Backend:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth
- **AI:** Claude API for analysis and recommendations
- **Integrations:** SendGrid (email), Twilio (SMS)

### Security Requirements (Non-Negotiable)
- Row Level Security (RLS) on all tables
- No public keys exposed to client
- All sensitive database operations via RPC/Edge Functions
- Full encryption for customer data

### Data Isolation
- Each business's data is completely isolated
- Apps and customers scoped to organization
- No cross-business data leakage

---

## Business Model

### AppSumo Lifetime Deal (Launch)
- **Starter ($59):** 1 app, 500 members, basic AI
- **Growth ($118):** 3 apps, 2,000 members, full AI, automated campaigns
- **Scale ($177):** Unlimited apps/members, white-label, API access

### Post-Launch Pricing
- Monthly subscription model
- Usage-based surcharges for high-volume users

---

## Development Rules

### Mandatory Process
Every feature follows:
1. **Understand** — Clarify requirements
2. **Review** — Examine existing codebase
3. **Build** — Implement the feature
4. **Test** — QA + regression testing
5. **Verify** — Security intact, no regressions
6. **Deploy** — Only after validation

### Code Quality Standards
- Maintainable, readable code
- Test everything before presenting
- Debug methodically
- Safe, secure, scalable

---

## Key Milestones

### Launch (Feb 28, 2026)
- 1-click loyalty app creation
- QR check-ins working
- AI campaigns running
- Owner dashboard with reporting

### Post-Launch
- SMS integration
- Advanced analytics
- Multi-language support
- Public API

---

## Philosophy

> "The AI that runs your loyalty program while you run your business."

Royalty exists to give local businesses the loyalty technology that big chains have—without the complexity, cost, or staff to manage it.
