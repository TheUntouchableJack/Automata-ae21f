// Supabase Edge Function: Royal AI Recommend
// -------------------------------------------
// Knowledge-driven recommendation generator — the piece that finally fulfils the
// survey's core pitch ("answer these questions so Royal can give you smarter
// recommendations"). Loads accumulated business_knowledge + profile + org stats,
// asks Claude Haiku for up to 3 concrete recommendations, and INSERTs them into
// the existing `ai_recommendations` table so `get_pending_recommendations` + the
// Intelligence feed consume them unchanged.
//
// One handler, two entry modes:
//   - Cron mode    (no organization_id in body): process all eligible orgs.
//   - On-demand    ({ organization_id }): single org, triggered by the Analyze button.
//
// Shape cloned from analyze-suggestion (service-role client, facts+profile→JSON,
// _shared/knowledge.ts loaders, Claude Haiku). See ~/.claude/plans/sequential-scribbling-pumpkin.md.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { loadBusinessKnowledge, loadBusinessProfile } from '../_shared/knowledge.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MODEL_HAIKU = 'claude-haiku-4-5-20251001'

// Fleet-wide daily cost control. Small user base today; process everyone eligible.
// If the fleet ever outgrows this, we log the overflow rather than silently drop.
const MAX_ORGS_PER_RUN = 200
const MAX_RECS_PER_ORG = 3
const PENDING_DEDUP_LIMIT = 5
const MIN_KNOWLEDGE_FACTS = 5

const REC_TYPES = ['opportunity', 'efficiency', 'risk', 'growth', 'automation']
const IMPACTS = ['low', 'medium', 'high']
const ACTION_TYPES = [
  'create_automation', 'create_app', 'contact_customer', 'review_data',
  'create_project_with_automation', 'create_reward', 'send_message',
]

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface OrgResult {
  organization_id: string
  status: 'generated' | 'skipped'
  reason?: string
  count?: number
}

