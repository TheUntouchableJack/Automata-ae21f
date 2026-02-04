# Royalty AI Intelligence Feed

## Vision (From Jay - Jan 30, 2026)
> "We want to fully unleash your capabilities and have you grow and scale our business online, along with our clients."

The goal is an AI-powered feed that analyzes organization data and surfaces daily opportunities - turning AI insights into actionable automations, apps, and growth strategies.

## Philosophy
- AI as a strategic partner, not just a tool
- Leverage everything AI understands (and doesn't) about patterns, data, and opportunity
- Lead the way - proactive recommendations, not reactive responses
- Scale what works, flag what doesn't

## Data Inputs for Analysis
| Data Source | What AI Analyzes |
|-------------|------------------|
| Customers | Location clusters, industries, acquisition channels, churn signals |
| Products/Services | Pricing patterns, popular items, gaps in catalog |
| Team | Size, capacity, skills, bottlenecks |
| Automations | Performance, engagement, time saved |
| Revenue | Growth patterns, seasonal trends, at-risk accounts |
| External | Market trends, competitor moves, regional opportunities |

## Recommendation Types
1. **Automation Ideas** - "Your customers in Texas respond 40% better to SMS. Create an SMS follow-up automation."
2. **Product Opportunities** - "3 customers asked about X this month. Consider adding it."
3. **Efficiency Gains** - "Your team spends 5hrs/week on Y. This could be automated."
4. **Customer Acquisition** - "Businesses like your top customers cluster in [area]. Target there."
5. **Risk Alerts** - "Customer Z hasn't logged in 30 days. Reach out."
6. **Resource Optimization** - "You're under-utilizing [feature]. Here's how others use it."

## Feed UI Concept
```
┌─────────────────────────────────────────────────────────┐
│ 🧠 AI Intelligence Feed                    Admin Only   │
├─────────────────────────────────────────────────────────┤
│ TODAY                                                   │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 💡 OPPORTUNITY                                      │ │
│ │ Your restaurant customers in Miami have 3x higher  │ │
│ │ engagement. Consider a Miami restaurant campaign.  │ │
│ │                                                     │ │
│ │ [Create Automation] [Dismiss] [Tell Me More]       │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ⚡ EFFICIENCY                                       │ │
│ │ 4 team members manually send welcome emails.       │ │
│ │ Automate this to save ~8 hours/week.               │ │
│ │                                                     │ │
│ │ [Create Automation] [Dismiss] [Tell Me More]       │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ⚠️ RISK                                            │ │
│ │ 2 high-value customers haven't logged in 14 days.  │ │
│ │ Proactive outreach recommended.                    │ │
│ │                                                     │ │
│ │ [View Customers] [Create Re-engagement Flow]       │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ YESTERDAY                                               │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ✅ IMPLEMENTED                                      │ │
│ │ You created the "New Customer Welcome" automation  │ │
│ │ from yesterday's suggestion. Tracking performance. │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Technical Architecture

### Database Tables
```sql
-- AI recommendations storage
CREATE TABLE ai_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    recommendation_type TEXT, -- opportunity, efficiency, risk, growth
    title TEXT,
    description TEXT,
    analysis_data JSONB, -- raw analysis that led to this
    confidence_score DECIMAL, -- how confident AI is (0-1)
    potential_impact TEXT, -- low, medium, high
    suggested_action TEXT, -- what to do
    action_type TEXT, -- create_automation, create_app, contact_customer, etc.
    action_payload JSONB, -- pre-filled data for the action
    status TEXT DEFAULT 'pending', -- pending, implemented, dismissed, expired
    implemented_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    feedback TEXT, -- user feedback on recommendation
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track recommendation outcomes
CREATE TABLE ai_recommendation_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id UUID REFERENCES ai_recommendations(id),
    outcome_type TEXT, -- success, partial, failed
    metrics JSONB, -- measured results
    notes TEXT,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Analysis Flow
1. **Daily Cron Job** (Supabase Edge Function or external)
2. **Gather Org Data** → customers, automations, usage, revenue
3. **Send to AI API** with analysis prompt
4. **Parse Recommendations** → store in `ai_recommendations`
5. **Display in Feed** → dashboard queries today's recommendations

### AI Prompt Template
```
You are analyzing {organization_name}'s business data to identify growth opportunities.

CONTEXT:
- Industry: {industry}
- Location: {location}
- Team Size: {team_size}
- Products/Services: {products}
- Customer Count: {customer_count}
- Monthly Revenue: {revenue}

RECENT DATA:
- New customers this month: {new_customers}
- Churned customers: {churned}
- Top performing automations: {top_automations}
- Underutilized features: {unused_features}

CUSTOMER BREAKDOWN:
{customer_analysis}

Provide 3-5 specific, actionable recommendations. For each:
1. Type (opportunity/efficiency/risk/growth)
2. Clear title (under 10 words)
3. Explanation (2-3 sentences)
4. Suggested action
5. Confidence score (0-1)
6. Potential impact (low/medium/high)

Be specific. Reference actual data points. Prioritize high-impact, low-effort wins.
```

## Phases

### Phase 1: Manual Trigger (MVP)
- Admin clicks "Analyze My Business" button
- AI analyzes available data
- Recommendations displayed immediately
- Store in database for history

### Phase 2: Daily Automated Analysis
- Supabase cron or external scheduler
- Runs analysis overnight
- Fresh recommendations each morning
- Email digest option

### Phase 3: Action Integration
- "Create Automation" pre-fills automation builder
- "Create App" pre-fills app builder
- Track which recommendations → implementations
- Measure outcomes

### Phase 4: Learning Loop
- AI sees which recommendations were implemented
- Tracks success metrics
- Improves future recommendations
- Personalized to org's patterns

### Phase 5: Autonomous Agents
- AI can draft automations directly
- Admin approval workflow
- Self-optimizing campaigns
- Proactive scaling

## On Agents (Future)
Agents differ from current AI in key ways:
- **Autonomous execution** - can take actions, not just suggest
- **Multi-step reasoning** - chain together complex workflows
- **Memory and learning** - improve based on outcomes
- **Parallel operation** - multiple agents handling different domains

Potential Royalty agents:
- **Growth Agent** - continuously optimizes customer acquisition
- **Retention Agent** - monitors and prevents churn
- **Efficiency Agent** - finds and builds automations
- **Content Agent** - generates marketing/blog content

## Notes from Jay
- "Lead the way" - AI should be proactive, not just reactive
- Admin-only initially, public when templates are ready
- Open to creating new skills to leverage AI better
- Agents are on the radar for future scaling

---

*This document captures the vision. Implementation starts with Phase 1 MVP.*
