# Content Engine Integration Roadmap

## Current State (Completed)

### Phase 1: Database Schema ✅
- `content_calendars` table - project-level strategy
- `content_posts` table - AI-generated content pipeline
- RPC functions for CRUD operations
- **Migration file**: `database/project-content-calendar-migration.sql`

### Phase 2: Mock AI Content Generation ✅
- Strategy generator (industry-aware templates)
- Post generator with quality scoring
- Social snippets (Twitter, LinkedIn, Facebook, Instagram)
- SEO metadata generation

### Phase 3: Content Pipeline UI ✅
- Content tab in project page
- Strategy settings form
- Publishing settings (frequency, days, quality threshold)
- Pipeline stats dashboard
- Full post editor modal with scheduling

---

## Upcoming Integration Features

### Phase 4: Real AI Integration
**Timeline**: When API keys available (~1 week)

**Required**:
- Anthropic API key (Claude)
- Supabase project access for Edge Functions

**Implementation**:
```
supabase/functions/
├── generate-content-strategy/
│   └── index.ts
├── generate-content-post/
│   └── index.ts
└── score-content-quality/
    └── index.ts
```

**Tasks**:
1. Create Edge Function for strategy generation
2. Create Edge Function for post generation
3. Store API key in Supabase secrets: `supabase secrets set ANTHROPIC_API_KEY=sk-...`
4. Update frontend to call Edge Functions instead of mock
5. Add retry logic and error handling

**Claude Prompt Templates** (to refine):
- Strategy: Project context → content calendar
- Post: Strategy + topic → full article
- Quality: Article → score breakdown

---

### Phase 5: Image Generation
**Timeline**: After Phase 4

**Options**:
- DALL-E 3 (OpenAI) - $0.04/image standard
- Stability AI - $0.002/image
- Midjourney API (when available)

**Implementation**:
```
supabase/functions/
└── generate-hero-image/
    └── index.ts
```

**Tasks**:
1. Create Edge Function for image generation
2. Upload generated images to Supabase Storage
3. Update `content_posts.hero_image_url` with storage URL
4. Add image regeneration UI

---

### Phase 6: Auto-Publish Scheduler
**Timeline**: After Phase 4

**Options**:
- Supabase pg_cron extension
- External cron (Vercel, Railway, or simple server)
- Supabase Edge Function with scheduled trigger

**Implementation**:
```sql
-- pg_cron job (runs every 15 minutes)
SELECT cron.schedule(
  'publish-scheduled-content',
  '*/15 * * * *',
  $$SELECT publish_due_content()$$
);
```

**Tasks**:
1. Create `publish_due_content()` function
2. Enable pg_cron in Supabase
3. Add publish error handling and retry
4. Update calendar stats on publish

---

### Phase 7: Newsletter Delivery
**Timeline**: After Phase 6

**Options**:
- Resend ($0 for 3k emails/month, then $20/month)
- SendGrid (free tier: 100/day)
- Postmark ($15/month for 10k)

**Implementation**:
```
supabase/functions/
└── send-newsletter/
    └── index.ts
```

**Tasks**:
1. Create Edge Function for email sending
2. Build email template with content
3. Handle subscriber lists from `app_members`
4. Track delivery stats
5. Unsubscribe handling

---

## Testing Checklist (Current Mock Implementation)

### Content Tab
- [ ] Navigate to project → Content tab loads
- [ ] Save content settings
- [ ] Generate strategy → displays calendar, insights, series ideas
- [ ] Generate post → creates post in pipeline
- [ ] View post → opens editor modal
- [ ] Edit post → saves changes
- [ ] Approve post → status changes
- [ ] Schedule post → date picker works
- [ ] Publish post → status = published
- [ ] Delete post → soft delete

### Blog Display (TODO)
- [ ] Published posts appear on customer app blog
- [ ] Post detail page renders content
- [ ] SEO metadata applied
- [ ] Social share buttons work

---

## API Keys Needed

| Service | Purpose | Dashboard |
|---------|---------|-----------|
| Anthropic | Claude API for content generation | https://console.anthropic.com |
| OpenAI (optional) | DALL-E for images | https://platform.openai.com |
| Resend (recommended) | Email delivery | https://resend.com |

---

## Notes

- All integrations use Supabase Edge Functions (Deno runtime)
- API keys stored in Supabase secrets (not in code)
- Frontend calls Edge Functions, never directly to external APIs
- Rate limiting already implemented for AI features
