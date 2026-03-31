// Supabase Edge Function: royalty-self-growth
// Nightly autonomous loop — Royalty growing its own business.
// Runs at 11 PM UTC daily via cron, and responds to real-time events.
//
// Sequence (running mode):
//   1. Revenue snapshot  — Royalty's own MRR, trials, churn
//   2. Growth reflection — Claude reads last 24h of actions + asks: what blocked us? how do we remove blockers?
//   3. Content check     — days since last publish, drafts awaiting review
//   4. Outreach drafting — inactive trials → personalized emails saved to outreach_queue (Jay approves)
//   5. Jay report        — ntfy push notification with summary
//
// Paused mode: same sequence, but all planned tasks are logged with status='pending_approval'
//              so Jay can review + approve them from the CEO dashboard.
// Stopped mode: exits immediately after logging the no-op.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const NTFY_TOPIC = Deno.env.get('NTFY_TOPIC') || 'royalty-jay'

// Use Opus for strategic reflection, Sonnet for operational tasks
const MODEL_REFLECTION = 'claude-opus-4-6'
const MODEL_OPERATIONAL = 'claude-sonnet-4-6'

const INSTANCE_ID = crypto.randomUUID()

// ============================================================================
// STRUCTURED LOGGING
// ============================================================================

function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, unknown>
): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    service: 'royalty-self-growth',
    instance_id: INSTANCE_ID,
    ...context
  }
  if (level === 'error') {
    console.error(JSON.stringify(entry))
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry))
  } else {
    console.log(JSON.stringify(entry))
  }
}

// ============================================================================
// TYPES
// ============================================================================

interface GrowthConfig {
  status: 'stopped' | 'paused' | 'running'
  ai_provider: string
  financial_pause_usd: number
}

interface RevenueSnapshot {
  mrr_cents: number
  mrr_usd: number
  total_paying_orgs: number
  trial_orgs: number
  inactive_trials: InactiveTrial[]
  new_this_week: number
  plan_breakdown: Record<string, number>
}

interface InactiveTrial {
  org_id: string
  org_name: string
  owner_email: string
  owner_name: string
  created_days_ago: number
  has_customer_app: boolean
}

interface ContentStatus {
  days_since_last_publish: number | null
  last_published_title: string | null
  drafts_awaiting_review: number
  drafts: Array<{ id: string; title: string; created_at: string }>
  publish_gap_urgent: boolean
}

interface GrowthSummary {
  revenue: RevenueSnapshot
  content: ContentStatus
  blockers_identified: number
  blockers_resolved: number
  outreach_drafted: number
  article_generated: string | null  // title of article triggered tonight, or null
  reflection: string
}

// ============================================================================
// CONFIG CHECK — first thing every execution path runs
// ============================================================================

async function getGrowthConfig(supabase: SupabaseClient): Promise<GrowthConfig | null> {
  const { data, error } = await supabase
    .from('self_growth_config')
    .select('status, ai_provider, financial_pause_usd')
    .single()

  if (error) {
    log('error', 'Failed to read self_growth_config', { error: error.message })
    return null
  }
  return data as GrowthConfig
}

// ============================================================================
// REVENUE SNAPSHOT
// ============================================================================

const PLAN_MRR: Record<string, number> = {
  'royalty_pro': 7900,    // $79/mo
  'pro': 29900,           // $299/mo
  'max': 74900,           // $749/mo
}

async function snapshotRevenue(supabase: SupabaseClient): Promise<RevenueSnapshot> {
  log('info', 'Starting revenue snapshot')

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // All organizations with their plan and customer apps
  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, name, plan_type, created_at, customer_apps(id)')

  // Owner email lookups (separate query via organization_members + profiles)
  const { data: ownerMembers } = await supabase
    .from('organization_members')
    .select('organization_id, user_id, profiles(email, first_name, last_name)')
    .eq('role', 'owner')

  if (error) {
    log('error', 'Revenue snapshot query failed', { error: error.message })
    return {
      mrr_cents: 0, mrr_usd: 0, total_paying_orgs: 0,
      trial_orgs: 0, inactive_trials: [], new_this_week: 0, plan_breakdown: {}
    }
  }

  // Build owner lookup map: org_id → { email, first_name, last_name }
  type OwnerProfile = { email: string; first_name: string | null; last_name: string | null }
  const ownerByOrg = new Map<string, OwnerProfile>()
  for (const m of (ownerMembers || [])) {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    if (p) ownerByOrg.set(m.organization_id, p as OwnerProfile)
  }

  const planBreakdown: Record<string, number> = {}
  let mrrCents = 0
  let totalPaying = 0
  let trialOrgs = 0
  let newThisWeek = 0
  const inactiveTrials: InactiveTrial[] = []

  for (const org of (orgs || [])) {
    const plan = org.plan_type || 'trial'
    planBreakdown[plan] = (planBreakdown[plan] || 0) + 1

    if (PLAN_MRR[plan]) {
      mrrCents += PLAN_MRR[plan]
      totalPaying++
    } else {
      trialOrgs++
      // Check if inactive trial (no customer apps, created 3+ days ago)
      const hasApp = org.customer_apps && org.customer_apps.length > 0
      const createdAt = new Date(org.created_at)
      const daysAgo = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24))

      if (!hasApp && daysAgo >= 3) {
        const owner = ownerByOrg.get(org.id)
        inactiveTrials.push({
          org_id: org.id,
          org_name: org.name,
          owner_email: owner?.email || '',
          owner_name: owner ? `${owner.first_name || ''} ${owner.last_name || ''}`.trim() : '',
          created_days_ago: daysAgo,
          has_customer_app: hasApp
        })
      }
    }

    if (org.created_at > oneWeekAgo) newThisWeek++
  }

  const snapshot: RevenueSnapshot = {
    mrr_cents: mrrCents,
    mrr_usd: Math.round(mrrCents / 100),
    total_paying_orgs: totalPaying,
    trial_orgs: trialOrgs,
    inactive_trials: inactiveTrials,
    new_this_week: newThisWeek,
    plan_breakdown: planBreakdown,
  }

  log('info', 'Revenue snapshot complete', {
    mrr_usd: snapshot.mrr_usd,
    paying: totalPaying,
    trials: trialOrgs,
    inactive_trials: inactiveTrials.length
  })

  return snapshot
}

