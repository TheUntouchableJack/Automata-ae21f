// Supabase Edge Function: Analyze Business for Signup
// Called pre-signup from the signup page. Takes business context from onboarding,
// calls Claude Haiku to generate a personalized business analysis, and returns
// structured JSON with business understanding, opportunities, and recommendations.
// No JWT required (pre-auth) — rate limited by IP.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MODEL_HAIKU = 'claude-haiku-4-5-20251001'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LANG_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', zh: 'Chinese (Simplified)', ar: 'Arabic'
}

function sanitize(s: string, maxLen = 500): string {
  return String(s || '').replace(/[<>]/g, '').slice(0, maxLen).trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { businessPrompt, businessContext, businessDetails, language } = body

    // Validate required input
    if (!businessPrompt || typeof businessPrompt !== 'string' || businessPrompt.trim().length < 10) {
      return new Response(
        JSON.stringify({ success: false, error: 'Business description required (min 10 chars)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (businessPrompt.length > 2000) {
      return new Response(
        JSON.stringify({ success: false, error: 'Business description too long (max 2000 chars)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Sanitize language param
    const lang = sanitize(language || 'en', 10).toLowerCase()
    const langName = LANG_NAMES[lang] || 'English'

    // Rate limit by IP (20 per hour — generous for testing + language switching)
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

    try {
      const { data: allowed } = await supabase.rpc('check_and_record_rate_limit', {
        p_identifier: `signup_analysis_${clientIp}`,
        p_action_type: 'signup_analysis',
        p_max_attempts: 20,
        p_window_minutes: 60
      })

      if (allowed === false) {
        return new Response(
          JSON.stringify({ success: false, error: 'Too many requests. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } catch (e) {
      console.warn('Rate limit check failed, continuing:', e)
    }

    // Sanitize inputs
    const prompt = sanitize(businessPrompt, 2000)
    const industry = sanitize(businessContext?.industry || '', 100)
    const goals = (businessContext?.goals || []).slice(0, 5).map((g: string) => sanitize(g, 200))
    const painPoints = (businessContext?.painPoints || []).slice(0, 5).map((p: string) => sanitize(p, 200))
    const bizName = sanitize(businessDetails?.businessName || '', 200)
    const bizType = sanitize(businessDetails?.businessType || '', 100)
    const customerCount = sanitize(businessDetails?.customerCount || '', 50)
    const websiteUrl = sanitize(businessDetails?.websiteUrl || '', 300)

    // Build Claude prompts
    const systemPrompt = `You are a business analyst for Royalty, an AI-powered loyalty and customer engagement platform for small and medium businesses. Royalty builds each business a complete platform: a branded customer-facing loyalty app, intelligent automations, real-time analytics dashboard, and growth tools. A potential customer has described their business. Demonstrate deep understanding and show what their complete Royalty platform will look like.

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "businessSummary": "2-3 sentences showing you understand this specific business, its market position, and challenges. Be specific, not generic. Reference their industry and goals.",
  "impactMetrics": [
    {
      "value": "Display string (e.g. '+32%', '3.2x', '$2,400/mo')",
      "numericValue": 32,
      "label": "What this metric represents for their business",
      "source": "Brief citation: industry benchmark, study, or trend that supports this projection",
      "icon": "revenue|retention|engagement",
      "color": "green|purple|blue"
    }
  ],
  "opportunities": [
    {
      "title": "Short title (3-5 words)",
      "description": "2-3 sentences about this specific opportunity for their business. Be concrete.",
      "impact": "One sentence about expected measurable outcome",
      "source": "Industry insight or benchmark supporting this opportunity",
      "icon": "loyalty|automation|insights|growth",
      "actionSteps": [
        "Step 1: Specific concrete action Royalty will take",
        "Step 2: Another specific action",
        "Step 3: A third specific action"
      ]
    }
  ],
  "platformHighlights": [
    {
      "name": "Feature or capability name",
      "reason": "One sentence on why this matters for their specific business"
    }
  ],
  "extractedDetails": {
    "businessName": "Extracted business name (or empty string if not mentioned)",
    "industry": "food|retail|health|service|technology|education|other",
    "businessType": "food|retail|health|service|technology|education|other",
    "location": "City/area mentioned (or empty string)",
    "customerCount": "1-50|51-200|201-500|501-1000|1001+|'' (best estimate from description)",
    "websiteUrl": "URL if mentioned (or empty string)"
  }
}

Rules:
- Generate exactly 3 impactMetrics: one for revenue/spending impact (color: green, icon: revenue), one for customer retention/return rate (color: purple, icon: retention), one for engagement or visit frequency (color: blue, icon: engagement). numericValue must be a positive integer (used for animation). Make stats realistic and impressive for their business size and industry.
- Generate exactly 4 opportunities covering these categories in order:
  1. "Your Branded Loyalty App" (icon: loyalty) — their custom mobile app with digital rewards, stamp cards, push notifications, branded experience
  2. "Smart Automations" (icon: automation) — automated campaigns like win-back, birthday rewards, post-visit follow-up, re-engagement
  3. "Customer Insights & Analytics" (icon: insights) — real-time dashboard, spending patterns, visit frequency, cohort analysis, customer segmentation
  4. "Revenue Growth Engine" (icon: growth) — upsell opportunities, referral programs, targeted promotions, competitive advantage
- Each opportunity must include exactly 3 actionSteps — specific, concrete things Royalty will do for THIS business
- Generate 4-5 platformHighlights — short feature callouts spanning the full platform (not just automations). Mix of app features, automation types, analytics capabilities, and growth tools.
- Each impactMetric and opportunity must include a "source" field citing the specific industry benchmark, study, statistic, or market trend that supports the projection (e.g. "Harvard Business Review: loyalty programs increase repeat visits by 20-30%", "National Restaurant Association 2024: 67% of diners prefer digital rewards")
- Use your knowledge about the industry to make insights specific and credible
- Reference specific industry trends, competitive dynamics, or market opportunities
- Tone: confident, specific, exciting — this is a "wow" moment to convince them to sign up
- Generate extractedDetails by parsing the business description. Extract the business name, industry category (must be one of the enum values), location, and customer count estimate. If explicit structured fields were provided (business name, industry, etc.), prefer those over extracted values. If a field cannot be determined, use an empty string.
- IMPORTANT: Generate ALL text content in ${lang === 'en' ? 'English' : langName}. This includes businessSummary, opportunity titles/descriptions/impacts/actionSteps, metric labels, and highlight names/reasons. Do NOT translate JSON field names or icon/color identifiers.`

    const userPrompt = `Business description: "${prompt}"

Business name: ${bizName || 'Not provided'}
Business type: ${bizType || 'Not specified'}
Industry: ${industry || 'Not specified'}
Approximate customers: ${customerCount || 'Not specified'}
Website: ${websiteUrl || 'Not provided'}

Goals: ${goals.length > 0 ? goals.join(', ') : 'Not specified'}
Challenges: ${painPoints.length > 0 ? painPoints.join(', ') : 'Not specified'}

Analyze this business and show what Royalty can do for them.`

    // Call Claude Haiku
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_HAIKU,
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Claude API error:', response.status, errorText)
      return new Response(
        JSON.stringify({ success: false, error: `Claude API returned ${response.status}`, detail: errorText }),
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

    // Parse JSON response — extract the JSON object robustly
    try {
      const jsonStart = aiText.indexOf('{')
      const jsonEnd = aiText.lastIndexOf('}')
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON object found in response')
      const cleanText = aiText.slice(jsonStart, jsonEnd + 1)
      const analysis = JSON.parse(cleanText)

      // Validate required fields
      if (!analysis.businessSummary || !analysis.opportunities) {
        throw new Error('Missing required fields in analysis')
      }

      return new Response(
        JSON.stringify({ success: true, analysis }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError, 'Raw:', aiText)
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to parse AI response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  } catch (e) {
    console.error('Unhandled error in analyze-business-signup:', e)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
