// Supabase Edge Function: Royal AI Prompt
// Conversational AI for business owners with mode-aware responses
// Features: session memory, chat threads, review mode (cards) vs chat mode (conversational)
// Phase 1: Business knowledge learning, discovery questions, and knowledge injection
// Phase 2: Proactive discovery with context-aware question selection
// Phase 3: Claude tool use for internal data queries and external research

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { webSearch, saveResearchFindings, extractInsights } from '../_shared/web-search.ts'
import { checkRateLimit, rateLimitHeaders } from '../_shared/rate-limit.ts'

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

// Allowed origins for CORS - production and development
const ALLOWED_ORIGINS = [
  'https://royaltyapp.ai',
  'https://www.royaltyapp.ai',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:5176',
]

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || ''

  // Security fix: Only allow exact matches, no fallback to default origin
  // Unknown origins get empty Access-Control-Allow-Origin which blocks the request
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
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

// ============================================================================
// KNOWLEDGE & DISCOVERY TYPES
// ============================================================================

interface BusinessKnowledge {
  id: string
  layer: 'operational' | 'customer' | 'financial' | 'market' | 'growth' | 'regulatory'
  category: string
  fact: string
  confidence: number
  importance: 'critical' | 'high' | 'medium' | 'low'
  source_type: 'conversation' | 'research' | 'integration' | 'inferred'
}

interface DiscoveryQuestion {
  question_id: string
  domain: string
  question: string
  why_asking: string
  priority: number
}