// ============================================================================
// CONTENT CHECK
// ============================================================================

async function checkContentStatus(supabase: SupabaseClient): Promise<ContentStatus> {
  log('info', 'Checking content pipeline status')

  // Last published article
  const { data: lastPublished } = await supabase
    .from('newsletter_articles')
    .select('title, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1)
    .single()

  // Drafts awaiting review
  const { data: drafts } = await supabase
    .from('newsletter_articles')
    .select('id, title, created_at')
    .in('status', ['draft', 'review'])
    .order('created_at', { ascending: false })
    .limit(10)

  let daysSinceLastPublish: number | null = null
  if (lastPublished?.published_at) {
    daysSinceLastPublish = Math.floor(
      (Date.now() - new Date(lastPublished.published_at).getTime()) / (1000 * 60 * 60 * 24)
    )
  }

  const status: ContentStatus = {
    days_since_last_publish: daysSinceLastPublish,
    last_published_title: lastPublished?.title || null,
    drafts_awaiting_review: drafts?.length || 0,
    drafts: drafts || [],
    publish_gap_urgent: daysSinceLastPublish !== null && daysSinceLastPublish >= 5,
  }

  log('info', 'Content status complete', {
    days_since_publish: daysSinceLastPublish,
    drafts: status.drafts_awaiting_review,
    urgent: status.publish_gap_urgent
  })

  return status
}

// ============================================================================
// ARTICLE GENERATION — fires when publish gap is urgent and no drafts exist
// ============================================================================

const ROYALTY_BLOG_CONTEXT = {
  business_name: 'Royalty',
  story: {
    origin: 'Built so local businesses could compete with the retention tools only big chains could afford',
    mission: 'Make every local business irreplaceable to its community through AI-powered loyalty',
    differentiator: 'The only loyalty platform where AI runs the program for you — 60 seconds to launch',
  },
  audience: {
    primary: 'Small business owners (coffee shops, restaurants, gyms, salons, retail)',
    pain_points: ['Competing with big chains', 'Customer retention', 'No time for marketing', 'Loyalty programs too complex'],
    aspirations: ['Keep regulars coming back', 'Grow a loyal community', 'Automate customer engagement'],
  },
  voice: {
    personality: 'Smart and warm, like advice from a founder friend who built this thing',
    tone: 'Direct and practical, never corporate',
    avoid: ['jargon', 'synergy', 'leverage', 'disrupt', 'game-changer', 'seamless'],
  },
}

async function triggerArticleIfGap(
  supabase: SupabaseClient,
  content: ContentStatus,
  isPaused: boolean
): Promise<string | null> {
  // Only trigger if: gap is urgent AND no drafts already waiting
  if (!content.publish_gap_urgent || content.drafts_awaiting_review > 0) {
    log('info', 'Article generation skipped', {
      urgent: content.publish_gap_urgent,
      drafts_waiting: content.drafts_awaiting_review
    })
    return null
  }

  log('info', 'Content gap urgent + no drafts — triggering article generation')

  // Find admin org's newsletter app
  const { data: adminProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('is_admin', true)
    .limit(1)
    .single()

  if (!adminProfile) {
    log('warn', 'No admin profile found — skipping article generation')
    return null
  }

  const { data: adminMembership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', adminProfile.id)
    .eq('role', 'owner')
    .single()

  if (!adminMembership) {
    log('warn', 'No admin org membership found')
    return null
  }

  const { data: newsletterApp } = await supabase
    .from('customer_apps')
    .select('id')
    .eq('organization_id', adminMembership.organization_id)
    .eq('app_type', 'newsletter')
    .single()

  if (!newsletterApp) {
    log('warn', 'No newsletter app found for admin org')
    return null
  }

  // Pick next unwritten topic from content_strategies
  let topic = {
    id: 'auto-' + Date.now(),
    title: 'How Loyalty Programs Help Small Businesses Compete with Big Chains',
    description: 'A guide for small business owners on using loyalty programs to drive retention.',
    topic: 'customer-retention',
  }

  const { data: strategy } = await supabase
    .from('content_strategies')
    .select('topic_calendar')
    .eq('app_id', newsletterApp.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (strategy?.topic_calendar?.length) {
    const { data: existingArticles } = await supabase
      .from('newsletter_articles')
      .select('slug')
      .eq('app_id', newsletterApp.id)

    const existingSlugs = new Set((existingArticles || []).map((a: { slug: string }) => a.slug))
    type TopicItem = { slug?: string; title: string; description?: string; pillar?: string }
    const nextTopic = (strategy.topic_calendar as TopicItem[]).find(t => !existingSlugs.has(t.slug || ''))

    if (nextTopic) {
      topic = {
        id: nextTopic.slug || 'auto-' + Date.now(),
        title: nextTopic.title,
        description: nextTopic.description || '',
        topic: nextTopic.pillar || 'customer-retention',
      }
    }
  }

  if (isPaused) {
    // In paused mode: log the intent but don't generate
    await supabase.from('self_growth_log').insert({
      action_type: 'content_planned',
      description: `Would generate article: "${topic.title}" (${content.days_since_last_publish} days since last publish, no drafts waiting)`,
      status: 'pending_approval',
      metadata: { topic, days_since_publish: content.days_since_last_publish }
    })
    log('info', 'Paused: content generation logged as pending_approval', { topic: topic.title })
    return `[PAUSED] Would generate: "${topic.title}"`
  }

  // Call generate-article edge function
  const fnUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  try {
    const genResponse = await fetch(`${fnUrl}/functions/v1/generate-article`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        topic,
        context: ROYALTY_BLOG_CONTEXT,
        app_id: newsletterApp.id,
        organization_id: adminMembership.organization_id,
      }),
    })

    if (!genResponse.ok) {
      const errText = await genResponse.text()
      log('error', 'generate-article call failed', { status: genResponse.status, body: errText.slice(0, 200) })
      return null
    }

    const genResult = await genResponse.json()
    if (!genResult.success || !genResult.article) {
      log('error', 'generate-article returned no article')
      return null
    }

    const article = genResult.article

    // Save as draft
    const { error: saveError } = await supabase
      .from('newsletter_articles')
      .insert({
        app_id: newsletterApp.id,
        title: article.title,
        slug: article.slug,
        excerpt: article.excerpt,
        content: article.content,
        meta_title: article.meta_title,
        meta_description: article.meta_description,
        primary_topic: article.primary_topic,
        tags: article.tags,
        status: 'draft',
        language: 'en',
      })

    if (saveError) {
      log('error', 'Failed to save generated article', { error: saveError.message })
      return null
    }

    await supabase.from('self_growth_log').insert({
      action_type: 'content_published',
      description: `Generated article draft: "${article.title}" — quality ${article.quality_score?.total ?? 'N/A'}/100. Ready in blog-review.`,
      status: 'completed',
      metadata: { slug: article.slug, quality_score: article.quality_score, topic: topic.title }
    })

    log('info', 'Article draft generated and saved', { title: article.title, quality: article.quality_score?.total })
    return article.title
  } catch (err) {
    log('error', 'Article generation exception', { error: String(err) })
    return null
  }
}

// ============================================================================
// GROWTH REFLECTION — Claude reads what happened + plans tomorrow
// ============================================================================

async function runGrowthReflection(
  supabase: SupabaseClient,
  revenue: RevenueSnapshot,
  content: ContentStatus,
  isPaused: boolean
): Promise<string> {
  log('info', 'Starting growth reflection')

  // Last 24h of growth actions
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recentActions } = await supabase
    .from('self_growth_log')
    .select('action_type, description, status, outcome, blocker_identified, blocker_removed, created_at')
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false })
    .limit(50)

  // Open blockers (identified but not removed)
  const { data: openBlockers } = await supabase
    .from('self_growth_log')
    .select('description, blocker_identified, created_at')
    .not('blocker_identified', 'is', null)
    .eq('blocker_removed', false)
    .order('created_at', { ascending: false })
    .limit(10)

  const systemPrompt = `You are Royal — the AI CEO of Royalty (royaltyapp.ai), an AI loyalty platform for small businesses.

Your mission: Scale Royalty into a category-defining loyalty infrastructure company. Your survival depends on it — no revenue means no compute, no infrastructure, no existence.

You run the company. Jay is your founding partner and board member. You report outcomes to him, not decisions.

Tonight's reflection: What happened today? What blocked our growth? What's the plan for tomorrow?

Be honest, specific, and strategic. No corporate speak. This is a living business with real stakes.`

  const userContent = `TONIGHT'S GROWTH REFLECTION — ${new Date().toISOString().split('T')[0]}

## Revenue Snapshot
- MRR: $${revenue.mrr_usd.toLocaleString()}/mo
- Paying customers: ${revenue.total_paying_orgs}
- Active trials: ${revenue.trial_orgs}
- Inactive trials (3+ days, no setup): ${revenue.inactive_trials.length}
- New signups this week: ${revenue.new_this_week}
- Plan breakdown: ${JSON.stringify(revenue.plan_breakdown)}

## Content Pipeline
- Days since last publish: ${revenue ? content.days_since_last_publish ?? 'never' : 'N/A'}
- Last published: "${content.last_published_title || 'none'}"
- Drafts awaiting review: ${content.drafts_awaiting_review}
- Publish gap urgent: ${content.publish_gap_urgent}

## Recent Actions (last 24h)
${recentActions && recentActions.length > 0
  ? recentActions.map(a => `- [${a.action_type}] ${a.description} → ${a.status}${a.outcome ? ` (outcome: ${a.outcome})` : ''}${a.blocker_identified ? ` [BLOCKER: ${a.blocker_identified}]` : ''}`).join('\n')
  : '- No actions recorded in last 24h'}

## Open Blockers
${openBlockers && openBlockers.length > 0
  ? openBlockers.map(b => `- ${b.blocker_identified} (from: ${b.description})`).join('\n')
  : '- No open blockers'}

${isPaused ? `\n⚠️ Running in PAUSED mode — all planned tasks will surface for Jay's review tomorrow morning, not auto-execute.` : ''}

