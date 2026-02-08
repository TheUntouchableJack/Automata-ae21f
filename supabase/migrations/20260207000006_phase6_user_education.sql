-- Migration: Phase 6 - User Education Content
-- Seeds FAQ entries, knowledge base articles, and coaching configuration

-- ============================================================================
-- 1. GLOBAL FAQ/KB CONTENT (not tied to specific app)
-- ============================================================================

-- Create global FAQ table for template content
CREATE TABLE IF NOT EXISTS global_faq (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert FAQ entries for Royal AI features
INSERT INTO global_faq (question, answer, category, sort_order) VALUES
('What can Royal AI do?',
'Royal AI is your intelligent business advisor that learns about your business, researches your market, and takes action to grow your loyalty program. Key capabilities:

• **Learn**: Remembers everything you tell it about your business
• **Research**: Can search for competitors, regulations, and market trends
• **Analyze**: Queries your customer data to find insights
• **Act**: Creates announcements, sends messages, runs promotions (with your approval)
• **Improve**: Measures results and learns what works best for your business',
'royal-ai', 1),

('How does Royal AI learn about my business?',
'Royal AI learns through conversations! When you chat, it:

1. **Asks thoughtful questions** about your costs, customers, and goals
2. **Remembers your answers** for future conversations
3. **Extracts facts** from natural conversation (e.g., "Our food cost is 32%")
4. **Never forgets** - knowledge persists across all sessions

The more you chat, the smarter and more personalized its suggestions become.',
'royal-ai', 2),

('What is auto-pilot mode?',
'Auto-pilot mode lets Royal AI take actions automatically when it''s confident they''ll help your business.

**How it works:**
• AI calculates a confidence score (0-100%) for each action
• Actions above your threshold (default 70%) execute automatically
• Lower-confidence actions still need your approval
• You can adjust the threshold or disable auto-pilot anytime

**Safety features:**
• Daily action limits prevent runaway automation
• Large audience actions always need approval
• Full audit log of every AI action',
'royal-ai', 3),

('Can Royal AI research my competitors?',
'Yes! Ask questions like:
• "What are my competitors doing for loyalty?"
• "Who are the top restaurants near me?"
• "What promotions are others running?"

Royal AI will search the web for local competition and their programs, then save insights for future reference.',
'royal-ai', 4),

('Is my business information private?',
'Absolutely. Your data is:

• **Never shared** with other businesses
• **Never used** to train AI models
• **Encrypted** in transit and at rest
• **Only accessed** by Royal AI to help YOU

The knowledge Royal AI learns about your business stays exclusively yours.',
'royal-ai', 5),

('What actions can Royal AI take?',
'Royal AI can help with:

**Announcements**: Post updates to your loyalty app
**Messages**: Send targeted messages to customer segments
**Promotions**: Create flash sales and points multipliers
**Points**: Award bonus points to members
**Automations**: Enable birthday, win-back, and streak rewards

All actions are either approved by you first or auto-approved based on your confidence settings.',
'royal-ai', 6),

('How do I review AI-suggested actions?',
'When Royal AI suggests an action:

1. You''ll see it in the **Pending Actions** section
2. Review the action details and AI''s reasoning
3. Click **Approve** to execute or **Reject** to decline
4. Approved actions execute within 30 seconds

In auto-pilot mode, high-confidence actions skip this queue and execute immediately.',
'royal-ai', 7),

('Can I undo an AI action?',
'It depends on the action:

• **Announcements**: Can be deleted or hidden
• **Messages**: Cannot be unsent once delivered
• **Promotions**: Can be deactivated early
• **Points awarded**: Can be manually adjusted

That''s why lower-confidence actions always require approval first!',
'royal-ai', 8);

-- ============================================================================
-- 2. KNOWLEDGE BASE ARTICLES
-- ============================================================================

-- Create global KB table for template content
CREATE TABLE IF NOT EXISTS global_kb (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'guides',
    sort_order INTEGER DEFAULT 0,
    is_published BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert knowledge base articles
INSERT INTO global_kb (title, slug, content, category, sort_order) VALUES
('Getting Started with Royal AI', 'getting-started-royal-ai',
'# Getting Started with Royal AI

Royal AI is your intelligent business advisor built into Royalty. This guide will help you get the most out of it from day one.

## Your First Conversation

When you first open the Intelligence tab, Royal AI will greet you and start learning about your business. Here''s what to expect:

1. **It asks questions** - Royal AI will ask about your business type, customers, and goals
2. **Answer naturally** - No special format needed, just chat like you would with a consultant
3. **It remembers** - Everything you share is saved for future reference

## Tips for Great Conversations

- **Be specific** - "Our food cost is 32%" is better than "costs are high"
- **Share context** - Tell Royal AI about slow days, busy seasons, and challenges
- **Ask questions** - "What should I do about my Tuesday slump?"

## Next Steps

After your first conversation, explore:
- Enabling auto-pilot mode for hands-free help
- Asking about competitors and market trends
- Reviewing AI-suggested actions

The more you chat, the smarter Royal AI becomes!',
'guides', 1),

('Teaching Royal AI About Your Business', 'teaching-royal-ai',
'# Teaching Royal AI About Your Business

Royal AI gets smarter with every conversation. Here''s how to help it learn effectively.

## What Information Helps

Royal AI benefits most from knowing:

### Financial Metrics
- Average ticket size
- Food/product costs (%)
- Labor costs (%)
- Monthly revenue range
- Margins

### Customer Insights
- Your ideal customer profile
- Age ranges and demographics
- What brings them in
- Why they might leave

### Operations
- Busy and slow periods
- Staffing challenges
- Peak hours
- Seasonal patterns

### Competition
- Who your competitors are
- What they do well
- Your competitive advantage

## Example Answers

**Good**: "Our average ticket is $28, and we see mostly young professionals aged 25-40 who work in the downtown office buildings."

**Better**: "Food cost runs about 32% which is a bit high for our category. Our edge is speed - lunch customers love that we get them in and out in 15 minutes."

## How It''s Used

Royal AI uses this knowledge to:
- Tailor promotional suggestions to your margins
- Target the right customer segments
- Time campaigns for your slow periods
- Compare your metrics to industry benchmarks',
'guides', 2),

('Understanding Confidence Scores', 'understanding-confidence-scores',
'# Understanding Confidence Scores

Royal AI assigns a confidence score to every action it suggests. Here''s what they mean.

## What is Confidence?

Confidence (0-100%) represents how certain Royal AI is that an action will help your business.

## How It''s Calculated

Confidence is based on:

### Historical Success
- Similar actions that worked before get higher confidence
- Failed approaches get lower confidence

### Audience Size
- Smaller, targeted audiences = higher confidence
- Mass messaging = lower confidence (more review needed)

### Action Impact
- Low-risk actions = higher confidence
- High-cost or irreversible = lower confidence

### Context Fit
- Actions matching your goals = higher confidence
- Generic suggestions = lower confidence

## Confidence Thresholds

| Score | Meaning | Behavior |
|-------|---------|----------|
| 70-100% | High confidence | Auto-executes (if enabled) |
| 50-69% | Medium confidence | Queued with countdown |
| 0-49% | Low confidence | Always requires approval |

## Adjusting Your Threshold

In Settings > AI Preferences, you can:
- Raise the threshold (more approval, less automation)
- Lower the threshold (more automation, less approval)
- Disable auto-execute entirely

The default 70% threshold provides a good balance of help and oversight.',
'guides', 3),

('Auto-Pilot Mode Explained', 'auto-pilot-mode',
'# Auto-Pilot Mode Explained

Auto-pilot lets Royal AI take action on your behalf. Here''s everything you need to know.

## Benefits of Auto-Pilot

- **Time savings** - AI handles routine optimizations
- **Faster response** - Actions happen without waiting for approval
- **24/7 automation** - AI works even when you''re away
- **Data-driven** - Decisions based on real performance metrics

## How It Works

1. Royal AI evaluates an action
2. Calculates a confidence score
3. If score >= your threshold, executes automatically
4. If score < threshold, queues for your approval

## Safety Guardrails

Auto-pilot includes protections:

- **Daily limits** - Max 20 actions per day (adjustable)
- **Mass targeting block** - Large audiences always need approval
- **High-value protection** - Big point awards need approval
- **Full audit log** - Every action is recorded

## Recommended Settings

| Business Stage | Threshold | Daily Limit |
|----------------|-----------|-------------|
| Just starting | 80% | 5 |
| Comfortable | 70% | 20 |
| Fully trusting | 60% | 50 |

## Enabling Auto-Pilot

1. Go to Settings > AI Preferences
2. Toggle "Auto-pilot mode" on
3. Set your confidence threshold
4. Set your daily action limit

Start conservative and adjust as you see results!',
'guides', 4),

('Royal AI Research Tools', 'royal-ai-research',
'# Royal AI Research Tools

Royal AI can research external information to help inform your strategy.

## Available Research

### Competitor Analysis
Ask: "What are my competitors doing?"
- Finds local competitors
- Reviews their loyalty programs
- Identifies their pricing and offerings
- Spots opportunities they''re missing

### Industry Regulations
Ask: "What regulations affect my business?"
- Local health and safety requirements
- Labor laws and minimum wage
- Loyalty program legal considerations
- Tax and reporting requirements

### Market Trends
Ask: "What''s trending in my industry?"
- Consumer behavior shifts
- Technology adoption
- Seasonal patterns
- Economic indicators

### Benchmarks
Ask: "How do my metrics compare?"
- Industry-standard margins
- Average customer retention rates
- Typical loyalty enrollment rates
- Visit frequency benchmarks

## How Research Works

1. You ask a research question
2. Royal AI searches relevant sources
3. Results are summarized for you
4. Key insights are saved to your knowledge base

## Using Research Insights

After research, Royal AI can:
- Compare your metrics to benchmarks
- Suggest counter-moves to competitors
- Prepare for regulatory changes
- Adapt to market trends',
'guides', 5),

('Reviewing AI Actions', 'reviewing-ai-actions',
'# Reviewing AI Actions

Learn how to review, approve, and learn from Royal AI''s suggestions.

## The Action Queue

Pending actions appear in your Intelligence dashboard showing:
- **Action type** (announcement, message, promotion, etc.)
- **Target** (who it affects)
- **Confidence score** (AI certainty)
- **Reasoning** (why AI suggests it)

## Approving Actions

To approve:
1. Review the action details
2. Check the reasoning makes sense
3. Click "Approve" to execute

Approved actions run within 30 seconds.

## Rejecting Actions

To reject:
1. Click "Reject" on the action
2. Optionally, tell Royal AI why in chat

Royal AI learns from rejections and adjusts future suggestions.

## After Execution

24 hours after an action executes, Royal AI:
1. Measures the outcome (visits, engagement, etc.)
2. Calculates a success score
3. Saves learnings for future reference

## Viewing History

In the Action History tab, you can see:
- All past actions (approved, rejected, auto-executed)
- Outcome measurements and success scores
- What Royal AI learned

Use this to understand what works for your specific business!',
'guides', 6);

-- ============================================================================
-- 3. COACHING CONFIGURATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS coaching_triggers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger_event TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    icon TEXT DEFAULT 'lightbulb',
    priority INTEGER DEFAULT 0,
    show_once BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO coaching_triggers (trigger_event, title, message, icon, priority) VALUES
('first_intelligence_visit',
'Welcome to Royal AI!',
'I''m your intelligent business advisor. Let''s start by learning about your business. What''s your biggest challenge right now?',
'sparkles', 100),

('discovery_questions_5',
'I''m Learning!',
'Nice! I''m starting to understand your business better. The more we talk, the better my suggestions become.',
'brain', 80),

('first_action_queued',
'Action Ready for Review',
'I''ve prepared an action for you. Review it below - you can approve, edit, or dismiss it.',
'clipboard-check', 90),

('auto_pilot_enabled',
'Auto-Pilot Active',
'Auto-pilot is ON. I''ll only auto-execute when I''m 70%+ confident. You can always intervene or adjust settings.',
'rocket', 95),

('first_auto_action',
'First Autonomous Action!',
'I just took my first autonomous action! Check back in 24 hours to see how it performed.',
'check-circle', 85),

('outcome_measured',
'Results Are In',
'I measured the outcome of a recent action. Check the Action History to see what we learned!',
'chart-bar', 70),

('competitor_research_done',
'Competitor Intel Ready',
'I''ve gathered intelligence on your competitors. Ask me about their strategies or how to differentiate.',
'search', 75),

('knowledge_milestone_10',
'Growing Knowledge Base',
'I now know 10+ facts about your business! My recommendations are getting more personalized.',
'database', 60);

-- ============================================================================
-- 4. USER COACHING PROGRESS TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_coaching_progress (
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    trigger_event TEXT NOT NULL,
    shown_at TIMESTAMPTZ DEFAULT NOW(),
    dismissed_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, organization_id, trigger_event)
);

-- ============================================================================
-- 5. COMMENTS
-- ============================================================================

COMMENT ON TABLE faq_items IS 'FAQ entries for the help section, including Royal AI features';
COMMENT ON TABLE knowledgebase_articles IS 'Knowledge base articles for in-depth feature guides';
COMMENT ON TABLE coaching_triggers IS 'Contextual coaching tooltips and modals configuration';
COMMENT ON TABLE user_coaching_progress IS 'Tracks which coaching has been shown to each user';
