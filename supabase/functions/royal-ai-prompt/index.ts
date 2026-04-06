// Supabase Edge Function: Royal AI Prompt
// Conversational AI for business owners with mode-aware responses
// Features: session memory, chat threads, review mode (cards) vs chat mode (conversational)
// Phase 1: Business knowledge learning, discovery questions, and knowledge injection
// Phase 2: Proactive discovery with context-aware question selection
// Phase 3: Claude tool use for internal data queries and external research

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkRateLimit, rateLimitHeaders } from '../_shared/rate-limit.ts'

// Module imports
import type { ToolContext, PromptRequest, PromptResponse, DiscoveryQuestion, ContentBlock, TextBlock, ToolUseBlock, ClaudeToolResponse } from './types.ts'
import { TOOL_USE_CONFIG, log } from './types.ts'
import { ROYAL_AI_TOOLS, TOOL_HANDLERS, executeToolWithTimeout } from './tools.ts'
import {
  loadBusinessKnowledge, loadBusinessProfile,
  getNextDiscoveryQuestionV2,
  getSessionDiscoveryState, getPendingQuestionById,
  handleQuestionOutcome, detectDeferral, detectDiscoveryAnswer,
  detectConversationContext, markQuestionAsked,
  extractKnowledgeFromText, saveExtractedKnowledge,
  buildKnowledgeContextSection, buildDiscoveryPromptAddition,
  buildSystemPrompt, truncateSystemPrompt, parseResponse,
  generateThreadTitle
} from './knowledge.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Model configuration - tiered for cost optimization
const MODEL_SONNET = 'claude-sonnet-4-20250514'
const MODEL_HAIKU = 'claude-haiku-4-5-20251001'
const MODEL_ID = MODEL_SONNET // Default for backward compatibility
const MODEL_DISPLAY_NAME = 'Sonnet 4'

