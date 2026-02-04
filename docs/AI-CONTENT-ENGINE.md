# AI Content Engine - Architecture & Quality System

**Goal:** Generate content that reads like a talented NYT publicist wrote it, not AI slop.

**Principle:** Specificity beats generality. Every article should feel like it was written BY this business, FOR their specific audience, with real insight.

---

## Table of Contents

1. [The Difference: AI Slop vs. Great Content](#the-difference-ai-slop-vs-great-content)
2. [Content Quality Pipeline](#content-quality-pipeline)
3. [Phase 1: Context Gathering](#phase-1-context-gathering-during-app-setup)
4. [Phase 2: Competitor Research](#phase-2-competitor-research-system)
5. [Phase 3: Strategy Generation](#phase-3-content-strategy-generation)
6. [Phase 4: Quality Writing](#phase-4-quality-focused-writing)
7. [Phase 5: Quality Gate](#phase-5-quality-gate-self-critique)
8. [Phase 6: Tracking & Learning](#phase-6-database---content-generation-tracking)
9. [URL Structure](#url-structure-decision)
10. [Intelligence Feed Integration](#integration-with-intelligence-feed)
11. [Next Steps to Build](#next-steps-to-build)
12. [Quality Mantras](#quality-mantras)

---

## The Difference: AI Slop vs. Great Content

| AI Slop | Great Content |
|---------|---------------|
| "Email marketing is important for businesses" | "When Sarah's Bakery started sending 'Fresh from the Oven' alerts at 6am, regulars started lining up before doors opened" |
| Generic stats everyone uses | Specific data from the business or real research |
| Obvious conclusions | Non-obvious insights that make readers think |
| No personality or voice | Distinct voice that matches the brand |
| "5 Tips for X" listicles | Deep dives with actionable frameworks |
| Could be about any business | Could ONLY be about this specific business |

---

## Content Quality Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AI CONTENT ENGINE                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. CONTEXT DEPTH                    2. RESEARCH                    │
│  ┌──────────────────┐               ┌──────────────────┐            │
│  │ Business story   │               │ Competitor blogs │            │
│  │ Founder journey  │               │ Industry news    │            │
│  │ Customer avatars │      +        │ Real statistics  │            │
│  │ Unique voice     │               │ Content gaps     │            │
│  │ Pain points      │               │ What's working   │            │
│  └──────────────────┘               └──────────────────┘            │
│           │                                  │                       │
│           └──────────────┬───────────────────┘                       │
│                          ▼                                           │
│  3. STRATEGY                                                         │
│  ┌──────────────────────────────────────────────────────┐           │
│  │ Content pillars tailored to THIS business            │           │
│  │ Topics that fill gaps competitors miss               │           │
│  │ Series that build authority over time                │           │
│  └──────────────────────────────────────────────────────┘           │
│                          │                                           │
│                          ▼                                           │
│  4. WRITING (Quality-Focused)                                        │
│  ┌──────────────────────────────────────────────────────┐           │
│  │ • Lead with specific story/example                   │           │
│  │ • Include real data (never make up stats)            │           │
│  │ • Match brand voice exactly                          │           │
│  │ • Add non-obvious insights                           │           │
│  │ • End with actionable next step                      │           │
│  └──────────────────────────────────────────────────────┘           │
│                          │                                           │
│                          ▼                                           │
│  5. QUALITY GATE                                                     │
│  ┌──────────────────────────────────────────────────────┐           │
│  │ Self-critique: "What would a skeptical editor say?"  │           │
│  │ Voice check: "Does this sound like the brand?"       │           │
│  │ Specificity check: "Could this be about anyone?"     │           │
│  │ Value check: "Would I share this?"                   │           │
│  └──────────────────────────────────────────────────────┘           │
│                          │                                           │
│                          ▼                                           │
│  6. PUBLISH → DISTRIBUTE                                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Context Gathering (During App Setup)

When a user creates a newsletter/blog app within a project, we gather rich context:

### Business Story Questions

```javascript
const CONTENT_CONTEXT_QUESTIONS = {
    // The Story
    story: {
        origin: "How did this business start? What's the origin story?",
        mission: "What does this business believe that others don't?",
        differentiator: "What can you do that competitors can't or won't?",
        milestone: "What's a proud moment or achievement worth sharing?"
    },

    // The Audience
    audience: {
        primary: "Describe your ideal customer in detail",
        painPoints: "What problems keep your customers up at night?",
        aspirations: "What does success look like for your customers?",
        objections: "What hesitations do people have before buying?"
    },

    // The Voice
    voice: {
        personality: "If your brand were a person, how would they talk?",
        tone: "Formal? Casual? Witty? Warm? Technical?",
        avoid: "What words or phrases should we NEVER use?",
        examples: "Share 2-3 examples of content you love"
    },

    // The Competition
    competitors: {
        urls: "List 3-5 competitor websites or blogs",
        respect: "What do competitors do well?",
        gaps: "What do competitors miss or get wrong?",
        differentiate: "How should your content feel different?"
    },

    // The Goals
    goals: {
        primary: "What's the #1 goal for this blog?",
        topics: "What topics should we definitely cover?",
        avoid: "Any topics that are off-limits?",
        frequency: "How often should new content publish?"
    }
};
```

### Storage

```sql
-- Add to customer_apps.settings JSONB
{
    "newsletter": {
        "content_context": {
            "story": {
                "origin": "Started in my garage in 2019...",
                "mission": "We believe small businesses deserve enterprise tools",
                "differentiator": "We're the only ones who...",
                "milestone": "Helped 500+ businesses scale"
            },
            "audience": {
                "primary": "Small business owners, 30-50, overwhelmed by tech",
                "pain_points": ["Too many tools", "No time for marketing"],
                "aspirations": ["More customers", "Less manual work"]
            },
            "voice": {
                "personality": "Friendly expert, like a smart friend",
                "tone": "Warm, practical, no jargon",
                "avoid": ["synergy", "leverage", "disrupt"]
            },
            "competitors": [
                "https://competitor1.com/blog",
                "https://competitor2.com/blog"
            ]
        }
    }
}
```

---

## Phase 2: Competitor Research System

### What We Analyze

```javascript
async function analyzeCompetitor(url) {
    // 1. Fetch their blog/content pages
    const pages = await fetchSitemap(url) || await crawlBlog(url);

    // 2. For each article, extract:
    const analysis = {
        topics: [],           // What they write about
        headlines: [],        // How they title content
        formats: [],          // Listicle, how-to, case study, etc.
        wordCounts: [],       // Short vs long form
        publishFrequency: 0,  // How often they post
        engagement: [],       // Comments, shares if visible
        keywords: [],         // SEO keywords they target
        gaps: []              // What they DON'T cover
    };

    // 3. Find patterns
    return {
        topPerforming: "Topics that seem to get engagement",
        contentGaps: "What they're missing that we can own",
        voiceAnalysis: "How they sound (formal, casual, etc.)",
        opportunities: "Where we can differentiate"
    };
}
```

### Research Database

```sql
-- Competitor research cache
CREATE TABLE IF NOT EXISTS competitor_research (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES customer_apps(id) ON DELETE CASCADE,
    competitor_url TEXT NOT NULL,

    -- Analysis results
    topics JSONB DEFAULT '[]',
    headlines JSONB DEFAULT '[]',
    content_gaps JSONB DEFAULT '[]',
    voice_analysis TEXT,
    opportunities JSONB DEFAULT '[]',

    -- Raw data
    articles_analyzed INTEGER DEFAULT 0,
    last_analyzed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(app_id, competitor_url)
);
```

---

## Phase 3: Content Strategy Generation

Based on context + research, generate a content strategy:

```javascript
async function generateContentStrategy(appId) {
    const context = await getContentContext(appId);
    const research = await getCompetitorResearch(appId);
    const industry = await getIndustryInsights(context.industry);

    const prompt = `
You are a content strategist for ${context.story.business_name}.

## Business Context
${JSON.stringify(context, null, 2)}

## Competitor Analysis
${JSON.stringify(research, null, 2)}

## Your Task
Create a content strategy that:
1. Fills gaps competitors miss
2. Showcases what makes this business unique
3. Speaks directly to their audience's pain points
4. Matches their brand voice exactly

## Output Format
{
    "content_pillars": [
        {
            "name": "Pillar name",
            "description": "What this pillar covers",
            "why": "Why this matters for their audience",
            "example_topics": ["Topic 1", "Topic 2", "Topic 3"]
        }
    ],
    "first_month_calendar": [
        {
            "week": 1,
            "title": "Article title",
            "topic": "Which pillar",
            "angle": "Unique angle for this business",
            "outline": ["Section 1", "Section 2", "Section 3"],
            "hook": "Opening line that grabs attention"
        }
    ],
    "series_ideas": [
        {
            "name": "Series name",
            "articles": 5,
            "description": "What this series covers",
            "why_series": "Why this works as a series"
        }
    ],
    "differentiation": "How this content will feel different from competitors"
}
`;

    return await callAI(prompt);
}
```

---

## Phase 4: Quality-Focused Writing

### The Writing Prompt Structure

```javascript
async function writeArticle(articlePlan, context) {
    const prompt = `
You are a talented writer crafting content for ${context.business_name}.

## Voice Guidelines
- Personality: ${context.voice.personality}
- Tone: ${context.voice.tone}
- NEVER use these words: ${context.voice.avoid.join(', ')}

## Audience
- Who they are: ${context.audience.primary}
- Their pain points: ${context.audience.pain_points.join(', ')}
- What they want: ${context.audience.aspirations.join(', ')}

## This Article
- Title: ${articlePlan.title}
- Angle: ${articlePlan.angle}
- Outline: ${articlePlan.outline.join(' → ')}

## Quality Requirements
1. LEAD WITH SPECIFICITY: Start with a concrete story, example, or scenario. Never start with "In today's world..." or generic statements.

2. INCLUDE REAL VALUE: Every section must teach something actionable. If a reader can't DO something after reading, it's not valuable.

3. MATCH THE VOICE: Read your output aloud. Does it sound like a ${context.voice.personality} would say it?

4. NO FILLER: Remove any sentence that doesn't add value. "It's important to note that..." = delete.

5. SPECIFIC > GENERIC: Instead of "many businesses struggle with X", say "When [specific type of business] faces X, they often..."

6. END WITH ACTION: The final section should give readers a clear next step.

## Format
- 1200-1800 words
- Use subheadings (H2, H3)
- Include 2-3 specific examples
- Add relevant internal links where [royalty:*] embeds make sense

Write the complete article now:
`;

    return await callAI(prompt);
}
```

---

## Phase 5: Quality Gate (Self-Critique)

Before publishing, run a quality check:

```javascript
async function qualityCheck(article, context) {
    const prompt = `
You are a tough editor reviewing this article for ${context.business_name}.

## The Article
${article}

## Check These Quality Criteria

1. **Specificity Score (1-10)**
   - Could this article be about ANY business, or specifically THIS one?
   - Are there concrete examples, numbers, scenarios?
   - Rate and explain.

2. **Voice Match (1-10)**
   - Does this sound like a ${context.voice.personality}?
   - Are there any words/phrases that feel off-brand?
   - Rate and explain.

3. **Value Density (1-10)**
   - Can readers DO something after reading each section?
   - Is there filler that should be cut?
   - Rate and explain.

4. **Hook Strength (1-10)**
   - Does the opening grab attention?
   - Would you keep reading after the first paragraph?
   - Rate and explain.

5. **AI Slop Check**
   - Does this feel human-written or obviously AI?
   - Flag any phrases that scream "AI wrote this"

## Output
{
    "overall_score": 0-10,
    "publish_ready": true/false,
    "issues": ["Issue 1", "Issue 2"],
    "suggested_edits": [
        {
            "location": "paragraph 2",
            "current": "original text",
            "suggested": "improved text",
            "reason": "why this is better"
        }
    ],
    "verdict": "Publish as-is / Needs minor edits / Needs rewrite"
}
`;

    const review = await callAI(prompt);

    // If score < 7, rewrite with feedback
    if (review.overall_score < 7) {
        return await rewriteWithFeedback(article, review, context);
    }

    // If score 7-8, apply suggested edits
    if (review.overall_score < 9 && review.suggested_edits.length > 0) {
        return await applyEdits(article, review.suggested_edits);
    }

    return article;
}
```

---

## Phase 6: Database - Content Generation Tracking

```sql
-- Track content generation for quality improvement
CREATE TABLE IF NOT EXISTS content_generation_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id UUID REFERENCES newsletter_articles(id),
    app_id UUID REFERENCES customer_apps(id),

    -- Generation details
    topic TEXT,
    outline JSONB,
    competitor_research_used JSONB,

    -- Quality metrics
    initial_score DECIMAL(3,1),
    final_score DECIMAL(3,1),
    rewrites_needed INTEGER DEFAULT 0,
    edits_applied INTEGER DEFAULT 0,

    -- Timing
    generation_started_at TIMESTAMPTZ,
    generation_completed_at TIMESTAMPTZ,

    -- Post-publish metrics (for learning)
    views INTEGER DEFAULT 0,
    avg_time_on_page INTEGER,
    scroll_depth DECIMAL(5,2),
    shares INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Learn what works
CREATE INDEX idx_content_log_performance
    ON content_generation_log(app_id, final_score DESC, views DESC);
```

---

## URL Structure Decision

**Recommendation: Subdirectory first, custom domains Phase 2**

### Phase 1 (Now)
```
royaltyapp.ai/blog/                    # Royalty's blog
royaltyapp.ai/a/jays-coffee/blog/      # Client blogs
royaltyapp.ai/a/jays-coffee/blog/en/fresh-roast-fridays/
```

### Phase 2 (Future)
```
blog.jayscoffee.com/en/fresh-roast-fridays/  # Custom domain
```

Custom domains require:
- SSL certificate provisioning (Let's Encrypt)
- DNS verification flow
- CDN configuration
- More complex routing

Start simple, add complexity when clients demand it.

---

## Integration with Intelligence Feed

The AI Intelligence system should recommend blog creation:

```javascript
// In ai-recommendations, add blog suggestion logic
const blogRecommendation = {
    type: 'growth',
    title: 'Start a blog to build authority',
    description: `Based on your industry (${org.industry}) and customer base, content marketing could drive 3x more organic traffic than paid ads.`,
    confidence: 0.85,
    action_payload: {
        action: 'create_blog_app',
        suggested_topics: ['Topic based on their data'],
        competitor_analysis_ready: true
    },
    reasoning: [
        'Competitors in your space are publishing 2-4x/month',
        'Your customers search for topics you could own',
        'Content builds trust before they ever contact you'
    ]
};
```

---

## Next Steps to Build

### Immediate (This Sprint)

| Task | Files to Create/Edit | Description |
|------|---------------------|-------------|
| **Context Gathering UI** | `app/app-builder.html`, `app/app-builder.js` | Add Step 2.5 for newsletter apps with story/audience/voice questions |
| **Content Context API** | `app/content-context.js` | Save/load content context, call `save_content_context` RPC |
| **Public Blog Home** | `blog/app-blog.html` | Render blog home for `royaltyapp.ai/a/{slug}/blog/` |
| **Article Page** | `blog/article.html` | Single article view with SEO, schema, embeds |

### Next Sprint

| Task | Files to Create/Edit | Description |
|------|---------------------|-------------|
| **Competitor Fetcher** | `app/competitor-research.js` | WebFetch competitor blogs, extract topics/headlines |
| **Research Analyzer** | `app/research-analyzer.js` | AI analysis of competitor content, find gaps |
| **Strategy Generator** | `app/content-strategy.js` | Generate content pillars and calendar from context + research |
| **Strategy Preview UI** | `app/strategy-preview.html` | Show generated strategy for approval |

### Following Sprint

| Task | Files to Create/Edit | Description |
|------|---------------------|-------------|
| **Article Writer** | `app/article-writer.js` | Generate article from outline using context/voice |
| **Quality Checker** | `app/quality-check.js` | Self-critique with scoring, auto-rewrite if < 7 |
| **Article Editor** | `app/article-editor.html` | Edit/preview articles before publish |
| **One-Click Publish** | `app/publish-flow.js` | Publish with SEO generation, automation triggers |

### Polish Sprint

| Task | Files to Create/Edit | Description |
|------|---------------------|-------------|
| **Email Distribution** | `app/email-campaign.js` | Send article to subscribers via Resend |
| **Analytics Dashboard** | `app/blog-analytics.html` | Views, time on page, conversions |
| **Multi-Language** | `app/translate-article.js` | AI translation with localized slugs |
| **Sitemap Generator** | `blog/sitemap.xml` | Dynamic XML sitemap for SEO |

### Database Tables (Already Created)

| Table | Status | Purpose |
|-------|--------|---------|
| `newsletter_articles` | ✅ Ready | Article storage with SEO fields |
| `article_series` | ✅ Ready | Multi-part content series |
| `newsletter_subscribers` | ✅ Ready | Subscriber management |
| `email_campaigns` | ✅ Ready | Campaign tracking |
| `competitor_research` | ✅ Ready | Competitor analysis cache |
| `content_strategies` | ✅ Ready | Generated content plans |
| `content_generation_log` | ✅ Ready | Quality tracking and learning |
| `custom_app_requests` | ✅ Ready | Custom app request workflow |

### RPC Functions (Already Created)

| Function | Status | Purpose |
|----------|--------|---------|
| `subscribe_to_newsletter` | ✅ Ready | Public signup with rate limiting |
| `confirm_newsletter_subscription` | ✅ Ready | Double opt-in confirmation |
| `get_published_articles` | ✅ Ready | List articles with pagination |
| `get_article_by_slug` | ✅ Ready | Single article with related content |
| `save_content_context` | ✅ Ready | Store business context for content |
| `add_competitor_for_research` | ✅ Ready | Queue competitor for analysis |
| `get_content_generation_stats` | ✅ Ready | Quality metrics dashboard |

---

## Quality Mantras

- **"Could this be about anyone?"** → If yes, rewrite.
- **"Would I share this?"** → If no, rewrite.
- **"Does this sound like the brand?"** → If no, rewrite.
- **"Is there filler?"** → Cut it.
- **"Where's the specific example?"** → Add one.

---

*Great content isn't about more content. It's about content so good that readers think "this company gets me."*
