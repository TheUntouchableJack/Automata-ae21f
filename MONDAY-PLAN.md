# Monday Plan - Feb 3, 2026

## Mission
Test and validate that both app types (Loyalty Apps + Newsletter Apps) are **true 1-click solutions**, with AI Intelligence (Claude API) proposing complete projects so businesses don't need to think.

---

## Part 1: E2E Testing - Signup to Working App

### 1.1 Test: New User Signup Flow
```
Landing Page → Signup → Email Confirmation → Dashboard → Project Created
```

**Checkpoints:**
- [ ] Rate limiting works (try 6 signups rapidly)
- [ ] CAPTCHA blocks bots
- [ ] Email confirmation delivers
- [ ] PKCE code exchange works
- [ ] User lands in dashboard with organization created
- [ ] Onboarding data (if any) becomes a project

### 1.2 Test: Loyalty App 1-Click Setup
```
Dashboard → Create App → Select "Loyalty" → Configure → Publish → Test Customer Signup
```

**Checkpoints:**
- [ ] App builder wizard completes
- [ ] QR code generates correctly
- [ ] Customer can signup via QR link
- [ ] Customer appears in org's customers table
- [ ] Points awarded on signup (welcome bonus)
- [ ] Scan-to-earn flow works
- [ ] Rewards can be redeemed

### 1.3 Test: Newsletter App 1-Click Setup
```
Dashboard → Create App → Select "Newsletter" → Configure → Publish → Test Subscriber Signup
```

**Checkpoints:**
- [ ] Newsletter template selection works
- [ ] Branding applied to blog
- [ ] Subscriber signup widget works
- [ ] Article can be created/published
- [ ] SEO tags generate correctly
- [ ] Embed widgets render

---

## Part 2: AI Intelligence - Claude API Integration

### 2.1 Create Edge Function: `analyze-business`
```typescript
// supabase/functions/analyze-business/index.ts

// Input: organization_id
// Process:
// 1. Gather org data (customers, automations, apps, usage)
// 2. Build prompt with business context
// 3. Call Claude API (claude-3-5-sonnet)
// 4. Parse structured recommendations
// 5. Store in ai_recommendations table
// Output: Array of recommendations
```

### 2.2 Claude API Integration
```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: Deno.env.get('ANTHROPIC_API_KEY')
});

const response = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 2048,
  messages: [{
    role: 'user',
    content: buildAnalysisPrompt(orgData)
  }]
});
```

### 2.3 Recommendation Types to Generate
1. **Project Proposals** - "Based on your restaurant, here's a complete loyalty program"
2. **Automation Suggestions** - "Your customers would benefit from birthday rewards"
3. **App Recommendations** - "A newsletter would help with customer retention"
4. **Growth Opportunities** - "Your top customers are in Miami - expand there"
5. **Risk Alerts** - "3 customers haven't visited in 30 days"

### 2.4 Database: Run Migration
```sql
-- From royalty-ai-intelligence-feed.md
CREATE TABLE ai_recommendations (...);
CREATE TABLE ai_recommendation_outcomes (...);
```

---

## Part 3: AI-Proposed Projects (The Magic)

### 3.1 Flow: Business Signs Up → AI Proposes Everything

```
1. New user signs up
2. Onboarding asks: "Tell us about your business"
   - Business name
   - Industry (dropdown)
   - Location
   - What they sell/do (free text)

3. AI analyzes input immediately
4. AI generates:
   - Recommended project name
   - 3-5 suggested automations
   - 1-2 app recommendations (loyalty/newsletter)
   - First-week action plan

5. User sees: "Here's your personalized setup"
   - One-click to create everything
   - Can customize before creating
```

### 3.2 Prompt Template for Project Proposal
```
You are setting up Royalty for a new business.

BUSINESS INFO:
- Name: {business_name}
- Industry: {industry}
- Location: {location}
- Description: {description}

Generate a personalized project setup:

1. PROJECT
   - Suggested name
   - Description (2 sentences)

2. AUTOMATIONS (pick 3-5 most relevant)
   - For each: name, type, trigger, brief description
   - Prioritize high-impact, easy wins

3. APPS (pick 1-2 most relevant)
   - Loyalty app config if B2C with repeat customers
   - Newsletter if content/thought leadership makes sense

4. FIRST WEEK ACTIONS
   - 3 specific things they should do this week

Return as JSON for easy parsing.
```