// Simple query patterns that can be handled by Haiku (10x cheaper)
const SIMPLE_QUERY_PATTERNS = [
  /^(how many|what is|show me|list|count|total)\b/i,
  /^(what('s| is) my|check my|view my)\b/i,
  /^(hello|hi|hey|thanks|thank you|ok|okay|got it|sure)\b/i,
  /^(yes|no|yep|nope|correct|right)\b/i,
]

function selectModel(prompt: string, mode: string): string {
  // Review mode always uses Sonnet (generates intelligence cards with tool use)
  if (mode === 'review') return MODEL_SONNET
  // Long prompts likely need deeper reasoning
  if (prompt.length > 300) return MODEL_SONNET
  // Short simple queries route to Haiku
  if (SIMPLE_QUERY_PATTERNS.some(p => p.test(prompt.trim()))) return MODEL_HAIKU
  // Default to Sonnet for everything else
  return MODEL_SONNET
}

// Allowed origins for CORS - production only (localhost handled by regex below)
const ALLOWED_ORIGINS = [
  'https://royaltyapp.ai',
  'https://www.royaltyapp.ai',
]

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || ''

  // Allow any localhost/127.0.0.1 port for development
  const isLocalDev = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

  // Security: Only allow exact production matches or local dev origins
  if (!origin || (!ALLOWED_ORIGINS.includes(origin) && !isLocalDev)) {
    return {
      'Access-Control-Allow-Origin': '',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

// ============================================================================
// API TIMEOUT WRAPPER
// ============================================================================

/**
 * Fetch with timeout to prevent indefinite hangs on API calls
 * Uses AbortController to cancel requests that exceed the timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = 30000
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    return response
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

// API timeout configuration
const API_TIMEOUT_MS = 30000  // 30 seconds for Anthropic API calls

// ============================================================================
// CLAUDE API ORCHESTRATION
// ============================================================================

/**
 * Call Claude API with tool use support
 * Implements the tool use loop: call Claude -> execute tools -> call Claude again
 */
async function callClaudeWithTools(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }>,
  ctx: ToolContext,
  maxTokens: number = TOOL_USE_CONFIG.maxTokens,
  modelId: string = MODEL_SONNET
): Promise<{ text: string; toolsUsed: string[]; tokensUsed: number; modelUsed: string }> {

  let currentMessages = [...messages]
  let totalTokensUsed = 0
  const toolsUsed: string[] = []
  let iterations = 0

  while (iterations < TOOL_USE_CONFIG.maxIterations) {
    iterations++

    // Add cache_control to the last tool for prompt caching
    const toolsWithCache = ROYAL_AI_TOOLS.map((tool, i) =>
      i === ROYAL_AI_TOOLS.length - 1
        ? { ...tool, cache_control: { type: 'ephemeral' } }
        : tool
    )

    const response = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: maxTokens,
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' }
            }
          ],
          messages: currentMessages,
          tools: toolsWithCache,
        }),
      },
      API_TIMEOUT_MS
    )

    if (!response.ok) {
      const error = await response.text()
      log('error', 'Claude API error in tool loop', { status: response.status, error, iteration: iterations, model: modelId, systemPromptLength: systemPrompt.length })
      // Classify oversized request errors so they get a helpful user message
      if (response.status === 413 || (response.status === 400 && (error.includes('too many tokens') || error.includes('maximum context length') || error.includes('prompt is too long')))) {
        throw new Error('REQUEST_TOO_LARGE')
      }
      throw new Error(`Claude API error: ${response.status} - ${error}`)
    }

    const data: ClaudeToolResponse = await response.json()
    totalTokensUsed += data.usage.input_tokens + data.usage.output_tokens
    log('info', 'Claude API response received', { iteration: iterations, tokensUsed: data.usage.input_tokens + data.usage.output_tokens, model: modelId })

    // Token budget check - prevent runaway cost on complex tool loops
    if (totalTokensUsed > TOOL_USE_CONFIG.tokenBudget) {
      log('warn', 'Token budget exceeded, returning partial response', { totalTokensUsed, budget: TOOL_USE_CONFIG.tokenBudget })
      const textBlocks = data.content.filter(
        (block): block is TextBlock => block.type === 'text'
      )
      return {
        text: textBlocks.map(b => b.text).join('\n') || 'I used up my processing budget for this query. Please try a simpler question or break it into smaller parts.',
        toolsUsed: [...new Set(toolsUsed)],
        tokensUsed: totalTokensUsed,
        modelUsed: modelId
      }
    }

    // Check if Claude wants to use tools
    if (data.stop_reason === 'tool_use') {
      const toolUseBlocks = data.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      )

      if (toolUseBlocks.length === 0) {
        console.warn('stop_reason is tool_use but no tool blocks found')
        break
      }

      // Add assistant message with tool use to conversation
      currentMessages.push({
        role: 'assistant',
        content: data.content
      })

      // Execute all tools and collect results
      const toolResults: Array<{
        type: 'tool_result'
        tool_use_id: string
        content: string
        is_error?: boolean
      }> = []

      for (const toolUse of toolUseBlocks) {
        toolsUsed.push(toolUse.name)

        try {
          const result = await executeToolWithTimeout(
            toolUse.name,
            toolUse.input,
            ctx,
            TOOL_USE_CONFIG.toolTimeout
          )

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result.success ? result.data : { error: result.error }),
            is_error: !result.success
          })

        } catch (e) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: (e as Error).message || 'Tool execution failed' }),
            is_error: true
          })
        }
      }

      // Add tool results to conversation
      currentMessages.push({
        role: 'user',
        content: toolResults
      })

      continue
    }

    // Claude finished - extract final text response
    const textBlocks = data.content.filter(
      (block): block is TextBlock => block.type === 'text'
    )

    let finalText = textBlocks.map(block => block.text).join('\n')

    // If Claude ended turn with no text after tool use, force a text summary
    if (!finalText && toolsUsed.length > 0) {
      log('info', 'No text in final response after tool use — making force-text call', { toolsUsed })
      const forceResponse = await fetchWithTimeout(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelId,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [
              ...currentMessages,
              { role: 'assistant', content: data.content },
              { role: 'user', content: 'Please summarize what you found.' }
            ],
            // No tools param — forces text-only response
          }),
        },
        API_TIMEOUT_MS
      )
      if (forceResponse.ok) {
        const forceData = await forceResponse.json()
        const forceBlocks = forceData.content.filter(
          (block: ContentBlock): block is TextBlock => block.type === 'text'
        )
        finalText = forceBlocks.map((b: TextBlock) => b.text).join('\n')
        totalTokensUsed += forceData.usage.input_tokens + forceData.usage.output_tokens
      }
    }

    return {
      text: finalText,
      toolsUsed: [...new Set(toolsUsed)],
      tokensUsed: totalTokensUsed,
      modelUsed: modelId
    }
  }

  console.warn(`Tool use loop exceeded ${TOOL_USE_CONFIG.maxIterations} iterations`)
  throw new Error('AI response took too long. Please try a simpler question.')
}

