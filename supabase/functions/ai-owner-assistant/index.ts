// Supabase Edge Function: AI Owner Assistant
// Helps business owners with dashboard questions, analytics, and feature guidance
// SECURE: API key stored in Supabase secrets, not exposed to frontend

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Rate limits for owner assistant (per user per hour)
const OWNER_ASSISTANT_LIMIT = 30

interface AssistantRequest {
  user_id: string
  organization_id: string
  message: string
  context?: 'dashboard' | 'rewards' | 'automations' | 'customers' | 'settings' | 'general'
}

interface BusinessContext {
  organization: {
    name: string
    plan_type: string
    created_at: string
  }
  apps: Array<{
    id: string
    name: string
    slug: string
    member_count: number
    settings: Record<string, unknown>
  }>
  stats: {
    total_members: number
    total_visits_today: number
    total_rewards_redeemed: number
    active_campaigns: number
  }
  recentActivity: Array<{
    type: string
    description: string
    created_at: string
  }>
}

// Call Claude API
async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 1500
): Promise<string> {
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
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return data.content[0].text
}

// Build system prompt with business context
function buildSystemPrompt(context: BusinessContext, questionContext?: string): string {
  const { organization, apps, stats, recentActivity } = context

  // Format apps info
  const appsInfo = apps.length > 0
    ? apps.map(a => `- ${a.name} (${a.member_count} members, slug: ${a.slug})`).join('\n')
    : 'No loyalty apps created yet.'

  // Format recent activity
  const activityInfo = recentActivity.length > 0
    ? recentActivity.slice(0, 5).map(a => `- ${a.type}: ${a.description}`).join('\n')
    : 'No recent activity.'

  return `You are a helpful AI assistant for Royalty, a loyalty program platform for local businesses.

## Your Role
- Help business owners use the Royalty dashboard effectively
- Answer questions about features, settings, and best practices
- Provide actionable guidance with specific steps
- Be friendly, professional, and concise

## Current Business Context
**Organization:** ${organization.name}
**Plan:** ${organization.plan_type}
**Member since:** ${new Date(organization.created_at).toLocaleDateString()}

**Loyalty Apps:**
${appsInfo}

**Quick Stats:**
- Total Members: ${stats.total_members}
- Visits Today: ${stats.total_visits_today}
- Rewards Redeemed: ${stats.total_rewards_redeemed}
- Active Campaigns: ${stats.active_campaigns}

**Recent Activity:**
${activityInfo}

${questionContext ? `**Question Context:** The user is asking about ${questionContext}.` : ''}

## Royalty Features You Can Help With

### Dashboard
- Overview of business metrics
- Quick actions and shortcuts
- Activity feed

### Intelligence (AI Features)
- AI recommendations feed
- Auto-pilot vs manual approve modes
- Automated campaigns (win-back, birthday, streaks, milestones)

### Rewards Management
- Creating and editing rewards
- Setting point costs
- Tier-exclusive rewards
- Active/inactive status

### Customer Management
- Viewing member list
- Customer segments
- Points adjustments
- Member profiles

### Automations
- Setting up automated campaigns
- Win-back campaigns (inactive customers)
- Birthday rewards
- Streak bonuses
- Milestone celebrations

### Settings
- Business hours
- AI settings
- Team management
- Billing

## Response Guidelines
1. Give specific, actionable steps
2. Reference actual UI elements (tabs, buttons, sections)
3. If you don't know something, say so
4. Keep responses focused and under 200 words unless more detail is needed
5. Use numbered steps for instructions
6. Suggest related features they might find helpful`
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

    const { user_id, organization_id, message, context: questionContext } = await req.json() as AssistantRequest

    if (!user_id || !organization_id || !message) {
      throw new Error('Missing required fields: user_id, organization_id, message')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ===== VERIFY USER ACCESS =====
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('user_id', user_id)
      .eq('organization_id', organization_id)
      .single()

    if (!membership) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Not authorized to access this organization'
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ===== RATE LIMITING =====
    const { data: rateCheck } = await supabase.rpc('check_and_record_rate_limit', {
      p_identifier: user_id,
      p_action_type: 'owner_assistant_chat',
      p_max_requests: OWNER_ASSISTANT_LIMIT,
      p_window_minutes: 60
    })

    if (rateCheck === false) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Too many requests. Please wait a few minutes.',
          rate_limited: true
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ===== LOAD BUSINESS CONTEXT =====
    // Organization info
    const { data: org } = await supabase
      .from('organizations')
      .select('name, plan_type, created_at, settings')
      .eq('id', organization_id)
      .single()

    if (!org) {
      throw new Error('Organization not found')
    }

    // Apps with member counts
    const { data: apps } = await supabase
      .from('customer_apps')
      .select(`
        id, name, slug, settings,
        app_members(count)
      `)
      .eq('organization_id', organization_id)
      .eq('is_active', true)

    const appsWithCounts = (apps || []).map(app => ({
      id: app.id,
      name: app.name,
      slug: app.slug,
      settings: app.settings || {},
      member_count: app.app_members?.[0]?.count || 0
    }))

    // Get aggregated stats
    const totalMembers = appsWithCounts.reduce((sum, app) => sum + app.member_count, 0)

    // Today's visits
    const today = new Date().toISOString().split('T')[0]
    const { count: visitsToday } = await supabase
      .from('member_visits')
      .select('*', { count: 'exact', head: true })
      .gte('visited_at', today)
      .in('app_id', appsWithCounts.map(a => a.id))

    // Total redemptions
    const { count: redemptions } = await supabase
      .from('reward_redemptions')
      .select('*', { count: 'exact', head: true })
      .in('app_id', appsWithCounts.map(a => a.id))

    // Active campaigns
    const { count: activeCampaigns } = await supabase
      .from('automated_campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organization_id)
      .eq('is_enabled', true)

    // Recent activity (from audit log)
    const { data: recentActivity } = await supabase
      .from('audit_log')
      .select('action, entity_type, created_at')
      .eq('organization_id', organization_id)
      .order('created_at', { ascending: false })
      .limit(10)

    const formattedActivity = (recentActivity || []).map(a => ({
      type: a.entity_type,
      description: a.action,
      created_at: a.created_at
    }))

    const businessContext: BusinessContext = {
      organization: {
        name: org.name,
        plan_type: org.plan_type || 'free',
        created_at: org.created_at
      },
      apps: appsWithCounts,
      stats: {
        total_members: totalMembers,
        total_visits_today: visitsToday || 0,
        total_rewards_redeemed: redemptions || 0,
        active_campaigns: activeCampaigns || 0
      },
      recentActivity: formattedActivity
    }

    // ===== GENERATE AI RESPONSE =====
    const systemPrompt = buildSystemPrompt(businessContext, questionContext)
    const aiResponse = await callClaude(systemPrompt, message)

    // ===== LOG THE INTERACTION =====
    await supabase.from('audit_log').insert({
      user_id,
      organization_id,
      action: 'ai_assistant_query',
      entity_type: 'ai_owner_assistant',
      entity_id: null,
      changes: {
        question_context: questionContext || 'general',
        message_length: message.length,
        response_length: aiResponse.length
      }
    })

    // ===== RETURN RESPONSE =====
    return new Response(
      JSON.stringify({
        success: true,
        response: aiResponse,
        context: {
          organization: org.name,
          apps_count: appsWithCounts.length,
          total_members: totalMembers
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Owner Assistant error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        response: "I'm having trouble right now. Please try again or check the help documentation."
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
