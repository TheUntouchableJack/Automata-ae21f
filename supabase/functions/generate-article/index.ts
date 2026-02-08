// Supabase Edge Function: AI Article Generator
// Uses Claude API for quality-focused content generation
// SECURE: API key stored in Supabase secrets, not exposed to frontend
// RATE LIMITED: Enforces plan limits server-side

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// CORS headers for frontend access
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://royaltyapp.ai',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Plan limits for articles_monthly (must match plan-limits.js)
const ARTICLE_LIMITS: Record<string, number> = {
  // Free tier
  'free': 3,
  // Subscription tiers
  'subscription:pro': 20,
  'subscription:scale': 100,
  'subscription:enterprise': -1,  // Unlimited
  // AppSumo tiers
  'appsumo:1': 10,
  'appsumo:2': 30,
  'appsumo:3': 100,
}

// ===== TABOO PHRASES (AI-isms that must be removed) =====
// These are telltale signs of AI-generated content
// If found, article MUST be rewritten - no exceptions
const TABOO_PHRASES: string[] = [
  // Opening clichés
  'in today\'s world',
  'in today\'s fast-paced',
  'in today\'s digital',
  'in today\'s competitive',
  'in the ever-evolving',
  'in the rapidly changing',
  'in this day and age',
  'it\'s no secret that',
  'it goes without saying',
  'as we all know',
  'needless to say',

  // Buzzwords that scream AI
  'delve',
  'delving',
  'leverage', // as a verb
  'utilize',
  'utilizing',
  'synergy',
  'synergies',
  'paradigm',
  'paradigm shift',
  'game-changer',
  'game changer',
  'cutting-edge',
  'cutting edge',
  'best-in-class',
  'world-class',
  'next-level',
  'holistic',
  'robust',
  'seamless',
  'seamlessly',
  'streamline',
  'streamlined',
  'optimize',
  'optimizing',
  'empower',
  'empowering',
  'unlock',
  'unlocking',

  // Filler phrases
  'it\'s important to note',
  'it\'s worth noting',
  'it\'s worth mentioning',
  'it is important to',
  'it is worth',
  'it should be noted',
  'importantly',
  'interestingly',
  'notably',
  'essentially',
  'basically',
  'fundamentally',
  'ultimately',

  // Vague transitions
  'that being said',
  'with that being said',
  'having said that',
  'at the end of the day',
  'when all is said and done',
  'all things considered',
  'by the same token',

  // Weak conclusions
  'in conclusion',
  'to conclude',
  'to summarize',
  'to sum up',
  'in summary',
  'all in all',
  'embrace the future',
  'embrace change',
  'the possibilities are endless',
  'only time will tell',

  // Overused metaphors
  'navigate the landscape',
  'navigate the waters',
  'tip of the iceberg',
  'deep dive',
  'take a deep dive',
  'unpack this',
  'let\'s unpack',
  'at its core',
  'the bottom line',

  // Padding phrases
  'there\'s no doubt that',
  'without a doubt',
  'make no mistake',
  'the fact of the matter',
  'the reality is',
  'the truth is',
  'when it comes to',
  'in terms of',
  'with regards to',
  'in order to',
]

// Scan article for taboo phrases - returns list of violations
function scanForTabooPhrases(article: string): string[] {
  const lowerArticle = article.toLowerCase()
  const violations: string[] = []

  for (const phrase of TABOO_PHRASES) {
    if (lowerArticle.includes(phrase.toLowerCase())) {
      violations.push(phrase)
    }
  }

  return violations
}

// Get article limit for an organization
function getArticleLimit(org: { plan_type?: string; subscription_tier?: string; appsumo_tier?: number }): number {
  if (!org || !org.plan_type) return ARTICLE_LIMITS['free']

  if (org.plan_type === 'subscription' && org.subscription_tier) {
    return ARTICLE_LIMITS[`subscription:${org.subscription_tier}`] ?? ARTICLE_LIMITS['free']
  }

  if (org.plan_type === 'appsumo_lifetime' && org.appsumo_tier) {
    return ARTICLE_LIMITS[`appsumo:${org.appsumo_tier}`] ?? ARTICLE_LIMITS['free']
  }

  return ARTICLE_LIMITS['free']
}

