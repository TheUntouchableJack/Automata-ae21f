# Newsletter/Blogger App - Implementation Plan

**Goal:** Build a second app type that enables AI-powered content creation, multi-language publishing, and subscriber management with SEO-optimized interlinking.

**First Customer:** Automata itself (dogfooding)

---

## 1. Strategic Vision

### For Automata's Own Newsletter
- **Topic:** Helping businesses understand automation scenarios
- **Value Prop:** Show real-world examples of how intelligence + apps improve business
- **Content Types:**
  - Use case deep-dives
  - Industry-specific automation guides
  - Success story templates
  - Feature announcements
  - Tips & best practices

### For Clients
- AI analyzes their business context (industry, goals, customers)
- Suggests relevant topics automatically
- Generates localized content in their target languages
- Builds SEO authority through intelligent interlinking

---

## 2. Architecture Overview

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
│  │  - SEO metadata (title, desc, keywords)              │  │
│  │  - Multi-language versions                            │  │
│  │  - Interlinks (related, series, topics)              │  │
│  │  - Canonical URLs                                     │  │
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

## 3. Database Schema Additions

### A. Newsletter App Configuration

```sql
-- Add 'newsletter' to app_type enum
ALTER TYPE app_type ADD VALUE IF NOT EXISTS 'newsletter';

-- Newsletter-specific settings in customer_apps.settings JSONB:
{
  "newsletter": {
    "default_language": "en",
    "enabled_languages": ["en", "es", "fr", "de"],
    "publish_frequency": "weekly",  -- daily, weekly, biweekly, monthly
    "ai_topic_enabled": true,
    "topics": ["automation", "growth", "efficiency"],
    "subscriber_fields": ["email", "name", "preferred_language"],
    "double_optin": true,
    "welcome_email_enabled": true,
    "footer_text": "Unsubscribe anytime...",
    "from_name": "Automata Blog",
    "reply_to": "hello@automata.app"
  }
}
```

### B. Articles Table (Enhanced blog_posts)

```sql
-- New table for newsletter articles (more SEO-focused than blog_posts)
CREATE TABLE newsletter_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    automation_id UUID REFERENCES automations(id),

    -- Content
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    excerpt TEXT,  -- Short description for listings/email
    content TEXT NOT NULL,
    content_html TEXT,  -- Pre-rendered HTML

    -- SEO
    meta_title TEXT,  -- Override for <title> tag
    meta_description TEXT,  -- 155 chars for search results
    canonical_url TEXT,
    og_image_url TEXT,

    -- Categorization
    primary_topic TEXT,
    tags TEXT[] DEFAULT '{}',
    series_id UUID,  -- For article series (Part 1, Part 2...)
    series_order INTEGER,

    -- Interlinking
    related_article_ids UUID[] DEFAULT '{}',  -- Manual related
    auto_related_ids UUID[] DEFAULT '{}',  -- AI-suggested related
    internal_links JSONB DEFAULT '[]',  -- [{url, anchor_text, context}]

    -- Publishing
    status TEXT DEFAULT 'draft',  -- draft, scheduled, published, archived
    language TEXT DEFAULT 'en',
    is_primary_language BOOLEAN DEFAULT true,  -- Original vs translation
    primary_article_id UUID,  -- Links translations to original

    -- Timestamps
    published_at TIMESTAMPTZ,
    scheduled_for TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Soft delete
    deleted_at TIMESTAMPTZ,

    UNIQUE(app_id, slug, language)
);

-- Index for SEO queries
CREATE INDEX idx_articles_published ON newsletter_articles(app_id, status, language, published_at DESC);
CREATE INDEX idx_articles_slug ON newsletter_articles(app_id, slug, language);
CREATE INDEX idx_articles_series ON newsletter_articles(series_id, series_order);
```

### C. Article Series (For Multi-Part Content)

```sql
CREATE TABLE article_series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,

    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    cover_image_url TEXT,

    -- SEO
    meta_title TEXT,
    meta_description TEXT,

    status TEXT DEFAULT 'active',  -- active, completed, archived
    article_count INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(app_id, slug)
);
```

