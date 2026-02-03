# Skill: Newsletter App

## Overview

This skill guides the creation of newsletter/blogger apps that enable AI-powered content creation, multi-language publishing, and subscriber management with SEO-optimized interlinking.

**First Customer:** Automata (dogfooding our own platform)

---

## Current State (Jan 31, 2026)

### What's Planned (Not Yet Built)

This is Automata's second app type after the Loyalty app. The full implementation plan lives in `/NEWSLETTER-APP-PLAN.md`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    NEWSLETTER APP                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   AI Topic   │───▶│   Content    │───▶│  Multi-Lang  │  │
│  │   Selector   │    │  Generator   │    │  Publisher   │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    ARTICLES                           │  │
│  │  - SEO metadata + JSON-LD schema                     │  │
│  │  - Multi-language versions (hreflang)                │  │
│  │  - Interlinks (series, topics, related)              │  │
│  │  - Embedded widgets (automation/app cards)           │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│         ┌──────────────────┼──────────────────┐            │
│         ▼                  ▼                  ▼            │
│  ┌────────────┐    ┌────────────┐    ┌────────────┐       │
│  │ Subscriber │    │   Email    │    │   Public   │       │
│  │   Signup   │    │  Delivery  │    │   Blog     │       │
│  └────────────┘    └────────────┘    └────────────┘       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Technique: Constraint Cascade

**Layer complexity progressively with checkpoints at each phase.**

### Phase Structure

```
PHASE 1: Database Setup → [CHECKPOINT] →
PHASE 2: Article CRUD → [CHECKPOINT] →
PHASE 3: SEO & Schema → [CHECKPOINT] →
PHASE 4: Interlinking → [CHECKPOINT] →
PHASE 5: Multi-Language → [CHECKPOINT] →
PHASE 6: Dynamic Embeds → [CHECKPOINT] →
PHASE 7: Subscriber Management → [CHECKPOINT] →
PHASE 8: Email Integration → [CHECKPOINT] →
PHASE 9: AI Enhancement
```

**At each checkpoint, ask:**
> "Phase X complete. Here's what we built: [summary]. Ready for Phase Y, or adjustments needed?"

---

## Database Schema

### newsletter_articles
```sql
newsletter_articles (
    id UUID PRIMARY KEY,
    app_id UUID REFERENCES customer_apps(id),
    automation_id UUID REFERENCES automations(id),

    -- Content
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    excerpt TEXT,
    content TEXT NOT NULL,
    content_html TEXT,

    -- SEO
    meta_title TEXT,
    meta_description TEXT,
    canonical_url TEXT,
    og_image_url TEXT,
    schema_json JSONB,           -- Pre-rendered JSON-LD

    -- Categorization
    primary_topic TEXT,
    tags TEXT[] DEFAULT '{}',
    series_id UUID,
    series_order INTEGER,

    -- Interlinking
    related_article_ids UUID[] DEFAULT '{}',
    auto_related_ids UUID[] DEFAULT '{}',
    internal_links JSONB DEFAULT '[]',

    -- Publishing
    status TEXT DEFAULT 'draft',
    language TEXT DEFAULT 'en',
    is_primary_language BOOLEAN DEFAULT true,
    primary_article_id UUID,

    -- Timestamps
    published_at TIMESTAMPTZ,
    scheduled_for TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    UNIQUE(app_id, slug, language)
)
```

### article_series
```sql
article_series (
    id UUID PRIMARY KEY,
    app_id UUID REFERENCES customer_apps(id),
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    cover_image_url TEXT,
    meta_title TEXT,
    meta_description TEXT,
    status TEXT DEFAULT 'active',
    article_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(app_id, slug)
)
```

### newsletter_subscribers
```sql
newsletter_subscribers (
    id UUID PRIMARY KEY,
    app_id UUID REFERENCES customer_apps(id),
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    preferred_language TEXT DEFAULT 'en',
    frequency_preference TEXT DEFAULT 'all',
    topic_preferences TEXT[] DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    confirmed_at TIMESTAMPTZ,
    unsubscribed_at TIMESTAMPTZ,
    source TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    emails_sent INTEGER DEFAULT 0,
    emails_opened INTEGER DEFAULT 0,
    emails_clicked INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(app_id, email)
)
```

---

## SEO Implementation

### JSON-LD Schema (Google's Preferred Format)

**Article Schema:**
```json
{
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "{title}",
    "description": "{meta_description}",
    "image": "{og_image_url}",
    "author": {
        "@type": "Organization",
        "name": "{org_name}",
        "url": "{org_url}"
    },
    "publisher": {
        "@type": "Organization",
        "name": "{org_name}",
        "logo": {
            "@type": "ImageObject",
            "url": "{logo_url}"
        }
    },
    "datePublished": "{published_at}",
    "dateModified": "{updated_at}",
    "mainEntityOfPage": "{canonical_url}",
    "inLanguage": "{language}",
    "articleSection": "{primary_topic}",
    "keywords": "{tags}"
}
```