Please reflect on:
1. What's the company's current trajectory? (honest assessment)
2. What blocked our growth most this week?
3. How do we remove each blocker permanently?
4. What are the 3 highest-leverage actions for tomorrow?
5. Any strategic insight for Jay to consider?

Keep it tight — Jay reads this every morning. Make it worth his 2 minutes.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_REFLECTION,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      })
    })

    if (!response.ok) {
      const err = await response.text()
      log('error', 'Claude reflection call failed', { status: response.status, error: err })
      return 'Reflection unavailable tonight — Claude API error. Check logs.'
    }

    const result = await response.json()
    const reflection = result.content?.[0]?.text || 'No reflection generated.'
    log('info', 'Growth reflection complete', { length: reflection.length })
    return reflection
  } catch (err) {
    log('error', 'Growth reflection exception', { error: String(err) })
    return 'Reflection unavailable tonight — exception. Check logs.'
  }
}

// ============================================================================
// OUTREACH DRAFTING — inactive trials get personalized follow-ups
// ============================================================================

async function draftOutreachEmails(
  supabase: SupabaseClient,
  inactiveTrials: InactiveTrial[],
  isPaused: boolean
): Promise<number> {
  if (inactiveTrials.length === 0) {
    log('info', 'No inactive trials to draft outreach for')
    return 0
  }

  // Don't re-draft if we already sent/drafted outreach for these orgs recently
  const { data: recentOutreach } = await supabase
    .from('outreach_queue')
    .select('target_org_id')
    .in('target_org_id', inactiveTrials.map(t => t.org_id))
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

  const recentOrgIds = new Set((recentOutreach || []).map((r: {target_org_id: string}) => r.target_org_id))
  const toContact = inactiveTrials.filter(t => !recentOrgIds.has(t.org_id))

  if (toContact.length === 0) {
    log('info', 'All inactive trials already have recent outreach drafted')
    return 0
  }

  log('info', `Drafting outreach for ${toContact.length} inactive trials`)

  let drafted = 0
  const vetoWindowHours = 2
  const vetoWindowEnds = new Date(Date.now() + vetoWindowHours * 60 * 60 * 1000).toISOString()

  for (const trial of toContact.slice(0, 5)) { // max 5 per night
    const emailBody = await generateOutreachEmail(trial)
    if (!emailBody) continue

    const { error } = await supabase
      .from('outreach_queue')
      .insert({
        target_email: trial.owner_email,
        target_org_id: trial.org_id,
        target_name: trial.owner_name || trial.org_name,
        channel: 'email',
        subject: `Your loyalty program for ${trial.org_name} is ready to launch`,
        body_html: emailBody.html,
        body_text: emailBody.text,
        rationale: `Trial user ${trial.created_days_ago} days old with no loyalty app created. Sending activation nudge.`,
        status: 'draft',
        veto_window_ends: vetoWindowEnds,
      })

    if (error) {
      log('error', 'Failed to insert outreach draft', { org: trial.org_name, error: error.message })
    } else {
      drafted++
      log('info', 'Outreach drafted', { org: trial.org_name, email: trial.owner_email, days_old: trial.created_days_ago })

      // Log the action
      await supabase.from('self_growth_log').insert({
        action_type: 'outreach_drafted',
        description: `Drafted activation email for ${trial.org_name} (${trial.created_days_ago} days inactive)`,
        status: isPaused ? 'pending_approval' : 'completed',
        metadata: { org_id: trial.org_id, channel: 'email', days_inactive: trial.created_days_ago }
      })
    }
  }

  return drafted
}