### D. Newsletter Subscribers (Enhanced app_members)

```sql
-- Use existing app_members table with newsletter-specific fields in custom columns
-- OR create a dedicated subscribers table for cleaner separation

CREATE TABLE newsletter_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,

    -- Contact
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,

    -- Preferences
    preferred_language TEXT DEFAULT 'en',
    frequency_preference TEXT DEFAULT 'all',  -- all, weekly_digest, monthly_digest
    topic_preferences TEXT[] DEFAULT '{}',  -- Filter by topics

    -- Status
    status TEXT DEFAULT 'pending',  -- pending, active, unsubscribed, bounced, complained
    confirmed_at TIMESTAMPTZ,
    unsubscribed_at TIMESTAMPTZ,
    unsubscribe_reason TEXT,

    -- Tracking
    source TEXT,  -- signup_form, import, api, referral
    referrer_id UUID,  -- If referred by another subscriber
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,

    -- Engagement
    emails_sent INTEGER DEFAULT 0,
    emails_opened INTEGER DEFAULT 0,
    emails_clicked INTEGER DEFAULT 0,
    last_email_at TIMESTAMPTZ,
    last_opened_at TIMESTAMPTZ,
    last_clicked_at TIMESTAMPTZ,

    -- Compliance
    ip_address INET,
    user_agent TEXT,
    consent_text TEXT,  -- What they agreed to

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(app_id, email)
);

CREATE INDEX idx_subscribers_active ON newsletter_subscribers(app_id, status) WHERE status = 'active';
```

### E. Email Campaigns