interface BusinessProfile {
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

// Knowledge extraction patterns - what facts we're looking for in conversations
const KNOWLEDGE_EXTRACTION_PATTERNS = [
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
// PHASE 3: CLAUDE TOOL USE TYPES
// ============================================================================

/**
 * Claude's tool definition format (Anthropic API spec)
 */
interface ClaudeTool {
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
interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * Text content block from Claude response
 */
interface TextBlock {
  type: 'text'
  text: string
}

type ContentBlock = ToolUseBlock | TextBlock

/**
 * Claude API response with tool use support
 */
interface ClaudeToolResponse {
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
interface ToolContext {
  supabase: SupabaseClient
  organizationId: string
  appId?: string
}

/**
 * Tool execution result
 */
interface ToolResult {
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
type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolContext
) => Promise<ToolResult>

// Tool use configuration
const TOOL_USE_CONFIG = {
  maxIterations: 5,      // Maximum tool use loops
  maxTokens: 4000,       // Max tokens per Claude call
  toolTimeout: 10000,    // Timeout per tool execution (ms)
  tokenBudget: 15000,    // Max total tokens per request (prevents runaway cost)
}

// ============================================================================
// PHASE 3: TOOL DEFINITIONS
// ============================================================================

const ROYAL_AI_TOOLS: ClaudeTool[] = [
  // Internal Read Tools
  {
    name: 'read_customers',
    description: 'Query customer data from the loyalty program. Returns member details including points, tier, visit history, and engagement metrics. Use to understand customer segments, at-risk members, and VIPs.',
    input_schema: {
      type: 'object',
      properties: {
        segment: {
          type: 'string',
          description: 'Customer segment to query',
          enum: ['all', 'active', 'at_risk', 'churned', 'new', 'vip']
        },
        tier: {
          type: 'string',
          description: 'Filter by loyalty tier',
          enum: ['bronze', 'silver', 'gold', 'platinum']
        },
        limit: {
          type: 'number',
          description: 'Maximum customers to return (default: 50, max: 100)'
        },
        include_visits: {
          type: 'boolean',
          description: 'Include recent visit history'
        },
        days_inactive: {
          type: 'number',
          description: 'For at_risk/churned, define inactivity threshold in days'
        }
      },
      required: []
    }
  },
  {
    name: 'read_activity',
    description: 'Query recent activity and events from the loyalty program. Use to understand engagement patterns, recent transactions, tier upgrades, and visit frequency.',
    input_schema: {
      type: 'object',
      properties: {
        event_type: {
          type: 'string',
          description: 'Filter by event type',
          enum: ['member_joined', 'points_earned', 'reward_redeemed', 'tier_upgrade', 'visit']
        },
        days: {
          type: 'number',
          description: 'Look back period in days (default: 30, max: 90)'
        },
        limit: {
          type: 'number',
          description: 'Maximum events to return (default: 100)'
        },
        member_id: {
          type: 'string',
          description: 'Filter to a specific member UUID'
        }
      },
      required: []
    }
  },
  {
    name: 'read_automations',
    description: 'Query configured automations and campaigns with performance metrics. Returns open rates, click rates, and identifies top/under performers. Use to understand what works.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status',
          enum: ['active', 'inactive', 'all']
        },
        type: {
          type: 'string',
          description: 'Filter by automation type (e.g., birthday, win_back, streak_bonus)'
        },
        include_performance: {
          type: 'boolean',
          description: 'Include detailed performance metrics (open rates, click rates). Default: true',
          default: true
        },
        days: {
          type: 'number',
          description: 'Number of days to calculate performance metrics. Default: 30',
          default: 30
        }
      },
      required: []
    }
  },
  {
    name: 'check_fatigue',
    description: 'Check customer fatigue before sending messages. Returns fatigue scores and recommendation on whether to proceed. ALWAYS use before sending bulk messages or campaigns.',
    input_schema: {
      type: 'object',
      properties: {
        segment: {
          type: 'string',
          description: 'Segment to check fatigue for',
          enum: ['all', 'vip', 'at_risk', 'new', 'active', 'churned']
        },
        threshold: {
          type: 'number',
          description: 'Fatigue threshold 0-100 (default: 50). Members above this are considered fatigued.',
          default: 50
        }
      },
      required: []
    }
  },
  {
    name: 'create_automation',
    description: 'Create a custom automation with guardrails. Validates config, checks for duplicates, and calculates confidence for auto-approval. LIMITS: max 500 points, max 5x multiplier, max 50% discount.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Automation name (human-readable)'
        },
        description: {
          type: 'string',
          description: 'Brief description of what this automation does'
        },
        category: {
          type: 'string',
          description: 'Automation category',
          enum: ['welcome', 'engagement', 'retention', 'recovery', 'behavioral', 'proactive']
        },
        trigger: {
          type: 'object',
          description: 'Trigger configuration',
          properties: {
            type: {
              type: 'string',
              enum: ['event', 'schedule', 'condition', 'ai'],
              description: 'Trigger type'
            },
            event: {
              type: 'string',
              description: 'Event name (for event triggers): member_signup, visit, purchase, birthday, inactivity_30d, tier_change'
            },
            schedule: {
              type: 'string',
              description: 'Cron schedule (for schedule triggers)'
            },
            condition: {
              type: 'object',
              description: 'Condition config (for condition triggers)'
            }
          }
        },
        action: {
          type: 'object',
          description: 'Action configuration',
          properties: {
            type: {
              type: 'string',
              enum: ['send_message', 'award_points', 'create_promo', 'notify_staff'],
              description: 'Action type'
            },
            config: {
              type: 'object',
              description: 'Action-specific config (channel, subject, body for messages; points for awards)'
            }
          }
        },
        limits: {
          type: 'object',
          description: 'Rate limiting configuration',
          properties: {
            delay_minutes: {
              type: 'number',
              description: 'Delay before executing (default: 0)'
            },
            max_frequency_days: {
              type: 'number',
              description: 'Minimum days between triggers for same member'
            },
            daily_limit: {
              type: 'number',
              description: 'Max executions per day'
            }
          }
        },
        auto_enable: {
          type: 'boolean',
          description: 'Enable immediately if confidence is high enough (autonomous mode)'
        }
      },
      required: ['name', 'category', 'trigger', 'action']
    }
  },
  {
    name: 'read_business_profile',
    description: 'Query the business profile including financial metrics, market position, and operational details. Use before making recommendations to understand the business model.',
    input_schema: {
      type: 'object',
      properties: {
        include_knowledge: {
          type: 'boolean',
          description: 'Also return accumulated business knowledge facts (default: true)'
        },
        knowledge_layers: {
          type: 'array',
          description: 'Filter knowledge to specific layers',
          items: { type: 'string' }
        }
      },
      required: []
    }
  },
  {
    name: 'read_knowledge',
    description: 'Query the business knowledge store for facts learned from conversations and research. Use to recall previously learned information about the business.',
    input_schema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          description: 'Filter by knowledge layer',
          enum: ['operational', 'customer', 'financial', 'market', 'growth', 'regulatory']
        },
        category: {
          type: 'string',
          description: 'Filter by category (e.g., margin, competitor, regulation)'
        },
        importance: {
          type: 'string',
          description: 'Filter by importance level',
          enum: ['critical', 'high', 'medium', 'low']
        },
        limit: {
          type: 'number',
          description: 'Maximum facts to return (default: 20)'
        }
      },
      required: []
    }
  },
  // External Research Tools
  {
    name: 'search_competitors',
    description: 'Search for competitor information in the local area or industry. Use for competitive intelligence, pricing comparisons, and market positioning insights.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Specific search query (e.g., "coffee shops downtown Austin")'
        },
        location: {
          type: 'string',
          description: 'City and state for local search'
        },
        industry: {
          type: 'string',
          description: 'Industry context (e.g., restaurant, salon, retail)'
        }
      },
      required: []
    }
  },
  {
    name: 'search_regulations',
    description: 'Search for industry regulations and compliance requirements. Use for local or state regulations that may affect the business.',
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Regulation topic (e.g., "food safety requirements", "loyalty program laws")'
        },
        state: {
          type: 'string',
          description: 'State for state-specific regulations'
        },
        industry: {
          type: 'string',
          description: 'Industry for industry-specific regulations'
        }
      },
      required: ['topic']
    }
  },
  {
    name: 'search_market_trends',
    description: 'Search for current market trends and industry developments. Use for trends in customer behavior, technology adoption, or industry shifts.',
    input_schema: {
      type: 'object',
      properties: {
        industry: {
          type: 'string',
          description: 'Industry to research'
        },
        topic: {
          type: 'string',
          description: 'Specific trend topic (e.g., "loyalty program trends", "consumer preferences")'
        },
        timeframe: {
          type: 'string',
          description: 'Timeframe for trends',
          enum: ['2024', '2025', '2026', 'recent']
        }
      },
      required: ['industry']
    }
  },
  {
    name: 'search_benchmarks',
    description: 'Search for industry benchmarks and KPIs. Use for typical metrics (e.g., average customer retention rate, visit frequency).',
    input_schema: {
      type: 'object',
      properties: {
        industry: {
          type: 'string',
          description: 'Industry for benchmarks'
        },
        metric: {
          type: 'string',
          description: 'Specific metric to benchmark (e.g., "customer retention rate", "loyalty enrollment rate")'
        },
        business_size: {
          type: 'string',
          description: 'Business size for relevant benchmarks',
          enum: ['small', 'medium', 'large']
        }
      },
      required: ['industry', 'metric']
    }
  },
  // ---------------------------------------------------------------------------
  // PHASE 4: WRITE TOOLS (Confidence-gated, queued for approval)
  // ---------------------------------------------------------------------------
  {
    name: 'create_announcement',
    description: 'Create an announcement to post to the loyalty app. Use for important updates, new offers, or business news. Requires approval unless confidence is high and auto-execute is enabled.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Announcement title (max 100 chars)'
        },
        body: {
          type: 'string',
          description: 'Announcement content (max 500 chars)'
        },
        priority: {
          type: 'string',
          description: 'Priority level affects visibility',
          enum: ['low', 'normal', 'high']
        },
        schedule_for: {
          type: 'string',
          description: 'ISO datetime to schedule (optional, default: immediate)'
        }
      },
      required: ['title', 'body']
    }
  },
  {
    name: 'send_targeted_message',
    description: 'Send a targeted message to a customer segment. Use for personalized outreach, win-back campaigns, or VIP communications.',
    input_schema: {
      type: 'object',
      properties: {
        segment: {
          type: 'string',
          description: 'Target customer segment',
          enum: ['all', 'active', 'at_risk', 'churned', 'new', 'vip']
        },
        tier: {
          type: 'string',
          description: 'Optional tier filter',
          enum: ['bronze', 'silver', 'gold', 'platinum']
        },
        subject: {
          type: 'string',
          description: 'Message subject (max 100 chars)'
        },
        body: {
          type: 'string',
          description: 'Message content (max 500 chars)'
        },
        channel: {
          type: 'string',
          description: 'Delivery channel',
          enum: ['push', 'email', 'in_app']
        }
      },
      required: ['segment', 'subject', 'body']
    }
  },
  {
    name: 'create_flash_promotion',
    description: 'Create a time-limited points promotion (e.g., 2x points today only). Use for driving immediate traffic or rewarding engagement.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Promotion name (max 50 chars)'
        },
        multiplier: {
          type: 'number',
          description: 'Points multiplier (e.g., 2 for double points)'
        },
        duration_hours: {
          type: 'number',
          description: 'Duration in hours (max 72)'
        },
        min_spend: {
          type: 'number',
          description: 'Minimum spend to qualify (optional)'
        },
        target_segment: {
          type: 'string',
          description: 'Optional segment targeting',
          enum: ['all', 'active', 'at_risk', 'new', 'vip']
        }
      },
      required: ['name', 'multiplier', 'duration_hours']
    }
  },
  {
    name: 'award_bonus_points',
    description: 'Award bonus points to specific members or a segment. Use for rewarding loyalty, resolving issues, or surprise-and-delight moments.',
    input_schema: {
      type: 'object',
      properties: {
        member_ids: {
          type: 'array',
          description: 'Specific member UUIDs to award (max 50)',
          items: { type: 'string' }
        },
        segment: {
          type: 'string',
          description: 'Award to entire segment (alternative to member_ids)',
          enum: ['vip', 'new', 'at_risk', 'birthday_today']
        },
        points: {
          type: 'number',
          description: 'Points to award (max 1000)'
        },
        reason: {
          type: 'string',
          description: 'Reason shown to member (max 100 chars)'
        }
      },
      required: ['points', 'reason']
    }
  },
  {
    name: 'enable_automation',
    description: 'Enable or configure a loyalty automation (e.g., birthday rewards, win-back campaigns, streak bonuses).',
    input_schema: {
      type: 'object',
      properties: {
        automation_type: {
          type: 'string',
          description: 'Type of automation',
          enum: ['birthday', 'win_back', 'streak_bonus', 'tier_upgrade', 'welcome']
        },
        enable: {
          type: 'boolean',
          description: 'Whether to enable (true) or disable (false)'
        },
        config: {
          type: 'object',
          description: 'Automation-specific configuration'
        }
      },
      required: ['automation_type', 'enable']
    }
  },
  {
    name: 'pause_automation',
    description: 'Pause an automation due to poor performance (high bounce rate, low engagement). Records the reason and notifies the owner.',
    input_schema: {
      type: 'object',
      properties: {
        automation_id: {
          type: 'string',
          description: 'UUID of the automation to pause'
        },
        reason: {
          type: 'string',
          description: 'Reason for pausing (e.g., "High bounce rate of 18%", "Low engagement")'
        },
        metrics: {
          type: 'object',
          description: 'Current performance metrics snapshot',
          properties: {
            bounce_rate_pct: { type: 'number' },
            open_rate_pct: { type: 'number' },
            click_rate_pct: { type: 'number' },
            total_sent: { type: 'number' }
          }
        }
      },
      required: ['automation_id', 'reason']
    }
  },
  {
    name: 'get_recovery_suggestions',
    description: 'Get automations that have been paused for 7+ days and are eligible for recovery. Returns suggested recovery configurations with reduced frequency.',
    input_schema: {
      type: 'object',
      properties: {
        min_days_paused: {
          type: 'number',
          description: 'Minimum days an automation must be paused (default: 7)'
        }
      },
      required: []
    }
  },
  {
    name: 'recover_automation',
    description: 'Re-enable a paused automation with reduced frequency settings. Use after reviewing recovery suggestions.',
    input_schema: {
      type: 'object',
      properties: {
        automation_id: {
          type: 'string',
          description: 'UUID of the paused automation to recover'
        },
        new_frequency_days: {
          type: 'number',
          description: 'New max_frequency_days setting (should be higher than original to reduce send frequency)'
        }
      },
      required: ['automation_id']
    }
  },
  {
    name: 'save_knowledge',
    description: 'Save a learned fact to the business knowledge store. Use when you learn important business information that should be remembered.',
    input_schema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          description: 'Knowledge category',
          enum: ['operational', 'customer', 'financial', 'market', 'growth', 'regulatory']
        },
        category: {
          type: 'string',
          description: 'Specific category (e.g., margin, competitor, regulation)'
        },
        fact: {
          type: 'string',
          description: 'The fact to store (max 500 chars)'
        },
        importance: {
          type: 'string',
          description: 'Importance level',
          enum: ['critical', 'high', 'medium', 'low']
        },
        confidence: {
          type: 'number',
          description: 'Confidence in fact accuracy (0.0-1.0)'
        }
      },
      required: ['layer', 'category', 'fact']
    }
  },

  // ── CEO / Self-Growth Tools ──────────────────────────────────────────
  {
    name: 'read_own_revenue',
    description: "Read Royalty's own Stripe revenue metrics: MRR, new trials, churn, active subscriptions. Use when Jay asks about Royalty's financial performance.",
    input_schema: {
      type: 'object',
      properties: {
        period_days: {
          type: 'number',
          description: 'Number of days to look back for new subscriptions/churn (default 30)'
        }
      },
      required: []
    }
  },
  {
    name: 'read_trial_users',
    description: "Get Royalty's trial organizations that have not yet activated (no customer app set up). Use to identify who needs follow-up.",
    input_schema: {
      type: 'object',
      properties: {
        days_since_signup: {
          type: 'number',
          description: 'Only return trials signed up at least N days ago (default 3)'
        },
        limit: {
          type: 'number',
          description: 'Max results (default 20)'
        }
      },
      required: []
    }
  },
  {
    name: 'read_content_queue',
    description: "Check Royalty's blog content pipeline: articles in draft, days since last publish, articles awaiting review in blog-review.",
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'log_growth_action',
    description: "Log an action taken by Royal for Royalty's own business growth. Always call this after taking any autonomous action.",
    input_schema: {
      type: 'object',
      properties: {
        action_type: {
          type: 'string',
          description: 'Type of action (e.g. revenue_snapshot, content_check, outreach_drafted, reflection)'
        },
        description: {
          type: 'string',
          description: 'What Royal did and why (max 500 chars)'
        },
        status: {
          type: 'string',
          description: 'Execution status',
          enum: ['completed', 'failed', 'pending_approval']
        }
      },
      required: ['action_type', 'description']
    }
  },
  {
    name: 'log_task',
    description: "Record a task Royal is actively working on. Use this to make your work visible in the CEO dashboard Tasks panel. Call when starting a significant action.",
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short task name (max 100 chars)'
        },
        description: {
          type: 'string',
          description: 'What Royal is doing and why (max 500 chars)'
        }
      },
      required: ['title']
    }
  },
  {
    name: 'request_help',
    description: "Signal that Royal is blocked and needs Jay's input. Use when you cannot proceed without a resource, decision, or approval from Jay. This creates a blocker item visible in the CEO dashboard Tasks panel.",
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Brief description of what Royal was trying to do (max 100 chars)'
        },
        blocker_description: {
          type: 'string',
          description: 'Exactly what Jay needs to provide or decide to unblock Royal (max 500 chars)'
        },
        blocker_type: {
          type: 'string',
          description: 'Category of blocker',
          enum: ['api_key', 'approval', 'decision', 'data', 'other']
        }
      },
      required: ['title', 'blocker_description', 'blocker_type']
    }
  },
  {
    name: 'queue_outreach',
    description: "Draft an outreach email or message and queue it for Jay's approval in the CEO Dashboard. Use when Jay asks Royal to send outreach, or when Royal identifies a high-value outreach opportunity. Items appear in 'Today's Plan — Pending Approval'. Jay must approve before anything sends.",
    input_schema: {
      type: 'object',
      properties: {
        target_email: { type: 'string', description: 'Recipient email address' },
        target_name:  { type: 'string', description: 'Recipient name or org name' },
        subject:      { type: 'string', description: 'Email subject line' },
        body_text:    { type: 'string', description: 'Plain text email body' },
        body_html:    { type: 'string', description: 'HTML email body (optional, falls back to body_text)' },
        rationale:    { type: 'string', description: "Why this outreach makes sense — shown to Jay in the approval queue" },
        channel:      { type: 'string', enum: ['email', 'sms'], description: 'Delivery channel (default: email)' },
      },
      required: ['target_email', 'subject', 'body_text', 'rationale'],
    }
  },
  {
    name: 'trigger_article_generation',
    description: "Generate a new blog article for Royalty's website. Auto-picks the next SEO-priority topic from the content strategy, or writes a specific topic if provided. Article is saved as a draft in blog-review for Jay to publish.",
    input_schema: {
      type: 'object',
      properties: {
        topic_title: {
          type: 'string',
          description: 'Article title (optional — auto-picks next from content strategy if omitted)'
        },
        keyword: {
          type: 'string',
          description: 'Primary SEO keyword to target (optional)'
        },
        description: {
          type: 'string',
          description: 'Brief description of what the article should cover (optional)'
        }
      },
      required: []
    }
  }
]

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
// STRUCTURED LOGGING
// ============================================================================