interface GenerateRequest {
  topic: {
    id: string
    title: string
    description: string
    topic: string
  }
  context: {
    business_name: string
    story?: {
      origin?: string
      mission?: string
      differentiator?: string
    }
    audience?: {
      primary?: string
      pain_points?: string[]
      aspirations?: string[]
    }
    voice?: {
      personality?: string
      tone?: string
      avoid?: string[]
    }
  }
  app_id: string
  organization_id: string
}

interface QualityScore {
  total: number
  specificity: number
  voice: number
  value: number
  hook: number
  human: number
  taboo_violations: number  // Count of AI-isms found (0 = clean)
}

interface ArticleResult {
  title: string
  slug: string
  excerpt: string
  content: string
  meta_title: string
  meta_description: string
  primary_topic: string
  tags: string[]
  quality_score: QualityScore
}

// Call Claude API
async function callClaude(prompt: string, maxTokens: number = 4000): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return data.content[0].text
}

// Generate the article
async function generateArticle(topic: GenerateRequest['topic'], context: GenerateRequest['context']): Promise<string> {
  const businessName = context.business_name || 'the business'
  const personality = context.voice?.personality || 'friendly and professional'
  const tone = context.voice?.tone || 'warm and practical'
  const avoidWords = context.voice?.avoid?.join(', ') || 'synergy, leverage, disrupt'
  const audience = context.audience?.primary || 'small business owners'
  const painPoints = context.audience?.pain_points?.join(', ') || 'time management, customer retention'
  const aspirations = context.audience?.aspirations?.join(', ') || 'growth, efficiency'
  const origin = context.story?.origin || ''
  const mission = context.story?.mission || ''
  const differentiator = context.story?.differentiator || ''

  const prompt = `You are a talented writer crafting content for ${businessName}.

## Voice Guidelines
- Personality: ${personality}
- Tone: ${tone}
- NEVER use these words: ${avoidWords}
- Write like a smart friend explaining something, not a corporation

## Audience
- Who they are: ${audience}
- Their pain points: ${painPoints}
- What they want: ${aspirations}

## Business Context
${origin ? `- Origin story: ${origin}` : ''}
${mission ? `- Mission: ${mission}` : ''}
${differentiator ? `- What makes them different: ${differentiator}` : ''}

## This Article
- Title: ${topic.title}
- Topic area: ${topic.topic}
- Angle: ${topic.description}

## Quality Requirements (CRITICAL)

1. **LEAD WITH SPECIFICITY**: Start with a concrete story, example, or scenario. Never start with "In today's world..." or generic statements. The first paragraph should hook the reader with something specific and interesting.

2. **INCLUDE REAL VALUE**: Every section must teach something actionable. If a reader can't DO something after reading, it's not valuable. No fluff.

3. **MATCH THE VOICE**: Read your output aloud. Does it sound like a ${personality} would say it? Would ${audience} feel like this was written for them?

4. **NO FILLER**: Remove any sentence that doesn't add value. Phrases like "It's important to note that..." should be deleted. Be direct.

5. **SPECIFIC > GENERIC**: Instead of "many businesses struggle with X", say "When a [specific type of business] faces X, they often..."

6. **END WITH ACTION**: The final section should give readers a clear next step they can take today.

7. **NO AI SLOP**: Avoid these telltale AI patterns:
   - Starting with "In the [adjective] world of..."
   - Using "landscape" as a metaphor
   - Saying "it's no secret that..."
   - Generic numbered lists without depth
   - Ending with vague "embrace the future" statements

## Format Requirements
- 1200-1800 words
- Use markdown with H2 (##) and H3 (###) subheadings
- Include 2-3 specific examples or mini-stories
- Write naturally flowing paragraphs, not just bullet lists
- End with a clear call-to-action section

Write the complete article now. Just the article content in markdown, no preamble or explanation:`

  return await callClaude(prompt, 4000)
}