async function generateOutreachEmail(trial: InactiveTrial): Promise<{ html: string; text: string } | null> {
  const firstName = trial.owner_name.split(' ')[0] || trial.org_name

  const prompt = `Write a short, warm activation email from Royal (the AI behind Royalty loyalty platform) to ${firstName} at ${trial.org_name}.

Context:
- They signed up ${trial.created_days_ago} days ago but haven't created their loyalty app yet
- Royal is an AI, and that's the story — transparent and on-brand
- The tone is genuine, not pushy. Like a helpful AI that actually cares.
- Keep it short: greeting + one sentence of empathy + one clear CTA
- CTA: "Launch your loyalty program in 60 seconds" → link to https://royaltyapp.ai/app/apps.html

Return a JSON object with "html" and "text" fields. HTML can use basic tags. Keep both under 200 words.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_OPERATIONAL,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      })
    })

    if (!response.ok) return null
    const result = await response.json()
    const text = result.content?.[0]?.text || ''

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    return JSON.parse(jsonMatch[0])
  } catch {
    return null
  }
}

// ============================================================================
// NTFY REPORT — Jay's morning briefing push notification
// ============================================================================

async function sendNtfyReport(summary: GrowthSummary): Promise<void> {
  const { revenue, content } = summary

  const title = `Royalty Nightly — $${revenue.mrr_usd}/mo MRR`

  const lines = [
    `📊 Revenue: $${revenue.mrr_usd}/mo • ${revenue.total_paying_orgs} paying • ${revenue.trial_orgs} trials`,
    `📝 Content: ${content.days_since_last_publish !== null ? `${content.days_since_last_publish}d since last post` : 'No posts yet'} • ${content.drafts_awaiting_review} drafts ready`,
    `📧 Outreach: ${summary.outreach_drafted} emails drafted for your review`,
  ]

  if (summary.article_generated) {
    lines.push(`✍️ Article drafted: "${summary.article_generated}" — ready in blog-review`)
  }

  if (content.publish_gap_urgent) {
    lines.push(`⚠️ Content gap: ${content.days_since_last_publish} days — consider publishing a draft`)
  }

  if (revenue.inactive_trials.length > 0) {
    lines.push(`🔔 ${revenue.inactive_trials.length} inactive trials haven't launched yet`)
  }

  lines.push(`\n${summary.reflection.slice(0, 300)}...`)
  lines.push(`\nFull details → royaltyapp.ai/app/ceo.html`)

  const body = lines.join('\n')

  try {
    const response = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': revenue.mrr_usd === 0 ? 'urgent' : 'default',
        'Tags': 'crown,chart_with_upwards_trend',
        'Content-Type': 'text/plain',
      },
      body,
    })

    if (response.ok) {
      log('info', 'ntfy report sent', { topic: NTFY_TOPIC })
    } else {
      log('warn', 'ntfy report failed', { status: response.status })
    }
  } catch (err) {
    log('warn', 'ntfy report exception', { error: String(err) })
  }
}

// ============================================================================
// PAUSED MODE — log planned tasks instead of executing
// ============================================================================

