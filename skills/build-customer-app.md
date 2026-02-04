# Skill: Build Customer App

## Overview

This skill guides the creation of customer-facing apps that sit on top of Royalty automations. These apps provide end-to-end customer experiences like loyalty programs, rewards clubs, and VIP memberships.

---

## Current State (Jan 30, 2026)

### What's Been Built

#### Landing Page (`customer-app/index.html`)
- App discovery via slug URL (`?slug=my-coffee-shop`)
- Multi-language support (8 languages with live switching)
- Signup flow with email, phone, name, and 4-digit PIN
- Login flow with RPC-based secure PIN verification
- Welcome points badge display
- Auto-redirect to app after signup (2.5s delay)
- Glassmorphism design with smooth animations
- Business branding (logo, colors) applied dynamically

#### Main App (`customer-app/app.html`)
- Points balance display with animated counter
- Tier system (Bronze → Silver → Gold → Platinum)
- Tier progress bar with shimmer animation
- Quick actions grid (Rewards, Leaderboard, Profile)
- Recent activity feed
- Leaderboard tab with rankings
- Rewards catalog tab with redemption modal
- Profile tab with basic info
- Bottom navigation with central scan button
- Feature flags to show/hide tabs based on app settings
- Dynamic theming from business branding

#### App Builder (`app/app-builder.html`)
- Step-by-step wizard for creating apps
- App type selection (loyalty, rewards, membership, custom)
- Features toggle (points, leaderboard, rewards, menu, etc.)
- Points configuration (per scan, per dollar, welcome bonus)
- Tier thresholds customization
- Branding (colors, logo with fit options)
- Business info (hours, phone, email, address)
- Social media links (Instagram, Facebook, TikTok, etc.)
- QR code generation and sharing
- Auto-save on all changes

#### RPC Functions
```sql
-- Fetch app by URL slug
get_app_by_slug(p_slug TEXT)

-- Atomic signup with customer creation
signup_app_member(p_app_id, p_email, p_phone, p_first_name, p_last_name, p_pin_hash)

-- Secure server-side PIN verification
verify_app_member_login(p_app_id, p_email, p_phone, p_pin_hash)

-- Fetch leaderboard rankings
get_app_leaderboard(p_app_id, p_limit)

-- Process reward redemption
redeem_reward(p_app_id, p_member_id, p_reward_id)
```

---

## Simplified Vision: Visits-Based Loyalty

### Core Philosophy
> "Keep it simple. Customers scan, earn points, get rewarded for showing up."

Instead of complex menu/checkout integration:
- **Earn points per visit** (scan QR code when visiting)
- **Bonus points** for frequency (daily streak, weekly milestone)
- **Tier upgrades** based on total visits or points
- **Simple rewards** redeemable at the business

### Customer Journey
```
1. DISCOVER → Find app via QR code or link
2. JOIN → Quick signup (name, email/phone, PIN)
3. SCAN → Scan QR code each visit to earn points
4. TRACK → See points, progress, activity
5. REDEEM → Exchange points for rewards
6. REPEAT → Build loyalty through visits
```

---

## Technique: Constraint Cascade

**Don't dump all complexity at once.** Layer instructions progressively with user checkpoints at each phase.

### Phase Structure

```
PHASE 1: Requirements → [USER CHECKPOINT] →
PHASE 2: Database Setup → [USER CHECKPOINT] →
PHASE 3: Core Features → [USER CHECKPOINT] →
PHASE 4: Rewards Config → [USER CHECKPOINT] →
PHASE 5: Branding → [USER CHECKPOINT] →
PHASE 6: Testing → [USER CHECKPOINT] →
PHASE 7: Launch
```

**At each checkpoint, ask:**
> "Phase X complete. Here's what we built: [summary]. Ready for Phase Y, or do you want to adjust anything?"

---

## Planned Features

### Phase 1: Profile Management (NEXT)

#### 1.1 Profile Photo
```javascript
// Features:
- Take photo with camera (mobile)
- Upload from gallery/files
- Crop/resize to square
- Store in Supabase Storage
- Display throughout app (header, profile, leaderboard)
```

**Database change:**
```sql
ALTER TABLE app_members ADD COLUMN avatar_url TEXT;
```

**Storage bucket:**
```sql
-- Create bucket for member avatars
INSERT INTO storage.buckets (id, name, public)
VALUES ('member-avatars', 'member-avatars', true);
```

#### 1.2 Edit Profile Info
```javascript
// Editable fields:
- Display name (first + last)
- Email address (with validation)
- Phone number (with formatting)
- Profile photo

// UI: Bottom sheet modal with form
// Validation: Email format, phone format
// Auto-save or explicit save button
```