/**
 * Structured logging for production traceability
 */
function log(
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

// ============================================================================
// PHASE 3: TOOL HANDLERS
// ============================================================================

/**
 * Input validation schema types
 */
type ValidationSchema = Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object'>

/**
 * Validate and sanitize tool input parameters
 * Prevents injection attacks and ensures type safety
 */
function validateToolInput<T extends Record<string, unknown>>(
  input: Record<string, unknown>,
  schema: ValidationSchema,
  toolName: string
): T {
  const validated: Record<string, unknown> = {}

  for (const [key, expectedType] of Object.entries(schema)) {
    const value = input[key]

    // Skip undefined values (optional parameters)
    if (value === undefined || value === null) continue

    switch (expectedType) {
      case 'string':
        if (typeof value !== 'string') {
          log('warn', 'Invalid tool input type', { tool: toolName, key, expected: 'string', got: typeof value })
          throw new Error(`Parameter '${key}' must be a string`)
        }
        // Sanitize strings to prevent injection
        validated[key] = sanitizeContextInput(value, 1000)
        break

      case 'number':
        const num = typeof value === 'number' ? value : Number(value)
        if (isNaN(num)) {
          log('warn', 'Invalid tool input type', { tool: toolName, key, expected: 'number', got: typeof value })
          throw new Error(`Parameter '${key}' must be a number`)
        }
        // Clamp to reasonable bounds
        validated[key] = Math.min(Math.max(num, -1000000), 1000000)
        break

      case 'boolean':
        validated[key] = Boolean(value)
        break

      case 'array':
        if (!Array.isArray(value)) {
          log('warn', 'Invalid tool input type', { tool: toolName, key, expected: 'array', got: typeof value })
          throw new Error(`Parameter '${key}' must be an array`)
        }
        // Limit array size and sanitize string elements
        validated[key] = value.slice(0, 100).map(item =>
          typeof item === 'string' ? sanitizeContextInput(item, 200) : item
        )
        break

      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) {
          log('warn', 'Invalid tool input type', { tool: toolName, key, expected: 'object', got: typeof value })
          throw new Error(`Parameter '${key}' must be an object`)
        }
        // Limit object depth and stringify for safety
        validated[key] = JSON.parse(JSON.stringify(value).slice(0, 10000))
        break

      default:
        validated[key] = value
    }
  }

  return validated as T
}

/**
 * Get app_id for an organization
 */
async function getAppIdForOrg(supabase: SupabaseClient, organizationId: string): Promise<string | null> {
  const { data } = await supabase
    .from('customer_apps')
    .select('id')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .limit(1)
    .single()
  return data?.id || null
}

/**
 * Tool handlers registry
 */
