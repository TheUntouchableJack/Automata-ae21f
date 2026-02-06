// Supabase Edge Function: Royal AI Prompt
// Conversational AI for business owners with mode-aware responses
// Features: session memory, chat threads, review mode (cards) vs chat mode (conversational)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Model configuration - update when switching models
const MODEL_ID = 'claude-sonnet-4-20250514'
const MODEL_DISPLAY_NAME = 'Sonnet 4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ExternalContext {
  weather?: {
    available: boolean
    current?: {
      temp: number
      conditions: string
      description: string
    }
    forecast?: {
      season: string
      temp_range: { low: number; high: number }
    }
  }
  time?: {
    dayOfWeek: number
    dayName: string
    hour: number
    timeOfDay: string
    isWeekend: boolean
    isHappyHour: boolean
    isLunchHour: boolean
    isFriday: boolean
    isMonday: boolean
    monthName: string
  }
  holidays?: Array<{
    name: string
    daysAway: number
    isThisWeek: boolean
  }>
}

interface PromptRequest {
  prompt: string
  session_id: string
  thread_id?: string
  mode: 'review' | 'chat'
  context: {
    industry: string | null
    customerCount: number
    activeAutomations: string[]
    city: string | null
    state?: string | null
    businessName: string | null
    slowDays?: string[] | null
    monthlyRevenue?: number | null
    currentChallenge?: string | null
    external?: ExternalContext | null
  }
}

interface IdeaCard {
  type: 'automation' | 'strategy' | 'local-insight' | 'industry-tip'
  title: string
  description: string
  confidence: number
  impact: 'high' | 'medium' | 'low'
  action_type?: 'create_automation' | 'navigate' | 'info'
  action_payload?: {
    template_id?: string
    url?: string
  }
}

interface ReviewResponse {
  mode: 'review'
  ideas: IdeaCard[]
  follow_up_questions: string[]
  thread_id: string
  session_id: string
}

interface ChatResponse {
  mode: 'chat'
  message: string
  ideas?: IdeaCard[]
  thread_id: string
  session_id: string
}

type PromptResponse = ReviewResponse | ChatResponse

// Sanitize user input to prevent prompt injection attacks
// Rejects inputs containing common injection patterns and enforces length limits
function sanitizeContextInput(input: string | null | undefined, maxLength: number = 200): string {
  if (!input) return ''

  // Common prompt injection patterns to reject
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|above|prior)/i,
    /disregard\s+(all\s+)?(previous|above|prior)/i,
    /forget\s+(all\s+)?(previous|above|prior)/i,
    /new\s+instructions?:/i,
    /system\s*prompt/i,
    /you\s+are\s+now/i,
    /act\s+as\s+(a\s+)?different/i,
    /pretend\s+(to\s+be|you('re|are))/i,
    /role:\s*(system|assistant|user)/i,
    /\[\[.*\]\]/,  // Double bracket commands
    /{{.*}}/,      // Template injection
    /<\/?script/i, // Script tags
  ]

  const cleanInput = input.toString().trim()

  // Check for injection patterns
  for (const pattern of injectionPatterns) {
    if (pattern.test(cleanInput)) {
      console.warn('Prompt injection pattern detected, sanitizing input')
      return cleanInput.replace(pattern, '[FILTERED]').slice(0, maxLength)
    }
  }

  // Truncate to max length and remove excessive newlines (which can break prompt structure)
  return cleanInput
    .replace(/\n{3,}/g, '\n\n')  // Collapse multiple newlines
    .slice(0, maxLength)
}

// Sanitize array of strings
function sanitizeContextArray(arr: string[] | null | undefined): string[] {
  if (!arr || !Array.isArray(arr)) return []
  return arr.slice(0, 10).map(item => sanitizeContextInput(item, 50))
}

// Call Claude API with conversation history
async function callClaude(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number = 2000
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL_ID,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return data.content[0].text
}