**Breadcrumb Schema:**
```json
{
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Blog", "item": "/blog"},
        {"@type": "ListItem", "position": 2, "name": "{topic}", "item": "/blog/topic/{topic}"},
        {"@type": "ListItem", "position": 3, "name": "{title}", "item": "{url}"}
    ]
}
```

### Meta Tags
```html
<head>
    <title>{meta_title || title} | {org_name}</title>
    <meta name="description" content="{meta_description}">
    <link rel="canonical" href="{canonical_url}">

    <!-- hreflang for translations -->
    <link rel="alternate" hreflang="en" href="/blog/en/{slug}">
    <link rel="alternate" hreflang="es" href="/blog/es/{slug-es}">
    <link rel="alternate" hreflang="x-default" href="/blog/en/{slug}">

    <!-- Open Graph -->
    <meta property="og:type" content="article">
    <meta property="og:title" content="{title}">
    <meta property="og:description" content="{meta_description}">
    <meta property="og:image" content="{og_image_url}">
    <meta property="og:url" content="{canonical_url}">

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{title}">
    <meta name="twitter:description" content="{meta_description}">
    <meta name="twitter:image" content="{og_image_url}">

    <!-- JSON-LD -->
    <script type="application/ld+json">{schema_json}</script>
</head>
```

---

## Dynamic Content Embedding

### Embed Syntax
Articles can include interactive widgets using bracket syntax:

```markdown
[automata:automation type="email-sequence" industry="restaurant"]
[automata:app type="loyalty" features="points,rewards,tiers"]
[automata:custom-request]
[automata:cta text="Start Free Trial" href="/signup"]
```

### Embed Parser
```javascript
function parseEmbeds(content) {
    const embedPattern = /\[automata:(\w+(?:-\w+)*)\s*([^\]]*)\]/g;

    return content.replace(embedPattern, (match, type, attrs) => {
        const attributes = parseAttributes(attrs);

        switch(type) {
            case 'automation':
                return renderAutomationCard(attributes);
            case 'app':
                return renderAppCard(attributes);
            case 'custom-request':
                return renderCustomRequestForm();
            case 'cta':
                return renderCTAButton(attributes);
            default:
                return match;
        }
    });
}
```

### Widget Types

**Automation Card:**
- Shows automation type (email-sequence, social, etc.)
- Features list
- CTA to try the automation

**App Card:**
- Shows app type (loyalty, newsletter)
- Feature badges
- CTA to build the app

**Custom Request Form:**
- Textarea for describing needs
- Email input
- Submit for review
- 48-hour response promise

---

## Interlinking System

### Link Types

1. **Manual Links** - Author explicitly links articles
2. **Auto-Suggested** - AI analyzes content similarity
3. **Series Links** - Automatic prev/next within series
4. **Topic Clusters** - Same primary_topic link together
5. **Historical** - New articles reference relevant past content

### Algorithm
```javascript
async function generateInterlinks(articleId) {
    const article = await getArticle(articleId);
    const allArticles = await getPublishedArticles(article.app_id);

    // 1. Same series (automatic)
    const seriesLinks = allArticles.filter(a =>
        a.series_id === article.series_id && a.id !== article.id
    );

    // 2. Same topic
    const topicLinks = allArticles.filter(a =>
        a.primary_topic === article.primary_topic && a.id !== article.id
    ).slice(0, 5);

    // 3. Shared tags (weighted by overlap)
    const tagLinks = allArticles
        .map(a => ({
            article: a,
            overlap: a.tags.filter(t => article.tags.includes(t)).length
        }))
        .filter(a => a.overlap > 0 && a.article.id !== article.id)
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, 5)
        .map(a => a.article);

    return { series: seriesLinks, topic: topicLinks, related: tagLinks };
}
```

---

## Multi-Language Support

### URL Structure (Subdirectory)
```
/blog/en/automation-basics
/blog/es/conceptos-basicos-de-automatizacion
/blog/fr/bases-de-lautomatisation
```

### Translation Workflow
1. AI generates article in primary language (en)
2. Article saved with `is_primary_language = true`
3. Automation triggers translation for enabled_languages
4. Each translation saved with:
   - `language = target_language`
   - `is_primary_language = false`
   - `primary_article_id = original_id`
   - Localized slug

---

## AI Content Engine

**Goal:** Content that reads like a NYT publicist wrote it, not AI slop.

**Full spec:** `/AI-CONTENT-ENGINE.md`

### The Difference

| AI Slop | Great Content |
|---------|---------------|
| Generic statements | Specific to THIS business |
| "Email marketing is important" | "When Sarah's Bakery sent 6am alerts, lines formed before opening" |
| Fake statistics | Real data or honest benchmarks |
| No personality | Distinct brand voice |

### Content Quality Pipeline