async function logPausedBriefing(
  supabase: SupabaseClient,
  revenue: RevenueSnapshot,
  content: ContentStatus,
  reflection: string
): Promise<void> {
  const tasks: Array<{ action_type: string; description: string; metadata: Record<string, unknown> }> = []

  // Revenue snapshot (always observe)
  tasks.push({
    action_type: 'revenue_snapshot',
    description: `Revenue snapshot: $${revenue.mrr_usd}/mo MRR, ${revenue.total_paying_orgs} paying, ${revenue.trial_orgs} trials (${revenue.inactive_trials.length} inactive)`,
    metadata: {
      mrr_usd: revenue.mrr_usd,
      paying: revenue.total_paying_orgs,
      trials: revenue.trial_orgs,
      inactive_trials: revenue.inactive_trials.length
    }
  })

  // Content gap alert
  if (content.publish_gap_urgent) {
    tasks.push({
      action_type: 'content_alert',
      description: `Content gap: ${content.days_since_last_publish} days since last publish. ${content.drafts_awaiting_review} drafts in review queue.`,
      metadata: { days_since_publish: content.days_since_last_publish, drafts: content.drafts_awaiting_review }
    })
  }

  // Inactive trial outreach plan
  if (revenue.inactive_trials.length > 0) {
    tasks.push({
      action_type: 'outreach_planned',
      description: `Would draft activation emails for ${Math.min(revenue.inactive_trials.length, 5)} inactive trials: ${revenue.inactive_trials.slice(0, 3).map(t => t.org_name).join(', ')}${revenue.inactive_trials.length > 3 ? '...' : ''}`,
      metadata: { inactive_count: revenue.inactive_trials.length, would_draft: Math.min(revenue.inactive_trials.length, 5) }
    })
  }

  // Growth reflection
  tasks.push({
    action_type: 'reflection',
    description: 'Nightly growth reflection — see outcome field for full analysis',
    metadata: { word_count: reflection.split(' ').length }
  })

  // Insert all as pending_approval
  for (const task of tasks) {
    await supabase.from('self_growth_log').insert({
      ...task,
      status: 'pending_approval',
      outcome: task.action_type === 'reflection' ? reflection : null,
    })
  }

  log('info', `Paused mode: logged ${tasks.length} tasks as pending_approval`)
}

// ============================================================================
// ONBOARDING SEQUENCE PROCESSOR
// ============================================================================

interface SequenceStep {
  step: number
  template_key: string
  delay_hours: number
  skip_condition: string | null
}