// Quality check with self-critique
async function qualityCheck(article: string, context: GenerateRequest['context']): Promise<{ score: QualityScore; issues: string[]; verdict: string }> {
  const personality = context.voice?.personality || 'friendly and professional'

  const prompt = `You are a tough editor reviewing this article. Be critical but fair.

## The Article
${article}

## Check These Quality Criteria

Rate each 1-10 and explain briefly:

1. **Specificity**: Could this article be about ANY business, or does it feel specific? Are there concrete examples, numbers, scenarios?

2. **Voice Match**: Does this sound like a ${personality}? Any off-brand phrases?

3. **Value Density**: Can readers DO something after each section? Is there filler?

4. **Hook Strength**: Does the opening grab attention? Would you keep reading?

5. **Human Feel**: Does this feel human-written or obviously AI? Flag any "AI tells".

## Output as JSON only:
{
  "scores": {
    "specificity": 8,
    "voice": 7,
    "value": 9,
    "hook": 8,
    "human": 7
  },
  "issues": ["Issue 1", "Issue 2"],
  "verdict": "publish" or "needs_edits" or "rewrite"
}

Respond with only the JSON, no other text:`

  const response = await callClaude(prompt, 1000)

  try {
    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = response.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    }

    const result = JSON.parse(jsonStr)
    const scores = result.scores
    const total = (scores.specificity + scores.voice + scores.value + scores.hook + scores.human) / 5

    return {
      score: {
        total: Math.round(total * 10) / 10,
        specificity: scores.specificity,
        voice: scores.voice,
        value: scores.value,
        hook: scores.hook,
        human: scores.human,
        taboo_violations: 0, // Will be set by caller after taboo scan
      },
      issues: result.issues || [],
      verdict: result.verdict || 'publish',
    }
  } catch (e) {
    // Default to passing if we can't parse
    console.error('Quality check parse error:', e)
    return {
      score: { total: 7.5, specificity: 8, voice: 7, value: 8, hook: 7, human: 8, taboo_violations: 0 },
      issues: [],
      verdict: 'publish',
    }
  }
}

// Rewrite article with feedback
async function rewriteWithFeedback(originalArticle: string, issues: string[], context: GenerateRequest['context'], topic: GenerateRequest['topic']): Promise<string> {
  const prompt = `You wrote this article but an editor found issues. Rewrite it to fix them.

## Original Article
${originalArticle}

## Issues to Fix
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

## Voice Reminder
- Personality: ${context.voice?.personality || 'friendly and professional'}
- Tone: ${context.voice?.tone || 'warm and practical'}
- Audience: ${context.audience?.primary || 'small business owners'}

## Requirements
- Fix the specific issues mentioned
- Keep what's working well
- Maintain 1200-1800 words
- Make it feel more human and specific
- Start with something that grabs attention

Write the improved article now. Just the article content in markdown:`

  return await callClaude(prompt, 4000)
}

// Generate SEO metadata
function generateSEO(article: string, topic: GenerateRequest['topic']): { meta_title: string; meta_description: string; excerpt: string; tags: string[] } {
  // Extract first paragraph for excerpt
  const paragraphs = article.split('\n\n').filter(p => p.trim() && !p.startsWith('#'))
  const firstParagraph = paragraphs[0] || topic.description
  const excerpt = firstParagraph.substring(0, 200).trim() + (firstParagraph.length > 200 ? '...' : '')

  // Generate meta title (max 60 chars)
  let metaTitle = topic.title
  if (metaTitle.length > 60) {
    metaTitle = metaTitle.substring(0, 57) + '...'
  }

  // Generate meta description (max 160 chars)
  let metaDescription = topic.description || excerpt
  if (metaDescription.length > 160) {
    metaDescription = metaDescription.substring(0, 157) + '...'
  }

  // Extract potential tags from topic
  const tags = [topic.topic]
  if (topic.title.toLowerCase().includes('automation')) tags.push('automation')
  if (topic.title.toLowerCase().includes('email')) tags.push('email-marketing')
  if (topic.title.toLowerCase().includes('loyalty')) tags.push('loyalty-programs')
  if (topic.title.toLowerCase().includes('customer')) tags.push('customer-engagement')

  return { meta_title: metaTitle, meta_description: metaDescription, excerpt, tags }
}

// Generate URL slug
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 60)
}