// ============================================================================
// HANDLER
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let organization_id: string | null = null
    try {
      const body = await req.json()
      organization_id = body?.organization_id || null
    } catch {
      // No / empty body → cron mode.
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const onDemand = !!organization_id
    const triggerType = onDemand ? 'manual' : 'scheduled'

    // Resolve the org list for this run.
    let orgIds: string[]
    if (onDemand) {
      orgIds = [organization_id!]
    } else {
      orgIds = await getEligibleOrgs(supabase)
      if (orgIds.length > MAX_ORGS_PER_RUN) {
        // No-silent-cap: surface exactly what got dropped.
        console.warn(`royal-ai-recommend: ${orgIds.length} eligible orgs exceeds MAX_ORGS_PER_RUN=${MAX_ORGS_PER_RUN}; processing first ${MAX_ORGS_PER_RUN}, deferring ${orgIds.length - MAX_ORGS_PER_RUN} to next run.`)
        orgIds = orgIds.slice(0, MAX_ORGS_PER_RUN)
      }
    }

    console.log(`royal-ai-recommend: mode=${onDemand ? 'on-demand' : 'cron'}, orgs=${orgIds.length}`)

    const results: OrgResult[] = []
    for (const orgId of orgIds) {
      try {
        results.push(await processOrg(supabase, orgId, triggerType))
      } catch (e) {
        console.error(`royal-ai-recommend: org ${orgId} failed:`, e)
        results.push({ organization_id: orgId, status: 'skipped', reason: 'error' })
      }
    }

    const generated = results.filter(r => r.status === 'generated')
    return new Response(
      JSON.stringify({
        success: true,
        mode: onDemand ? 'on-demand' : 'cron',
        processed: results.length,
        generated: generated.length,
        recommendations: generated.reduce((sum, r) => sum + (r.count || 0), 0),
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    console.error('Unhandled error in royal-ai-recommend:', e)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ============================================================================
// ELIGIBILITY (cron mode)
// Eligible = ai_analysis_enabled (default true) AND has a customer_apps row AND
// ≥5 active business_knowledge facts.
// ============================================================================

async function getEligibleOrgs(supabase: SupabaseClient): Promise<string[]> {
  const [{ data: orgs }, { data: apps }, { data: facts }] = await Promise.all([
    supabase.from('organizations').select('id, ai_analysis_enabled'),
    supabase.from('customer_apps').select('organization_id'),
    supabase.from('business_knowledge').select('organization_id').eq('status', 'active'),
  ])

  const withApp = new Set((apps || []).map((a: { organization_id: string }) => a.organization_id))

  const factCount: Record<string, number> = {}
  for (const f of (facts || []) as { organization_id: string }[]) {
    factCount[f.organization_id] = (factCount[f.organization_id] || 0) + 1
  }

  return (orgs || [])
    .filter((o: { id: string, ai_analysis_enabled: boolean | null }) =>
      o.ai_analysis_enabled !== false &&
      withApp.has(o.id) &&
      (factCount[o.id] || 0) >= MIN_KNOWLEDGE_FACTS
    )
    .map((o: { id: string }) => o.id)
}

// ============================================================================
// PER-ORG GENERATION
// ============================================================================

async function processOrg(
  supabase: SupabaseClient,
  orgId: string,
  triggerType: string
): Promise<OrgResult> {
  // 1. Hard budget gate (fleet-wide daily cost).
  const { data: budget } = await supabase.rpc('check_ai_budget', {
    p_org_id: orgId,
    p_default_cap_cents: 5000,
  })
  if (budget && budget.within_budget === false) {
    console.log(`royal-ai-recommend: org ${orgId} skipped — over budget`)
    return { organization_id: orgId, status: 'skipped', reason: 'over_budget' }
  }

  // 2. Dedup gate — don't pile up pending recs.
  const { count: pendingCount } = await supabase
    .from('ai_recommendations')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'pending')
  if ((pendingCount || 0) >= PENDING_DEDUP_LIMIT) {
    console.log(`royal-ai-recommend: org ${orgId} skipped — ${pendingCount} pending`)
    return { organization_id: orgId, status: 'skipped', reason: 'pending_full' }
  }

  // 3. Load context (reuse _shared/knowledge.ts loaders + existing RPC).
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const [knowledge, profile, analysisRes, recentRes] = await Promise.all([
    loadBusinessKnowledge(supabase, orgId, 30),
    loadBusinessProfile(supabase, orgId),
    supabase.rpc('get_org_analysis_data', { org_id: orgId }),
    supabase
      .from('ai_recommendations')
      .select('title')
      .eq('organization_id', orgId)
      .in('status', ['pending', 'implemented'])
      .gte('created_at', thirtyDaysAgo),
  ])

  if (knowledge.length === 0 && !profile) {
    return { organization_id: orgId, status: 'skipped', reason: 'no_context' }
  }

  const analysisData = analysisRes.data || {}
  const recentTitles = (recentRes.data || []).map((r: { title: string }) => r.title)
  const knowledgeIds = knowledge.map(k => k.id).filter(Boolean)

  // 4. Build prompts + call Haiku.
  const { systemPrompt, userPrompt } = buildPrompts(knowledge, profile, analysisData, recentTitles)

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL_HAIKU,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`royal-ai-recommend: Claude error for org ${orgId}:`, response.status, errorText)
    return { organization_id: orgId, status: 'skipped', reason: 'ai_error' }
  }

  const result = await response.json()
  const aiText = result.content?.[0]?.text
  const usage = result.usage || {}
  const inputTokens = usage.input_tokens || 0
  const outputTokens = usage.output_tokens || 0

  const recs = parseRecommendations(aiText)
  if (recs.length === 0) {
    console.warn(`royal-ai-recommend: org ${orgId} produced no valid recs`)
    // Still record the (small) spend + analysis run below? No — only bookkeeping when we generated.
    trackUsage(supabase, orgId, inputTokens, outputTokens)
    return { organization_id: orgId, status: 'skipped', reason: 'empty_result' }
  }

  // 5. Validate/clamp + INSERT into the existing table (columns unchanged).
  const rows = recs.slice(0, MAX_RECS_PER_ORG).map(rec => ({
    organization_id: orgId,
    recommendation_type: REC_TYPES.includes(rec.recommendation_type) ? rec.recommendation_type : 'opportunity',
    title: String(rec.title).slice(0, 200),
    description: String(rec.description || '').slice(0, 1000),
    confidence_score: clamp01(rec.confidence_score),
    potential_impact: IMPACTS.includes(rec.potential_impact) ? rec.potential_impact : 'medium',
    suggested_action: rec.suggested_action ? String(rec.suggested_action).slice(0, 500) : null,
    action_type: ACTION_TYPES.includes(rec.action_type) ? rec.action_type : 'review_data',
    action_payload: {
      ...(rec.action_payload && typeof rec.action_payload === 'object' ? rec.action_payload : {}),
      knowledge_refs: knowledgeIds,
    },
    analysis_data: {
      generated_by: 'royal-ai-recommend',
      model: 'haiku',
      trigger_type: triggerType,
      knowledge_refs: knowledgeIds,
      stats: analysisData,
    },
    status: 'pending',
  }))

  const { data: inserted, error: insertError } = await supabase
    .from('ai_recommendations')
    .insert(rows)
    .select('id, title')

  if (insertError) {
    console.error(`royal-ai-recommend: insert failed for org ${orgId}:`, insertError)
    return { organization_id: orgId, status: 'skipped', reason: 'insert_error' }
  }

  const insertedCount = inserted?.length || 0

  // 6. Bookkeeping — first-ever writers of this scaffolding.
  await Promise.all([
    supabase.from('ai_analysis_history').insert({
      organization_id: orgId,
      trigger_type: triggerType,
      analysis_summary: {
        mode: triggerType,
        titles: (inserted || []).map((r: { title: string }) => r.title),
        knowledge_facts_used: knowledgeIds.length,
      },
      recommendations_generated: insertedCount,
      tokens_used: inputTokens + outputTokens,
      completed_at: new Date().toISOString(),
    }),
    supabase.from('organizations').update({ last_ai_analysis_at: new Date().toISOString() }).eq('id', orgId),
  ])

  trackUsage(supabase, orgId, inputTokens, outputTokens)

  // Bump times_used on the facts that shaped these recs (provenance/learning loop).
  if (knowledgeIds.length > 0) {
    supabase.rpc('increment_knowledge_usage', { p_ids: knowledgeIds }).then(() => {}, () => {})
  }

  console.log(`royal-ai-recommend: org ${orgId} generated ${insertedCount} recs`)
  return { organization_id: orgId, status: 'generated', count: insertedCount }
}

// ============================================================================
// HELPERS
// ============================================================================

// deno-lint-ignore no-explicit-any
function trackUsage(supabase: SupabaseClient, orgId: string, input: number, output: number): void {
  if (input <= 0 && output <= 0) return
  supabase.rpc('increment_ai_usage', {
    p_org_id: orgId,
    p_input_tokens: input,
    p_output_tokens: output,
    p_cache_read_tokens: 0,
    p_model: 'haiku',
    p_function_name: 'royal_ai_recommend',
  }).then(({ error }: { error: unknown }) => { if (error) console.error('AI usage tracking error:', error) }, () => {})
}

function clamp01(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0.7
  return Math.max(0, Math.min(1, n))
}

// deno-lint-ignore no-explicit-any
function parseRecommendations(aiText: string | undefined): any[] {
  if (!aiText) return []
  try {
    const clean = aiText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    const parsed = JSON.parse(clean)
    const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.recommendations) ? parsed.recommendations : [])
    return arr.filter((r: unknown) => r && typeof r === 'object' && (r as { title?: unknown }).title)
  } catch (e) {
    console.error('royal-ai-recommend: failed to parse AI response:', e, 'raw:', aiText?.slice(0, 300))
    return []
  }
}