### 3.3 Implementation: New Onboarding Flow

**File: `app/onboarding-ai.js`**
```javascript
async function generateProjectProposal(businessInfo) {
  const { data, error } = await db.functions.invoke('propose-project', {
    body: businessInfo
  });

  if (error) throw error;
  return data.proposal;
}

function renderProposal(proposal) {
  // Show proposed project, automations, apps
  // "Create All" button
  // Ability to toggle individual items
}

async function createFromProposal(proposal, selectedItems) {
  // Create project
  // Create selected automations
  // Create selected apps
  // Redirect to project page with celebration
}
```

### 3.4 Edge Function: `propose-project`
```typescript
// supabase/functions/propose-project/index.ts

Deno.serve(async (req) => {
  const { business_name, industry, location, description } = await req.json();

  const prompt = buildProjectProposalPrompt({ business_name, industry, location, description });

  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }]
  });

  const proposal = parseProposal(response.content[0].text);

  return new Response(JSON.stringify({ proposal }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

---

## Part 4: Intelligence Dashboard

### 4.1 UI: Intelligence Feed in Dashboard
```
┌─────────────────────────────────────────────────────┐
│ 🧠 AI Intelligence                     [Refresh]    │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ 💡 PROJECT SUGGESTION                           │ │
│ │ Based on your coffee shop, we recommend:        │ │
│ │ • Loyalty program with 10 pts/visit            │ │
│ │ • Birthday rewards automation                   │ │
│ │ • Win-back campaign for inactive customers      │ │
│ │                                                 │ │
│ │ [Create All] [Customize] [Dismiss]             │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 4.2 File Changes
- `app/dashboard.html` - Add Intelligence section
- `app/dashboard.js` - Fetch and render recommendations
- `app/intelligence.html` - Full intelligence page (existing, enhance)

---

## Part 5: Testing Checklist

### E2E Test Suite (Playwright)
```javascript
// e2e/signup-to-app.spec.js

test('complete signup creates working loyalty app', async ({ page }) => {
  // 1. Sign up new user
  // 2. Complete onboarding
  // 3. AI proposes project
  // 4. Create from proposal
  // 5. Verify loyalty app works
  // 6. Test customer signup
  // 7. Test scan and earn
});

test('AI generates relevant proposals', async ({ page }) => {
  // 1. Sign up as "Coffee Shop in Miami"
  // 2. Verify AI suggests loyalty + cafe-specific automations
  // 3. Sign up as "Law Firm"
  // 4. Verify AI suggests newsletter + appointment automations
});
```

---

## Environment Setup

### Required Secrets (Supabase Dashboard → Edge Functions)
```
ANTHROPIC_API_KEY=sk-ant-...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Local Development
```bash
# Set local env
export ANTHROPIC_API_KEY=sk-ant-...

# Run Edge Functions locally
supabase functions serve

# Run E2E tests
npx playwright test
```

---

## Success Criteria

By end of Monday:

1. **Signup → Dashboard** works flawlessly (tested 3+ times)
2. **Loyalty App** is true 1-click (create → publish → working in < 2 min)
3. **Newsletter App** is true 1-click (create → publish → working in < 2 min)
4. **AI proposes projects** that make sense for the business type
5. **Intelligence feed** shows on dashboard for admins
6. **E2E tests pass** for the complete flow

---

## Order of Operations

```
1. [30 min] Run AI Intelligence migration (database tables)
2. [60 min] Build `propose-project` Edge Function with Claude API
3. [30 min] Test project proposals for different business types
4. [60 min] Integrate into onboarding flow (UI)
5. [60 min] E2E test signup → loyalty app flow
6. [60 min] E2E test signup → newsletter app flow
7. [30 min] Intelligence dashboard integration
8. [30 min] Final polish and bug fixes
```

---

*Created: Jan 31, 2026*
*For: Monday Feb 3, 2026*