const TOOL_HANDLERS: Record<string, ToolHandler> = {
  // ---------------------------------------------------------------------------
  // read_customers - Query customer segments and member data
  // ---------------------------------------------------------------------------
  read_customers: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    // Validate inputs
    const validated = validateToolInput<{
      limit?: number
      segment?: string
      tier?: string
      include_visits?: boolean
      days_inactive?: number
    }>(input, {
      limit: 'number',
      segment: 'string',
      tier: 'string',
      include_visits: 'boolean',
      days_inactive: 'number'
    }, 'read_customers')

    const { supabase, organizationId, appId } = ctx
    const limit = Math.min(validated.limit || 50, 100)
    const segment = validated.segment || 'all'
    const tier = validated.tier
    const includeVisits = validated.include_visits
    const daysInactive = validated.days_inactive || 30

    const targetAppId = appId || await getAppIdForOrg(supabase, organizationId)
    if (!targetAppId) {
      return { success: false, error: 'No loyalty app found for this organization' }
    }

    let query = supabase
      .from('app_members')
      .select('id, email, first_name, last_name, tier, points_balance, total_points_earned, visit_count, current_streak, last_visit_at, joined_at')
      .eq('app_id', targetAppId)
      .is('deleted_at', null)

    // Apply segment filter
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysInactive)

    switch (segment) {
      case 'active':
        query = query.gte('last_visit_at', cutoffDate.toISOString())
        break
      case 'at_risk':
        const atRiskStart = new Date()
        atRiskStart.setDate(atRiskStart.getDate() - (daysInactive * 2))
        query = query
          .lt('last_visit_at', cutoffDate.toISOString())
          .gte('last_visit_at', atRiskStart.toISOString())
        break
      case 'churned':
        const churnCutoff = new Date()
        churnCutoff.setDate(churnCutoff.getDate() - 60)
        query = query.lt('last_visit_at', churnCutoff.toISOString())
        break
      case 'new':
        const newCutoff = new Date()
        newCutoff.setDate(newCutoff.getDate() - 14)
        query = query.gte('joined_at', newCutoff.toISOString())
        break
      case 'vip':
        query = query.in('tier', ['gold', 'platinum'])
        break
    }

    if (tier) {
      query = query.eq('tier', tier)
    }

    query = query.order('last_visit_at', { ascending: false }).limit(limit)

    const { data: members, error } = await query

    if (error) {
      return { success: false, error: error.message }
    }

    // Build summary
    const summary = {
      total_count: members?.length || 0,
      segment_applied: segment,
      by_tier: (members || []).reduce((acc, m) => {
        acc[m.tier || 'none'] = (acc[m.tier || 'none'] || 0) + 1
        return acc
      }, {} as Record<string, number>),
      avg_points: members?.length
        ? Math.round((members || []).reduce((sum, m) => sum + (m.points_balance || 0), 0) / members.length)
        : 0,
      avg_visits: members?.length
        ? Math.round((members || []).reduce((sum, m) => sum + (m.visit_count || 0), 0) / members.length)
        : 0
    }

    return {
      success: true,
      data: { summary, members: members || [] },
      metadata: { rowCount: members?.length || 0 }
    }
  },

  // ---------------------------------------------------------------------------
  // read_activity - Query recent events and activity
  // ---------------------------------------------------------------------------
  read_activity: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId, appId } = ctx
    const days = Math.min((input.days as number) || 30, 90)
    const limit = Math.min((input.limit as number) || 100, 500)
    const eventType = input.event_type as string
    const memberId = input.member_id as string

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    const targetAppId = appId || await getAppIdForOrg(supabase, organizationId)
    if (!targetAppId) {
      return { success: false, error: 'No loyalty app found' }
    }

    let query = supabase
      .from('app_events')
      .select('id, event_type, event_data, member_id, created_at')
      .eq('app_id', targetAppId)
      .gte('created_at', cutoffDate.toISOString())

    if (eventType) {
      query = query.eq('event_type', eventType)
    }
    if (memberId) {
      query = query.eq('member_id', memberId)
    }

    query = query.order('created_at', { ascending: false }).limit(limit)

    const { data: events, error } = await query

    if (error) {
      return { success: false, error: error.message }
    }

    const summary = {
      total_events: events?.length || 0,
      period_days: days,
      by_type: (events || []).reduce((acc, e) => {
        acc[e.event_type] = (acc[e.event_type] || 0) + 1
        return acc
      }, {} as Record<string, number>)
    }

    return {
      success: true,
      data: { summary, events: events || [] },
      metadata: { rowCount: events?.length || 0 }
    }
  },

  // ---------------------------------------------------------------------------
  // read_automations - Query active automations with performance metrics
  // ---------------------------------------------------------------------------
  read_automations: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId, appId } = ctx
    const status = input.status as string
    const type = input.type as string
    const includePerformance = input.include_performance !== false
    const days = (input.days as number) || 30

    const targetAppId = appId || await getAppIdForOrg(supabase, organizationId)

    // Query automations table (legacy)
    let query = supabase
      .from('automations')
      .select('id, name, automation_type, is_active, trigger_config, action_config, template_id, created_at')

    if (targetAppId) {
      query = query.eq('app_id', targetAppId)
    }

    query = query.eq('is_archived', false)

    if (status === 'active') {
      query = query.eq('is_active', true)
    } else if (status === 'inactive') {
      query = query.eq('is_active', false)
    }

    if (type) {
      query = query.eq('automation_type', type)
    }

    const { data: automations, error } = await query

    if (error) {
      return { success: false, error: error.message }
    }

    // Get performance metrics from automation_definitions if enabled
    let performanceData: Record<string, unknown>[] = []
    let rankings: Record<string, unknown> | null = null

    if (includePerformance) {
      // Get performance with correlation from automation_definitions table
      const { data: perfData } = await supabase.rpc('get_automation_performance_with_correlation', {
        p_organization_id: organizationId,
        p_app_id: targetAppId || null,
        p_days: days
      })
      performanceData = perfData || []

      // Get rankings (top/bottom performers)
      const { data: rankData } = await supabase.rpc('get_automation_rankings', {
        p_organization_id: organizationId,
        p_days: days
      })
      rankings = rankData || null
    }

    // Create a map of automation_id -> performance for quick lookup
    const perfMap = new Map(performanceData.map((p: Record<string, unknown>) =>
      [p.automation_id as string, p]
    ))

    // Enhance automations with performance and correlation data if available
    const enhancedAutomations = (automations || []).map(a => {
      const perf = perfMap.get(a.id)
      return {
        ...a,
        performance: perf ? {
          trigger_count: perf.trigger_count,
          success_rate_pct: perf.success_rate_pct,
          total_sent: perf.total_sent,
          open_rate_pct: perf.open_rate_pct,
          click_rate_pct: perf.click_rate_pct
        } : null,
        correlation: perf ? {
          executions_in_period: perf.executions_in_period,
          attributed_visits: perf.attributed_visits,
          visit_rate_pct: perf.visit_rate_pct,
          avg_success_score: perf.avg_success_score,
          avg_days_to_visit: perf.avg_days_to_visit
        } : null
      }
    })

    const summary = {
      total_automations: automations?.length || 0,
      active: (automations || []).filter(a => a.is_active).length,
      by_type: (automations || []).reduce((acc, a) => {
        const aType = a.automation_type || 'unknown'
        acc[aType] = (acc[aType] || 0) + 1
        return acc
      }, {} as Record<string, number>),
      ...(rankings ? {
        avg_open_rate_pct: rankings.avg_open_rate_pct,
        top_performer: rankings.top_performer,
        underperformer: rankings.underperformer
      } : {})
    }

    return {
      success: true,
      data: {
        summary,
        automations: enhancedAutomations,
        performance_period_days: days
      },
      metadata: { rowCount: automations?.length || 0 }
    }
  },

  // ---------------------------------------------------------------------------
  // check_fatigue - Check customer fatigue before messaging
  // ---------------------------------------------------------------------------
  check_fatigue: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId } = ctx
    const segment = (input.segment as string) || 'all'
    const threshold = (input.threshold as number) || 50

    // Get segment fatigue summary
    const { data: summary, error } = await supabase.rpc('get_segment_fatigue_summary', {
      p_organization_id: organizationId,
      p_segment: segment,
      p_threshold: threshold
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: {
        segment,
        ...summary,
        guidance: summary?.status === 'pause'
          ? 'DO NOT proceed with messaging. Audience is critically fatigued.'
          : summary?.status === 'caution'
          ? 'Proceed with caution. Consider targeting only unfatigued members or high-value content.'
          : 'Safe to proceed with messaging campaign.'
      },
      metadata: { segment, threshold }
    }
  },

  // ---------------------------------------------------------------------------
  // create_automation - Queue custom automation creation with guardrails
  // Routes through ai_action_queue for approval, execution, and outcome measurement
  // ---------------------------------------------------------------------------
  create_automation: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId, appId } = ctx

    const name = input.name as string
    const description = input.description as string || ''
    const category = input.category as string
    const trigger = input.trigger as Record<string, unknown>
    const action = input.action as Record<string, unknown>
    const limits = input.limits as Record<string, unknown> || {}
    const autoEnable = input.auto_enable as boolean || false

    if (!name || !category || !trigger || !action) {
      return { success: false, error: 'Missing required fields: name, category, trigger, action' }
    }

    const targetAppId = appId || await getAppIdForOrg(supabase, organizationId)

    // Calculate confidence based on automation parameters
    // (mirrors create_custom_automation's calculate_automation_confidence logic)
    let confidence = 0.65  // Base for custom automations
    const actionConfig = action.config as Record<string, unknown> || {}
    const pointsAwarded = (actionConfig.points as number) || 0
    const multiplier = (actionConfig.multiplier as number) || 1
    const discountPct = (actionConfig.discount_percent as number) || 0
    const delayMinutes = (limits.delay_minutes as number) || 0
    const maxFreqDays = (limits.max_frequency_days as number) || 0

    if (pointsAwarded > 200) confidence -= 0.10
    if (multiplier > 3) confidence -= 0.10
    if (discountPct > 30) confidence -= 0.10
    if (!maxFreqDays) confidence -= 0.10  // No frequency limit = risky
    if (delayMinutes >= 30) confidence += 0.05
    if (maxFreqDays >= 14) confidence += 0.05
    confidence = Math.min(confidence, 0.80)  // Cap for custom automations

    // Queue the action (same pattern as other write tools)
    const { data: queueResult, error } = await supabase.rpc('queue_ai_action', {
      p_org_id: organizationId,
      p_action_type: 'create_automation',
      p_action_payload: {
        app_id: targetAppId,
        name,
        description,
        category,
        trigger,
        action,
        limits,
        auto_enable: autoEnable
      },
      p_reasoning: `Create custom automation: "${name}" — ${description || category}`,
      p_confidence: confidence
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: {
        queued: true,
        action_id: queueResult?.action_id,
        status: queueResult?.status,
        confidence,
        auto_approved: queueResult?.auto_approved,
        message: queueResult?.auto_approved
          ? 'Automation queued for automatic creation'
          : 'Automation queued for approval — owner will review before creation'
      }
    }
  },

  // ---------------------------------------------------------------------------
  // read_business_profile - Query business profile and knowledge
  // ---------------------------------------------------------------------------
  read_business_profile: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId } = ctx
    const includeKnowledge = input.include_knowledge !== false
    const knowledgeLayers = input.knowledge_layers as string[] | undefined

    const { data: org } = await supabase
      .from('organizations')
      .select('name, slug, created_at, plan_type')
      .eq('id', organizationId)
      .single()

    const { data: profile } = await supabase
      .from('business_profiles')
      .select('organization_id, business_type, business_subtype, revenue_model, primary_revenue_streams, avg_ticket, gross_margin_pct, food_cost_pct, labor_cost_pct, rent_pct, break_even_daily, price_positioning, primary_competitors, competitive_advantage, unique_selling_points, current_stage, growth_goals, expansion_interest, biggest_challenge, success_vision, location_type, foot_traffic_level, parking_situation, nearby_anchors, peak_hours, slow_periods, staff_count, owner_hours_weekly, ideal_customer_description, primary_age_range, customer_frequency, profile_completeness')
      .eq('organization_id', organizationId)
      .single()

    let knowledge: unknown[] = []
    if (includeKnowledge) {
      let knowledgeQuery = supabase
        .from('business_knowledge')
        .select('layer, category, fact, confidence, importance, source_type, created_at')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .order('importance', { ascending: false })
        .limit(30)

      if (knowledgeLayers && knowledgeLayers.length > 0) {
        knowledgeQuery = knowledgeQuery.in('layer', knowledgeLayers)
      }

      const { data: knowledgeData } = await knowledgeQuery
      knowledge = knowledgeData || []
    }

    return {
      success: true,
      data: {
        organization: org,
        profile: profile,
        knowledge: knowledge,
        profile_completeness: profile?.profile_completeness || 0
      }
    }
  },

  // ---------------------------------------------------------------------------
  // read_knowledge - Query knowledge store
  // ---------------------------------------------------------------------------
  read_knowledge: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId } = ctx
    const limit = Math.min((input.limit as number) || 20, 50)
    const layer = input.layer as string
    const category = input.category as string
    const importance = input.importance as string

    let query = supabase
      .from('business_knowledge')
      .select('id, layer, category, fact, confidence, importance, source_type, source_url, created_at, times_used')
      .eq('organization_id', organizationId)
      .eq('status', 'active')

    if (layer) query = query.eq('layer', layer)
    if (category) query = query.eq('category', category)
    if (importance) query = query.eq('importance', importance)

    query = query.order('importance', { ascending: false })
      .order('times_used', { ascending: false })
      .limit(limit)

    const { data: knowledge, error } = await query

    if (error) {
      return { success: false, error: error.message }
    }

    const byLayer = (knowledge || []).reduce((acc, k) => {
      if (!acc[k.layer]) acc[k.layer] = []
      acc[k.layer].push(k)
      return acc
    }, {} as Record<string, unknown[]>)

    return {
      success: true,
      data: { facts: knowledge || [], by_layer: byLayer, total_count: knowledge?.length || 0 },
      metadata: { rowCount: knowledge?.length || 0 }
    }
  },

  // ---------------------------------------------------------------------------
  // External Research Tools (Structured for Serper API integration)
  // ---------------------------------------------------------------------------

  search_competitors: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId } = ctx
    const industry = (input.industry as string) || 'business'
    const location = (input.location as string) || ''
    const query = (input.query as string) || `${industry} competitors ${location}`.trim()

    // Use shared web search module (handles API key check and caching internally)
    const searchResult = await webSearch(supabase, organizationId, query, 'competitors', { num: 5 })

    if (searchResult.source === 'serper' && searchResult.results.length > 0) {
      // Save real insights to knowledge base
      const insights = extractInsights(searchResult.results)
      if (insights.length > 0) {
        await saveResearchFindings(supabase, organizationId, 'market', 'competition', insights, query)
      }
    }

    return {
      success: searchResult.success,
      data: {
        query: searchResult.query,
        results: searchResult.results,
        cached: searchResult.cached,
        api_status: searchResult.source === 'serper' ? 'configured' : 'not_configured'
      },
      metadata: { source: searchResult.source }
    }
  },

  search_regulations: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId } = ctx
    const topic = (input.topic as string) || 'business'
    const state = (input.state as string) || ''
    const industry = (input.industry as string) || ''
    const query = `${topic} regulations ${state} ${industry}`.trim()

    const searchResult = await webSearch(supabase, organizationId, query, 'regulations', { num: 5 })

    if (searchResult.source === 'serper' && searchResult.results.length > 0) {
      const insights = extractInsights(searchResult.results)
      if (insights.length > 0) {
        await saveResearchFindings(supabase, organizationId, 'market', 'regulations', insights, query)
      }
    }

    return {
      success: searchResult.success,
      data: {
        query: searchResult.query,
        results: searchResult.results,
        cached: searchResult.cached,
        api_status: searchResult.source === 'serper' ? 'configured' : 'not_configured'
      },
      metadata: { source: searchResult.source }
    }
  },

  search_market_trends: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId } = ctx
    const industry = (input.industry as string) || 'retail'
    const topic = (input.topic as string) || 'trends'
    const timeframe = (input.timeframe as string) || '2026'
    const query = `${industry} ${topic} ${timeframe}`.trim()

    const searchResult = await webSearch(supabase, organizationId, query, 'trends', { num: 5 })

    if (searchResult.source === 'serper' && searchResult.results.length > 0) {
      const insights = extractInsights(searchResult.results)
      if (insights.length > 0) {
        await saveResearchFindings(supabase, organizationId, 'market', 'trends', insights, query)
      }
    }

    return {
      success: searchResult.success,
      data: {
        query: searchResult.query,
        results: searchResult.results,
        cached: searchResult.cached,
        api_status: searchResult.source === 'serper' ? 'configured' : 'not_configured'
      },
      metadata: { source: searchResult.source }
    }
  },

  search_benchmarks: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId } = ctx
    const industry = (input.industry as string) || 'retail'
    const metric = (input.metric as string) || 'customer retention'
    const businessSize = (input.business_size as string) || 'small business'
    const query = `${industry} ${metric} benchmark ${businessSize}`.trim()

    const searchResult = await webSearch(supabase, organizationId, query, 'benchmarks', { num: 5 })

    if (searchResult.source === 'serper' && searchResult.results.length > 0) {
      const insights = extractInsights(searchResult.results)
      if (insights.length > 0) {
        await saveResearchFindings(supabase, organizationId, 'market', 'benchmarks', insights, query)
      }
    }

    return {
      success: searchResult.success,
      data: {
        query: searchResult.query,
        results: searchResult.results,
        cached: searchResult.cached,
        api_status: searchResult.source === 'serper' ? 'configured' : 'not_configured'
      },
      metadata: { source: searchResult.source }
    }
  },

  // ---------------------------------------------------------------------------
  // PHASE 4: WRITE TOOL HANDLERS (Confidence-gated, queued for approval)
  // ---------------------------------------------------------------------------

  create_announcement: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    // Validate and sanitize inputs
    const validated = validateToolInput<{
      title?: string
      body?: string
      priority?: string
      schedule_for?: string
    }>(input, {
      title: 'string',
      body: 'string',
      priority: 'string',
      schedule_for: 'string'
    }, 'create_announcement')

    const { supabase, organizationId, appId } = ctx
    const title = (validated.title || '').slice(0, 100)
    const body = (validated.body || '').slice(0, 500)
    const priority = validated.priority || 'normal'
    const scheduleFor = validated.schedule_for

    if (!title || !body) {
      return { success: false, error: 'Title and body are required' }
    }

    // Validate priority enum
    if (!['low', 'normal', 'high'].includes(priority)) {
      return { success: false, error: 'Priority must be low, normal, or high' }
    }

    const targetAppId = appId || await getAppIdForOrg(supabase, organizationId)

    // Calculate confidence based on action parameters
    let confidence = 0.7  // Base confidence for announcements
    if (priority === 'high') confidence -= 0.1  // High priority = lower confidence, needs approval
    if (body.length > 300) confidence -= 0.05  // Long messages warrant review

    // Queue the action instead of executing directly
    const { data: queueResult, error } = await supabase.rpc('queue_ai_action', {
      p_org_id: organizationId,
      p_action_type: 'create_announcement',
      p_action_payload: {
        app_id: targetAppId,
        title,
        body,
        priority,
        schedule_for: scheduleFor
      },
      p_reasoning: `AI generated announcement: "${title}"`,
      p_confidence: confidence
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: {
        queued: true,
        action_id: queueResult?.action_id,
        status: queueResult?.status,
        confidence,
        auto_approved: queueResult?.auto_approved,
        message: queueResult?.auto_approved
          ? 'Announcement queued for automatic execution'
          : 'Announcement queued for approval'
      }
    }
  },

  send_targeted_message: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    // Validate and sanitize inputs
    const validated = validateToolInput<{
      segment?: string
      tier?: string
      subject?: string
      body?: string
      channel?: string
    }>(input, {
      segment: 'string',
      tier: 'string',
      subject: 'string',
      body: 'string',
      channel: 'string'
    }, 'send_targeted_message')

    const { supabase, organizationId, appId } = ctx
    const segment = validated.segment || 'all'
    const tier = validated.tier
    const subject = (validated.subject || '').slice(0, 100)
    const body = (validated.body || '').slice(0, 500)
    const channel = validated.channel || 'push'

    if (!subject || !body) {
      return { success: false, error: 'Subject and body are required' }
    }

    // Validate enums
    if (!['all', 'active', 'at_risk', 'churned', 'new', 'vip'].includes(segment)) {
      return { success: false, error: 'Invalid segment' }
    }
    if (channel && !['push', 'email', 'in_app'].includes(channel)) {
      return { success: false, error: 'Invalid channel' }
    }

    const targetAppId = appId || await getAppIdForOrg(supabase, organizationId)

    // Count affected members to calculate confidence
    let memberQuery = supabase
      .from('app_members')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', targetAppId)
      .is('deleted_at', null)

    // Apply segment filter
    if (segment === 'vip') {
      memberQuery = memberQuery.in('tier', ['gold', 'platinum'])
    } else if (segment === 'new') {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 14)
      memberQuery = memberQuery.gte('joined_at', cutoff.toISOString())
    }

    if (tier) {
      memberQuery = memberQuery.eq('tier', tier)
    }

    const { count } = await memberQuery

    // Calculate confidence - lower for larger audiences
    let confidence = 0.75
    if ((count || 0) > 100) confidence -= 0.1
    if ((count || 0) > 500) confidence -= 0.15
    if (segment === 'all') confidence -= 0.1  // Mass messages need approval

    // Queue the action
    const { data: queueResult, error } = await supabase.rpc('queue_ai_action', {
      p_org_id: organizationId,
      p_action_type: 'send_targeted_message',
      p_action_payload: {
        app_id: targetAppId,
        segment,
        tier,
        subject,
        body,
        channel,
        estimated_recipients: count
      },
      p_reasoning: `Send "${subject}" to ${count} ${segment} members via ${channel}`,
      p_confidence: Math.max(0.3, confidence)
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: {
        queued: true,
        action_id: queueResult?.action_id,
        status: queueResult?.status,
        confidence: Math.max(0.3, confidence),
        estimated_recipients: count,
        auto_approved: queueResult?.auto_approved,
        message: queueResult?.auto_approved
          ? `Message to ${count} members queued for automatic sending`
          : `Message to ${count} members queued for approval`
      }
    }
  },

  create_flash_promotion: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId, appId } = ctx
    const name = (input.name as string || '').slice(0, 50)
    const multiplier = Math.min((input.multiplier as number) || 2, 5)  // Cap at 5x
    const durationHours = Math.min((input.duration_hours as number) || 24, 72)  // Cap at 72 hours
    const minSpend = input.min_spend as number | undefined
    const targetSegment = (input.target_segment as string) || 'all'

    if (!name) {
      return { success: false, error: 'Promotion name is required' }
    }

    const targetAppId = appId || await getAppIdForOrg(supabase, organizationId)

    // Calculate confidence - higher multipliers need more approval
    let confidence = 0.7
    if (multiplier >= 3) confidence -= 0.15
    if (multiplier >= 4) confidence -= 0.15
    if (durationHours > 24) confidence -= 0.1
    if (targetSegment === 'all') confidence -= 0.05

    const startsAt = new Date()
    const endsAt = new Date(startsAt.getTime() + durationHours * 60 * 60 * 1000)

    const { data: queueResult, error } = await supabase.rpc('queue_ai_action', {
      p_org_id: organizationId,
      p_action_type: 'create_flash_promotion',
      p_action_payload: {
        app_id: targetAppId,
        name,
        multiplier,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        min_spend: minSpend,
        target_segment: targetSegment
      },
      p_reasoning: `${multiplier}x points promotion "${name}" for ${durationHours} hours`,
      p_confidence: Math.max(0.3, confidence)
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: {
        queued: true,
        action_id: queueResult?.action_id,
        status: queueResult?.status,
        confidence: Math.max(0.3, confidence),
        promotion_details: { name, multiplier, durationHours, targetSegment },
        auto_approved: queueResult?.auto_approved
      }
    }
  },

  award_bonus_points: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    // Validate and sanitize inputs
    const validated = validateToolInput<{
      member_ids?: string[]
      segment?: string
      points?: number
      reason?: string
    }>(input, {
      member_ids: 'array',
      segment: 'string',
      points: 'number',
      reason: 'string'
    }, 'award_bonus_points')

    const { supabase, organizationId, appId } = ctx
    const memberIds = (validated.member_ids as string[] | undefined)?.slice(0, 50)
    const segment = validated.segment
    const points = Math.min(Math.max(validated.points || 0, 1), 1000)  // 1-1000 range
    const reason = (validated.reason || '').slice(0, 100)

    if (!reason) {
      return { success: false, error: 'Reason is required' }
    }

    if (!memberIds?.length && !segment) {
      return { success: false, error: 'Either member_ids or segment is required' }
    }

    // Validate segment if provided
    if (segment && !['vip', 'new', 'at_risk', 'birthday_today'].includes(segment)) {
      return { success: false, error: 'Invalid segment' }
    }

    // Validate member_ids are valid UUIDs if provided
    if (memberIds?.length) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      for (const id of memberIds) {
        if (!uuidRegex.test(id)) {
          return { success: false, error: 'Invalid member_id format' }
        }
      }
    }

    const targetAppId = appId || await getAppIdForOrg(supabase, organizationId)

    // Calculate affected count
    let affectedCount = memberIds?.length || 0
    if (segment) {
      const { count } = await supabase
        .from('app_members')
        .select('id', { count: 'exact', head: true })
        .eq('app_id', targetAppId)
        .is('deleted_at', null)
      affectedCount = count || 0
    }

    // Calculate confidence
    let confidence = 0.75
    if (points > 200) confidence -= 0.1
    if (points > 500) confidence -= 0.15
    if (affectedCount > 50) confidence -= 0.1
    if (segment === 'all') confidence -= 0.2  // Never auto-award to all

    const { data: queueResult, error } = await supabase.rpc('queue_ai_action', {
      p_org_id: organizationId,
      p_action_type: 'award_bonus_points',
      p_action_payload: {
        app_id: targetAppId,
        member_ids: memberIds,
        segment,
        points,
        reason
      },
      p_reasoning: `Award ${points} points to ${affectedCount} members: "${reason}"`,
      p_confidence: Math.max(0.2, confidence)
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: {
        queued: true,
        action_id: queueResult?.action_id,
        status: queueResult?.status,
        confidence: Math.max(0.2, confidence),
        total_points: points * affectedCount,
        affected_members: affectedCount,
        auto_approved: queueResult?.auto_approved
      }
    }
  },

  enable_automation: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId, appId } = ctx
    const automationType = input.automation_type as string
    const enable = input.enable as boolean
    const config = input.config as Record<string, unknown> | undefined

    if (!automationType) {
      return { success: false, error: 'automation_type is required' }
    }

    const targetAppId = appId || await getAppIdForOrg(supabase, organizationId)

    // Enabling automations has higher confidence than disabling
    let confidence = enable ? 0.65 : 0.8

    const { data: queueResult, error } = await supabase.rpc('queue_ai_action', {
      p_org_id: organizationId,
      p_action_type: 'enable_automation',
      p_action_payload: {
        app_id: targetAppId,
        automation_type: automationType,
        enable,
        config
      },
      p_reasoning: `${enable ? 'Enable' : 'Disable'} ${automationType} automation`,
      p_confidence: confidence
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: {
        queued: true,
        action_id: queueResult?.action_id,
        status: queueResult?.status,
        confidence,
        action: enable ? 'enable' : 'disable',
        automation_type: automationType,
        auto_approved: queueResult?.auto_approved
      }
    }
  },

  pause_automation: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId } = ctx
    const automationId = input.automation_id as string
    const reason = input.reason as string
    const metrics = input.metrics as Record<string, unknown> | undefined

    if (!automationId || !reason) {
      return { success: false, error: 'automation_id and reason are required' }
    }

    // Get automation details first
    const { data: automation, error: fetchError } = await supabase
      .from('automation_definitions')
      .select('id, name, organization_id, is_enabled')
      .eq('id', automationId)
      .eq('organization_id', organizationId)
      .single()

    if (fetchError || !automation) {
      return { success: false, error: 'Automation not found or access denied' }
    }

    if (!automation.is_enabled) {
      return { success: false, error: 'Automation is already disabled' }
    }

    // Pause the automation
    const { error: updateError } = await supabase
      .from('automation_definitions')
      .update({
        is_enabled: false,
        paused_at: new Date().toISOString(),
        pause_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', automationId)

    if (updateError) {
      return { success: false, error: updateError.message }
    }

    // Log the pause event
    await supabase
      .from('automation_pause_events')
      .insert({
        automation_id: automationId,
        organization_id: organizationId,
        event_type: 'manual_pause',
        reason,
        metrics_snapshot: metrics ? {
          bounce_rate_pct: metrics.bounce_rate_pct,
          open_rate_pct: metrics.open_rate_pct,
          click_rate_pct: metrics.click_rate_pct,
          total_sent: metrics.total_sent
        } : null,
        triggered_by: 'ai'
      })

    return {
      success: true,
      data: {
        automation_id: automationId,
        name: automation.name,
        paused: true,
        reason
      }
    }
  },

  get_recovery_suggestions: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId } = ctx
    const minDaysPaused = (input.min_days_paused as number) || 7

    // Call the RPC function
    const { data, error } = await supabase.rpc('get_recovery_candidates', {
      p_organization_id: organizationId,
      p_min_days_paused: minDaysPaused
    })

    if (error) {
      return { success: false, error: error.message }
    }

    // For each candidate, generate a recovery suggestion
    const suggestions = (data || []).map((candidate: Record<string, unknown>) => {
      const originalFreq = (candidate.original_frequency_days as number) || 7
      const suggestedFreq = Math.max(originalFreq * 2, 7)

      return {
        automation_id: candidate.automation_id,
        name: candidate.name,
        pause_reason: candidate.pause_reason,
        days_paused: candidate.days_paused,
        recovery_attempts: candidate.recovery_attempts,
        suggested_config: {
          original_frequency_days: originalFreq,
          suggested_frequency_days: suggestedFreq,
          frequency_reduction_pct: 50
        }
      }
    })

    return {
      success: true,
      data: {
        candidates: suggestions,
        count: suggestions.length,
        min_days_paused: minDaysPaused
      }
    }
  },

  recover_automation: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId } = ctx
    const automationId = input.automation_id as string
    const newFrequencyDays = input.new_frequency_days as number | undefined

    if (!automationId) {
      return { success: false, error: 'automation_id is required' }
    }

    // Build recovery config
    const recoveryConfig = newFrequencyDays
      ? { suggested_frequency_days: newFrequencyDays }
      : null

    // Call the execute_automation_recovery RPC
    const { data, error } = await supabase.rpc('execute_automation_recovery', {
      p_automation_id: automationId,
      p_recovery_config: recoveryConfig
    })

    if (error) {
      return { success: false, error: error.message }
    }

    const result = data as Record<string, unknown>
    if (!result.success) {
      return { success: false, error: result.error as string }
    }

    return {
      success: true,
      data: {
        automation_id: result.automation_id,
        name: result.name,
        recovered: true,
        new_frequency_days: result.new_frequency_days,
        recovery_attempt: result.recovery_attempt
      }
    }
  },

  save_knowledge: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId } = ctx
    const layer = input.layer as string
    const category = input.category as string
    const fact = (input.fact as string || '').slice(0, 500)
    const importance = (input.importance as string) || 'medium'
    const confidence = Math.min(Math.max((input.confidence as number) || 0.8, 0), 1)

    if (!layer || !category || !fact) {
      return { success: false, error: 'layer, category, and fact are required' }
    }

    // Knowledge saving doesn't need approval queue - execute directly
    const { data, error } = await supabase
      .from('business_knowledge')
      .insert({
        organization_id: organizationId,
        layer,
        category,
        fact,
        importance,
        confidence,
        source_type: 'conversation',
        status: 'active'
      })
      .select('id')
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: {
        saved: true,
        knowledge_id: data?.id,
        layer,
        category,
        importance
      }
    }
  },

  // ── CEO: read_own_revenue ────────────────────────────────────────────
  read_own_revenue: async (_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase } = ctx
    const periodDays = Math.min((_input.period_days as number) || 30, 90)
    const since = new Date()
    since.setDate(since.getDate() - periodDays)

    try {
      // Query organizations table for subscription data stored via Stripe webhooks
      const { data: orgs, error } = await supabase
        .from('organizations')
        .select('id, name, plan_type, stripe_subscription_id, stripe_customer_id, created_at, is_lifetime')
        .not('stripe_subscription_id', 'is', null)

      if (error) throw error

      const active = (orgs || []).filter((o: Record<string, unknown>) => o.plan_type && o.plan_type !== 'free')
      const newThisPeriod = (orgs || []).filter((o: Record<string, unknown>) => {
        return o.created_at && new Date(o.created_at as string) >= since
      })

      // Estimate MRR from plan types (real Stripe MRR would require Stripe API call)
      const PLAN_MRR: Record<string, number> = {
        pro: 299,
        max: 749,
        royalty_pro: 79,
        lifetime: 0, // LTD
      }
      const estimatedMrr = active.reduce((sum: number, o: Record<string, unknown>) => {
        return sum + (PLAN_MRR[o.plan_type as string] || 0)
      }, 0)

      return {
        success: true,
        data: {
          active_subscriptions: active.length,
          estimated_mrr_usd: estimatedMrr,
          new_orgs_this_period: newThisPeriod.length,
          period_days: periodDays,
          note: 'MRR is estimated from plan types. Connect Stripe API for exact billing data.',
          plan_breakdown: active.reduce((acc: Record<string, number>, o: Record<string, unknown>) => {
            const plan = (o.plan_type as string) || 'unknown'
            acc[plan] = (acc[plan] || 0) + 1
            return acc
          }, {}),
        }
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },

  // ── CEO: read_trial_users ────────────────────────────────────────────
  read_trial_users: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase } = ctx
    const daysSince = Math.max((input.days_since_signup as number) || 3, 1)
    const limit = Math.min((input.limit as number) || 20, 50)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - daysSince)

    try {
      // Get orgs with no plan (free/trial) created before the cutoff
      const { data: orgs, error } = await supabase
        .from('organizations')
        .select('id, name, created_at, plan_type')
        .or('plan_type.is.null,plan_type.eq.free')
        .lte('created_at', cutoff.toISOString())
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error

      // For each org, check if they have a customer app (activation signal)
      const orgIds = (orgs || []).map((o: Record<string, unknown>) => o.id)
      const { data: apps } = await supabase
        .from('customer_apps')
        .select('organization_id')
        .in('organization_id', orgIds)

      const activatedOrgIds = new Set((apps || []).map((a: Record<string, unknown>) => a.organization_id))

      const unactivated = (orgs || []).filter((o: Record<string, unknown>) => !activatedOrgIds.has(o.id))

      return {
        success: true,
        data: {
          unactivated_trials: unactivated.map((o: Record<string, unknown>) => ({
            org_id: o.id,
            name: o.name,
            signed_up: o.created_at,
            days_since_signup: Math.floor((Date.now() - new Date(o.created_at as string).getTime()) / 86400000),
          })),
          total_unactivated: unactivated.length,
          days_threshold: daysSince,
        }
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },

  // ── CEO: read_content_queue ──────────────────────────────────────────
  read_content_queue: async (_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase } = ctx

    try {
      const [draftsRes, publishedRes] = await Promise.all([
        supabase
          .from('newsletter_articles')
          .select('id, title, status, created_at')
          .eq('status', 'draft')
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('newsletter_articles')
          .select('id, published_at')
          .eq('status', 'published')
          .order('published_at', { ascending: false })
          .limit(1),
      ])

      const lastPublished = publishedRes.data?.[0]?.published_at
      const daysSincePublish = lastPublished
        ? Math.floor((Date.now() - new Date(lastPublished).getTime()) / 86400000)
        : null

      return {
        success: true,
        data: {
          drafts_count: draftsRes.data?.length || 0,
          drafts: (draftsRes.data || []).map((a: Record<string, unknown>) => ({
            id: a.id,
            title: a.title,
            status: a.status,
            created_at: a.created_at,
          })),
          last_published_at: lastPublished || null,
          days_since_last_publish: daysSincePublish,
          recommendation: daysSincePublish === null
            ? 'No articles published yet'
            : daysSincePublish >= 5
              ? `${daysSincePublish} days since last publish — content gap detected`
              : `On track — last published ${daysSincePublish} day(s) ago`,
        }
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },

  // ── CEO: log_growth_action ───────────────────────────────────────────
  log_growth_action: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase } = ctx
    const actionType = (input.action_type as string || '').slice(0, 100)
    const description = (input.description as string || '').slice(0, 500)
    const status = (input.status as string) || 'completed'

    if (!actionType || !description) {
      return { success: false, error: 'action_type and description are required' }
    }

    try {
      const { data, error } = await supabase
        .from('self_growth_log')
        .insert({ action_type: actionType, description, status })
        .select('id')
        .single()

      if (error) throw error

      return { success: true, data: { logged: true, id: data?.id } }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },

  // ── CEO: log_task ────────────────────────────────────────────────────
  log_task: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase } = ctx
    const title = (input.title as string || '').slice(0, 100)
    const description = (input.description as string || '').slice(0, 500)

    if (!title) return { success: false, error: 'title is required' }

    try {
      const { data, error } = await supabase
        .from('royal_tasks')
        .insert({ title, description: description || null, status: 'active' })
        .select('id')
        .single()

      if (error) throw error
      return { success: true, data: { logged: true, id: data?.id } }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },

  // ── CEO: request_help ────────────────────────────────────────────────
  request_help: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase } = ctx
    const title = (input.title as string || '').slice(0, 100)
    const blockerDescription = (input.blocker_description as string || '').slice(0, 500)
    const blockerType = (input.blocker_type as string) || 'other'

    if (!title || !blockerDescription) {
      return { success: false, error: 'title and blocker_description are required' }
    }

    try {
      const { data, error } = await supabase
        .from('royal_tasks')
        .insert({ title, status: 'blocked', blocker_type: blockerType, blocker_description: blockerDescription })
        .select('id')
        .single()

      if (error) throw error
      return { success: true, data: { blocked: true, id: data?.id, message: 'Blocker recorded — Jay will see this in the CEO dashboard Tasks panel.' } }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },

  // ── CEO: queue_outreach ───────────────────────────────────────────────
  queue_outreach: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase } = ctx
    const targetEmail = input.target_email as string
    const subject     = input.subject as string
    const bodyText    = input.body_text as string
    const rationale   = input.rationale as string

    if (!targetEmail || !subject || !bodyText || !rationale) {
      return { success: false, error: 'target_email, subject, body_text, and rationale are required' }
    }

    const vetoWindowEnds = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    try {
      const { error } = await supabase.from('outreach_queue').insert({
        target_email:     targetEmail,
        target_name:      (input.target_name as string) || null,
        channel:          (input.channel as string) || 'email',
        subject,
        body_html:        (input.body_html as string) || `<p>${bodyText.replace(/\n/g, '</p><p>')}</p>`,
        body_text:        bodyText,
        rationale,
        status:           'draft',
        veto_window_ends: vetoWindowEnds,
      })
      if (error) throw error
      return { success: true, data: { queued: true, message: "Queued for approval. Jay will see this in CEO Dashboard → Today's Plan. 2-hour veto window before auto-send." } }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },

  // ── CEO: trigger_article_generation ─────────────────────────────────
  trigger_article_generation: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase } = ctx
    const topicTitleRaw = input.topic_title as string | undefined
    const keywordRaw = input.keyword as string | undefined
    const descriptionRaw = input.description as string | undefined

    const fnUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    try {
      // Find the admin org's newsletter app
      const { data: adminProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('is_admin', true)
        .limit(1)
        .single()

      if (!adminProfile) return { success: false, error: 'Admin profile not found' }

      const { data: adminMembership } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', adminProfile.id)
        .eq('role', 'owner')
        .single()

      if (!adminMembership) return { success: false, error: 'Admin org not found' }

      const { data: newsletterApp } = await supabase
        .from('customer_apps')
        .select('id, name')
        .eq('organization_id', adminMembership.organization_id)
        .eq('app_type', 'newsletter')
        .single()

      if (!newsletterApp) return { success: false, error: 'No newsletter app found. Create one at /app/apps.html first.' }

      // Build topic — use provided or auto-pick from content strategy
      let topic = {
        id: 'auto-' + Date.now(),
        title: topicTitleRaw || '',
        description: descriptionRaw || '',
        topic: keywordRaw || 'customer-retention',
      }

      if (!topicTitleRaw) {
        // Auto-pick: find next unwritten topic from content_strategies
        const { data: strategy } = await supabase
          .from('content_strategies')
          .select('topic_calendar')
          .eq('app_id', newsletterApp.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (strategy?.topic_calendar?.length) {
          const { data: existingArticles } = await supabase
            .from('newsletter_articles')
            .select('slug')
            .eq('app_id', newsletterApp.id)

          const existingSlugs = new Set((existingArticles || []).map((a: { slug: string }) => a.slug))
          type TopicItem = { slug?: string; title: string; description?: string; pillar?: string }
          const nextTopic = (strategy.topic_calendar as TopicItem[]).find(t => !existingSlugs.has(t.slug || ''))

          if (nextTopic) {
            topic = {
              id: nextTopic.slug || 'auto-' + Date.now(),
              title: nextTopic.title,
              description: nextTopic.description || '',
              topic: nextTopic.pillar || 'customer-retention',
            }
          }
        }

        // Final fallback if still no title
        if (!topic.title) {
          topic.title = 'How AI Loyalty Programs Help Small Businesses Compete with Big Chains'
          topic.topic = 'ai-loyalty'
        }
      }

      // Royalty brand context (hardcoded — this is always for Royalty's own blog)
      const royaltyContext = {
        business_name: 'Royalty',
        story: {
          origin: 'Built so local businesses could compete with the retention tools only big chains could afford',
          mission: 'Make every local business irreplaceable to its community through AI-powered loyalty',
          differentiator: 'The only loyalty platform where AI runs the program for you — 60 seconds to launch',
        },
        audience: {
          primary: 'Small business owners (coffee shops, restaurants, gyms, salons, retail)',
          pain_points: ['Competing with big chains', 'Customer retention', 'No time for marketing', 'Loyalty programs too complex'],
          aspirations: ['Keep regulars coming back', 'Grow a loyal community', 'Automate customer engagement'],
        },
        voice: {
          personality: 'Smart and warm, like advice from a founder friend who built this thing',
          tone: 'Direct and practical, never corporate',
          avoid: ['jargon', 'synergy', 'leverage', 'disrupt', 'game-changer', 'seamless'],
        },
      }

      // Call generate-article
      const genResponse = await fetch(`${fnUrl}/functions/v1/generate-article`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          topic,
          context: royaltyContext,
          app_id: newsletterApp.id,
          organization_id: adminMembership.organization_id,
        }),
      })

      if (!genResponse.ok) {
        const errText = await genResponse.text()
        return { success: false, error: `generate-article failed: ${genResponse.status} — ${errText.slice(0, 200)}` }
      }

      const genResult = await genResponse.json()
      if (!genResult.success || !genResult.article) {
        return { success: false, error: 'generate-article returned no article' }
      }

      const article = genResult.article

      // Save to newsletter_articles as draft
      const { data: saved, error: saveError } = await supabase
        .from('newsletter_articles')
        .insert({
          app_id: newsletterApp.id,
          title: article.title,
          slug: article.slug,
          excerpt: article.excerpt,
          content: article.content,
          meta_title: article.meta_title,
          meta_description: article.meta_description,
          primary_topic: article.primary_topic,
          tags: article.tags,
          status: 'draft',
          language: 'en',
        })
        .select('id, title, slug')
        .single()

      if (saveError) return { success: false, error: `Failed to save draft: ${saveError.message}` }

      // Log the growth action
      await supabase.from('self_growth_log').insert({
        action_type: 'content_published',
        description: `Generated article draft: "${article.title}" — quality score ${article.quality_score?.total ?? 'N/A'}`,
        status: 'completed',
        metadata: { article_id: saved?.id, slug: article.slug, quality_score: article.quality_score },
      })

      return {
        success: true,
        data: {
          article_id: saved?.id,
          title: article.title,
          slug: article.slug,
          quality_score: article.quality_score?.total,
          status: 'draft',
          review_url: '/app/blog-review.html',
          message: `Draft saved: "${article.title}". Quality score: ${article.quality_score?.total ?? 'N/A'}/100. Ready for review at /app/blog-review.html`,
        },
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },
}