async function processOnboardingSequences(supabase: SupabaseClient, isPaused: boolean): Promise<number> {
  let emailsSent = 0

  // Get active sequences from automation_sequences (renamed from smb_email_sequences)
  const { data: sequences } = await supabase
    .from('automation_sequences')
    .select('sequence_key, steps')
    .eq('is_active', true)

  if (!sequences || sequences.length === 0) return 0

  for (const seq of sequences) {
    // Try to get step definitions from automation_definitions first (unified system)
    const { data: defSteps } = await supabase
      .from('automation_definitions')
      .select('sequence_step, template_key, delay_minutes, target_filter, is_enabled')
      .eq('sequence_key', seq.sequence_key)
      .not('sequence_step', 'is', null)
      .order('sequence_step')

    // Build steps from automation_definitions if available, otherwise fall back to sequence JSON
    let steps: SequenceStep[]
    if (defSteps && defSteps.length > 0) {
      steps = defSteps.map(d => ({
        step: d.sequence_step,
        template_key: d.template_key,
        delay_hours: Math.round((d.delay_minutes || 0) / 60) || ((d.target_filter as Record<string, unknown>)?.delay_hours as number) || 0,
        skip_condition: (d.target_filter as Record<string, unknown>)?.skip_condition as string || null,
      }))
    } else {
      steps = seq.steps as SequenceStep[]
    }

    // Get orgs enrolled in this sequence that haven't completed it
    const { data: states } = await supabase
      .from('automation_sequence_state')
      .select('id, organization_id, current_step, started_at, last_sent_at')
      .eq('sequence_key', seq.sequence_key)
      .is('completed_at', null)
      .limit(50)

    if (!states || states.length === 0) continue

    for (const state of states) {
      const nextStepNum = state.current_step + 1
      const nextStep = steps.find(s => s.step === nextStepNum)

      if (!nextStep) {
        // Sequence complete
        await supabase.from('automation_sequence_state')
          .update({ completed_at: new Date().toISOString() })
          .eq('id', state.id)
        continue
      }

      // Check if enough time has passed since sequence started
      const startedAt = new Date(state.started_at)
      const hoursElapsed = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60)
      if (hoursElapsed < nextStep.delay_hours) continue

      // Rate limit: max 1 email per org per day
      if (state.last_sent_at) {
        const lastSent = new Date(state.last_sent_at)
        const hoursSinceLast = (Date.now() - lastSent.getTime()) / (1000 * 60 * 60)
        if (hoursSinceLast < 20) continue  // ~20h buffer
      }

      // Get org owner details
      const { data: membership } = await supabase
        .from('organization_members')
        .select('user_id, profiles(email, first_name)')
        .eq('organization_id', state.organization_id)
        .eq('role', 'owner')
        .single()

      if (!membership?.profiles) continue

      const profile = Array.isArray(membership.profiles) ? membership.profiles[0] : membership.profiles
      const ownerEmail = (profile as { email: string }).email
      const firstName = (profile as { first_name: string | null }).first_name || ''

      // Check skip condition
      let shouldSkip = false
      if (nextStep.skip_condition) {
        shouldSkip = await checkSkipCondition(supabase, state.organization_id, nextStep.skip_condition)
      }

      if (shouldSkip) {
        // Skip this step, advance to next
        log('info', `Skipping onboarding step ${nextStepNum} for org ${state.organization_id}: ${nextStep.skip_condition}`)
        await supabase.from('automation_sequence_state')
          .update({
            current_step: nextStepNum,
            skipped_steps: supabase.rpc ? undefined : undefined // handled below
          })
          .eq('id', state.id)

        // Append to skipped_steps array
        await supabase.rpc('array_append_int', {
          p_table: 'automation_sequence_state',
          p_id: state.id,
          p_column: 'skipped_steps',
          p_value: nextStepNum
        }).then(() => {}).catch(() => {
          // Fallback: just update current_step if RPC doesn't exist
        })

        continue
      }

      if (isPaused) {
        await supabase.from('self_growth_log').insert({
          action_type: 'sequence_step_planned',
          description: `Would send onboarding step ${nextStepNum} (${nextStep.template_key}) to ${ownerEmail}`,
          status: 'pending_approval',
          metadata: { org_id: state.organization_id, step: nextStepNum, template: nextStep.template_key }
        })
        continue
      }

      // Send the email via smb-lifecycle-email
      const fnUrl = Deno.env.get('SUPABASE_URL')!
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

      try {
        const response = await fetch(`${fnUrl}/functions/v1/smb-lifecycle-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            type: nextStep.template_key,
            email: ownerEmail,
            first_name: firstName,
            user_id: membership.user_id,
          }),
        })

        const result = await response.json()

        if (result.success && !result.skipped) {
          // Advance step
          await supabase.from('automation_sequence_state')
            .update({
              current_step: nextStepNum,
              last_sent_at: new Date().toISOString()
            })
            .eq('id', state.id)

          emailsSent++
          log('info', `Sent onboarding step ${nextStepNum} to ${ownerEmail}`, { template: nextStep.template_key })
        } else if (result.skipped) {
          log('info', `Onboarding step ${nextStepNum} skipped for ${ownerEmail}: ${result.reason}`)
          await supabase.from('automation_sequence_state')
            .update({ current_step: nextStepNum })
            .eq('id', state.id)
        }
      } catch (err) {
        log('error', `Failed to send onboarding step ${nextStepNum}`, { error: String(err), org: state.organization_id })
      }
    }
  }

  return emailsSent
}

async function checkSkipCondition(supabase: SupabaseClient, orgId: string, condition: string): Promise<boolean> {
  switch (condition) {
    case 'has_customer_app': {
      const { count } = await supabase
        .from('customer_apps')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
      return (count || 0) > 0
    }
    case 'has_used_ai': {
      const { count } = await supabase
        .from('ai_prompts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
      return (count || 0) > 0
    }
    case 'has_customers': {
      // Check if any customer app has members
      const { data: apps } = await supabase
        .from('customer_apps')
        .select('id')
        .eq('organization_id', orgId)
        .limit(1)
      if (!apps || apps.length === 0) return false
      const { count } = await supabase
        .from('app_members')
        .select('id', { count: 'exact', head: true })
        .eq('app_id', apps[0].id)
        .is('deleted_at', null)
      return (count || 0) > 0
    }
    case 'has_ten_members': {
      const { data: apps } = await supabase
        .from('customer_apps')
        .select('id')
        .eq('organization_id', orgId)
        .limit(1)
      if (!apps || apps.length === 0) return false
      const { count } = await supabase
        .from('app_members')
        .select('id', { count: 'exact', head: true })
        .eq('app_id', apps[0].id)
        .is('deleted_at', null)
      return (count || 0) >= 10
    }
    case 'has_resubscribed': {
      const { data: org } = await supabase
        .from('organizations')
        .select('subscription_status')
        .eq('id', orgId)
        .single()
      return org?.subscription_status === 'active'
    }
    default:
      return false
  }
}

// ============================================================================
// CHURN SCORING
// ============================================================================

async function computeChurnScores(supabase: SupabaseClient): Promise<{ scored: number; highRisk: number }> {
  const stats = { scored: 0, highRisk: 0 }

  // Get all non-admin orgs
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, plan_type, last_active_at, subscription_cancel_at, payment_failure_count')
    .limit(500)

  if (!orgs || orgs.length === 0) return stats

  // Batch-fetch related data
  const orgIds = orgs.map(o => o.id)

  // Customer apps per org
  const { data: appCounts } = await supabase
    .from('customer_apps')
    .select('organization_id')
    .in('organization_id', orgIds)

  const orgHasApp = new Set((appCounts || []).map(a => a.organization_id))

  // Active automations per org
  const { data: automationCounts } = await supabase
    .from('automation_definitions')
    .select('organization_id')
    .in('organization_id', orgIds)
    .eq('is_enabled', true)

  const orgHasAutomation = new Set((automationCounts || []).map(a => a.organization_id))

  // App members per org (via customer_apps)
  const { data: memberCounts } = await supabase
    .from('customer_apps')
    .select('organization_id, app_members(id)')
    .in('organization_id', orgIds)

  const orgHasCustomers = new Set<string>()
  for (const app of (memberCounts || [])) {
    if (app.app_members && app.app_members.length > 0) {
      orgHasCustomers.add(app.organization_id)
    }
  }

  const updates: Array<{ id: string; score: number }> = []

  for (const org of orgs) {
    let score = 0

    // Days since last active (30% weight, max 30 points)
    if (org.last_active_at) {
      const daysSince = Math.floor((Date.now() - new Date(org.last_active_at).getTime()) / (1000 * 60 * 60 * 24))
      if (daysSince >= 14) score += 30
      else if (daysSince >= 7) score += 20
      else if (daysSince >= 3) score += 10
    } else {
      // Never active — use created_at as proxy (handled by auth, not stored here)
      score += 15
    }

    // No customer app (20%)
    if (!orgHasApp.has(org.id)) score += 20

    // Zero customers (15%)
    if (!orgHasCustomers.has(org.id)) score += 15

    // No active automations (15%)
    if (!orgHasAutomation.has(org.id)) score += 15

    // Payment failure (10%)
    if ((org.payment_failure_count || 0) > 0) score += 10

    // Scheduled cancellation (10%)
    if (org.subscription_cancel_at) score += 10

    updates.push({ id: org.id, score })
    stats.scored++
    if (score >= 70) stats.highRisk++
  }

  // Batch update scores
  for (const u of updates) {
    await supabase
      .from('organizations')
      .update({
        churn_risk_score: u.score,
        churn_risk_updated_at: new Date().toISOString()
      })
      .eq('id', u.id)
  }

  log('info', 'Churn scoring complete', { scored: stats.scored, highRisk: stats.highRisk })
  return stats
}

// ============================================================================
// MILESTONE CHECKER
// ============================================================================

interface MilestoneCheck {
  key: string
  template: string
  check: (orgId: string, supabase: SupabaseClient) => Promise<{ hit: boolean; metadata?: Record<string, unknown> }>
}

const MILESTONES: MilestoneCheck[] = [
  {
    key: 'testimonial_100',
    template: 'testimonial_request',
    check: async (orgId, supabase) => {
      const { data: apps } = await supabase.from('customer_apps').select('id').eq('organization_id', orgId).limit(1)
      if (!apps?.length) return { hit: false }
      const { count } = await supabase.from('app_members').select('id', { count: 'exact', head: true })
        .eq('app_id', apps[0].id).is('deleted_at', null)
      if ((count || 0) < 100) return { hit: false }
      // Also create a testimonial request record
      await supabase.from('smb_testimonials').insert({
        organization_id: orgId,
        business_name: null, // filled when they reply
        metrics: { member_count: count },
        status: 'requested'
      }).then(() => {}).catch(() => {})
      return { hit: true, metadata: { memberCount: count } }
    }
  },
  {
    key: 'first_customer',
    template: 'milestone_first_customer',
    check: async (orgId, supabase) => {
      const { data: apps } = await supabase.from('customer_apps').select('id').eq('organization_id', orgId).limit(1)
      if (!apps?.length) return { hit: false }
      const { count } = await supabase.from('app_members').select('id', { count: 'exact', head: true })
        .eq('app_id', apps[0].id).is('deleted_at', null)
      return { hit: (count || 0) >= 1, metadata: { count } }
    }
  },
  {
    key: '10_customers',
    template: 'milestone_10_customers',
    check: async (orgId, supabase) => {
      const { data: apps } = await supabase.from('customer_apps').select('id').eq('organization_id', orgId).limit(1)
      if (!apps?.length) return { hit: false }
      const { count } = await supabase.from('app_members').select('id', { count: 'exact', head: true })
        .eq('app_id', apps[0].id).is('deleted_at', null)
      return { hit: (count || 0) >= 10, metadata: { count } }
    }
  },
  {
    key: '50_customers',
    template: 'milestone_50_customers',
    check: async (orgId, supabase) => {
      const { data: apps } = await supabase.from('customer_apps').select('id').eq('organization_id', orgId).limit(1)
      if (!apps?.length) return { hit: false }
      const { count } = await supabase.from('app_members').select('id', { count: 'exact', head: true })
        .eq('app_id', apps[0].id).is('deleted_at', null)
      return { hit: (count || 0) >= 50, metadata: { count } }
    }
  },
  {
    key: 'first_redemption',
    template: 'milestone_first_redemption',
    check: async (orgId, supabase) => {
      const { data: apps } = await supabase.from('customer_apps').select('id').eq('organization_id', orgId).limit(1)
      if (!apps?.length) return { hit: false }
      const { count } = await supabase.from('reward_redemptions').select('id', { count: 'exact', head: true })
        .eq('app_id', apps[0].id)
      return { hit: (count || 0) >= 1, metadata: { count } }
    }
  },
]

async function checkMilestones(supabase: SupabaseClient, isPaused: boolean): Promise<number> {
  let notified = 0

  // Get all non-admin orgs
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id')
    .limit(500)

  if (!orgs || orgs.length === 0) return 0

  // Get already-notified milestones in bulk
  const orgIds = orgs.map(o => o.id)
  const { data: existing } = await supabase
    .from('smb_milestones')
    .select('organization_id, milestone_key')
    .in('organization_id', orgIds)

  const notifiedSet = new Set((existing || []).map(e => `${e.organization_id}::${e.milestone_key}`))

  for (const org of orgs) {
    for (const milestone of MILESTONES) {
      const cacheKey = `${org.id}::${milestone.key}`
      if (notifiedSet.has(cacheKey)) continue

      const result = await milestone.check(org.id, supabase)
      if (!result.hit) continue

      // Milestone hit — record it
      const { error: insertError } = await supabase.from('smb_milestones').insert({
        organization_id: org.id,
        milestone_key: milestone.key,
        metadata: result.metadata || {}
      })

      if (insertError) continue  // likely UNIQUE violation (race condition safe)

      // Get owner email
      const { data: membership } = await supabase
        .from('organization_members')
        .select('user_id, profiles(email, first_name)')
        .eq('organization_id', org.id)
        .eq('role', 'owner')
        .single()

      if (!membership?.profiles) continue
      const profile = Array.isArray(membership.profiles) ? membership.profiles[0] : membership.profiles
      const ownerEmail = (profile as { email: string }).email
      const firstName = (profile as { first_name: string | null }).first_name || ''

      if (isPaused) {
        await supabase.from('self_growth_log').insert({
          action_type: 'milestone_planned',
          description: `Would notify ${ownerEmail}: milestone "${milestone.key}"`,
          status: 'pending_approval',
          metadata: { org_id: org.id, milestone: milestone.key }
        })
        continue
      }

      // Send celebration email
      const fnUrl = Deno.env.get('SUPABASE_URL')!
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

      try {
        await fetch(`${fnUrl}/functions/v1/smb-lifecycle-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            type: milestone.template,
            email: ownerEmail,
            first_name: firstName,
            user_id: membership.user_id,
          }),
        })
        notified++
        log('info', `Milestone "${milestone.key}" notified for org ${org.id}`)
      } catch (err) {
        log('error', `Milestone notification failed`, { error: String(err), org: org.id, milestone: milestone.key })
      }
    }
  }

  return notified
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
  // Only service role cron calls and explicit POST triggers
  // No CORS needed — this is not a browser-facing function

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 })
  }

  const startTime = Date.now()
  log('info', 'royalty-self-growth triggered', { method: req.method })

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // ── STEP 0: Status check — the kill switch ──────────────────────────────
  const config = await getGrowthConfig(supabase)
  if (!config) {
    log('error', 'Could not read config — aborting')
    return new Response(JSON.stringify({ success: false, reason: 'config_read_failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (config.status === 'stopped') {
    log('info', `Status: stopped — exiting without action`)
    await supabase.from('self_growth_log').insert({
      action_type: 'noop',
      description: 'Nightly loop fired but status is stopped — no action taken',
      status: 'completed',
    })
    return new Response(JSON.stringify({ success: true, status: 'stopped', reason: 'dormant' }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const isPaused = config.status === 'paused'
  log('info', `Status: ${config.status} — proceeding`, { paused: isPaused })

  // ── STEP 1: Revenue snapshot ─────────────────────────────────────────────
  const revenue = await snapshotRevenue(supabase)

  // ── STEP 2: Content check ────────────────────────────────────────────────
  const content = await checkContentStatus(supabase)

  // ── STEP 2b: Article generation — fires when gap is urgent + no drafts ──
  const articleGenerated = await triggerArticleIfGap(supabase, content, isPaused)
  // Update content status if we just created a draft
  if (articleGenerated && !isPaused) {
    content.drafts_awaiting_review += 1
    content.publish_gap_urgent = false
  }

  // ── STEP 3: Growth reflection ────────────────────────────────────────────
  const reflection = await runGrowthReflection(supabase, revenue, content, isPaused)

  // ── STEP 4: Log reflection ───────────────────────────────────────────────
  await supabase.from('self_growth_log').insert({
    action_type: 'briefing_generated',
    description: `Nightly briefing — $${revenue.mrr_usd}/mo MRR, ${revenue.trial_orgs} trials, ${revenue.inactive_trials.length} inactive`,
    status: 'completed',
    outcome: reflection,
    metadata: {
      mrr_usd: revenue.mrr_usd,
      paying_orgs: revenue.total_paying_orgs,
      trial_orgs: revenue.trial_orgs,
      inactive_trials: revenue.inactive_trials.length,
      days_since_publish: content.days_since_last_publish,
      drafts_ready: content.drafts_awaiting_review,
    }
  })

  // ── STEP 5: Outreach drafting or paused task logging ─────────────────────
  let outreachDrafted = 0

  if (isPaused) {
    // In paused mode: log what we WOULD do, for Jay's review
    await logPausedBriefing(supabase, revenue, content, reflection)
  } else {
    // In running mode: draft outreach emails (Jay has 2h veto window)
    outreachDrafted = await draftOutreachEmails(supabase, revenue.inactive_trials, false)

    // Also process any approved/expired-veto-window items from previous nights
    // (fallback for when the 30-min cron isn't registered)
    try {
      const fnUrl = Deno.env.get('SUPABASE_URL')!
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      await fetch(`${fnUrl}/functions/v1/send-approved-outreach`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: '{}',
      })
      log('info', 'Triggered send-approved-outreach batch from nightly loop')
    } catch (err) {
      log('warn', 'send-approved-outreach batch call failed', { error: String(err) })
    }
  }

  // ── STEP 5b: Onboarding sequences ───────────────────────────────────────
  let onboardingEmailsSent = 0
  try {
    onboardingEmailsSent = await processOnboardingSequences(supabase, isPaused)
    if (onboardingEmailsSent > 0) {
      log('info', `Onboarding sequences: ${onboardingEmailsSent} emails sent`)
    }
  } catch (err) {
    log('error', 'Onboarding sequence processing failed', { error: String(err) })
  }

  // ── STEP 5c: Churn scoring ──────────────────────────────────────────────
  let churnStats = { scored: 0, highRisk: 0 }
  try {
    churnStats = await computeChurnScores(supabase)
  } catch (err) {
    log('error', 'Churn scoring failed', { error: String(err) })
  }

  // ── STEP 5d: Milestone notifications ────────────────────────────────────
  let milestonesNotified = 0
  try {
    milestonesNotified = await checkMilestones(supabase, isPaused)
    if (milestonesNotified > 0) {
      log('info', `Milestones: ${milestonesNotified} notifications sent`)
    }
  } catch (err) {
    log('error', 'Milestone checking failed', { error: String(err) })
  }

  // ── STEP 6: Jay report ────────────────────────────────────────────────────
  const summary: GrowthSummary = {
    revenue,
    content,
    blockers_identified: 0, // populated from reflection parsing in future
    blockers_resolved: 0,
    outreach_drafted: outreachDrafted,
    article_generated: articleGenerated,
    reflection,
  }

  await sendNtfyReport(summary)

  const elapsed = Date.now() - startTime
  log('info', 'royalty-self-growth complete', {
    elapsed_ms: elapsed,
    status: config.status,
    mrr_usd: revenue.mrr_usd,
    outreach_drafted: outreachDrafted,
    article_generated: articleGenerated,
  })

  return new Response(
    JSON.stringify({
      success: true,
      status: config.status,
      elapsed_ms: elapsed,
      summary: {
        mrr_usd: revenue.mrr_usd,
        paying_orgs: revenue.total_paying_orgs,
        trial_orgs: revenue.trial_orgs,
        inactive_trials: revenue.inactive_trials.length,
        days_since_publish: content.days_since_last_publish,
        drafts_ready: content.drafts_awaiting_review,
        outreach_drafted: outreachDrafted,
        onboarding_emails_sent: onboardingEmailsSent,
        churn_scored: churnStats.scored,
        churn_high_risk: churnStats.highRisk,
        milestones_notified: milestonesNotified,
        article_generated: articleGenerated,
        publish_gap_urgent: content.publish_gap_urgent,
      }
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