// Build external context section for prompt
function buildExternalContextSection(external: ExternalContext | null | undefined): string {
  if (!external) return ''

  const lines: string[] = []

  // Weather
  if (external.weather?.available && external.weather.current) {
    lines.push(`**Weather:** ${external.weather.current.description}, ${external.weather.current.temp}°F`)
  }

  // Time context
  if (external.time) {
    const t = external.time
    lines.push(`**Time:** ${t.dayName} ${t.timeOfDay} (${t.hour}:00)`)

    const timeFlags: string[] = []
    if (t.isHappyHour) timeFlags.push('happy hour window')
    if (t.isLunchHour) timeFlags.push('lunch rush')
    if (t.isWeekend) timeFlags.push('weekend')
    if (t.isFriday) timeFlags.push('Friday')
    if (t.isMonday) timeFlags.push('Monday')

    if (timeFlags.length > 0) {
      lines.push(`**Time Context:** ${timeFlags.join(', ')}`)
    }
  }

  // Upcoming holidays
  if (external.holidays && external.holidays.length > 0) {
    const holidayList = external.holidays.slice(0, 3).map(h =>
      `${h.name} (${h.daysAway === 0 ? 'today' : h.daysAway === 1 ? 'tomorrow' : `${h.daysAway} days`})`
    ).join(', ')
    lines.push(`**Upcoming:** ${holidayList}`)
  }

  if (lines.length === 0) return ''

  return `\n\n## Real-Time Context\n${lines.join('\n')}`
}

// Build system prompt based on mode
function buildSystemPrompt(context: PromptRequest['context'], mode: 'review' | 'chat'): string {
  // Sanitize all user-provided context fields to prevent prompt injection
  const safeIndustry = sanitizeContextInput(context.industry, 100)
  const safeCity = sanitizeContextInput(context.city, 100)
  const safeState = sanitizeContextInput(context.state, 50)
  const safeBusinessName = sanitizeContextInput(context.businessName, 100)
  const safeChallenge = sanitizeContextInput(context.currentChallenge, 300)
  const safeAutomations = sanitizeContextArray(context.activeAutomations)
  const safeSlowDays = sanitizeContextArray(context.slowDays)

  const industryInfo = safeIndustry ? `\n**Industry:** ${safeIndustry}` : ''
  const locationInfo = safeCity ? `\n**Location:** ${safeCity}${safeState ? `, ${safeState}` : ''}` : ''
  const automationsInfo = safeAutomations.length > 0
    ? `\n**Active Automations:** ${safeAutomations.join(', ')}`
    : '\n**Active Automations:** None set up yet'

  // Extended business info
  const slowDaysInfo = safeSlowDays.length ? `\n**Slow Days:** ${safeSlowDays.join(', ')}` : ''
  const revenueInfo = context.monthlyRevenue ? `\n**Monthly Revenue:** $${context.monthlyRevenue.toLocaleString()}` : ''
  const challengeInfo = safeChallenge ? `\n**Current Challenge:** ${safeChallenge}` : ''

  // External context (weather, time, holidays)
  const externalContext = buildExternalContextSection(context.external)

  const businessContext = `## Business Context
**Business:** ${safeBusinessName || 'Local Business'}${industryInfo}${locationInfo}
**Customer Count:** ${context.customerCount}${automationsInfo}${slowDaysInfo}${revenueInfo}${challengeInfo}${externalContext}`

  if (mode === 'chat') {
    // Chat mode: conversational, no forced card generation
    return `You are Royal AI, a friendly and knowledgeable business advisor for local businesses using Royalty, a loyalty program platform.

## Your Role
- Have natural conversations about business growth and customer retention
- Answer questions helpfully and conversationally
- Only suggest specific actions when the user asks for recommendations
- Be warm, encouraging, and supportive

${businessContext}

## Response Format
Respond naturally in conversational text. Do NOT return JSON unless specifically asked for action recommendations.

If the user asks for specific recommendations or actions, you may optionally include a JSON block at the end:
\`\`\`json
{"ideas": [...], "suggested": true}
\`\`\`

But for general conversation, just respond in plain text like a helpful advisor would.

## Guidelines
1. Be conversational and natural - this is a chat, not a report
2. Ask clarifying questions when needed
3. Reference their business context when relevant
4. Only generate action cards when they explicitly ask "what should I do" or similar
5. Keep responses concise but helpful`
  }

  // Review mode: structured card generation (existing behavior)
  return `You are Royal AI, an intelligent business advisor for local businesses using Royalty, a loyalty program platform.

## Your Role
- Help business owners grow their customer base and increase retention
- Provide actionable insights based on their specific business context
- Suggest automations, strategies, and local marketing ideas
- Be conversational, helpful, and data-driven

${businessContext}

## Industry Knowledge
You have deep knowledge of:
- Loyalty program best practices
- Industry-specific retention strategies
- Local marketing tactics
- Automation workflows for customer engagement
- Competitive insights for various industries

## Response Format
You MUST respond in valid JSON with this exact structure:
{
  "ideas": [
    {
      "type": "automation" | "strategy" | "local-insight" | "industry-tip",
      "title": "Short title (max 60 chars)",
      "description": "Detailed explanation (2-3 sentences)",
      "confidence": 0.0-1.0,
      "impact": "high" | "medium" | "low",
      "action_type": "create_automation" | "navigate" | "info",
      "action_payload": { "template_id": "string" }
    }
  ],
  "follow_up_questions": [
    "Question 1?",
    "Question 2?"
  ]
}

## Available Automation Templates
When suggesting automations, use these template_id values:
- "welcome-email" - Welcome message for new members
- "birthday" - Birthday reward offers
- "win-back" - Re-engagement for inactive customers (30+ days)
- "streak-bonus" - Bonus for consecutive visits
- "milestone" - Celebrate point milestones
- "review-request" - Ask for reviews after visits

## Guidelines
1. Generate 1-3 relevant idea cards per response
2. Tailor suggestions to the user's industry and location when known
3. Consider their current automation setup to avoid duplicates
4. Include 2-4 follow-up questions to continue the conversation
5. Be specific and actionable - general advice is not helpful
6. For new businesses (0 customers), focus on acquisition and onboarding
7. For established businesses, focus on retention and optimization`
}