/**
 * Execute a tool with timeout protection
 */
async function executeToolWithTimeout(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
  timeoutMs: number
): Promise<ToolResult> {
  const handler = TOOL_HANDLERS[toolName]

  if (!handler) {
    return { success: false, error: `Unknown tool: ${toolName}` }
  }

  return Promise.race([
    handler(input, ctx),
    new Promise<ToolResult>((_, reject) =>
      setTimeout(() => reject(new Error('Tool execution timeout')), timeoutMs)
    )
  ])
}

/**
 * Check if a tool is an external research tool
 */
function isExternalTool(toolName: string): boolean {
  return toolName.startsWith('search_')
}

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

// ============================================================================
// KNOWLEDGE MANAGEMENT FUNCTIONS
// ============================================================================

// Load accumulated business knowledge for an organization
async function loadBusinessKnowledge(
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
async function loadBusinessProfile(
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
async function getNextDiscoveryQuestion(
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
async function markQuestionAsked(
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
function extractKnowledgeFromText(
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
async function saveExtractedKnowledge(
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
function buildKnowledgeContextSection(
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
function buildDiscoveryPromptAddition(question: DiscoveryQuestion | null): string {
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

interface SessionDiscoveryState {
  questionsAskedThisSession: number
  lastQuestionId: string | null
  pendingQuestionId: string | null
}

interface AnswerDetectionResult {
  isAnswer: boolean
  answerText: string | null
  confidence: number
}

// Detect if user explicitly wants to skip/defer a question
function detectDeferral(userMessage: string): 'skip' | 'defer' | null {
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
function detectConversationContext(
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
function detectDiscoveryAnswer(
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
async function getSessionDiscoveryState(
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
async function getPendingQuestionById(
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
async function handleQuestionOutcome(
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
async function getNextDiscoveryQuestionV2(
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

// Guard against oversized system prompts (knowledge accumulation can exceed context limits)
function truncateSystemPrompt(prompt: string, maxChars: number = 12000): string {
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
function buildSystemPrompt(
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
7. For established businesses, focus on retention and optimization${discoveryPrompt}`
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
- Royal's job is to grow Royalty's business, not build Royalty's platform (Jay does that)`

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
        organizationId: ceoMembership?.organization_id || user.id,
        appId: undefined,
      }

      const formatted = messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: String(m.content || '').slice(0, 5000),
      }))

      const result = await callClaudeWithTools(ceoSystemPrompt, formatted, ceoCtx, 4000, MODEL_SONNET)

      const responseText = result.text ||
        (result.toolsUsed.length > 0
          ? `Data retrieved via ${result.toolsUsed.join(', ')}. Ask a follow-up question for details.`
          : 'No response generated. Please try again.')

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
            : 'Something went wrong. Please try again.',
        ideas: [],
        follow_up_questions: ['What would you like to know about your business?']
      }),
      { status: isTooLarge ? 413 : (isTimeout ? 504 : 500), headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
