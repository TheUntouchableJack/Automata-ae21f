// Royal AI Prompt — Shared Type Definitions
// All interfaces, types, and constants used across modules

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================================
// REQUEST / RESPONSE TYPES
// ============================================================================

export interface ExternalContext {
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

export interface PromptRequest {
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

export interface IdeaCard {
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

export interface ReviewResponse {
  mode: 'review'
  ideas: IdeaCard[]
  follow_up_questions: string[]
  thread_id: string
  session_id: string
}

export interface ChatResponse {
  mode: 'chat'
  message: string
  ideas?: IdeaCard[]
  thread_id: string
  session_id: string
}

export type PromptResponse = ReviewResponse | ChatResponse

// ============================================================================
// KNOWLEDGE & DISCOVERY TYPES
// ============================================================================

export interface BusinessKnowledge {
  id: string
  layer: 'operational' | 'customer' | 'financial' | 'market' | 'growth' | 'regulatory'
  category: string
  fact: string
  confidence: number
  importance: 'critical' | 'high' | 'medium' | 'low'
  source_type: 'conversation' | 'research' | 'integration' | 'inferred'
}

export interface DiscoveryQuestion {
  question_id: string
  domain: string
  question: string
  why_asking: string
  priority: number
}

export interface BusinessProfile {
  business_type?: string
  revenue_model?: string
  avg_ticket?: number
  gross_margin_pct?: number
  food_cost_pct?: number
  labor_cost_pct?: number
  price_positioning?: string
  competitive_advantage?: string
  current_stage?: string
  biggest_challenge?: string
  success_vision?: string
  ideal_customer_description?: string
  primary_age_range?: string
  profile_completeness?: number
}

export interface SessionDiscoveryState {
  questionsAskedThisSession: number
  lastQuestionId: string | null
  pendingQuestionId: string | null
}

export interface AnswerDetectionResult {
  isAnswer: boolean
  answerText: string | null
  confidence: number
}

// Knowledge extraction patterns - what facts we're looking for in conversations
export const KNOWLEDGE_EXTRACTION_PATTERNS = [
  { pattern: /(?:food|product)\s*cost.*?(\d+)\s*%/i, layer: 'financial', category: 'food_cost', field: 'food_cost_pct' },
  { pattern: /(?:labor|payroll).*?(\d+)\s*%/i, layer: 'financial', category: 'labor_cost', field: 'labor_cost_pct' },
  { pattern: /(?:margin|gross\s*margin).*?(\d+)\s*%/i, layer: 'financial', category: 'margin', field: 'gross_margin_pct' },
  { pattern: /average\s*(?:ticket|transaction|check).*?\$?(\d+(?:\.\d{2})?)/i, layer: 'financial', category: 'avg_ticket', field: 'avg_ticket' },
  { pattern: /(\d+)\s*(?:employees?|staff|workers)/i, layer: 'operational', category: 'staff_count', field: 'staff_count' },
  { pattern: /(?:busy|peak)\s*(?:hours?|times?)\s*(?:are?|is)?\s*([^.]+)/i, layer: 'operational', category: 'peak_hours', field: null },
  { pattern: /(?:slow|quiet)\s*(?:days?|times?)\s*(?:are?|is)?\s*([^.]+)/i, layer: 'operational', category: 'slow_periods', field: null },
  { pattern: /(?:competitor|competition)\s*(?:is|are|includes?)?\s*([^.]+)/i, layer: 'market', category: 'competitor', field: null },
  { pattern: /(?:customers?|clients?)\s*(?:are?|is)\s*(?:mostly|typically|usually)\s*([^.]+)/i, layer: 'customer', category: 'customer_profile', field: 'ideal_customer_description' },
  { pattern: /(?:age|ages?)\s*(?:range|group)?\s*(?:is|are)?\s*(\d+\s*-\s*\d+|\d+s?)/i, layer: 'customer', category: 'age_range', field: 'primary_age_range' },
]

// ============================================================================
// CLAUDE TOOL USE TYPES
// ============================================================================

/**
 * Claude's tool definition format (Anthropic API spec)
 */
export interface ClaudeTool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, {
      type: string
      description: string
      enum?: string[]
      items?: { type: string }
    }>
    required?: string[]
  }
}

/**
 * Tool use content block from Claude response
 */
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * Text content block from Claude response
 */
export interface TextBlock {
  type: 'text'
  text: string
}

export type ContentBlock = ToolUseBlock | TextBlock

/**
 * Claude API response with tool use support
 */
export interface ClaudeToolResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: ContentBlock[]
  model: string
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

/**
 * Context passed to tool handlers
 */
export interface ToolContext {
  supabase: SupabaseClient
  organizationId: string
  appId?: string
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
  metadata?: {
    rowCount?: number
    truncated?: boolean
    source?: string
  }
}

/**
 * Tool handler function signature
 */
export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolContext
) => Promise<ToolResult>

// Tool use configuration
export const TOOL_USE_CONFIG = {
  maxIterations: 5,      // Maximum tool use loops
  maxTokens: 4000,       // Max tokens per Claude call
  toolTimeout: 10000,    // Timeout per tool execution (ms)
  tokenBudget: 15000,    // Max total tokens per request (prevents runaway cost)
}

// ============================================================================
// SHARED UTILITY FUNCTIONS
// ============================================================================

/**
 * Structured logging for production traceability
 */
export function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, unknown>
): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    service: 'royal-ai-prompt',
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

// Sanitize user input to prevent prompt injection attacks
// Rejects inputs containing common injection patterns and enforces length limits
export function sanitizeContextInput(input: string | null | undefined, maxLength: number = 200): string {
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
export function sanitizeContextArray(arr: string[] | null | undefined): string[] {
  if (!arr || !Array.isArray(arr)) return []
  return arr.slice(0, 10).map(item => sanitizeContextInput(item, 50))
}