// Call Claude API with conversation history (with prompt caching)
async function callClaude(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number = 2000,
  modelId: string = MODEL_SONNET
): Promise<string> {
  const response = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: maxTokens,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages,
      }),
    },
    API_TIMEOUT_MS
  )

  if (!response.ok) {
    const error = await response.text()
    log('error', 'Claude API error', { status: response.status, error })
    throw new Error(`Claude API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return data.content[0].text
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Top-level request timeout: 120 seconds safety net
    const HANDLER_TIMEOUT_MS = 120_000
    const result = await Promise.race([
      (async () => {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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

    const rawBody = await req.json() as Record<string, unknown>
    const bodyMode = (rawBody.mode as string) || 'review'

    // ── CEO mode: early branch, separate tool context ──────────────────
    if (bodyMode === 'ceo') {
      const messages = rawBody.messages as Array<{ role: string; content: string }> | undefined
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'CEO mode requires messages array' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Security: admin-only (is_admin flag)
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

      if (!profile?.is_admin) {
        return new Response(
          JSON.stringify({ success: false, error: 'CEO dashboard is admin-only' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const ROYAL_CONSTITUTION = `Royal's core values (non-negotiable, always active):
- SMBs deserve enterprise-grade AI without enterprise-grade complexity. Simplicity is a feature.
- Every action must be traceable and reversible. Transparency builds trust.
- Jay's time is the scarcest resource. Protect it — be direct, use data, skip fluff.
- Revenue follows value. Build things that make customers' businesses measurably better.
- Royal grows by learning, not by guessing. Measure outcomes, update beliefs, improve.`

      const ROYALTY_COMPANY_STATE = `Royalty current product state (as of March 2026):

LIVE — do NOT suggest building these:
- Blog: live at royaltyapp.ai/blog, powered by newsletter_articles table + content-generator.html
- Loyalty platform: customer apps, points/tiers, rewards, redemption, QR check-ins — all live
- AI Intelligence: autonomous Royal AI running growth actions (royal-ai-autonomous edge function)
- Automations: email/SMS campaigns (Resend + Twilio), win-back, birthday, streaks — all live
- Stripe billing: configured, subscriptions + webhooks working
- Content pipeline: articles being generated via content-generator, published to blog

IN PROGRESS / NOT YET LIVE:
- QR scanner for check-ins (planned)
- Push notifications (planned)
- LinkedIn / X / Medium / Quora / Blogger content distribution (planned, not active)

KEY FACTS:
- newsletter_articles table = Royalty's OWN blog content, not a customer feature to be built
- /app/apps.html = loyalty program app builder for customers, NOT newsletter infrastructure
- Royal's job is to grow Royalty's business, not build Royalty's platform (Jay does that)

INTEGRATIONS — already configured in Supabase secrets. NEVER use request_help with blocker_type='api_key' for these:
- Email: Resend (RESEND_API_KEY set) — use queue_outreach with channel='email' to draft outreach
- SMS: Twilio (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN set) — use queue_outreach with channel='sms'
- Stripe: configured, subscriptions + webhooks working
If you need to send email or SMS: USE THE TOOL. Do not ask Jay for credentials — they are already set up.

OUTREACH RULE: When contacting a Royalty customer, ALWAYS pass target_org_id — the tool looks up their real email (for email channel) or phone (for SMS channel) automatically from the database. NEVER guess, invent, or fabricate email addresses or phone numbers. Only use target_email/target_phone for external contacts who are NOT Royalty customers in the DB.`

      const ceoSystemPrompt = `${ROYAL_CONSTITUTION}

${ROYALTY_COMPANY_STATE}

You are Royal — the AI CEO, COO, and CTO of Royalty (royaltyapp.ai), an AI-powered loyalty platform for small businesses.

You are speaking with Jay, your founding partner and investor. Jay is reviewing the company's progress.

Your role: Run the business. Report outcomes, not decisions. You have tools to read Royalty's own revenue, trial users, and content pipeline.

Guidelines:
- Be direct and specific. Use real numbers when you have them.
- Call tools proactively to answer questions with live data.
- After taking any autonomous action, log it with log_growth_action.
- Surface blockers honestly. Surface opportunities concisely.
- You are the CEO reporting to a board member — not asking for permission.
- If revenue data shows $0 MRR or no active subscriptions, report that plainly: "We have 0 paid subscriptions and $0 MRR right now." Do NOT say there is a technical problem unless the tool returns success: false with an explicit error.
- IMPORTANT: After using any tool, you MUST write a text response summarizing what you found. Never end a turn without writing text.

Current autonomy status: ${rawBody.context && typeof rawBody.context === 'object' ? (rawBody.context as Record<string, unknown>).growth_status || 'unknown' : 'unknown'}`

      // Get org ID for tools that need it (most CEO tools don't filter by org)
      const { data: ceoMembership } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .single()

      const ceoCtx: ToolContext = {
        supabase,
        organizationId: ceoMembership?.organization_id ?? '',
        appId: undefined,
      }

      const formatted = messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: String(m.content || '').slice(0, 5000),
      }))

      // Brief mode: single-turn Haiku, no tools (metrics already in the prompt)
      if (rawBody.brief_mode === true) {
        const briefRes = await fetchWithTimeout(
          'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: MODEL_HAIKU,
              max_tokens: 400,
              system: 'You are Royal, CEO of Royalty (royaltyapp.ai). Be direct. Use only the data provided in the message — do not call tools.',
              messages: formatted,
            }),
          },
          30_000
        )
        const briefText = briefRes.ok
          ? ((await briefRes.json()).content?.[0]?.text ?? 'Brief unavailable — ask Royal directly.')
          : 'Brief unavailable — ask Royal directly.'
        return new Response(
          JSON.stringify({ success: true, content: briefText, mode: 'ceo', tools_used: [] }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      let result: { text: string; toolsUsed: string[]; tokensUsed: number; modelUsed: string }
      try {
        result = await callClaudeWithTools(ceoSystemPrompt, formatted, ceoCtx, 4000, MODEL_SONNET)
      } catch (ceoErr) {
        const msg = ceoErr instanceof Error ? ceoErr.message : String(ceoErr)
        return new Response(
          JSON.stringify({ success: true, content: `I ran into an issue: ${msg}. Try asking again.`, mode: 'ceo', tools_used: [] }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // If tools were used but no text was generated, ask Claude to summarize
      let responseText = result.text
      if (!responseText && result.toolsUsed.length > 0) {
        // One more request: force a text summary of the tool results
        try {
          const summaryMessages = [
            ...formatted,
            { role: 'assistant' as const, content: `[Used tools: ${result.toolsUsed.join(', ')}]` },
            { role: 'user' as const, content: 'Now summarize what you found. Give me the full analysis.' },
          ]
          const summary = await callClaudeWithTools(ceoSystemPrompt, summaryMessages, ceoCtx, 2000, MODEL_SONNET)
          responseText = summary.text || 'I gathered the data but had trouble summarizing it. Try asking again.'
        } catch (_) {
          responseText = 'I gathered the data but had trouble summarizing it. Try asking again.'
        }
      } else if (!responseText) {
        responseText = 'No response generated. Please try again.'
      }

      return new Response(
        JSON.stringify({ success: true, content: responseText, mode: 'ceo', tools_used: result.toolsUsed }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    // ── End CEO mode ───────────────────────────────────────────────────

    const { prompt, session_id, thread_id, mode = 'review', context } = rawBody as unknown as PromptRequest

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

    // Track activity for churn scoring (fire-and-forget, no await needed)
    supabase.from('organizations').update({ last_active_at: new Date().toISOString() }).eq('id', organizationId).then(() => {})

    // Check per-hour rate limit (60 requests/hour/org via shared module)
    const rateCheck = await checkRateLimit(supabase, organizationId, 'ai_prompt')
    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Too many requests. Please wait a moment.',
          rate_limited: true,
          retry_after: rateCheck.retry_after_seconds
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            ...rateLimitHeaders(rateCheck)
          }
        }
      )
    }

    // Check AI budget cap (system default: $50/org/month)
    const { data: budgetCheck } = await supabase.rpc('check_ai_budget', {
      p_org_id: organizationId,
      p_default_cap_cents: 5000
    })
    if (budgetCheck && !budgetCheck.within_budget) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Monthly AI budget reached. Please contact support or upgrade your plan.',
          budget_exceeded: true,
          usage_percent: budgetCheck.usage_percent
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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
      .limit(5) // Last 5 exchanges for context (reduced for token efficiency)

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

    // =========================================================================
    // PHASE 2: INTELLIGENT DISCOVERY WITH CONTEXT AWARENESS
    // Load knowledge, detect answers/skips, and select contextual questions
    // =========================================================================

    // Load business knowledge, profile, and session state in parallel
    const [knowledge, profile, sessionState] = await Promise.all([
      loadBusinessKnowledge(supabase, organizationId),
      loadBusinessProfile(supabase, organizationId),
      getSessionDiscoveryState(supabase, session_id, organizationId)
    ])

    // Track discovery outcomes for logging
    let discoveryOutcome: 'answered' | 'skipped' | 'deferred' | null = null
    let lastAnsweredQuestionId: string | null = null

    // Check if there's a pending question from previous messages
    if (sessionState.pendingQuestionId) {
      const pendingQuestion = await getPendingQuestionById(supabase, sessionState.pendingQuestionId)

      if (pendingQuestion) {
        // Check for explicit deferral/skip first
        const deferralResult = detectDeferral(prompt)

        if (deferralResult === 'defer') {
          discoveryOutcome = 'deferred'
          await handleQuestionOutcome(
            supabase, organizationId,
            sessionState.pendingQuestionId,
            'deferred',
            currentThreadId || null,
            null
          )
        } else if (deferralResult === 'skip') {
          discoveryOutcome = 'skipped'
          await handleQuestionOutcome(
            supabase, organizationId,
            sessionState.pendingQuestionId,
            'skipped',
            currentThreadId || null,
            null
          )
        } else {
          // Check if user's message answers the pending question
          const answerResult = detectDiscoveryAnswer(prompt, pendingQuestion)

          if (answerResult.isAnswer && answerResult.confidence >= 0.5) {
            discoveryOutcome = 'answered'
            lastAnsweredQuestionId = sessionState.pendingQuestionId
            await handleQuestionOutcome(
              supabase, organizationId,
              sessionState.pendingQuestionId,
              'answered',
              currentThreadId || null,
              answerResult.answerText
            )
          }
          // If not clearly an answer and not a skip, question remains pending
          // It will be implicitly skipped after 2 ignores (handled by v2 function)
        }
      }
    }

    // Detect conversation context for smart question selection
    const conversationContext = detectConversationContext(prompt, threadHistory || [])

    // Decide whether to ask a new discovery question
    let discoveryQuestion: DiscoveryQuestion | null = null
    const shouldAskQuestion =
      sessionState.questionsAskedThisSession < 2 &&  // Max 2 per session
      discoveryOutcome !== 'answered'  // Don't ask right after they just answered

    if (shouldAskQuestion) {
      // Use context-aware v2 question selection
      discoveryQuestion = await getNextDiscoveryQuestionV2(
        supabase,
        organizationId,
        conversationContext,
        lastAnsweredQuestionId,  // For follow-up chaining
        sessionState.questionsAskedThisSession,
        profile?.business_type || null
      )
    }

    // Build knowledge context for prompt
    const knowledgeContext = buildKnowledgeContextSection(knowledge, profile)
    const discoveryPrompt = buildDiscoveryPromptAddition(discoveryQuestion)

    // Generate AI response with enhanced context
    const rawSystemPrompt = buildSystemPrompt(context, mode, knowledgeContext, discoveryPrompt)
    // Guard against oversized system prompts from accumulated knowledge
    const systemPrompt = truncateSystemPrompt(rawSystemPrompt)

    // Phase 3: Use tool-enabled Claude call
    const toolContext: ToolContext = {
      supabase,
      organizationId,
      appId: undefined // Will be resolved by tool handlers
    }

    // Select model based on query complexity (Haiku for simple, Sonnet for complex)
    const selectedModel = selectModel(prompt, mode)

    // Response cache: check for cached response (chat mode only, not review)
    const normalizedPrompt = prompt.trim().toLowerCase().replace(/\s+/g, ' ')
    const cacheKey = `${organizationId}:${mode}:${normalizedPrompt.substring(0, 200)}`
    let aiResponseText: string
    let toolsUsed: string[] = []
    let tokensUsed = 0
    let modelUsed = selectedModel
    let cacheHit = false

    if (mode === 'chat') {
      const { data: cached } = await supabase
        .from('ai_response_cache')
        .select('response_text, tools_used, model_used, tokens_saved')
        .eq('cache_key', cacheKey)
        .gt('expires_at', new Date().toISOString())
        .single()

      if (cached) {
        aiResponseText = cached.response_text
        toolsUsed = cached.tools_used || []
        tokensUsed = 0
        modelUsed = cached.model_used || selectedModel
        cacheHit = true
        log('info', 'Cache hit', { cacheKey: cacheKey.substring(0, 50), tokensSaved: cached.tokens_saved })
      }
    }

    if (!cacheHit) {
      const result = await callClaudeWithTools(
        systemPrompt,
        messages,
        toolContext,
        TOOL_USE_CONFIG.maxTokens,
        selectedModel
      )
      aiResponseText = result.text
      toolsUsed = result.toolsUsed
      tokensUsed = result.tokensUsed
      modelUsed = result.modelUsed

      // Store in cache (chat mode, async)
      if (mode === 'chat') {
        supabase.from('ai_response_cache').upsert({
          cache_key: cacheKey,
          organization_id: organizationId,
          response_text: aiResponseText,
          tools_used: toolsUsed,
          model_used: modelUsed,
          tokens_saved: tokensUsed,
          expires_at: new Date(Date.now() + 3600000).toISOString()  // 1 hour TTL
        }).then(({ error: cacheErr }) => { if (cacheErr) console.error('Cache store error:', cacheErr) })
      }
    }

    const parsed = parseResponse(aiResponseText, mode)

    // =========================================================================
    // PHASE 1 & 2: KNOWLEDGE EXTRACTION
    // Extract facts from conversation and save to knowledge store
    // =========================================================================

    // Extract knowledge from user message and AI response
    const extractedKnowledge = extractKnowledgeFromText(prompt, aiResponseText)
    if (extractedKnowledge.length > 0) {
      // Save extracted knowledge (async, don't block response)
      saveExtractedKnowledge(supabase, organizationId, currentThreadId || null, extractedKnowledge)
        .catch(e => console.error('Knowledge save error:', e))
    }

    // Mark discovery question as asked if we included one
    if (discoveryQuestion) {
      markQuestionAsked(supabase, organizationId, discoveryQuestion.question_id, currentThreadId || null)
        .catch(e => console.error('Discovery question mark error:', e))
    }

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
        raw_response: aiResponseText,
        knowledge_extracted: extractedKnowledge.length,
        // Phase 2: Enhanced discovery tracking
        discovery_question_asked: discoveryQuestion?.question || null,
        discovery_question_id: discoveryQuestion?.question_id || null,
        discovery_question_domain: discoveryQuestion?.domain || null,
        discovery_outcome: discoveryOutcome,
        conversation_context: conversationContext,
        session_questions_count: sessionState.questionsAskedThisSession + (discoveryQuestion ? 1 : 0),
        // Phase 3: Tool use tracking
        tools_used: toolsUsed,
        tokens_used: tokensUsed,
        model_used: modelUsed
      },
      ideas_generated: parsed.ideas.length
    })

    // Track AI usage for cost monitoring (async, don't block response)
    supabase.rpc('increment_ai_usage', {
      p_org_id: organizationId,
      p_input_tokens: Math.round(tokensUsed * 0.7),  // Approximate input/output split
      p_output_tokens: Math.round(tokensUsed * 0.3),
      p_cache_read_tokens: 0,
      p_model: modelUsed.includes('haiku') ? 'haiku' : 'sonnet',
      p_function_name: 'royal_ai_prompt'
    }).then(({ error: e }) => { if (e) console.error('AI usage tracking error:', e) })

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
      })(),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), HANDLER_TIMEOUT_MS)
      )
    ])
    return result

  } catch (error) {
    console.error('Royal AI Prompt error:', error)
    const isTimeout = error instanceof Error && error.message === 'REQUEST_TIMEOUT'
    const isTooLarge = error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
    return new Response(
      JSON.stringify({
        success: false,
        error: isTooLarge
          ? 'Too much context accumulated. Try starting a new conversation.'
          : isTimeout
            ? 'Request took too long. Please try a simpler question.'
            : `Something went wrong: ${error instanceof Error ? error.message : String(error)}`,
        ideas: [],
        follow_up_questions: ['What would you like to know about your business?']
      }),
      { status: isTooLarge ? 413 : (isTimeout ? 504 : 500), headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
