// Supabase Edge Function: Analyze Reward Suggestion
// Reads a customer reward suggestion + business context, calls Claude Haiku
// to propose an optimized reward, and stores the proposal in ai_proposal JSONB.
// Triggered fire-and-forget from customer app after suggestion submission.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MODEL_HAIKU = 'claude-haiku-4-5-20251001'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// BUSINESS CONTEXT LOADERS (same patterns as royal-ai-prompt)
// ============================================================================

interface BusinessKnowledge {
  fact: string
  layer: string
  category: string
  importance: string
}

interface BusinessProfile {
  business_type: string | null
  business_subtype: string | null
  avg_ticket: number | null
  gross_margin_pct: number | null
  food_cost_pct: number | null
  price_positioning: string | null
  primary_revenue_streams: string[] | null
  customer_frequency: string | null
}

async function loadBusinessKnowledge(
  supabase: SupabaseClient,
  organizationId: string
): Promise<BusinessKnowledge[]> {
  try {
    const { data, error } = await supabase
      .from('business_knowledge')
      .select('fact, layer, category, importance')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .order('importance', { ascending: false })
      .limit(15)

    if (error) {
      console.error('Failed to load business knowledge:', error)
      return []
    }
    return data || []
  } catch (e) {
    console.error('Error loading knowledge:', e)
    return []
  }
}

async function loadBusinessProfile(
  supabase: SupabaseClient,
  organizationId: string
): Promise<BusinessProfile | null> {
  try {
    const { data, error } = await supabase
      .from('business_profiles')
      .select('business_type, business_subtype, avg_ticket, gross_margin_pct, food_cost_pct, price_positioning, primary_revenue_streams, customer_frequency')
      .eq('organization_id', organizationId)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Failed to load business profile:', error)
    }
    return data || null
  } catch (e) {
    console.error('Error loading profile:', e)
    return null
  }
}

// ============================================================================
// HANDLER
// ============================================================================

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { suggestion_id } = await req.json()

    if (!suggestion_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing suggestion_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Load the suggestion
    const { data: suggestion, error: fetchError } = await supabase
      .from('reward_suggestions')
      .select('*')
      .eq('id', suggestion_id)
      .single()

    if (fetchError || !suggestion) {
      console.error('Suggestion not found:', suggestion_id, fetchError)
      return new Response(
        JSON.stringify({ success: false, error: 'Suggestion not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Skip if already analyzed
    if (suggestion.ai_proposal) {
      return new Response(
        JSON.stringify({ success: true, message: 'Already analyzed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Load business context
    const [knowledge, profile] = await Promise.all([
      loadBusinessKnowledge(supabase, suggestion.organization_id),
      loadBusinessProfile(supabase, suggestion.organization_id),
    ])

    // 3. Build prompts
    const knowledgeSummary = knowledge.length > 0
      ? knowledge.map(k => `- [${k.layer}/${k.category}] ${k.fact}`).join('\n')
      : 'No business data available yet.'

    const profileSummary = profile
      ? [
          profile.business_type && `Business type: ${profile.business_type}${profile.business_subtype ? ` (${profile.business_subtype})` : ''}`,
          profile.avg_ticket && `Average ticket: $${profile.avg_ticket}`,
          profile.gross_margin_pct && `Gross margin: ${profile.gross_margin_pct}%`,
          profile.food_cost_pct && `Food cost: ${profile.food_cost_pct}%`,
          profile.price_positioning && `Price positioning: ${profile.price_positioning}`,
          profile.customer_frequency && `Customer visit frequency: ${profile.customer_frequency}`,
        ].filter(Boolean).join('\n')
      : 'No business profile available yet.'

    const systemPrompt = `You are a loyalty rewards analyst for small businesses. Given a customer's reward suggestion and the business's context, propose an optimized reward that is fair to customers while sustainable for the business.

Return ONLY a valid JSON object (no markdown, no code fences) with these fields:
- reward_name (string): A polished version of the customer's suggestion
- description (string): A clear 1-sentence description of the reward
- points_cost (integer): Recommended points cost
- category (string): One of: Food & Drink, Merchandise, Discount, Experience, Service, Other
- reasoning (string): 1-2 sentences explaining why this points cost makes sense for this business

Guidelines for points_cost:
- If the business has avg_ticket data, a free item should cost roughly 5-8x the per-visit points earn rate
- Small treats: 50-150 pts, Medium rewards: 150-400 pts, Premium rewards: 400-1000 pts
- If the customer suggested points, use that as a signal but adjust based on business economics
- Default to 25 pts per visit as the standard earn rate if no data available`

    const userPrompt = `Customer suggestion:
- Reward name: "${suggestion.reward_name}"
- Description: ${suggestion.description || 'None provided'}
- Customer suggested points: ${suggestion.suggested_points ? suggestion.suggested_points + ' pts' : 'Not specified'}

Business profile:
${profileSummary}

Business knowledge:
${knowledgeSummary}

Propose the optimized reward as JSON.`

    // 4. Call Claude Haiku
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_HAIKU,
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Claude API error:', response.status, errorText)
      return new Response(
        JSON.stringify({ success: false, error: 'AI analysis failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const result = await response.json()
    const aiText = result.content?.[0]?.text

    if (!aiText) {
      console.error('Empty AI response')
      return new Response(
        JSON.stringify({ success: false, error: 'Empty AI response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 5. Parse and store AI proposal
    try {
      // Clean potential markdown fences
      const cleanText = aiText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
      const proposal = JSON.parse(cleanText)

      // Validate required fields
      if (!proposal.reward_name || !proposal.points_cost) {
        throw new Error('Missing required fields in AI proposal')
      }

      // Ensure points_cost is an integer
      proposal.points_cost = Math.round(Number(proposal.points_cost))

      const { error: updateError } = await supabase
        .from('reward_suggestions')
        .update({ ai_proposal: proposal })
        .eq('id', suggestion_id)

      if (updateError) {
        console.error('Failed to store AI proposal:', updateError)
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to store proposal' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.log(`AI proposal stored for suggestion ${suggestion_id}:`, proposal.reward_name, proposal.points_cost, 'pts')

      return new Response(
        JSON.stringify({ success: true, proposal }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (parseError) {
      console.error('Failed to parse AI proposal:', parseError, 'Raw text:', aiText)
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to parse AI response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  } catch (e) {
    console.error('Unhandled error in analyze-suggestion:', e)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