// deno-lint-ignore no-explicit-any
function buildPrompts(
  knowledge: any[],
  profile: any,
  analysisData: any,
  recentTitles: string[]
): { systemPrompt: string, userPrompt: string } {
  const knowledgeSummary = knowledge.length > 0
    ? knowledge.map(k => `- [${k.layer}/${k.category}] ${k.fact}`).join('\n')
    : 'No accumulated business knowledge yet.'

  const profileSummary = profile
    ? [
        profile.business_type && `Business type: ${profile.business_type}${profile.business_subtype ? ` (${profile.business_subtype})` : ''}`,
        profile.avg_ticket && `Average ticket: $${profile.avg_ticket}`,
        profile.gross_margin_pct && `Gross margin: ${profile.gross_margin_pct}%`,
        profile.price_positioning && `Price positioning: ${profile.price_positioning}`,
        profile.current_stage && `Business stage: ${profile.current_stage}`,
        profile.biggest_challenge && `Biggest challenge: ${profile.biggest_challenge}`,
        profile.competitive_advantage && `Competitive edge: ${profile.competitive_advantage}`,
        profile.success_vision && `Success vision: ${profile.success_vision}`,
        profile.primary_age_range && `Primary customer age range: ${profile.primary_age_range}`,
        profile.customer_frequency && `Customer visit frequency: ${profile.customer_frequency}`,
      ].filter(Boolean).join('\n')
    : 'No structured business profile yet.'

  const statsSummary = JSON.stringify(analysisData, null, 0)

  const avoid = recentTitles.length > 0
    ? `\n\nDo NOT repeat or lightly reword any of these recently-surfaced recommendations:\n${recentTitles.map(t => `- ${t}`).join('\n')}`
    : ''

  const systemPrompt = `You are Royal, an AI business analyst for a small-business loyalty platform. Given what you know about a specific business, produce concrete, high-leverage recommendations the owner can act on to grow revenue, retain customers, or run more efficiently.

Return ONLY a valid JSON array (no markdown, no code fences) of at most 3 objects. Each object has exactly these fields:
- recommendation_type (string): one of "opportunity", "efficiency", "risk", "growth", "automation"
- title (string): a short, specific headline (max ~80 chars)
- description (string): 1-2 sentences grounded in this business's actual data explaining the recommendation and why it matters
- confidence_score (number): 0.0-1.0, how confident you are given the available data
- potential_impact (string): one of "low", "medium", "high"
- suggested_action (string): the single next step the owner should take
- action_type (string): one of "create_automation", "create_app", "contact_customer", "review_data", "create_reward", "send_message"
- action_payload (object): optional pre-filled data for the action (may be {})

Rules:
- Ground every recommendation in the provided knowledge/profile/stats. Never invent facts.
- Prefer specificity over generic advice. If data is thin, lower confidence_score.
- Fewer, sharper recommendations beat filler. Return 1-3, not always 3.
- Write in clear English.`

  const userPrompt = `Business profile:
${profileSummary}

What I know about this business:
${knowledgeSummary}

Current business stats (customers / projects / automations):
${statsSummary}${avoid}

Produce the recommendations as a JSON array.`

  return { systemPrompt, userPrompt }
}
