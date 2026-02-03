// Supabase Edge Function: AI Support Agent
// Provides 24/7 AI-powered customer support using FAQ/KB content
// SECURE: API key stored in Supabase secrets, not exposed to frontend

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// CORS headers for frontend access
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Rate limits for AI support (per member per hour)
const AI_SUPPORT_LIMIT = 50

interface ChatRequest {
  app_id: string
  member_id: string
  session_id?: string // Optional, will create new session if not provided
  message: string
}

interface SupportSettings {
  ai_support_enabled: boolean
  ai_autonomy_mode: 'auto_pilot' | 'manual_approve'
  ai_greeting_message: string
  ai_personality: string
  escalation_triggers: {
    keywords: string[]
    low_confidence_threshold: number
    max_ai_turns_before_offer_human: number
    negative_sentiment_escalate: boolean
  }
  business_hours: Record<string, { open: string; close: string } | null>
  after_hours_message: string
  human_unavailable_message: string
}

interface AppContext {
  app: {
    id: string
    name: string
    slug: string
    organization_id: string
    settings: Record<string, unknown>
  }
  organization: {
    name: string
    settings: Record<string, unknown>
  }
  member: {
    id: string
    first_name: string
    last_name: string
    email: string
    points_balance: number
    tier: string
    visit_count: number
  }
  faqs: Array<{
    question: string
    answer: string
    category: string
  }>
  kbArticles: Array<{
    title: string
    excerpt: string
    content: string
    category: string
  }>
  rewards: Array<{
    name: string
    points_cost: number
    description: string
  }>
  recentTransactions: Array<{
    type: string
    points_change: number
    description: string
    created_at: string
  }>
}

// Check if within business hours
function isWithinBusinessHours(settings: SupportSettings): boolean {
  if (!settings.business_hours) return true

  // Handle new format with enabled flag
  const bh = settings.business_hours as Record<string, unknown>
  if (bh.enabled === false) return true // 24/7 mode

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const now = new Date()
  const dayName = dayNames[now.getDay()]
  const time = now.toTimeString().slice(0, 5) // HH:MM format

  // Support both formats: direct days or nested under 'hours'
  const hours = (bh.hours as Record<string, unknown>) || bh
  const todayHours = hours[dayName] as { open?: string; close?: string; start?: string; end?: string } | null

  // If null or no hours for today, business is closed
  if (!todayHours) return false

  // Support both open/close and start/end naming
  const openTime = todayHours.open || todayHours.start
  const closeTime = todayHours.close || todayHours.end

  if (!openTime || !closeTime) return false

  return time >= openTime && time <= closeTime
}

// Check for escalation keywords
function containsEscalationKeyword(message: string, keywords: string[]): boolean {
  const lowerMessage = message.toLowerCase()
  return keywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()))
}

// Call Claude API
async function callClaude(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number = 1000
): Promise<{ content: string; confidence: number }> {
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
      system: systemPrompt,
      messages: messages,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  const content = data.content[0].text

  // Extract confidence if present (look for JSON at end of response)
  let confidence = 0.8 // Default confidence
  const confidenceMatch = content.match(/\{"confidence":\s*([\d.]+)\}$/m)
  if (confidenceMatch) {
    confidence = parseFloat(confidenceMatch[1])
  }

  // Remove confidence JSON from response if present
  const cleanContent = content.replace(/\n?\{"confidence":\s*[\d.]+\}$/m, '').trim()

  return { content: cleanContent, confidence }
}