#### 1.3 Profile Screen Redesign
```
┌─────────────────────────────┐
│      [Gradient Header]      │
│    ┌───────┐                │
│    │ Photo │  Display Name  │
│    │ + cam │  Bronze Member │
│    └───────┘                │
│    📧 email@example.com     │
│    📱 +1 (555) 123-4567     │
├─────────────────────────────┤
│  Points   Visits   Rewards  │
│   1,250     47        3     │
├─────────────────────────────┤
│ ✏️ Edit Profile            →│
│ 📋 Transaction History     →│
│ 🔔 Notifications           →│
│ ⚙️ Settings                →│
│ 🚪 Log Out                 →│
└─────────────────────────────┘
```

### Phase 2: Visit Tracking System

#### 2.1 QR Code Scanning
```javascript
// Business displays QR code at location
// Customer opens scanner in app
// Camera reads QR → Points awarded

// Options:
- Native Camera API with BarcodeDetector
- html5-qrcode library (fallback)
- Deep link for simple URL-based scanning
```

#### 2.2 Visit Validation
```javascript
// Prevent gaming the system:
const visitRules = {
    daily_scan_limit: 1,           // Max scans per day
    min_hours_between: 4,          // Minimum gap between scans
    geolocation_required: false,   // Optional GPS check
    rotating_codes: false          // Daily unique codes (optional)
};
```

#### 2.3 Points Award System
```javascript
const pointsConfig = {
    base_per_visit: 10,        // Default points per scan
    streak_bonus: {
        3_days: 5,             // +5 bonus for 3-day streak
        7_days: 15,            // +15 bonus for weekly streak
        30_days: 50            // +50 bonus for monthly streak
    },
    milestone_bonus: {
        10_visits: 25,
        50_visits: 100,
        100_visits: 250
    }
};
```

#### 2.4 Database: Visit Tracking
```sql
-- Add visit tracking columns
ALTER TABLE app_members ADD COLUMN visit_count INTEGER DEFAULT 0;
ALTER TABLE app_members ADD COLUMN current_streak INTEGER DEFAULT 0;
ALTER TABLE app_members ADD COLUMN longest_streak INTEGER DEFAULT 0;
ALTER TABLE app_members ADD COLUMN last_visit_at TIMESTAMPTZ;

-- Visit history table
CREATE TABLE member_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID REFERENCES app_members(id),
    app_id UUID REFERENCES customer_apps(id),
    visited_at TIMESTAMPTZ DEFAULT NOW(),
    points_awarded INTEGER,
    streak_bonus INTEGER DEFAULT 0,
    location_id UUID -- for multi-location support
);
```

### Phase 3: Enhanced Engagement

#### 3.1 Achievements/Badges
- First Visit badge
- Streak milestones (3, 7, 30 days)
- Tier upgrade celebrations
- Referral badges

#### 3.2 Simple Referrals
- Unique referral link per member
- Bonus points for both parties
- Track referral conversions

---

## Database Schema

### customer_apps
```sql
customer_apps (
    id UUID PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    app_type TEXT DEFAULT 'loyalty',
    is_active BOOLEAN DEFAULT false,
    is_published BOOLEAN DEFAULT false,
    features JSONB DEFAULT '{}',
    settings JSONB DEFAULT '{}',
    branding JSONB DEFAULT '{}',
    business_info JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
)
```

### app_members
```sql
app_members (
    id UUID PRIMARY KEY,
    app_id UUID REFERENCES customer_apps(id),
    email TEXT,
    phone TEXT,
    pin_hash TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    avatar_url TEXT,               -- NEW: Profile photo
    tier TEXT DEFAULT 'bronze',
    points_balance INTEGER DEFAULT 0,
    total_points_earned INTEGER DEFAULT 0,
    visit_count INTEGER DEFAULT 0, -- NEW: Total visits
    current_streak INTEGER DEFAULT 0, -- NEW: Current streak
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
)
```

### points_transactions
```sql
points_transactions (
    id UUID PRIMARY KEY,
    member_id UUID REFERENCES app_members(id),
    app_id UUID REFERENCES customer_apps(id),
    type TEXT NOT NULL,            -- 'visit', 'welcome', 'redeem', 'bonus'
    points_change INTEGER NOT NULL,
    balance_after INTEGER,
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
)
```

### app_rewards
```sql
app_rewards (
    id UUID PRIMARY KEY,
    app_id UUID REFERENCES customer_apps(id),
    name TEXT NOT NULL,
    description TEXT,
    points_cost INTEGER NOT NULL,
    image_url TEXT,
    quantity_available INTEGER,    -- NULL = unlimited
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
)
```

---

## Technical Architecture

### File Structure
```
customer-app/
├── index.html          # Landing/signup/login page
├── app.html            # Main authenticated app
├── app.css             # Shared styles/design system
├── manifest.json       # PWA manifest
└── assets/
    └── icons/          # App icons for PWA

app/
├── apps.html           # Apps listing page
├── apps.js             # CRUD operations
├── app-builder.html    # App creation wizard
├── app-builder.js      # Wizard logic
├── app-builder.css     # Wizard styles
└── app-templates-library.js  # Pre-built templates
```