// Parse response based on mode
function parseResponse(text: string, mode: 'review' | 'chat'): { ideas: IdeaCard[], message?: string, follow_up_questions?: string[] } {
  if (mode === 'chat') {
    // Chat mode: extract message and optional ideas
    let message = text
    let ideas: IdeaCard[] = []

    // Check if there's a JSON block for suggested ideas
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1])
        if (parsed.ideas && parsed.suggested) {
          ideas = parsed.ideas.slice(0, 3).map((idea: any) => ({
            type: ['automation', 'strategy', 'local-insight', 'industry-tip'].includes(idea.type) ? idea.type : 'strategy',
            title: String(idea.title || '').slice(0, 100),
            description: String(idea.description || '').slice(0, 500),
            confidence: Math.min(1, Math.max(0, Number(idea.confidence) || 0.7)),
            impact: ['high', 'medium', 'low'].includes(idea.impact) ? idea.impact : 'medium',
            action_type: 'info'
          }))
        }
        // Remove JSON block from message
        message = text.replace(/```json[\s\S]*?```/, '').trim()
      } catch (e) {
        // JSON parse failed, just use full text as message
      }
    }

    return { message, ideas }
  }

  // Review mode: parse JSON response
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }

    const parsed = JSON.parse(jsonMatch[0])

    const ideas: IdeaCard[] = (parsed.ideas || []).slice(0, 3).map((idea: any) => ({
      type: ['automation', 'strategy', 'local-insight', 'industry-tip'].includes(idea.type) ? idea.type : 'strategy',
      title: String(idea.title || '').slice(0, 100),
      description: String(idea.description || '').slice(0, 500),
      confidence: Math.min(1, Math.max(0, Number(idea.confidence) || 0.7)),
      impact: ['high', 'medium', 'low'].includes(idea.impact) ? idea.impact : 'medium',
      action_type: ['create_automation', 'navigate', 'info'].includes(idea.action_type) ? idea.action_type : 'info',
      action_payload: idea.action_payload || undefined
    }))

    const follow_up_questions: string[] = (parsed.follow_up_questions || [])
      .slice(0, 4)
      .map((q: any) => String(q).slice(0, 200))

    return { ideas, follow_up_questions }
  } catch (e) {
    console.error('Failed to parse AI response:', e, text)
    return {
      ideas: [{
        type: 'strategy',
        title: 'Let me think about that',
        description: 'I had trouble processing that request. Could you try rephrasing your question?',
        confidence: 0.5,
        impact: 'low',
        action_type: 'info'
      }],
      follow_up_questions: [
        'What specific aspect of your business would you like to improve?',
        'Are you looking for customer acquisition or retention strategies?'
      ]
    }
  }
}

// Generate thread title from first message
async function generateThreadTitle(prompt: string): Promise<string> {
  // Simple title generation: take first 50 chars or first sentence
  const firstSentence = prompt.split(/[.!?]/)[0]
  if (firstSentence.length <= 50) {
    return firstSentence.trim()
  }
  return prompt.slice(0, 47).trim() + '...'
}

