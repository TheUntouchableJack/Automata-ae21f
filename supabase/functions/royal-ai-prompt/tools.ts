// Royal AI Prompt — Tool Definitions & Handlers
// All 23 tools available to Royal AI, plus validation and execution

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { webSearch, saveResearchFindings, extractInsights } from '../_shared/web-search.ts'
import type { ClaudeTool, ToolContext, ToolResult, ToolHandler } from './types.ts'
import { TOOL_USE_CONFIG, log, sanitizeContextInput } from './types.ts'

export const ROYAL_AI_TOOLS: ClaudeTool[] = [
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
        },
        target_type: {
          type: 'string',
          enum: ['app_members', 'organizations', 'all'],
          description: 'Filter by target type. app_members = customer automations, organizations = business-targeting automations, all = both. Default: all'
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
        },
        target_type: {
          type: 'string',
          enum: ['app_members', 'organizations'],
          description: 'Who this automation targets. app_members = loyalty customers (default). organizations = business accounts (for platform-level automations like onboarding drips, win-back sequences).'
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
    name: 'create_reward_proposal',
    description: 'Propose a new loyalty reward for the business. Use when you identify a reward opportunity based on business knowledge, customer behavior, or industry benchmarks. The owner will review and approve before it goes live.',
    input_schema: {
      type: 'object',
      properties: {
        reward_name: {
          type: 'string',
          description: 'Name of the proposed reward'
        },
        description: {
          type: 'string',
          description: 'What the customer gets'
        },
        points_cost: {
          type: 'number',
          description: 'Points required to redeem'
        },
        category: {
          type: 'string',
          description: 'Category: food, drink, discount, experience, merchandise'
        },
        reasoning: {
          type: 'string',
          description: 'Why this reward would help the business (shown to owner)'
        }
      },
      required: ['reward_name', 'points_cost', 'reasoning']
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
    description: "Draft an outreach email or SMS and queue it for Jay's approval. Use target_org_id (preferred) to contact a Royalty customer — email and phone are looked up automatically from the DB. Use target_email/target_phone only for external contacts not in the DB. Items appear in CEO Dashboard → Today's Plan with a 2-hour veto window.",
    input_schema: {
      type: 'object',
      properties: {
        target_org_id: { type: 'string', description: 'Organization ID of the Royalty customer (preferred — email/phone looked up automatically from DB). ALWAYS use this for Royalty customers instead of guessing email/phone.' },
        target_email:  { type: 'string', description: 'Recipient email address (only for external contacts not in DB)' },
        target_phone:  { type: 'string', description: 'Recipient phone number for SMS (only for external contacts not in DB; for Royalty customers use target_org_id)' },
        target_name:   { type: 'string', description: 'Recipient name or org name' },
        subject:       { type: 'string', description: 'Email subject line (not used for SMS)' },
        body_text:     { type: 'string', description: 'Plain text message body' },
        body_html:     { type: 'string', description: 'HTML email body (optional, email only)' },
        rationale:     { type: 'string', description: "Why this outreach makes sense — shown to Jay in the approval queue" },
        channel:       { type: 'string', enum: ['email', 'sms'], description: 'Delivery channel (default: email)' },
      },
      required: ['body_text', 'rationale'],
    }
  },
  {
    name: 'queue_blog_draft',
    description: "Propose a blog article for Royalty's website and queue it for Jay's approval. Use when identifying a high-value SEO or content opportunity, or when Jay asks you to plan a post. The proposal appears in CEO Dashboard → Blog Proposals. Jay must approve before article generation starts. Use this instead of trigger_article_generation when you want Jay to review the topic first.",
    input_schema: {
      type: 'object',
      properties: {
        title:     { type: 'string', description: 'Proposed article title' },
        topic:     { type: 'string', description: 'Core topic or target keyword' },
        outline:   { type: 'string', description: 'Brief outline or key points to cover (shown to Jay)' },
        rationale: { type: 'string', description: 'Why this is a high-value content opportunity — shown to Jay in the approval queue' },
      },
      required: ['title', 'topic', 'rationale'],
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
export const TOOL_HANDLERS: Record<string, ToolHandler> = {
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
    const targetTypeFilter = (input.target_type as string) || 'all'

    const targetAppId = appId || await getAppIdForOrg(supabase, organizationId)

    // Query legacy automations table
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

    // Also query automation_definitions (lifecycle automations)
    let defQuery = supabase
      .from('automation_definitions')
      .select('id, name, description, category, trigger_type, trigger_event, action_type, action_config, target_type, sequence_key, sequence_step, is_enabled, is_archived, trigger_count, success_count, failure_count, created_at')
      .or(`organization_id.eq.${organizationId},organization_id.is.null`)
      .eq('is_archived', false)

    if (status === 'active') {
      defQuery = defQuery.eq('is_enabled', true)
    } else if (status === 'inactive') {
      defQuery = defQuery.eq('is_enabled', false)
    }

    if (targetTypeFilter !== 'all') {
      defQuery = defQuery.eq('target_type', targetTypeFilter)
    }

    const { data: definitions } = await defQuery

    // Get performance metrics if enabled
    let performanceData: Record<string, unknown>[] = []
    let rankings: Record<string, unknown> | null = null

    if (includePerformance) {
      const { data: perfData } = await supabase.rpc('get_automation_performance_with_correlation', {
        p_organization_id: organizationId,
        p_app_id: targetAppId || null,
        p_days: days
      })
      performanceData = perfData || []

      const { data: rankData } = await supabase.rpc('get_automation_rankings', {
        p_organization_id: organizationId,
        p_days: days
      })
      rankings = rankData || null
    }

    const perfMap = new Map(performanceData.map((p: Record<string, unknown>) =>
      [p.automation_id as string, p]
    ))

    // Enhance legacy automations
    const enhancedAutomations = (automations || []).map(a => {
      const perf = perfMap.get(a.id)
      return {
        ...a,
        source: 'legacy',
        target_type: 'app_members',
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

    // Enhance lifecycle automations
    const enhancedDefinitions = (definitions || []).map(d => ({
      ...d,
      source: 'lifecycle',
      is_active: d.is_enabled,
      performance: perfMap.get(d.id) ? {
        trigger_count: (perfMap.get(d.id) as Record<string, unknown>).trigger_count,
        success_rate_pct: (perfMap.get(d.id) as Record<string, unknown>).success_rate_pct,
      } : { trigger_count: d.trigger_count, success_rate_pct: d.trigger_count > 0 ? Math.round((d.success_count / d.trigger_count) * 100) : 0 }
    }))

    // Filter legacy automations by target_type if needed
    const filteredLegacy = targetTypeFilter === 'organizations' ? [] : enhancedAutomations

    const allAutomations = [...filteredLegacy, ...enhancedDefinitions]

    const summary = {
      total_automations: allAutomations.length,
      active: allAutomations.filter(a => a.is_active || a.is_enabled).length,
      by_target: {
        app_members: allAutomations.filter(a => (a.target_type || 'app_members') === 'app_members').length,
        organizations: allAutomations.filter(a => a.target_type === 'organizations').length,
      },
      by_category: (definitions || []).reduce((acc, d) => {
        acc[d.category] = (acc[d.category] || 0) + 1
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
        automations: allAutomations,
        performance_period_days: days
      },
      metadata: { rowCount: allAutomations.length }
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
    const targetType = (input.target_type as string) || 'app_members'

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
        app_id: targetType === 'organizations' ? null : targetAppId,
        name,
        description,
        category,
        trigger,
        action,
        limits,
        auto_enable: autoEnable,
        target_type: targetType
      },
      p_reasoning: `Create custom automation: "${name}" — ${description || category} (targets: ${targetType})`,
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

  // ── create_reward_proposal ──────────────────────────────────────────
  create_reward_proposal: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase, organizationId, appId } = ctx
    const rewardName = (input.reward_name as string || '').slice(0, 200)
    const description = (input.description as string || '').slice(0, 500)
    const pointsCost = input.points_cost as number
    const category = (input.category as string) || null
    const reasoning = (input.reasoning as string || '').slice(0, 500)

    if (!rewardName || !pointsCost || !reasoning) {
      return { success: false, error: 'reward_name, points_cost, and reasoning are required' }
    }

    if (pointsCost < 1 || pointsCost > 10000) {
      return { success: false, error: 'points_cost must be between 1 and 10,000' }
    }

    const targetAppId = appId || await getAppIdForOrg(supabase, organizationId)
    if (!targetAppId) {
      return { success: false, error: 'No loyalty app found for this organization' }
    }

    const { data, error } = await supabase
      .from('reward_suggestions')
      .insert({
        app_id: targetAppId,
        organization_id: organizationId,
        member_id: null,
        reward_name: rewardName,
        description: description || null,
        suggested_points: pointsCost,
        category: category,
        source_type: 'ai_proactive',
        ai_proposal: {
          reward_name: rewardName,
          description: description || '',
          points_cost: pointsCost,
          category: category || '',
          reasoning: reasoning
        },
        status: 'new'
      })
      .select('id')
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: {
        suggestion_id: data?.id,
        reward_name: rewardName,
        points_cost: pointsCost,
        message: 'Reward proposal created. The owner will see it in the Suggestions tab for review.'
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
    const inputOrgId = input.target_org_id as string | undefined
    const channel    = (input.channel as string) || 'email'
    let targetEmail  = input.target_email as string | undefined
    let targetPhone  = input.target_phone as string | undefined

    if (!inputOrgId && !targetEmail && !targetPhone) {
      return { success: false, error: 'Provide target_org_id (for Royalty customers) or target_email/target_phone (for external contacts)' }
    }

    // Auto-lookup contact info from org
    if (inputOrgId) {
      if (channel === 'email' && !targetEmail) {
        const { data: mem } = await supabase
          .from('organization_members')
          .select('user_id, profiles(email)')
          .eq('organization_id', inputOrgId)
          .eq('role', 'owner')
          .single()
        targetEmail = (mem as any)?.profiles?.email
        if (!targetEmail) return { success: false, error: `No owner email found for org ${inputOrgId}` }
      }
      if (channel === 'sms' && !targetPhone) {
        const { data: mem } = await supabase
          .from('organization_members')
          .select('user_id, profiles(email)')
          .eq('organization_id', inputOrgId)
          .eq('role', 'owner')
          .single()
        const ownerEmail = (mem as any)?.profiles?.email
        if (ownerEmail) {
          const { data: customer } = await supabase
            .from('customers')
            .select('phone')
            .ilike('email', ownerEmail)
            .not('phone', 'is', null)
            .limit(1)
            .single()
          targetPhone = (customer as any)?.phone
        }
        if (!targetPhone) {
          return {
            success: false,
            error: `No phone number on file for this customer. To enable SMS outreach, Jay needs to collect their phone number first. Consider asking Jay: "Can you get a phone number for this org so we can reach them via SMS?"`
          }
        }
      }
    }

    const to        = channel === 'sms' ? targetPhone! : targetEmail!
    const subject   = input.subject as string
    const bodyText  = input.body_text as string
    const rationale = input.rationale as string

    if (!to || !bodyText || !rationale) {
      return { success: false, error: 'body_text and rationale are required, plus a valid target' }
    }

    const vetoWindowEnds = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    try {
      const { error } = await supabase.from('outreach_queue').insert({
        target_email:     channel === 'email' ? to : (targetEmail || null),
        target_phone:     channel === 'sms' ? to : (targetPhone || null),
        target_org_id:    inputOrgId || null,
        target_name:      (input.target_name as string) || null,
        channel,
        subject:          subject || null,
        body_html:        (input.body_html as string) || `<p>${bodyText.replace(/\n/g, '</p><p>')}</p>`,
        body_text:        bodyText,
        rationale,
        status:           'draft',
        veto_window_ends: vetoWindowEnds,
      })
      if (error) throw error
      return { success: true, data: { queued: true, to, channel, message: "Queued for approval. Jay will see this in CEO Dashboard → Today's Plan. 2-hour veto window before auto-send." } }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },

  // ── CEO: queue_blog_draft ─────────────────────────────────────────────
  queue_blog_draft: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { supabase } = ctx
    const title     = input.title as string
    const topic     = input.topic as string
    const rationale = input.rationale as string

    if (!title || !topic || !rationale) {
      return { success: false, error: 'title, topic, and rationale are required' }
    }

    try {
      const { error } = await supabase.from('content_queue').insert({
        action_type:      'blog_post',
        title,
        topic,
        outline:          (input.outline as string) || null,
        rationale,
        status:           'draft',
        veto_window_ends: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      })
      if (error) throw error
      return { success: true, data: { queued: true, message: "Blog proposal queued for Jay's approval. Visible in CEO Dashboard → Blog Proposals. Jay approves → article generation starts automatically." } }
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
export async function executeToolWithTimeout(
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
export function isExternalTool(toolName: string): boolean {
  return toolName.startsWith('search_')
}
