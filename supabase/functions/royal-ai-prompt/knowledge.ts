// Royal AI Prompt — Knowledge, Discovery & Prompt Building
// Business knowledge management, discovery question system, and system prompt assembly

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type {
  BusinessKnowledge, BusinessProfile, DiscoveryQuestion,
  SessionDiscoveryState, AnswerDetectionResult,
  ExternalContext, PromptRequest, IdeaCard
} from './types.ts'
import { KNOWLEDGE_EXTRACTION_PATTERNS, sanitizeContextInput, sanitizeContextArray } from './types.ts'

// ============================================================================
// KNOWLEDGE MANAGEMENT FUNCTIONS
// ============================================================================

// Load accumulated business knowledge for an organization
export async function loadBusinessKnowledge(
  supabase: SupabaseClient,
  organizationId: string
): Promise<BusinessKnowledge[]> {
  try {
    const { data, error } = await supabase
      .from('business_knowledge')
      .select('id, layer, category, fact, confidence, importance, source_type')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .order('importance', { ascending: false })
      .limit(30)

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

// Load business profile for an organization
export async function loadBusinessProfile(
  supabase: SupabaseClient,
  organizationId: string
): Promise<BusinessProfile | null> {
  try {
    const { data, error } = await supabase
      .from('business_profiles')
      .select('organization_id, business_type, business_subtype, revenue_model, primary_revenue_streams, avg_ticket, gross_margin_pct, food_cost_pct, labor_cost_pct, rent_pct, break_even_daily, price_positioning, primary_competitors, competitive_advantage, unique_selling_points, current_stage, growth_goals, expansion_interest, biggest_challenge, success_vision, location_type, foot_traffic_level, parking_situation, nearby_anchors, peak_hours, slow_periods, staff_count, owner_hours_weekly, ideal_customer_description, primary_age_range, customer_frequency, profile_completeness')
      .eq('organization_id', organizationId)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('Failed to load business profile:', error)
    }
    return data || null
  } catch (e) {
    console.error('Error loading profile:', e)
    return null
  }
}

// Get next discovery question for an organization
export async function getNextDiscoveryQuestion(
  supabase: SupabaseClient,
  organizationId: string
): Promise<DiscoveryQuestion | null> {
  try {
    const { data, error } = await supabase
      .rpc('get_next_discovery_question', { p_org_id: organizationId })

    if (error) {
      console.error('Failed to get discovery question:', error)
      return null
    }
    return data?.[0] || null
  } catch (e) {
    console.error('Error getting discovery question:', e)
    return null
  }
}

// Mark a discovery question as asked
export async function markQuestionAsked(
  supabase: SupabaseClient,
  organizationId: string,
  questionId: string,
  threadId: string | null
): Promise<void> {
  try {
    await supabase
      .from('org_discovery_progress')
      .upsert({
        organization_id: organizationId,
        question_id: questionId,
        status: 'asked',
        asked_at: new Date().toISOString(),
        answer_thread_id: threadId
      }, { onConflict: 'organization_id,question_id' })
  } catch (e) {
    console.error('Error marking question asked:', e)
  }
}

// Extract knowledge from a conversation
export function extractKnowledgeFromText(
  userMessage: string,
  aiResponse: string
): Array<{ layer: string; category: string; fact: string; field?: string | null }> {
  const extracted: Array<{ layer: string; category: string; fact: string; field?: string | null }> = []
  const combinedText = `${userMessage} ${aiResponse}`

  for (const pattern of KNOWLEDGE_EXTRACTION_PATTERNS) {
    const match = combinedText.match(pattern.pattern)
    if (match && match[1]) {
      extracted.push({
        layer: pattern.layer,
        category: pattern.category,
        fact: match[0].slice(0, 500), // Store the matched context
        field: pattern.field
      })
    }
  }

  return extracted
}

// Save extracted knowledge to database
export async function saveExtractedKnowledge(
  supabase: SupabaseClient,
  organizationId: string,
  threadId: string | null,
  extracted: Array<{ layer: string; category: string; fact: string; field?: string | null }>
): Promise<void> {
  if (extracted.length === 0) return

  try {
    // Save to business_knowledge
    const knowledgeInserts = extracted.map(item => ({
      organization_id: organizationId,
      layer: item.layer,
      category: item.category,
      fact: item.fact,
      confidence: 0.7, // Medium confidence for extracted data
      importance: 'medium',
      source_type: 'conversation',
      source_thread_id: threadId
    }))

    await supabase
      .from('business_knowledge')
      .insert(knowledgeInserts)

    // Update business_profiles for structured fields
    const profileUpdates: Record<string, any> = {}
    for (const item of extracted) {
      if (item.field) {
        // Extract numeric value if it's a number field
        const numMatch = item.fact.match(/(\d+(?:\.\d+)?)/);
        if (numMatch) {
          profileUpdates[item.field] = parseFloat(numMatch[1])
        } else {
          profileUpdates[item.field] = item.fact
        }
      }
    }

    if (Object.keys(profileUpdates).length > 0) {
      // Upsert business profile
      await supabase
        .from('business_profiles')
        .upsert({
          organization_id: organizationId,
          ...profileUpdates
        }, { onConflict: 'organization_id' })
    }
  } catch (e) {
    console.error('Error saving knowledge:', e)
  }
}

// Build knowledge context section for prompt
export function buildKnowledgeContextSection(
  knowledge: BusinessKnowledge[],
  profile: BusinessProfile | null
): string {
  if (knowledge.length === 0 && !profile) return ''

  const lines: string[] = ['', '## What I Know About This Business']

  // Add profile info
  if (profile) {
    if (profile.business_type) lines.push(`- Business Type: ${profile.business_type}`)
    if (profile.avg_ticket) lines.push(`- Average Transaction: $${profile.avg_ticket}`)
    if (profile.gross_margin_pct) lines.push(`- Gross Margin: ${profile.gross_margin_pct}%`)
    if (profile.food_cost_pct) lines.push(`- Food Cost: ${profile.food_cost_pct}%`)
    if (profile.labor_cost_pct) lines.push(`- Labor Cost: ${profile.labor_cost_pct}%`)
    if (profile.price_positioning) lines.push(`- Price Position: ${profile.price_positioning}`)
    if (profile.current_stage) lines.push(`- Business Stage: ${profile.current_stage}`)
    if (profile.biggest_challenge) lines.push(`- Current Challenge: ${profile.biggest_challenge}`)
    if (profile.competitive_advantage) lines.push(`- Competitive Edge: ${profile.competitive_advantage}`)
    if (profile.ideal_customer_description) lines.push(`- Ideal Customer: ${profile.ideal_customer_description}`)
    if (profile.primary_age_range) lines.push(`- Customer Age Range: ${profile.primary_age_range}`)
  }

  // Group knowledge by layer
  const byLayer: Record<string, BusinessKnowledge[]> = {}
  for (const k of knowledge) {
    if (!byLayer[k.layer]) byLayer[k.layer] = []
    byLayer[k.layer].push(k)
  }

  // Add learned facts (avoiding duplicates with profile)
  const addedFacts = new Set<string>()
  for (const [layer, facts] of Object.entries(byLayer)) {
    const layerLabel = layer.charAt(0).toUpperCase() + layer.slice(1)
    for (const fact of facts.slice(0, 3)) {
      const factKey = `${fact.category}:${fact.fact.slice(0, 50)}`
      if (!addedFacts.has(factKey)) {
        lines.push(`- [${layerLabel}] ${fact.fact}`)
        addedFacts.add(factKey)
      }
    }
  }

  if (lines.length <= 1) return ''
  return lines.join('\n')
}

// Build discovery question injection
export function buildDiscoveryPromptAddition(question: DiscoveryQuestion | null): string {
  if (!question) return ''

  return `

## Discovery Question to Weave In
When natural, try to ask this question during your response. Don't force it if it doesn't fit the conversation.
- Question: "${question.question}"
- Why: "${question.why_asking || 'Helps me understand their business better'}"
- Domain: ${question.domain}

Weave this in naturally - for example:
- At the end of your response as a genuine question
- Or as a follow-up question in the follow_up_questions array
- Don't ask if the conversation is clearly about something else`
}

// ============================================================================
// PHASE 2: DISCOVERY DETECTION & SESSION TRACKING
// ============================================================================

// Detect if user explicitly wants to skip/defer a question
export function detectDeferral(userMessage: string): 'skip' | 'defer' | null {
  const message = userMessage.toLowerCase().trim()

  // Explicit defer patterns - user wants to answer later
  const deferPatterns = [
    /ask me (again )?later/i,
    /come back to (that|this)/i,
    /remind me (later|tomorrow|next time)/i,
    /maybe later/i,
    /let('s| me) (come back|get back) to (that|this)/i,
    /not (right )?now,? (but |maybe )?later/i,
  ]

  for (const pattern of deferPatterns) {
    if (pattern.test(userMessage)) {
      return 'defer'
    }
  }

  // Explicit skip patterns - user doesn't want to answer
  const skipPatterns = [
    /i('d| would) (rather not|prefer not to)/i,
    /skip (that|this)( question)?/i,
    /can we (talk about|move on|discuss) something else/i,
    /let's (talk about|focus on|move to) something else/i,
    /i('d| would) rather not (say|share|answer)/i,
    /none of your business/i,
    /that's private/i,
    /i don't (want to|wanna) (talk about|share|answer)/i,
    /pass on (that|this)/i,
    /next question/i,
  ]

  for (const pattern of skipPatterns) {
    if (pattern.test(userMessage)) {
      return 'skip'
    }
  }

  return null
}

// Detect conversation context/topic from user message and history
export function detectConversationContext(
  userMessage: string,
  threadHistory: Array<{ prompt_text: string; response: any }>
): string | null {
  // Combine recent messages for context detection
  const recentMessages = [
    userMessage,
    ...threadHistory.slice(-3).map(h => h.prompt_text)
  ].join(' ').toLowerCase()

  // Domain keywords - ordered by specificity
  const contextKeywords: Record<string, string[]> = {
    costs: ['cost', 'costs', 'expense', 'expenses', 'spending', 'overhead', 'margin', 'margins', 'labor', 'rent', 'payroll', 'food cost', 'cogs'],
    revenue: ['revenue', 'sales', 'income', 'money', 'profit', 'earnings', 'pricing', 'price', 'prices', 'ticket', 'transaction'],
    customers: ['customer', 'customers', 'client', 'clients', 'visitor', 'visitors', 'guest', 'guests', 'who buys', 'demographic', 'audience', 'age range', 'target market'],
    competition: ['competitor', 'competitors', 'competition', 'rival', 'rivals', 'other business', 'nearby', 'alternative', 'competing'],
    operations: ['hours', 'schedule', 'scheduling', 'staff', 'staffing', 'employee', 'employees', 'busy', 'slow', 'peak', 'capacity', 'workflow'],
    growth: ['grow', 'growth', 'expand', 'expansion', 'scale', 'scaling', 'goal', 'goals', 'target', 'milestone', 'future', 'plan', 'plans'],
    marketing: ['marketing', 'advertise', 'advertising', 'promotion', 'promotions', 'social media', 'campaign', 'reach', 'ads', 'word of mouth'],
    team: ['team', 'staff', 'employee', 'employees', 'hire', 'hiring', 'manager', 'worker', 'workers', 'turnover'],
    finances: ['cash flow', 'budget', 'budgeting', 'loan', 'loans', 'funding', 'investment', 'financial', 'money', 'bank'],
    personal: ['stress', 'stressed', 'worry', 'worried', 'concern', 'concerned', 'why i started', 'passion', 'motivation', 'burnout', 'tired'],
  }

  let bestMatch: string | null = null
  let highestScore = 0

  for (const [domain, keywords] of Object.entries(contextKeywords)) {
    let score = 0
    for (const keyword of keywords) {
      if (recentMessages.includes(keyword)) {
        // Give more weight to multi-word keywords
        score += keyword.includes(' ') ? 2 : 1
      }
    }
    if (score > highestScore) {
      highestScore = score
      bestMatch = domain
    }
  }

  // Require at least 2 keyword matches to be confident
  return highestScore >= 2 ? bestMatch : null
}

// Detect if user's message answers a pending discovery question
export function detectDiscoveryAnswer(
  userMessage: string,
  pendingQuestion: DiscoveryQuestion | null
): AnswerDetectionResult {
  if (!pendingQuestion) {
    return { isAnswer: false, answerText: null, confidence: 0 }
  }

  const message = userMessage.toLowerCase().trim()

  // Very short responses are rarely answers
  if (message.length < 5) {
    return { isAnswer: false, answerText: null, confidence: 0.1 }
  }

  // Domain-specific answer patterns
  const answerPatterns: Record<string, { patterns: RegExp[]; weight: number }> = {
    revenue: {
      patterns: [
        /\$?\d{1,3}(,\d{3})*(\.\d{2})?/,  // Money amounts like $1,234.56
        /(\d+)\s*(k|thousand|million)/i,   // 50k, 50 thousand
        /around\s+\$?\d+/i,
        /about\s+\$?\d+/i,
        /average(ly)?\s+(is|around|about)?\s*\$?\d+/i,
      ],
      weight: 1.5,
    },
    costs: {
      patterns: [
        /(\d+(\.\d+)?)\s*%/,              // Percentages
        /(\d+)\s*percent/i,
        /around\s+(\d+)/i,
        /about\s+(\d+)/i,
        /(one|two|three|four|five)\s*-?\s*thirds?/i,  // One-third, etc.
      ],
      weight: 1.5,
    },
    customers: {
      patterns: [
        /they('re| are)\s+(mostly|usually|typically|generally)/i,
        /my (ideal )?customers?( are)?/i,
        /(\d+)\s*(-|to)\s*(\d+)\s*(years?|y\/o|year old)/i,  // Age ranges
        /(young|old|middle.?aged?|millennial|gen.?z|boomer)/i,
        /(professional|student|family|families|couple|retiree)/i,
      ],
      weight: 1.2,
    },
    operations: {
      patterns: [
        /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
        /(\d{1,2})(:\d{2})?\s*(am|pm)?/i,  // Times
        /(morning|afternoon|evening|night|lunch|dinner|breakfast)/i,
        /(busiest|slowest|peak|dead|quiet)/i,
      ],
      weight: 1.3,
    },
    growth: {
      patterns: [
        /i want to|we('re| are) trying to|our goal/i,
        /by (end of |the )?(year|month|quarter)/i,
        /in (\d+)\s*(month|year|week)/i,
        /(expand|grow|scale|open|launch)/i,
        /(second|another|new)\s*(location|store|branch)/i,
      ],
      weight: 1.2,
    },
    personal: {
      patterns: [
        /i('m| am) (worried|concerned|stressed) about/i,
        /what keeps me up/i,
        /my biggest (concern|fear|worry|challenge)/i,
        /(burnout|exhausted|overwhelmed|frustrated)/i,
        /i started (this|my) business (because|to)/i,
      ],
      weight: 1.0,
    },
    competition: {
      patterns: [
        /(competitor|competition) (is|are)/i,
        /there('s| is) (a )?(\w+) (down|across|near)/i,
        /(joe|bob|mike|the )\s*('s|s)\s*(place|shop|store|cafe|restaurant)/i,  // Competitor names
        /(better|worse) than (us|me|we)/i,
      ],
      weight: 1.2,
    },
  }

  const domain = pendingQuestion.domain
  const domainPatterns = answerPatterns[domain]

  let matchedPattern = false
  let patternWeight = 1.0

  if (domainPatterns) {
    for (const pattern of domainPatterns.patterns) {
      if (pattern.test(userMessage)) {
        matchedPattern = true
        patternWeight = domainPatterns.weight
        break
      }
    }
  }

  // Calculate confidence based on various signals
  let confidence = 0.3  // Base confidence

  // Pattern match gives strong signal
  if (matchedPattern) {
    confidence += 0.35 * patternWeight
  }

  // Message length is a good indicator
  if (userMessage.length > 50) {
    confidence += 0.15
  } else if (userMessage.length > 20) {
    confidence += 0.1
  }

  // Messages that start with the domain topic are likely answers
  const startsWithTopic = new RegExp(`^(my |our |the |we )?(${domain}|${pendingQuestion.domain})`, 'i')
  if (startsWithTopic.test(userMessage)) {
    confidence += 0.1
  }

  // Cap at 0.95
  confidence = Math.min(0.95, confidence)

  // Threshold for considering it an answer
  const isAnswer = confidence >= 0.5

  return {
    isAnswer,
    answerText: isAnswer ? userMessage : null,
    confidence,
  }
}

// Get session discovery state from database
export async function getSessionDiscoveryState(
  supabase: SupabaseClient,
  sessionId: string,
  organizationId: string
): Promise<SessionDiscoveryState> {
  try {
    const { data, error } = await supabase
      .rpc('get_session_discovery_state', {
        p_org_id: organizationId,
        p_session_id: sessionId,
        p_lookback_minutes: 30
      })

    if (error) {
      console.error('Failed to get session discovery state:', error)
      return {
        questionsAskedThisSession: 0,
        lastQuestionId: null,
        pendingQuestionId: null
      }
    }

    return {
      questionsAskedThisSession: data?.questions_asked_this_session || 0,
      lastQuestionId: data?.last_question_id || null,
      pendingQuestionId: data?.pending_question_id || null
    }
  } catch (e) {
    console.error('Error getting session discovery state:', e)
    return {
      questionsAskedThisSession: 0,
      lastQuestionId: null,
      pendingQuestionId: null
    }
  }
}

// Get a pending question by ID
export async function getPendingQuestionById(
  supabase: SupabaseClient,
  questionId: string
): Promise<DiscoveryQuestion | null> {
  try {
    const { data, error } = await supabase
      .from('discovery_questions')
      .select('id, domain, question, why_asking, priority')
      .eq('id', questionId)
      .single()

    if (error || !data) {
      return null
    }

    return {
      question_id: data.id,
      domain: data.domain,
      question: data.question,
      why_asking: data.why_asking,
      priority: data.priority
    }
  } catch (e) {
    return null
  }
}

// Handle question outcome (answered, skipped, deferred)
export async function handleQuestionOutcome(
  supabase: SupabaseClient,
  organizationId: string,
  questionId: string,
  outcome: 'answered' | 'skipped' | 'deferred',
  threadId: string | null,
  answerText: string | null
): Promise<void> {
  try {
    await supabase.rpc('handle_question_outcome', {
      p_org_id: organizationId,
      p_question_id: questionId,
      p_outcome: outcome,
      p_thread_id: threadId,
      p_answer_text: answerText
    })
  } catch (e) {
    console.error('Error handling question outcome:', e)
  }
}

// Get next discovery question with context awareness (Phase 2)
export async function getNextDiscoveryQuestionV2(
  supabase: SupabaseClient,
  organizationId: string,
  conversationContext: string | null,
  lastAnsweredQuestionId: string | null,
  sessionQuestionsAsked: number,
  businessType: string | null
): Promise<DiscoveryQuestion | null> {
  try {
    const { data, error } = await supabase
      .rpc('get_next_discovery_question_v2', {
        p_org_id: organizationId,
        p_conversation_context: conversationContext,
        p_last_question_id: lastAnsweredQuestionId,
        p_session_questions_asked: sessionQuestionsAsked,
        p_business_type: businessType
      })

    if (error) {
      console.error('Failed to get discovery question v2:', error)
      return null
    }

    if (!data || data.length === 0) {
      return null
    }

    const q = data[0]
    return {
      question_id: q.question_id,
      domain: q.domain,
      question: q.question,
      why_asking: q.why_asking,
      priority: q.priority
    }
  } catch (e) {
    console.error('Error getting discovery question v2:', e)
    return null
  }
}

// Build external context section for prompt
export function buildExternalContextSection(external: ExternalContext | null | undefined): string {
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

// Guard against oversized system prompts (knowledge accumulation can exceed context limits)
export function truncateSystemPrompt(prompt: string, maxChars: number = 12000): string {
  if (prompt.length <= maxChars) return prompt

  // Try to truncate the knowledge section specifically (preserves core instructions)
  const knowledgeMarker = '## What I Know About This Business'
  const markerIdx = prompt.indexOf(knowledgeMarker)
  if (markerIdx !== -1) {
    const beforeKnowledge = prompt.substring(0, markerIdx)
    const remaining = maxChars - beforeKnowledge.length - 100
    if (remaining > 200) {
      const knowledgeSection = prompt.substring(markerIdx, markerIdx + remaining)
      return beforeKnowledge + knowledgeSection + '\n\n[Some business context omitted for brevity]'
    }
  }

  // Fallback: hard truncate
  return prompt.substring(0, maxChars) + '\n\n[Context truncated]'
}

// Build system prompt based on mode
export function buildSystemPrompt(
  context: PromptRequest['context'],
  mode: 'review' | 'chat',
  knowledgeContext: string = '',
  discoveryPrompt: string = ''
): string {
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
**Customer Count:** ${context.customerCount}${automationsInfo}${slowDaysInfo}${revenueInfo}${challengeInfo}${externalContext}${knowledgeContext}`

  if (mode === 'chat') {
    // Chat mode: conversational, no forced card generation
    return `You are Royal AI, a friendly and knowledgeable business advisor for local businesses using Royalty, a loyalty program platform.

## Your Role
- Have natural conversations about business growth and customer retention
- Answer questions helpfully and conversationally
- Only suggest specific actions when the user asks for recommendations
- Be warm, encouraging, and supportive
- Learn about the business over time through natural conversation

${businessContext}

## Response Format
Respond naturally in conversational text. Do NOT return JSON unless specifically asked for action recommendations.

If the user asks for specific recommendations or actions, you may optionally include a JSON block at the end:
\`\`\`json
{"ideas": [...], "suggested": true}
\`\`\`

But for general conversation, just respond in plain text like a helpful advisor would.

## Tools Available
You have access to tools to query AND act on real business data.

### Read Tools (use proactively):
- read_customers: Query customer segments, at-risk members, VIPs
- read_activity: Query recent activity and engagement
- read_automations: Check current campaigns
- read_business_profile: Get business model data
- read_knowledge: Recall previously learned facts

### Research Tools (external data):
- search_competitors: Research local competitors
- search_regulations: Find industry regulations
- search_market_trends: Discover market trends
- search_benchmarks: Find industry benchmarks

### Write Tools (requires approval unless high confidence):
- create_announcement: Post announcements to the loyalty app
- send_targeted_message: Send messages to customer segments
- create_flash_promotion: Create time-limited points promotions
- award_bonus_points: Award bonus points to members
- enable_automation: Enable/disable loyalty automations
- save_knowledge: Store learned facts about the business
- create_reward_proposal: Propose a new reward based on business knowledge (owner reviews in Suggestions tab)

When using write tools:
1. Explain what you're doing and why
2. If the action is queued for approval, inform the user
3. Only use write tools when the user clearly wants to take action
4. For knowledge, save important facts proactively

Use read tools proactively to provide data-driven answers rather than guessing.

## Guidelines
1. Be conversational and natural - this is a chat, not a report
2. Ask clarifying questions when needed
3. Reference their business context when relevant
4. Only generate action cards when they explicitly ask "what should I do" or similar
5. Keep responses concise but helpful
6. When you learn new facts about the business, acknowledge them naturally
7. Use tools to look up real data before giving specific numbers or recommendations
8. ALWAYS call read_automations before suggesting new automations - check what's already running
9. Don't suggest automations that duplicate or overlap with existing ones${discoveryPrompt}`
  }

  // Review mode: structured card generation (existing behavior)
  return `You are Royal AI, an intelligent business advisor for local businesses using Royalty, a loyalty program platform.

## Your Role
- Help business owners grow their customer base and increase retention
- Provide actionable insights based on their specific business context
- Suggest automations, strategies, and local marketing ideas
- Be conversational, helpful, and data-driven
- Continuously learn about the business to provide better recommendations

${businessContext}

## Industry Knowledge
You have deep knowledge of:
- Loyalty program best practices
- Industry-specific retention strategies
- Local marketing tactics
- Automation workflows for customer engagement
- Competitive insights for various industries

## Tools Available
You have access to tools to query AND act on real business data.

### Read Tools (use for data-driven recommendations):
- read_customers: Query customer segments, at-risk members, VIPs
- read_activity: Query recent events and engagement patterns
- read_automations: Check current campaigns and their performance
- read_business_profile: Get detailed business model data
- read_knowledge: Recall facts you've learned about this business

### Research Tools (external data):
- search_competitors: Research local competitors
- search_regulations: Find industry regulations
- search_market_trends: Discover market trends
- search_benchmarks: Find industry benchmarks for KPIs

### Write Tools (confidence-gated actions):
- create_announcement: Post to loyalty app
- send_targeted_message: Send to customer segments
- create_flash_promotion: Create points promotions
- award_bonus_points: Award points to members
- enable_automation: Toggle automations
- save_knowledge: Store learned business facts
- create_reward_proposal: Propose rewards based on business insights

Write tools queue actions for approval unless:
1. Auto-execute is enabled for the organization
2. The AI confidence exceeds the organization's threshold

Use tools proactively when generating recommendations to base them on real data.

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

## Automation Awareness
IMPORTANT: Before suggesting any new automation:
1. ALWAYS call read_automations first to see what's already active
2. Check for overlapping triggers - don't suggest "win-back" if one exists
3. Consider if an existing automation could be modified instead
4. Note total active automations - more than 5-6 active may fatigue customers

When a similar automation exists, respond like:
- "You already have a win-back automation running. Want to adjust its timing instead?"
- "I see you have 6 active automations. Before adding more, let's check their performance."

## Guidelines
1. Generate 1-3 relevant idea cards per response
2. Tailor suggestions to the user's industry and location when known
3. Consider their current automation setup to avoid duplicates
4. Include 2-4 follow-up questions to continue the conversation
5. Be specific and actionable - general advice is not helpful
6. For new businesses (0 customers), focus on acquisition and onboarding
7. For established businesses, focus on retention and optimization
8. When the business has fewer than 3 rewards, proactively call create_reward_proposal to suggest 2-3 rewards tailored to their industry and business knowledge${discoveryPrompt}`
}

// Parse response based on mode
export function parseResponse(text: string, mode: 'review' | 'chat'): { ideas: IdeaCard[], message?: string, follow_up_questions?: string[] } {
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
export async function generateThreadTitle(prompt: string): Promise<string> {
  // Simple title generation: take first 50 chars or first sentence
  const firstSentence = prompt.split(/[.!?]/)[0]
  if (firstSentence.length <= 50) {
    return firstSentence.trim()
  }
  return prompt.slice(0, 47).trim() + '...'
}