### Authentication Flow
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Landing   │────▶│   Signup/   │────▶│   App.html  │
│   index.html│     │   Login     │     │   (auth'd)  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    localStorage:
                    - app_member_id
                    - app_slug
                    - app_auth_token (future JWT)
```

### Security
- PIN hashed client-side (SHA-256) before transmission
- Server-side PIN verification (hashes never exposed)
- Rate limiting on login attempts (TODO)
- Session tokens with expiry (future enhancement)

---

## Design System

### Colors (Dynamic)
```css
--app-primary: #6366f1;      /* From business branding */
--app-primary-rgb: 99, 102, 241;
--app-secondary: #1e293b;
--color-bg: #f8fafc;
--color-surface: #ffffff;
--color-text: #1e293b;
--color-text-muted: #94a3b8;
```

### Animations
```css
@keyframes pointsPop      /* Points counter entrance */
@keyframes badgeGlow      /* Tier badge pulse */
@keyframes cardFadeIn     /* Card stagger entrance */
@keyframes shimmer        /* Progress bar shine */
@keyframes fadeIn         /* Tab transitions */
```

### Mobile Patterns
- Safe area insets for notched devices
- Touch-friendly tap targets (44x44 min)
- Bottom sheet modals (slide up)
- Glassmorphism effects (backdrop-filter)
- Central floating action in nav bar

---

## Implementation Checklist

### Profile Management (Phase 1) - NEXT
- [ ] Add `avatar_url` column to `app_members`
- [ ] Create Supabase Storage bucket for avatars
- [ ] Build photo capture/upload component
  - [ ] Camera button with native API
  - [ ] File picker fallback
  - [ ] Image preview before save
  - [ ] Upload to Storage with member ID path
- [ ] Build edit profile modal (bottom sheet)
  - [ ] Avatar display with camera overlay
  - [ ] First name / Last name fields
  - [ ] Email field with validation
  - [ ] Phone field with formatting
  - [ ] Save button with loading state
- [ ] Update `app_members` record on save
- [ ] Display avatar throughout app
  - [ ] Profile header
  - [ ] Leaderboard entries
  - [ ] App header (optional)

### Visit Tracking (Phase 2) - DONE
- [x] Add visit tracking columns to schema
- [x] Create `member_visits` table
- [x] Build QR scanner component (BarcodeDetector API with fallback)
- [x] Create `record_member_visit` RPC function
- [x] Add visit validation logic (daily limit, 1 scan/day)
- [x] Implement streak tracking (3/7/30 day bonuses)
- [x] Add milestone detection (10/50/100 visit bonuses)
- [ ] Create visit confirmation animation (nice to have)

### Polish & UX
- [ ] Loading states for all async operations
- [ ] Error handling with friendly messages
- [ ] Pull-to-refresh for activity feed
- [ ] Haptic feedback on key interactions
- [ ] Offline indicators

---

## Templates

Use `getAppTemplateById()` from `app-templates-library.js`:
- `loyalty-points` - Standard loyalty program
- `rewards-club` - Focus on rewards redemption
- `vip-membership` - Exclusive member perks
- `cafe-rewards` - Optimized for coffee shops
- `restaurant-rewards` - Optimized for dining
- `fitness-club` - Gym/wellness focused

---

## Usage

When building or enhancing customer app features:

```
/build-customer-app [feature-area]
```

Examples:
- `/build-customer-app profile` - Work on profile management
- `/build-customer-app scanner` - Build QR scanning feature
- `/build-customer-app rewards` - Enhance rewards catalog
- `/build-customer-app visits` - Implement visit tracking

---

## Session Log

### Jan 30, 2026
- Fixed customer signup flow with atomic RPC function
- Customers now created in org's customers table on signup
- Added email AND phone duplicate detection with specific errors
- Fixed login error (`last_seen` → `last_login_at`)
- Fixed bottom navigation bar layout issues
- Added auto-redirect after successful signup
- Fixed translation system for language switching
- Added business info and social links to app builder

### Jan 31, 2026
- Simplified nav bar (removed elevated floating scan button)
- Added tier-based avatar flair (colored rings, glowing animations)
- Implemented podium-style leaderboard (2nd-1st-3rd arrangement)
- Built QR code scanner with camera access (BarcodeDetector API)
- Added daily scan limiting (1 scan/day, resets at midnight)
- Connected scanner to `record_member_visit` RPC
- E.164 phone number formatting for Twilio integration

### Next Session
- Visit confirmation animation (celebrate points earned)
- Profile photo upload to Supabase Storage
- Business QR code generation in dashboard

---

*Last updated: Jan 31, 2026*
