// Supabase Edge Function: Blog Humanize
// Given a HUMAN_EDIT marker's prompt and article context, calls Claude Opus 4.6
// to regenerate a humanized content suggestion.
// Admin-only: validates JWT and checks is_admin before calling AI.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MODEL = 'claude-opus-4-6'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate JWT and check admin status
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const token = authHeader.replace('Bearer ', '')

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check is_admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const { marker_type, prompt, article_title, article_context } = await req.json()

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'Missing prompt' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build system prompt based on marker type
    const typeInstructions: Record<string, string> = {
      real_example: 'Write a specific, realistic example with concrete details. Use plausible business names, locations, and numbers. Keep it brief (2-4 sentences).',
      first_hand: 'Write in first-person voice as if from the Royalty team. Use "we" and reference real product decisions or observations. 1-3 sentences.',
      fact_check: 'Provide a fact-checked, accurate statement based on publicly available information. Flag anything that should be verified. 1-2 sentences.',
      unique_insight: 'Provide a specific insight that goes beyond what competitors say — something that shows genuine expertise or insider knowledge. 1-3 sentences.',
      tone_adjust: 'Rewrite the content with a more conversational, human tone. Less formal, more direct. Keep the meaning intact.',
      review_only: 'Review the content for accuracy and tone. Return it as-is if it reads well, or lightly polish it.',
    }

    const typeInstruction = typeInstructions[marker_type] || 'Write a helpful, specific replacement for this section.'

    const systemPrompt = `You are a marketing writer for Royalty (royaltyapp.ai), an AI-powered loyalty program platform for small businesses. Royalty's key differentiators:
- Sets up a loyalty program in 60 seconds
- AI win-back automation (detects lapsed customers, sends personalized messages)
- No app download needed for customers (QR code check-in)
- Flat lifetime pricing from $59 (no monthly fees)
- Multi-language (8 languages)

Your job: ${typeInstruction}

Guidelines:
- Be specific and concrete, not generic
- Never fabricate statistics — use ranges or "studies show" framing if citing data
- Write for small business owners, not enterprise
- Keep it concise
- Sound like a knowledgeable human wrote it, not an AI

Return ONLY the replacement text — no introductions, no "Here's the text:", no markdown fences.`

    const userMessage = article_title
      ? `Article: "${article_title}"\n\nContext: ${article_context || 'None provided'}\n\nWhat to write: ${prompt}`
      : `What to write: ${prompt}\n\nContext: ${article_context || 'None provided'}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Claude API error:', response.status, errorText)
      return new Response(
        JSON.stringify({ error: 'AI generation failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const result = await response.json()
    const suggestion = result.content?.[0]?.text?.trim()

    if (!suggestion) {
      return new Response(
        JSON.stringify({ error: 'Empty AI response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Estimate humanness score based on marker type
    const humannessEstimates: Record<string, number> = {
      real_example: 0.65,
      first_hand: 0.70,
      fact_check: 0.75,
      unique_insight: 0.68,
      tone_adjust: 0.80,
      review_only: 0.85,
    }
    const humanness_score = humannessEstimates[marker_type] ?? 0.70

    return new Response(
      JSON.stringify({ suggestion, humanness_score }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    console.error('Unhandled error in blog-humanize:', e)
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