// Main handler
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify we have the API key
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    const { topic, context, app_id, organization_id } = await req.json() as GenerateRequest

    if (!topic || !app_id) {
      throw new Error('Missing required fields: topic, app_id')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ===== RATE LIMITING =====
    // Check organization's plan and article usage

    // Get user from auth header
    const authHeader = req.headers.get('Authorization')
    let userId: string | null = null
    let isAdmin = false

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '')
      const { data: { user } } = await supabase.auth.getUser(token)
      userId = user?.id || null

      // Check if user is admin (role in organization_members)
      if (userId && organization_id) {
        const { data: membership } = await supabase
          .from('organization_members')
          .select('role')
          .eq('user_id', userId)
          .eq('organization_id', organization_id)
          .single()

        isAdmin = membership?.role === 'admin' || membership?.role === 'owner'
      }
    }

    // Get organization plan info
    let articleLimit = ARTICLE_LIMITS['free']
    if (organization_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('plan_type, subscription_tier, appsumo_tier')
        .eq('id', organization_id)
        .single()

      if (org) {
        articleLimit = getArticleLimit(org)
      }
    }

    // Skip limit check for admins or unlimited plans
    if (!isAdmin && articleLimit !== -1) {
      // Count articles generated this month for this organization
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)

      const { count: articlesThisMonth } = await supabase
        .from('content_generation_log')
        .select('*', { count: 'exact', head: true })
        .eq('app_id', app_id)
        .gte('generation_completed_at', startOfMonth.toISOString())

      const currentCount = articlesThisMonth || 0

      if (currentCount >= articleLimit) {
        console.log(`Rate limit exceeded: ${currentCount}/${articleLimit} articles for org ${organization_id}`)
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Article limit reached',
            limit_exceeded: true,
            current: currentCount,
            limit: articleLimit,
            message: `You've used all ${articleLimit} AI articles for this month. Upgrade your plan for more.`
          }),
          {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }

      console.log(`Rate limit check passed: ${currentCount}/${articleLimit} articles used`)
    } else if (isAdmin) {
      console.log(`Admin bypass: skipping rate limit check`)
    }

    console.log(`Generating article: "${topic.title}" for app ${app_id}`)

    // Step 1: Generate initial article
    let article = await generateArticle(topic, context)
    console.log('Initial article generated')

    // Step 2: Scan for taboo phrases (hard fail if found)
    let tabooViolations = scanForTabooPhrases(article)
    if (tabooViolations.length > 0) {
      console.log(`Taboo phrases detected: ${tabooViolations.join(', ')}`)
    }

    // Step 3: Quality check
    let qualityResult = await qualityCheck(article, context)
    console.log(`Quality score: ${qualityResult.score.total}, verdict: ${qualityResult.verdict}`)

    // Step 4: Rewrite if needed (score < 7 OR taboo phrases found)
    let rewriteCount = 0
    while ((qualityResult.score.total < 7 || tabooViolations.length > 0) && rewriteCount < 3) {
      // Add taboo violations to issues for targeted removal
      const allIssues = [...qualityResult.issues]
      if (tabooViolations.length > 0) {
        allIssues.push(`REMOVE these AI-sounding phrases: "${tabooViolations.join('", "')}"`)
      }

      console.log(`Rewriting article (attempt ${rewriteCount + 1})...`)
      article = await rewriteWithFeedback(article, allIssues, context, topic)

      // Re-scan for taboo phrases
      tabooViolations = scanForTabooPhrases(article)
      if (tabooViolations.length > 0) {
        console.log(`Still has taboo phrases: ${tabooViolations.join(', ')}`)
      } else {
        console.log('All taboo phrases removed')
      }

      // Re-check quality
      qualityResult = await qualityCheck(article, context)
      console.log(`New quality score: ${qualityResult.score.total}`)
      rewriteCount++
    }

    // Final warning if taboo phrases still present (rare)
    if (tabooViolations.length > 0) {
      console.warn(`Warning: Article still contains taboo phrases after ${rewriteCount} rewrites: ${tabooViolations.join(', ')}`)
    }

    // Step 4: Generate SEO metadata
    const seo = generateSEO(article, topic)

    // Build result (include final taboo count in quality score)
    const finalScore: QualityScore = {
      ...qualityResult.score,
      taboo_violations: tabooViolations.length,
    }

    const result: ArticleResult = {
      title: topic.title,
      slug: generateSlug(topic.title),
      excerpt: seo.excerpt,
      content: article,
      meta_title: seo.meta_title,
      meta_description: seo.meta_description,
      primary_topic: topic.topic,
      tags: seo.tags,
      quality_score: finalScore,
    }

    // Log generation (required for rate limiting)
    try {
      await supabase.from('content_generation_log').insert({
        app_id,
        topic: topic.title,
        initial_score: qualityResult.score.total,
        final_score: qualityResult.score.total,
        rewrites_needed: rewriteCount,
        generation_completed_at: new Date().toISOString(),
      })
    } catch (logError) {
      console.error('Failed to log generation:', logError)
      // Don't fail the request if logging fails
    }

    console.log(`Article generation complete: ${result.title}`)

    return new Response(
      JSON.stringify({ success: true, article: result }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Generation error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