```sql
CREATE TABLE email_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    article_id UUID REFERENCES newsletter_articles(id),

    -- Content
    subject TEXT NOT NULL,
    preview_text TEXT,  -- Email preview snippet
    body_html TEXT NOT NULL,
    body_text TEXT,  -- Plain text fallback

    -- Targeting
    target_languages TEXT[] DEFAULT '{}',  -- Empty = all
    target_topics TEXT[] DEFAULT '{}',  -- Empty = all

    -- Status
    status TEXT DEFAULT 'draft',  -- draft, scheduled, sending, sent, failed
    scheduled_for TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,

    -- Stats
    recipients_count INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    clicked_count INTEGER DEFAULT 0,
    unsubscribed_count INTEGER DEFAULT 0,
    bounced_count INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. Interlinking System

### How It Works

1. **Manual Links**: Author explicitly links to related articles
2. **Auto-Suggested**: AI analyzes content and suggests related articles
3. **Series Links**: Automatic prev/next within a series
4. **Topic Clusters**: Articles tagged with same topic link together
5. **Historical**: New articles reference relevant historical content

### Implementation

```javascript
// Auto-interlinking algorithm
async function generateInterlinks(articleId) {
    const article = await getArticle(articleId);
    const allArticles = await getPublishedArticles(article.app_id);

    // 1. Same series (automatic)
    const seriesLinks = allArticles.filter(a =>
        a.series_id === article.series_id && a.id !== article.id
    );

    // 2. Same primary topic
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

    // 4. AI content similarity (future enhancement)
    // const aiSimilar = await getAISimilarArticles(article);

    return {
        series: seriesLinks,
        topic: topicLinks,
        related: tagLinks
    };
}
```

### SEO Link Structure

```html
<!-- In article template -->
<article>
    <h1>{title}</h1>

    <!-- Series navigation (if part of series) -->
    {#if series}
    <nav class="series-nav">
        <span>Part {series_order} of {series.article_count}: {series.title}</span>
        {#if prev_in_series}<a href="{prev_in_series.url}">← Previous</a>{/if}
        {#if next_in_series}<a href="{next_in_series.url}">Next →</a>{/if}
    </nav>
    {/if}

    <div class="content">{content}</div>

    <!-- Related articles -->
    <aside class="related-articles">
        <h3>Related Reading</h3>
        <ul>
            {#each related_articles as related}
            <li><a href="{related.url}">{related.title}</a></li>
            {/each}
        </ul>
    </aside>

    <!-- More in this topic -->
    <aside class="topic-articles">
        <h3>More on {primary_topic}</h3>
        ...
    </aside>
</article>
```

---

## 5. Multi-Language Content

### URL Structure Options

**Option A: Subdirectory (Recommended)**
```
/blog/en/automation-basics
/blog/es/conceptos-basicos-de-automatizacion
/blog/fr/bases-de-lautomatisation
```

**Option B: Query Parameter**
```
/blog/automation-basics?lang=en
/blog/automation-basics?lang=es
```

**Option C: Subdomain**
```
en.blog.automata.app/automation-basics
es.blog.automata.app/conceptos-basicos
```

### hreflang Implementation

```html
<head>
    <link rel="alternate" hreflang="en" href="/blog/en/automation-basics" />
    <link rel="alternate" hreflang="es" href="/blog/es/conceptos-basicos" />
    <link rel="alternate" hreflang="fr" href="/blog/fr/bases-automatisation" />
    <link rel="alternate" hreflang="x-default" href="/blog/en/automation-basics" />
</head>
```

### Translation Workflow

```
1. AI generates article in primary language (en)
2. Article saved with is_primary_language = true
3. Automation triggers translation for enabled_languages
4. Each translation saved with:
   - language = target language
   - is_primary_language = false
   - primary_article_id = original article ID
   - Localized slug (auto-generated or AI-suggested)
5. All versions linked via primary_article_id
```

---

## 6. Public Blog UI

### Pages Needed

| Page | URL Pattern | Purpose |
|------|-------------|---------|
| Blog Home | `/blog` or `/a/{slug}/blog` | Latest articles, featured series |
| Article | `/blog/{lang}/{article-slug}` | Individual article with SEO |
| Topic | `/blog/{lang}/topic/{topic}` | Articles filtered by topic |
| Series | `/blog/{lang}/series/{series-slug}` | All articles in a series |
| Archive | `/blog/{lang}/archive` | All articles chronologically |
| Subscribe | `/blog/subscribe` | Signup form |

### SEO Requirements

**Core Structure:**
- [ ] Semantic HTML5 (`<article>`, `<nav>`, `<aside>`, `<header>`, `<footer>`)
- [ ] Proper heading hierarchy (single H1, logical H2-H6)
- [ ] Fast load times (< 2s LCP)
- [ ] Mobile-first responsive design
- [ ] Accessible (WCAG 2.1 AA)

**Schema Markup (JSON-LD - Google's preferred format):**
- [ ] Article schema (headline, author, datePublished, image)
- [ ] BreadcrumbList schema for navigation
- [ ] Organization/Person schema for author
- [ ] WebPage schema with speakable for voice search
- [ ] FAQPage schema for Q&A content
- [ ] HowTo schema for tutorial content

**Meta Tags:**
- [ ] Canonical URLs (`<link rel="canonical">`)
- [ ] hreflang for translations
- [ ] Open Graph (og:title, og:description, og:image, og:type, og:url)
- [ ] Twitter Cards (twitter:card, twitter:title, twitter:description, twitter:image)
- [ ] Meta description (155 chars)

**Indexability:**
- [ ] XML Sitemap with lastmod dates
- [ ] robots.txt with sitemap reference
- [ ] Submit sitemap to Google Search Console
- [ ] Internal linking between related content
- [ ] Breadcrumb navigation

**Testing Tools:**
- [ ] Google Rich Results Test
- [ ] Schema Markup Validator
- [ ] PageSpeed Insights
- [ ] Mobile-Friendly Test

---

## 7. Subscriber Experience

### Signup Flow

```
1. User visits /blog or article page
2. Sees email capture form (popup, inline, or floating)
3. Enters email (and optionally name, language preference)
4. Receives confirmation email (double opt-in)
5. Clicks confirm link
6. Status changes to 'active'
7. Receives welcome email (optional)
8. Added to next newsletter send
```

### Unsubscribe Flow

```
1. Click unsubscribe link in email footer
2. Lands on unsubscribe page with:
   - Option to reduce frequency instead
   - Option to change topic preferences
   - Confirm unsubscribe button
3. If confirmed, status = 'unsubscribed'
4. Optional: feedback form (why leaving?)
5. Confirmation page with option to re-subscribe
```

---

## 8. AI Topic Selection

### How It Works

```javascript
async function selectNextTopic(appId) {
    // 1. Get business context
    const org = await getOrganization(appId);
    const recentArticles = await getRecentArticles(appId, 10);
    const subscriberInterests = await getTopicEngagement(appId);

    // 2. Build AI prompt
    const prompt = `
        Business: ${org.name}
        Industry: ${org.industry}
        Goals: ${org.goals.join(', ')}

        Recent articles (avoid repetition):
        ${recentArticles.map(a => `- ${a.title} (${a.primary_topic})`).join('\n')}

        Subscriber engagement by topic:
        ${subscriberInterests.map(t => `- ${t.topic}: ${t.engagement_rate}%`).join('\n')}

        Suggest 3 article topics that would:
        1. Align with the business goals
        2. Engage subscribers based on past behavior
        3. Not repeat recent content
        4. Provide actionable value

        Return JSON: [{topic, title, outline, target_audience}]
    `;

    // 3. Get AI suggestions
    const suggestions = await callAI(prompt);

    // 4. Store as AI recommendations
    await saveTopicSuggestions(appId, suggestions);

    return suggestions;
}
```

---

## 9. Dynamic Content Embedding

### Embeddable Widgets

Articles can include dynamic, interactive widgets that showcase Automata features:

**Automation Cards**
```html
<!-- Embed syntax in article content -->
[automata:automation type="email-sequence" industry="restaurant"]

<!-- Renders as interactive card -->
<div class="automata-embed automation-card" data-type="email-sequence">
    <div class="card-icon">📧</div>
    <h4>Email Sequence Automation</h4>
    <p>Automatically nurture customers with perfectly-timed follow-ups</p>
    <ul class="features">
        <li>✓ Welcome series</li>
        <li>✓ Re-engagement campaigns</li>
        <li>✓ Birthday rewards</li>
    </ul>
    <button class="cta-button" onclick="openAutomataSignup('email-sequence')">
        Try This Automation →
    </button>
</div>
```

**App Cards**
```html
<!-- Embed syntax -->
[automata:app type="loyalty" features="points,rewards,tiers"]

<!-- Renders as app preview -->
<div class="automata-embed app-card" data-type="loyalty">
    <div class="app-preview">
        <img src="/images/loyalty-app-preview.png" alt="Loyalty App">
    </div>
    <h4>Customer Loyalty App</h4>
    <p>Turn one-time buyers into repeat customers</p>
    <div class="features-badges">
        <span>Points System</span>
        <span>Reward Tiers</span>
        <span>Custom Branding</span>
    </div>
    <button class="cta-button">Build Your App →</button>
</div>
```

**Custom App Request**
```html
<!-- Embed syntax -->
[automata:custom-request]

<!-- Renders as request form -->
<div class="automata-embed custom-request-card">
    <h4>Need Something Custom?</h4>
    <p>Describe your ideal app and we'll review it</p>
    <form class="custom-request-form">
        <textarea placeholder="I need an app that..."></textarea>
        <input type="email" placeholder="Your email">
        <button type="submit">Submit for Review</button>
    </form>
    <p class="note">Our team reviews all requests within 48 hours</p>
</div>
```

### Embed Parser

```javascript
// Parse article content and replace embed tags with rendered widgets
function parseEmbeds(content) {
    // Pattern: [automata:type key="value" key2="value2"]
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
                return match; // Unknown embed, leave as-is
        }
    });
}
```

### SEO for Embedded Content

Embedded widgets include:
- Proper alt text for images
- aria-labels for accessibility
- Schema.org Product/Service markup where applicable
- Lazy loading for performance
- Fallback content for no-JS environments

---

## 10. JSON-LD Schema Templates

### Article Schema
```json
{
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "{title}",
    "description": "{meta_description}",
    "image": "{og_image_url}",
    "author": {
        "@type": "Organization",
        "name": "Automata",
        "url": "https://automata.app"
    },
    "publisher": {
        "@type": "Organization",
        "name": "Automata",
        "logo": {
            "@type": "ImageObject",
            "url": "https://automata.app/logo.png"
        }
    },
    "datePublished": "{published_at}",
    "dateModified": "{updated_at}",
    "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": "{canonical_url}"
    },
    "inLanguage": "{language}",
    "articleSection": "{primary_topic}",
    "keywords": "{tags}"
}
```

### Breadcrumb Schema
```json
{
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
        {
            "@type": "ListItem",
            "position": 1,
            "name": "Blog",
            "item": "https://automata.app/blog"
        },
        {
            "@type": "ListItem",
            "position": 2,
            "name": "{topic}",
            "item": "https://automata.app/blog/topic/{topic}"
        },
        {
            "@type": "ListItem",
            "position": 3,
            "name": "{title}",
            "item": "{canonical_url}"
        }
    ]
}
```

### FAQ Schema (for Q&A content)
```json
{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
        {
            "@type": "Question",
            "name": "How does automation help my business?",
            "acceptedAnswer": {
                "@type": "Answer",
                "text": "Automation streamlines repetitive tasks..."
            }
        }
    ]
}
```

---

## 11. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Add `newsletter` app type to builder
- [ ] Create `newsletter_articles` table
- [ ] Create `newsletter_subscribers` table
- [ ] Basic article CRUD in admin
- [ ] Simple subscriber signup form
- [ ] Public article page with basic SEO

### Phase 2: Content System (Week 3-4)
- [ ] Article series support
- [ ] Topic tagging system
- [ ] Auto-interlinking algorithm
- [ ] Related articles widget
- [ ] Archive and topic index pages

### Phase 3: Multi-Language (Week 5-6)
- [ ] Translation workflow (manual first)
- [ ] Language switcher UI
- [ ] hreflang implementation
- [ ] Localized URLs
- [ ] (Future) AI translation integration

### Phase 4: Email Integration (Week 7-8)
- [ ] Email service integration (Resend/SendGrid)
- [ ] Campaign creation from article
- [ ] Email template builder
- [ ] Send scheduling
- [ ] Open/click tracking

### Phase 5: AI Enhancement (Week 9-10)
- [ ] AI topic suggestion
- [ ] AI content generation integration
- [ ] Auto-interlinking via content similarity
- [ ] Subscriber engagement analysis

---

## 12. Automata's Own Newsletter Content Plan

### Content Pillars

1. **Use Case Deep-Dives**
   - "How a Coffee Shop Increased Repeat Visits 40% with Loyalty Automation"
   - "Email Sequences That Turn One-Time Buyers into Regulars"

2. **Industry Guides**
   - "Restaurant Automation Playbook"
   - "Fitness Studio Member Retention Guide"
   - "Professional Services Client Nurturing"

3. **Feature Spotlights**
   - "Meet Intelligence: Your AI Business Advisor"
   - "Customer Apps 101: Build Your First Loyalty Program"

4. **Tactical Tips**
   - "5 Automation Triggers Every Business Should Set Up"
   - "Writing Email Sequences That Convert"

5. **Behind the Scenes**
   - "How We Built Automata (Using Automata)"
   - "Monthly Product Updates"

### Initial Series Ideas

- **"Automation Fundamentals"** (5-part series for beginners)
- **"Industry Playbooks"** (one per major industry)
- **"Case Study Collection"** (real or realistic examples)

---

## 13. Technical Decisions Needed

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Email Provider | Resend, SendGrid, Postmark | Resend (modern API, good DX) |
| URL Structure | Subdirectory, query, subdomain | Subdirectory (`/blog/en/...`) |
| Translation | Manual, AI, hybrid | Start manual, add AI later |
| Content Storage | Same DB, headless CMS | Same DB (simpler) |
| Rendering | SSR, static, client | Static generation preferred for SEO |

---

## 14. Success Metrics

### For Automata's Newsletter
- Subscriber count growth
- Open rate (target: >40%)
- Click rate (target: >5%)
- Organic search traffic
- Conversion to signups

### For Clients
- Time to first article published
- Subscriber acquisition rate
- Email engagement metrics
- SEO keyword rankings

---

*This plan establishes the newsletter/blogger app as a powerful content marketing tool that Automata will use internally while offering to all clients.*