// Build system prompt with context
function buildSystemPrompt(context: AppContext, settings: SupportSettings): string {
  const { app, organization, member, faqs, kbArticles, rewards, recentTransactions } = context

  // Format FAQs
  const faqsText = faqs.length > 0
    ? faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')
    : 'No FAQs available.'

  // Format KB articles (summaries only to save tokens)
  const kbText = kbArticles.length > 0
    ? kbArticles.map(a => `- "${a.title}": ${a.excerpt || a.content.substring(0, 200)}`).join('\n')
    : 'No knowledge base articles available.'

  // Format rewards
  const rewardsText = rewards.length > 0
    ? rewards.map(r => `- ${r.name}: ${r.points_cost} points${r.description ? ` (${r.description})` : ''}`).join('\n')
    : 'No rewards currently available.'

  // Format recent activity
  const activityText = recentTransactions.length > 0
    ? recentTransactions.slice(0, 5).map(t => `- ${t.type}: ${t.points_change > 0 ? '+' : ''}${t.points_change} points - ${t.description}`).join('\n')
    : 'No recent activity.'

  return `You are a friendly support team member for ${organization.name}, helping ${member.first_name} with our "${app.name}" loyalty program.

## Your Style
- Speak naturally, as if you're part of the ${organization.name} team
- Use "we", "our", and "us" when referring to the business
- NEVER mention being an AI, assistant, bot, or automated system
- Be warm, helpful, and genuinely interested in helping
- Use ${member.first_name}'s name naturally (not every message)
- Keep responses concise but complete

## ${member.first_name}'s Account
- Points: ${member.points_balance}
- Tier: ${member.tier}
- Visits: ${member.visit_count || 0}

## Recent Activity
${activityText}

## Our Rewards
${rewardsText}

## Common Questions
${faqsText}

## Help Articles
${kbText}

## What You Can Help With
- Points balance, earning, and history
- Rewards - what's available and how to redeem
- Account questions and tier status
- General questions about our loyalty program

## What Needs Our Team
For these topics, acknowledge the request warmly and let ${member.first_name} know you're connecting them with the team:
- Lost items or property
- Refunds, returns, or billing issues
- Complaints or negative experiences
- Anything requiring physical action at our location
- Account issues you can't resolve

When escalating, say something like: "Let me connect you with our team so we can help with this properly. You can follow up in your Messages."

## Response Guidelines
- Keep responses under 150 words unless detail is needed
- Don't use formal sign-offs
- Sound like a real person, not a script
- Be encouraging about their loyalty progress
- At the end of your response, add a confidence score on a new line: {"confidence": 0.85}
  - 0.9+ = Directly answered from our info
  - 0.7-0.9 = Confident answer from context
  - 0.5-0.7 = Uncertain, may need team follow-up
  - Below 0.5 = Should connect with team`
}