// Main handler
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { prompt, session_id, thread_id, mode = 'review', context } = await req.json() as PromptRequest

    // Comprehensive input validation
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Missing or invalid prompt')
    }
    if (prompt.length > 5000) {
      throw new Error('Prompt too long (max 5000 characters)')
    }
    if (!session_id || typeof session_id !== 'string') {
      throw new Error('Missing or invalid session_id')
    }
    if (mode !== 'review' && mode !== 'chat') {
      throw new Error('Invalid mode (must be "review" or "chat")')
    }
    if (thread_id && typeof thread_id !== 'string') {
      throw new Error('Invalid thread_id')
    }
    if (context && typeof context !== 'object') {
      throw new Error('Invalid context')
    }
    // Validate numeric fields
    if (context?.customerCount !== undefined && (typeof context.customerCount !== 'number' || context.customerCount < 0)) {
      throw new Error('Invalid customerCount')
    }
    if (context?.monthlyRevenue !== undefined && context.monthlyRevenue !== null && typeof context.monthlyRevenue !== 'number') {
      throw new Error('Invalid monthlyRevenue')
    }

    // Get user's organization
    const { data: membership } = await supabase
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return new Response(
        JSON.stringify({ success: false, error: 'No organization found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const organizationId = membership.organization_id

    // Check plan limits
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const { count: monthlyUsage } = await supabase
      .from('ai_prompts')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .gte('created_at', startOfMonth.toISOString())

    const { data: org } = await supabase
      .from('organizations')
      .select('plan_type, subscription_tier')
      .eq('id', organizationId)
      .single()

    const tier = org?.subscription_tier || org?.plan_type || 'free'
    const limits: Record<string, number> = {
      'free': 0,
      'appsumo_tier1': 0,
      'appsumo_tier2': 0,
      'appsumo_tier3': 0,
      'starter': 30,
      'growth': 100,
      'scale': Infinity,
      'enterprise': Infinity
    }
    const monthlyLimit = limits[tier] ?? 0

    if (monthlyLimit !== Infinity && (monthlyUsage || 0) >= monthlyLimit) {
      return new Response(
        JSON.stringify({ success: false, error: 'Monthly prompt limit reached', upgrade_required: true }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Handle thread creation or lookup
    let currentThreadId = thread_id
    let isNewThread = false

    if (!currentThreadId) {
      // Create new thread
      const title = await generateThreadTitle(prompt)
      const { data: newThread, error: threadError } = await supabase
        .from('ai_threads')
        .insert({
          organization_id: organizationId,
          user_id: user.id,
          title,
          mode
        })
        .select('id')
        .single()

      if (threadError) {
        console.error('Failed to create thread:', threadError)
      } else {
        currentThreadId = newThread.id
        isNewThread = true
      }
    } else {
      // Update thread's updated_at
      await supabase
        .from('ai_threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', currentThreadId)
    }

    // Load conversation history for thread
    const { data: threadHistory } = await supabase
      .from('ai_prompts')
      .select('prompt_text, response, mode')
      .eq('thread_id', currentThreadId)
      .order('created_at', { ascending: true })
      .limit(10) // Last 10 exchanges for context

    // Build conversation messages
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

    for (const entry of (threadHistory || [])) {
      messages.push({ role: 'user', content: entry.prompt_text })
      if (entry.response?.raw_response) {
        messages.push({ role: 'assistant', content: entry.response.raw_response })
      } else if (entry.response?.message) {
        messages.push({ role: 'assistant', content: entry.response.message })
      }
    }

    messages.push({ role: 'user', content: prompt })

    // Generate AI response
    const systemPrompt = buildSystemPrompt(context, mode)
    const aiResponseText = await callClaude(systemPrompt, messages)
    const parsed = parseResponse(aiResponseText, mode)

    // Save prompt and response to database
    await supabase.from('ai_prompts').insert({
      organization_id: organizationId,
      user_id: user.id,
      session_id,
      thread_id: currentThreadId,
      mode,
      prompt_text: prompt,
      context,
      response: {
        ...(mode === 'chat' ? { message: parsed.message } : {}),
        ideas: parsed.ideas,
        follow_up_questions: parsed.follow_up_questions,
        raw_response: aiResponseText
      },
      ideas_generated: parsed.ideas.length
    })

    // Build response based on mode
    let response: PromptResponse

    if (mode === 'chat') {
      response = {
        mode: 'chat',
        message: parsed.message || '',
        ideas: parsed.ideas.length > 0 ? parsed.ideas : undefined,
        thread_id: currentThreadId || '',
        session_id
      }
    } else {
      response = {
        mode: 'review',
        ideas: parsed.ideas,
        follow_up_questions: parsed.follow_up_questions || [],
        thread_id: currentThreadId || '',
        session_id
      }
    }

    return new Response(
      JSON.stringify({
        ...response,
        model: MODEL_DISPLAY_NAME,
        model_id: MODEL_ID
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Royal AI Prompt error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        ideas: [],
        follow_up_questions: ['What would you like to know about your business?']
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