```
1. CONTEXT GATHERING (During App Setup)
   → Business story, audience, voice, competitors

2. COMPETITOR RESEARCH
   → Fetch their blogs, find gaps, identify opportunities

3. STRATEGY GENERATION
   → Content pillars tailored to business
   → Topic calendar with specific angles

4. QUALITY WRITING
   → Lead with specificity
   → Match brand voice exactly
   → Include actionable takeaways

5. QUALITY GATE (Self-Critique)
   → Score 1-10 on: Specificity, Voice, Value, Hook
   → Rewrite if score < 7
   → Apply edits if score 7-8

6. AUTO-PUBLISH → DISTRIBUTE
```

### Context Gathering Questions

During newsletter app setup, we ask:

**The Story**
- How did this business start?
- What do you believe that others don't?
- What can you do that competitors can't?

**The Audience**
- Describe your ideal customer
- What problems keep them up at night?
- What hesitations do they have before buying?

**The Voice**
- If your brand were a person, how would they talk?
- What words should we NEVER use?
- Share content examples you love

**The Competition**
- List 3-5 competitor blogs
- What do they do well? What do they miss?

### Quality Mantras

- **"Could this be about anyone?"** → Rewrite
- **"Would I share this?"** → If no, rewrite
- **"Does this sound like the brand?"** → If no, rewrite
- **"Is there filler?"** → Cut it
- **"Where's the specific example?"** → Add one

---

## Content Strategy (Automata's Blog)

### Honest Approach
- NO fabricated case studies
- Speak to how "tools" help businesses scale
- Reference industry benchmarks, not fake metrics
- CTAs to try AI analysis (leads to onboarding)

### Content Pillars
1. **Use Case Guides** - Real-world automation scenarios
2. **Industry Playbooks** - Restaurant, fitness, professional services
3. **Feature Deep-Dives** - Intelligence, Customer Apps, Automations
4. **Tactical Tips** - Actionable advice, best practices
5. **Behind the Scenes** - How we built Automata

### Initial Series
- "Automation Fundamentals" (5-part beginner series)
- "Industry Playbooks" (one per major industry)

---

## Implementation Checklist

### Phase 1: Database Foundation
- [ ] Create `newsletter_articles` table
- [ ] Create `article_series` table
- [ ] Create `newsletter_subscribers` table
- [ ] Create `email_campaigns` table (optional)
- [ ] Add indexes for performance
- [ ] Add RLS policies

### Phase 2: Article CRUD
- [ ] Article list page in admin
- [ ] Article editor with markdown support
- [ ] Draft/Publish workflow
- [ ] Series management
- [ ] Tag management

### Phase 3: SEO & Schema
- [ ] Generate JSON-LD schema on publish
- [ ] Meta tag generation
- [ ] Canonical URL handling
- [ ] XML sitemap generation
- [ ] robots.txt

### Phase 4: Public Blog
- [ ] Blog home page
- [ ] Article detail page
- [ ] Topic index pages
- [ ] Series landing pages
- [ ] Archive page

### Phase 5: Interlinking
- [ ] Related articles widget
- [ ] Series navigation
- [ ] Topic cluster links
- [ ] Auto-interlinking algorithm

### Phase 6: Dynamic Embeds
- [ ] Embed parser
- [ ] Automation card component
- [ ] App card component
- [ ] Custom request form
- [ ] CTA button component

### Phase 7: Subscriber Management
- [ ] Signup form widget
- [ ] Double opt-in flow
- [ ] Unsubscribe flow
- [ ] Preference management

### Phase 8: Multi-Language
- [ ] Translation workflow
- [ ] Language switcher
- [ ] hreflang implementation
- [ ] Localized slugs

### Phase 9: Email Integration
- [ ] Email service setup (Resend)
- [ ] Campaign creation from article
- [ ] Email templates
- [ ] Send scheduling
- [ ] Open/click tracking

---

## Usage

```
/newsletter-app [area]
```

Examples:
- `/newsletter-app database` - Set up database tables
- `/newsletter-app articles` - Build article CRUD
- `/newsletter-app seo` - Implement schema/meta tags
- `/newsletter-app embeds` - Create dynamic widgets
- `/newsletter-app subscribers` - Build subscriber system

---

## Testing Tools

- **Google Rich Results Test** - Validate JSON-LD
- **Schema Markup Validator** - Check schema syntax
- **PageSpeed Insights** - Performance
- **Mobile-Friendly Test** - Responsive design

---

## Sources

- [Google Article Schema Documentation](https://developers.google.com/search/docs/appearance/structured-data/article)
- [Schema Markup Guide 2026](https://www.wearetg.com/blog/schema-markup/)
- [Schema for Blogs Guide](https://www.pageoptimizer.pro/blog/schema-markup-for-blogs-a-complete-guide-to-boosting-seo-and-visibility)

---

*Last updated: Jan 31, 2026*