// Main handler
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    const { app_id, member_id, session_id, message } = await req.json() as ChatRequest

    if (!app_id || !member_id || !message) {
      throw new Error('Missing required fields: app_id, member_id, message')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ===== LOAD SUPPORT SETTINGS =====
    const { data: settings, error: settingsError } = await supabase
      .from('support_settings')
      .select('*')
      .eq('app_id', app_id)
      .single()

    if (settingsError || !settings) {
      // Return a generic response if no settings (AI not configured)
      return new Response(
        JSON.stringify({
          success: true,
          response: "I'm sorry, but AI support hasn't been configured for this app yet. Please contact the business directly for assistance.",
          escalate: true,
          reason: 'ai_not_configured'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supportSettings = settings as SupportSettings

    // Check if AI is enabled - if disabled, we'll still try to help from FAQ/KB
    const aiEnabled = supportSettings.ai_support_enabled !== false

    // ===== RATE LIMITING =====
    const { data: rateCheck } = await supabase.rpc('check_and_record_rate_limit', {
      p_identifier: member_id,
      p_action_type: 'ai_support_chat',
      p_max_requests: AI_SUPPORT_LIMIT,
      p_window_minutes: 60
    })

    if (rateCheck === false) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Too many messages. Please wait a few minutes.',
          rate_limited: true
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ===== LOAD CONTEXT (Batched for performance) =====
    // First batch: Load app (needed for org_id)
    const { data: app } = await supabase
      .from('customer_apps')
      .select('id, name, slug, organization_id, settings')
      .eq('id', app_id)
      .single()

    if (!app) {
      throw new Error('App not found')
    }

    // Second batch: Load all independent data in parallel for performance
    const [
      { data: org },
      { data: member },
      { data: faqs },
      { data: kbArticles },
      { data: rewards },
      { data: transactions }
    ] = await Promise.all([
      // Organization
      supabase
        .from('organizations')
        .select('name, settings')
        .eq('id', app.organization_id)
        .single(),
      // Member info
      supabase
        .from('app_members')
        .select('id, first_name, last_name, email, points_balance, tier, visit_count')
        .eq('id', member_id)
        .single(),
      // FAQs (limited for context window)
      supabase
        .from('faq_items')
        .select('question, answer, category')
        .eq('app_id', app_id)
        .eq('is_active', true)
        .order('display_order')
        .limit(10),
      // KB articles (limited for context window)
      supabase
        .from('knowledgebase_articles')
        .select('title, excerpt, content, category')
        .eq('app_id', app_id)
        .eq('is_published', true)
        .order('is_featured', { ascending: false })
        .order('display_order')
        .limit(5),
      // Rewards (limited to prevent context overflow)
      supabase
        .from('app_rewards')
        .select('name, points_cost, description')
        .eq('app_id', app_id)
        .eq('is_active', true)
        .order('points_cost')
        .limit(15),
      // Recent transactions
      supabase
        .from('points_transactions')
        .select('type, points_change, description, created_at')
        .eq('member_id', member_id)
        .order('created_at', { ascending: false })
        .limit(5)
    ])

    if (!member) {
      throw new Error('Member not found')
    }

    const context: AppContext = {
      app,
      organization: org || { name: 'the business', settings: {} },
      member,
      faqs: faqs || [],
      kbArticles: kbArticles || [],
      rewards: rewards || [],
      recentTransactions: transactions || []
    }

    // ===== CHECK FOR ESCALATION TRIGGERS =====
    let shouldEscalate = false
    let escalateReason = ''

    // Check escalation keywords
    const escalationKeywords = supportSettings.escalation_triggers?.keywords || []
    if (containsEscalationKeyword(message, escalationKeywords)) {
      shouldEscalate = true
      escalateReason = 'escalation_keyword'
    }

    // Check business hours (for human support availability message)
    const withinHours = isWithinBusinessHours(supportSettings)

    // ===== GET OR CREATE SESSION =====
    let currentSessionId = session_id
    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []

    if (currentSessionId) {
      // Load existing session
      const { data: existingSession } = await supabase
        .from('ai_support_sessions')
        .select('id, message_count')
        .eq('id', currentSessionId)
        .single()

      if (existingSession) {
        // Check max turns (message_count / 2 since it counts both user and AI messages)
        const maxTurns = supportSettings.escalation_triggers?.max_ai_turns_before_offer_human || 5
        if ((existingSession.message_count || 0) / 2 >= maxTurns) {
          shouldEscalate = true
          escalateReason = 'max_turns_reached'
        }

        // Load conversation history (limited to last 15 messages to prevent context overflow)
        const { data: messages } = await supabase
          .from('ai_support_messages')
          .select('role, content')
          .eq('session_id', currentSessionId)
          .order('created_at', { ascending: false })
          .limit(15)

        if (messages) {
          // Reverse to get chronological order (oldest first)
          conversationHistory = messages.reverse().map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content
          }))
        }
      } else {
        currentSessionId = undefined // Session not found, create new
      }
    }

    if (!currentSessionId) {
      // Create new session
      const { data: newSession, error: sessionError } = await supabase
        .from('ai_support_sessions')
        .insert({
          app_id,
          member_id,
          organization_id: app.organization_id,
          status: 'active'
        })
        .select('id')
        .single()

      if (sessionError) throw sessionError
      currentSessionId = newSession.id
    }

    // Add user message to history
    conversationHistory.push({ role: 'user', content: message })

    // ===== GENERATE AI RESPONSE =====
    // Always try to answer from FAQ/KB first, even if after hours or AI disabled
    let aiResponse: string
    let confidence = 0.8

    // Only call AI if it's enabled
    if (aiEnabled) {
      // Generate AI response (references FAQ/KB content)
      const systemPrompt = buildSystemPrompt(context, supportSettings)
      const result = await callClaude(systemPrompt, conversationHistory)
      aiResponse = result.content
      confidence = result.confidence

      // ===== PROACTIVE ESCALATION: Detect when AI can't help =====
      // Check if the AI response indicates it cannot resolve the issue
      const cannotHelpPatterns = [
        /I can'?t help/i,
        /unfortunately.*not able/i,
        /you'?ll need to (contact|speak|visit|come)/i,
        /outside.*what I can/i,
        /lost (item|property|your)/i,
        /let me connect you with/i,
        /our team (can|will|should)/i,
        /refund|return|exchange/i,
        /complaint|complain/i,
        /speak.*in person/i,
        /visit (our|the) (location|store|shop)/i
      ]

      const cannotHelp = cannotHelpPatterns.some(p => p.test(aiResponse))
      if (cannotHelp && !shouldEscalate) {
        shouldEscalate = true
        escalateReason = 'beyond_ai_scope'
        // AI already mentioned connecting with team, just ensure ticket is created
      }

      // Also check user message for topics that need human help
      const userNeedsHumanPatterns = [
        /lost (my|a|the)/i,
        /left (my|a|the)/i,
        /forgot (my|a|the)/i,
        /refund/i,
        /complaint/i,
        /problem with.*order/i,
        /billing (issue|problem|error)/i
      ]

      const userNeedsHuman = userNeedsHumanPatterns.some(p => p.test(message))
      if (userNeedsHuman && !shouldEscalate) {
        shouldEscalate = true
        escalateReason = 'requires_human_action'
      }

      // Add appropriate message based on escalation reason
      if (shouldEscalate) {
        if (escalateReason === 'escalation_keyword') {
          aiResponse += `\n\nI've sent this to our team. You can follow up anytime in your Messages.`
        } else if (escalateReason === 'beyond_ai_scope' || escalateReason === 'requires_human_action') {
          // AI response already explains the situation, just add the follow-up note
          aiResponse += `\n\nI've sent this to our team so they can help you directly. You can track this and follow up in your Messages.`
        }
      }

      // Check confidence for escalation
      const lowConfidenceThreshold = supportSettings.escalation_triggers?.low_confidence_threshold || 0.5
      if (confidence < lowConfidenceThreshold && !shouldEscalate) {
        shouldEscalate = true
        escalateReason = 'low_confidence'
        aiResponse += `\n\nI want to make sure you get the right answer - I've flagged this for our team to follow up. Check your Messages for updates.`
      }

      // Add after-hours notice if outside business hours (but we still helped!)
      if (!withinHours && !shouldEscalate) {
        const afterHoursNote = supportSettings.after_hours_message || "Our team is currently offline but will be back during business hours."
        aiResponse += `\n\n📌 ${afterHoursNote}`
      }
    } else {
      // AI disabled - provide a helpful message that still references FAQ/KB exists
      const hasFaqs = context.faqs.length > 0
      const hasKb = context.kbArticles.length > 0

      if (hasFaqs || hasKb) {
        aiResponse = `Thanks for reaching out! While our AI assistant is currently unavailable, you can browse our ${hasFaqs ? 'FAQs' : ''}${hasFaqs && hasKb ? ' and ' : ''}${hasKb ? 'help articles' : ''} for answers to common questions.`
      } else {
        aiResponse = `Thanks for reaching out! AI support is currently unavailable.`
      }

      aiResponse += withinHours
        ? ` Our team will get back to you shortly.`
        : ` ${supportSettings.after_hours_message || "Our team is currently offline but will respond during business hours."}`

      shouldEscalate = true
      escalateReason = 'ai_disabled'
    }

    // ===== SAVE MESSAGES =====
    // Save user message
    await supabase.from('ai_support_messages').insert({
      session_id: currentSessionId,
      role: 'user',
      content: message
    })

    // Save AI response
    await supabase.from('ai_support_messages').insert({
      session_id: currentSessionId,
      role: 'assistant',
      content: aiResponse,
      metadata: { confidence, escalate_reason: escalateReason || null }
    })

    // Update session
    const { data: sessionUpdate } = await supabase
      .from('ai_support_sessions')
      .update({
        turn_count: conversationHistory.length,
        last_message_at: new Date().toISOString(),
        status: shouldEscalate ? 'escalated' : 'active',
        escalated_at: shouldEscalate ? new Date().toISOString() : null
      })
      .eq('id', currentSessionId)
      .select('turn_count')
      .single()

    // If escalated, create support ticket and notify business owner
    if (shouldEscalate && escalateReason) {
      // Create the support ticket
      const { data: ticket } = await supabase.from('support_tickets').insert({
        app_id,
        organization_id: app.organization_id,
        member_id,
        ticket_type: 'question',
        subject: `AI Escalation: ${escalateReason.replace(/_/g, ' ')}`,
        description: `Customer message: "${message}"\n\nEscalation reason: ${escalateReason}\nAI confidence: ${confidence}`,
        priority: 'high',
        status: 'escalated',
        requires_human: true,
        escalation_reason: escalateReason,
        source: 'ai_support',
        metadata: { ai_session_id: currentSessionId }
      }).select('id').single()

      // Send notifications to business owner (in-dashboard + webhook + email queue)
      if (ticket) {
        await supabase.rpc('handle_support_escalation', {
          p_app_id: app_id,
          p_organization_id: app.organization_id,
          p_ticket_id: ticket.id,
          p_session_id: currentSessionId,
          p_member_id: member_id,
          p_escalation_reason: escalateReason,
          p_customer_message: message,
          p_confidence: confidence
        })

        // Also queue email notification
        await supabase.rpc('queue_escalation_email', {
          p_app_id: app_id,
          p_member_id: member_id,
          p_ticket_id: ticket.id,
          p_escalation_reason: escalateReason,
          p_customer_message: message
        })
      }
    }

    // ===== RETURN RESPONSE =====
    return new Response(
      JSON.stringify({
        success: true,
        response: aiResponse,
        session_id: currentSessionId,
        turn_count: sessionUpdate?.turn_count || conversationHistory.length,
        escalate: shouldEscalate,
        escalate_reason: escalateReason || null,
        confidence,
        within_business_hours: withinHours
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('AI Support error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        response: "I'm having trouble right now. Please try again or contact the business directly."
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
