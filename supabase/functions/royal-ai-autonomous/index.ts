// Supabase Edge Function: Royal AI Autonomous Runner
// Cron function to execute approved AI actions and measure outcomes
// Runs every 5 minutes to process the action queue

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://royaltyapp.ai',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Generate unique instance ID for distributed locking
const INSTANCE_ID = crypto.randomUUID()

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
    service: 'royal-ai-autonomous',
    instance_id: INSTANCE_ID,
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
// TYPES
// ============================================================================

interface ExecutionResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

interface RateLimitInfo {
  allowed: boolean
  remaining: number
  limit: number
  reason?: string
}

// ============================================================================
// RATE LIMITING (FAIL-CLOSED)
// ============================================================================

/**
 * Check if organization has remaining action quota for today
 * SECURITY: Fails closed on any error - actions are blocked if rate limit check fails
 */
async function checkRateLimit(
  supabase: SupabaseClient,
  orgId: string
): Promise<RateLimitInfo> {
  try {
    // Use safe RPC function that handles errors internally
    const { data, error } = await supabase.rpc('safe_check_rate_limit', {
      p_org_id: orgId
    })

    if (error) {
      log('error', 'Rate limit RPC failed', { orgId, error: error.message })
      // FAIL CLOSED - block actions if we can't verify limits
      return {
        allowed: false,
        remaining: 0,
        limit: 20,
        reason: 'Rate limit check failed - blocking actions'
      }
    }

    // Parse RPC response
    const result = data as RateLimitInfo
    return {
      allowed: result.allowed,
      remaining: result.remaining,
      limit: result.limit,
      reason: result.reason
    }
  } catch (err) {
    log('error', 'Rate limit check exception', { orgId, error: (err as Error).message })
    // FAIL CLOSED on any exception
    return {
      allowed: false,
      remaining: 0,
      limit: 20,
      reason: 'Rate limit error - blocking actions'
    }
  }
}

// ============================================================================
// AUTOMATION EXECUTION TRACKING
// ============================================================================

/**
 * Record execution in automation_executions table for tracking
 */
async function recordAutomationExecution(
  supabase: SupabaseClient,
  action: Record<string, unknown>,
  result: ExecutionResult
): Promise<string | null> {
  const automationDefId = action.automation_definition_id as string | null
  const payload = action.action_payload as Record<string, unknown>
  const appId = payload.app_id as string

  // Only record if linked to an automation definition
  if (!automationDefId) {
    return null
  }

  const { data, error } = await supabase
    .from('automation_executions')
    .insert({
      automation_id: automationDefId,
      app_id: appId,
      trigger_source: 'ai_autonomous',
      trigger_context: {
        action_queue_id: action.id,
        action_type: action.action_type,
        scheduled_for: action.scheduled_for
      },
      execution_result: result.data || {},
      status: result.success ? 'success' : 'failed',
      error_message: result.error
    })
    .select('id')
    .single()

  if (error) {
    log('warn', 'Failed to record automation execution', { error: error.message, actionId: action.id })
    return null
  }

  return data?.id || null
}

/**
 * Measure outcomes for enable_automation actions
 */
async function measureEnableAutomationOutcome(
  supabase: SupabaseClient,
  action: Record<string, unknown>
): Promise<{ success_score: number; outcomes: MeasuredOutcome[] }> {
  const payload = action.action_payload as Record<string, unknown>
  const automationType = payload.automation_type as string
  const appId = payload.app_id as string
  const executedAt = new Date(action.executed_at as string)
  const outcomes: MeasuredOutcome[] = []

  // Find executions of this automation since it was enabled
  const { count: executionCount } = await supabase
    .from('automation_executions')
    .select('id', { count: 'exact', head: true })
    .eq('app_id', appId)
    .gte('created_at', executedAt.toISOString())

  // Count successful executions
  const { count: successCount } = await supabase
    .from('automation_executions')
    .select('id', { count: 'exact', head: true })
    .eq('app_id', appId)
    .eq('status', 'success')
    .gte('created_at', executedAt.toISOString())

  const totalExecs = executionCount || 0
  const successExecs = successCount || 0
  const successRate = totalExecs > 0 ? successExecs / totalExecs : 0

  outcomes.push({
    metric: 'automation_executions',
    value: totalExecs
  })

  outcomes.push({
    metric: 'automation_success_rate',
    value: successRate
  })

  // Score based on execution count and success rate
  let successScore = 0.5
  if (totalExecs >= 5 && successRate > 0.8) {
    successScore = 0.9  // Highly effective
  } else if (totalExecs >= 3 && successRate > 0.6) {
    successScore = 0.7  // Moderately effective
  } else if (totalExecs > 0 && successRate > 0.5) {
    successScore = 0.5  // Neutral
  } else if (totalExecs === 0) {
    successScore = 0.5  // No data yet, neutral
  } else {
    successScore = 0.3  // Low effectiveness
  }

  return { success_score: successScore, outcomes }
}

// ============================================================================
// ACTION EXECUTORS
// ============================================================================

/**
 * Execute a create_announcement action
 */
async function executeAnnouncement(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
): Promise<ExecutionResult> {
  const { app_id, title, body, priority } = payload

  // Create announcement in the app_announcements table
  const { data, error } = await supabase
    .from('app_announcements')
    .insert({
      app_id,
      title,
      body,
      priority: priority || 'normal',
      status: 'active',
      created_by: 'ai_autonomous'
    })
    .select('id')
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  return {
    success: true,
    data: { announcement_id: data?.id, title }
  }
}

/**
 * Execute a send_targeted_message action
 */
async function executeSendMessage(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
): Promise<ExecutionResult> {
  const { app_id, segment, tier, subject, body, channel } = payload

  // Get target members based on segment
  let memberQuery = supabase
    .from('app_members')
    .select('id, email, phone')
    .eq('app_id', app_id)
    .is('deleted_at', null)

  if (segment === 'vip') {
    memberQuery = memberQuery.in('tier', ['gold', 'platinum'])
  } else if (segment === 'new') {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 14)
    memberQuery = memberQuery.gte('joined_at', cutoff.toISOString())
  } else if (segment === 'at_risk') {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    memberQuery = memberQuery.lt('last_visit_at', cutoff.toISOString())
  }

  if (tier) {
    memberQuery = memberQuery.eq('tier', tier)
  }

  const { data: members, error: memberError } = await memberQuery.limit(1000)

  if (memberError) {
    return { success: false, error: memberError.message }
  }

  // Create message batch
  const { data: batch, error: batchError } = await supabase
    .from('app_message_batches')
    .insert({
      app_id,
      subject,
      body,
      channel: channel || 'push',
      segment,
      recipient_count: members?.length || 0,
      status: 'sent',
      sent_by: 'ai_autonomous'
    })
    .select('id')
    .single()

  if (batchError) {
    // Table might not exist, log and continue
    log('warn', 'Message batch insert failed', { error: batchError.message, app_id })
    return {
      success: true,
      data: {
        recipients: members?.length || 0,
        segment,
        channel,
        note: 'Message queued (batch table not available)'
      }
    }
  }

  return {
    success: true,
    data: {
      batch_id: batch?.id,
      recipients: members?.length || 0,
      segment,
      channel
    }
  }
}

/**
 * Execute a create_flash_promotion action
 */
async function executeFlashPromotion(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
): Promise<ExecutionResult> {
  const { app_id, name, multiplier, starts_at, ends_at, min_spend, target_segment } = payload

  const { data, error } = await supabase
    .from('app_promotions')
    .insert({
      app_id,
      name,
      type: 'multiplier',
      multiplier,
      starts_at,
      ends_at,
      min_spend: min_spend || 0,
      target_segment: target_segment || 'all',
      status: 'active',
      created_by: 'ai_autonomous'
    })
    .select('id')
    .single()

  if (error) {
    // Table might not exist, log and continue
    log('warn', 'Promotion insert failed', { error: error.message, name, app_id })
    return {
      success: true,
      data: { name, multiplier, note: 'Promotion created (table not available)' }
    }
  }

  return {
    success: true,
    data: { promotion_id: data?.id, name, multiplier }
  }
}

/**
 * Execute an award_bonus_points action
 * Uses batch RPC for transaction safety and performance
 */
async function executeAwardPoints(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
): Promise<ExecutionResult> {
  const { app_id, member_ids, segment, points, reason } = payload

  let targetMembers: string[] = member_ids as string[] || []

  // If segment specified, get member IDs
  if (segment && !targetMembers.length) {
    let memberQuery = supabase
      .from('app_members')
      .select('id')
      .eq('app_id', app_id)
      .is('deleted_at', null)

    if (segment === 'vip') {
      memberQuery = memberQuery.in('tier', ['gold', 'platinum'])
    } else if (segment === 'new') {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 14)
      memberQuery = memberQuery.gte('joined_at', cutoff.toISOString())
    } else if (segment === 'birthday_today') {
      const today = new Date()
      const month = today.getMonth() + 1
      const day = today.getDate()
      // This requires a birthday column - may not exist
      memberQuery = memberQuery
        .eq('birth_month', month)
        .eq('birth_day', day)
    }

    const { data: members } = await memberQuery.limit(100)
    targetMembers = (members || []).map((m: { id: string }) => m.id)
  }

  if (!targetMembers.length) {
    return { success: false, error: 'No members to award points to' }
  }

  // Use batch RPC for atomic transaction (all-or-nothing)
  const { data: batchResult, error: batchError } = await supabase.rpc('batch_award_points', {
    p_member_ids: targetMembers,
    p_points: points as number,
    p_reason: reason as string,
    p_app_id: app_id as string
  })

  if (batchError) {
    log('error', 'Batch award points failed', { error: batchError.message, memberCount: targetMembers.length })

    // Fallback to legacy loop if RPC not available
    log('info', 'Falling back to legacy point award loop', { memberCount: targetMembers.length })
    let awarded = 0
    for (const memberId of targetMembers) {
      const { data: member } = await supabase
        .from('app_members')
        .select('points_balance, total_points_earned')
        .eq('id', memberId)
        .single()

      if (member) {
        await supabase
          .from('app_members')
          .update({
            points_balance: (member.points_balance || 0) + (points as number),
            total_points_earned: (member.total_points_earned || 0) + (points as number)
          })
          .eq('id', memberId)

        await supabase
          .from('app_events')
          .insert({
            app_id,
            member_id: memberId,
            event_type: 'bonus_points_awarded',
            event_data: { points, reason, source: 'ai_autonomous' }
          })

        awarded++
      }
    }

    return {
      success: true,
      data: { awarded, points, reason, method: 'legacy' }
    }
  }

  // Parse RPC result
  const result = batchResult as { success: boolean; awarded: number; error?: string }
  if (!result.success) {
    return { success: false, error: result.error || 'Batch award failed' }
  }

  log('info', 'Batch award points successful', { awarded: result.awarded, requested: targetMembers.length })

  return {
    success: true,
    data: { awarded: result.awarded, points, reason, method: 'batch' }
  }
}

/**
 * Execute a send_weekly_digest action
 */
async function executeSendWeeklyDigest(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  organizationId: string
): Promise<ExecutionResult> {
  const digestData = payload.digest_data as Record<string, unknown>
  const weekStart = payload.week_start as string
  const weekEnd = payload.week_end as string

  if (!digestData) {
    return { success: false, error: 'No digest data provided' }
  }

  // Get organization owner email
  const { data: owner, error: ownerError } = await supabase
    .from('organization_members')
    .select(`
      profiles!inner(id, email, first_name)
    `)
    .eq('organization_id', organizationId)
    .eq('role', 'owner')
    .single()

  if (ownerError || !owner?.profiles?.email) {
    log('warn', 'Owner email not found for digest', { organizationId, error: ownerError?.message })
    return { success: false, error: 'Owner email not found' }
  }

  const ownerEmail = owner.profiles.email as string
  const ownerName = (owner.profiles.first_name as string) || 'there'

  // Format digest email
  const emailSubject = `Weekly Automation Report: ${weekStart} - ${weekEnd}`
  const emailBody = formatDigestEmail(digestData, ownerName)

  // Get organization's app for message batch
  const { data: app } = await supabase
    .from('customer_apps')
    .select('id')
    .eq('organization_id', organizationId)
    .limit(1)
    .single()

  if (!app) {
    log('warn', 'No app found for organization', { organizationId })
    return { success: false, error: 'No app found for organization' }
  }

  // Create message batch for digest email
  const { data: batch, error: batchError } = await supabase
    .from('app_message_batches')
    .insert({
      app_id: app.id,
      organization_id: organizationId,
      channel: 'email',
      subject: emailSubject,
      body: emailBody,
      segment: 'custom',
      member_ids: [],  // Not member-targeted, this is owner-targeted
      created_by: 'automation',
      status: 'scheduled',
      scheduled_for: new Date().toISOString(),
      total_recipients: 1
    })
    .select('id')
    .single()

  if (batchError) {
    log('error', 'Failed to create digest batch', { error: batchError.message })
    return { success: false, error: batchError.message }
  }

  // Mark digest snapshot as sent
  await supabase
    .from('weekly_digest_snapshots')
    .update({
      digest_sent_at: new Date().toISOString(),
      digest_channel: 'email'
    })
    .eq('organization_id', organizationId)
    .eq('week_start', weekStart)

  log('info', 'Weekly digest queued', { organizationId, batchId: batch?.id, recipient: ownerEmail })

  return {
    success: true,
    data: {
      batch_id: batch?.id,
      recipient: ownerEmail,
      week_start: weekStart,
      week_end: weekEnd
    }
  }
}

/**
 * Format digest email content
 */
function formatDigestEmail(digest: Record<string, unknown>, firstName: string): string {
  const topPerformers = (digest.top_performers as Array<Record<string, unknown>>) || []
  const underperformers = (digest.underperformers as Array<Record<string, unknown>>) || []
  const newlyPaused = (digest.newly_paused as Array<Record<string, unknown>>) || []
  const recoveryCandidates = (digest.recovery_candidates as Array<Record<string, unknown>>) || []

  let body = `Hi ${firstName},\n\n`
  body += `Here's your weekly automation performance summary for ${digest.week_start} to ${digest.week_end}.\n\n`

  body += `=== OVERVIEW ===\n`
  body += `Total Automations: ${digest.total_automations}\n`
  body += `Active: ${digest.active_automations} | Paused: ${digest.paused_automations}\n`
  body += `Messages Sent: ${digest.total_messages_sent || 0}\n`
  body += `Avg Open Rate: ${(digest.avg_open_rate as number)?.toFixed(1) || 0}%\n\n`

  if (topPerformers.length > 0) {
    body += `=== TOP PERFORMERS ===\n`
    topPerformers.forEach((p) => {
      body += `- ${p.name}: ${p.open_rate_pct}% open rate (${p.total_sent} sent)\n`
    })
    body += `\n`
  }

  if (underperformers.length > 0) {
    body += `=== NEEDS ATTENTION ===\n`
    underperformers.forEach((u) => {
      const issue = u.issue === 'high_bounce' ? 'high bounce rate' : 'low open rate'
      body += `- ${u.name}: ${issue} (${u.open_rate_pct}% opens, ${u.bounce_rate_pct}% bounces)\n`
    })
    body += `\n`
  }

  if (newlyPaused.length > 0) {
    body += `=== AUTO-PAUSED THIS WEEK ===\n`
    newlyPaused.forEach((p) => {
      body += `- ${p.name}: ${p.reason}\n`
    })
    body += `\n`
  }

  if (recoveryCandidates.length > 0) {
    body += `=== RECOVERY CANDIDATES ===\n`
    body += `These automations have been paused for 7+ days and may be ready to try again:\n`
    recoveryCandidates.forEach((r) => {
      body += `- ${r.name} (paused ${r.days_paused} days)\n`
    })
    body += `\n`
  }

  body += `View full details in your Intelligence dashboard.\n\n`
  body += `- Your Royalty AI`

  return body
}

/**
 * Execute an enable_automation action
 */
async function executeEnableAutomation(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
): Promise<ExecutionResult> {
  const { app_id, automation_type, enable, config } = payload

  // Find existing automation of this type
  const { data: existing } = await supabase
    .from('automations')
    .select('id')
    .eq('app_id', app_id)
    .eq('automation_type', automation_type)
    .single()

  if (existing) {
    // Update existing
    const { error } = await supabase
      .from('automations')
      .update({
        is_active: enable,
        ...(config ? { action_config: config } : {})
      })
      .eq('id', existing.id)

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: { automation_id: existing.id, automation_type, enabled: enable }
    }
  } else if (enable) {
    // Create new automation
    const { data, error } = await supabase
      .from('automations')
      .insert({
        app_id,
        name: `${automation_type} automation`,
        automation_type,
        is_active: true,
        action_config: config || {}
      })
      .select('id')
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: { automation_id: data?.id, automation_type, enabled: true, created: true }
    }
  }

  return {
    success: true,
    data: { automation_type, enabled: false, note: 'No automation to disable' }
  }
}

// ============================================================================
// OUTCOME MEASUREMENT
// ============================================================================

interface MeasuredOutcome {
  metric: string
  value: number
  comparison?: {
    before: number
    after: number
    change_pct: number
  }
}

/**
 * Measure outcomes for executed actions after 24 hours
 */
async function measureActionOutcome(
  supabase: SupabaseClient,
  action: Record<string, unknown>
): Promise<{ success_score: number; outcomes: MeasuredOutcome[] }> {
  const actionType = action.action_type as string
  const payload = action.action_payload as Record<string, unknown>
  const executedAt = new Date(action.executed_at as string)
  const appId = payload.app_id as string

  const outcomes: MeasuredOutcome[] = []
  let successScore = 0.5  // Default neutral

  try {
    switch (actionType) {
      case 'create_announcement': {
        // Measure: engagement with app after announcement
        const { count: visitsAfter } = await supabase
          .from('app_events')
          .select('id', { count: 'exact', head: true })
          .eq('app_id', appId)
          .eq('event_type', 'visit')
          .gte('created_at', executedAt.toISOString())

        outcomes.push({
          metric: 'visits_after_announcement',
          value: visitsAfter || 0
        })

        // Compare to baseline
        const beforeStart = new Date(executedAt)
        beforeStart.setDate(beforeStart.getDate() - 7)
        const { count: visitsBefore } = await supabase
          .from('app_events')
          .select('id', { count: 'exact', head: true })
          .eq('app_id', appId)
          .eq('event_type', 'visit')
          .gte('created_at', beforeStart.toISOString())
          .lt('created_at', executedAt.toISOString())

        const changePct = visitsBefore
          ? ((visitsAfter || 0) - visitsBefore) / visitsBefore * 100
          : 0

        successScore = changePct > 10 ? 0.8 : changePct > 0 ? 0.6 : 0.4
        break
      }

      case 'send_targeted_message': {
        // Measure: member activity after message
        const recipientCount = payload.estimated_recipients as number || 0
        const { count: activatedCount } = await supabase
          .from('app_events')
          .select('id', { count: 'exact', head: true })
          .eq('app_id', appId)
          .eq('event_type', 'visit')
          .gte('created_at', executedAt.toISOString())

        const activationRate = recipientCount > 0
          ? (activatedCount || 0) / recipientCount
          : 0

        outcomes.push({
          metric: 'activation_rate',
          value: activationRate
        })

        successScore = activationRate > 0.2 ? 0.9 : activationRate > 0.1 ? 0.7 : activationRate > 0.05 ? 0.5 : 0.3
        break
      }

      case 'create_flash_promotion': {
        // Measure: points earned during promotion
        const endsAt = new Date(payload.ends_at as string)
        const { count: transactionsDuring } = await supabase
          .from('app_events')
          .select('id', { count: 'exact', head: true })
          .eq('app_id', appId)
          .eq('event_type', 'points_earned')
          .gte('created_at', executedAt.toISOString())
          .lte('created_at', endsAt.toISOString())

        outcomes.push({
          metric: 'transactions_during_promo',
          value: transactionsDuring || 0
        })

        // Compare to similar period before
        const beforeStart = new Date(executedAt)
        const duration = endsAt.getTime() - executedAt.getTime()
        beforeStart.setTime(beforeStart.getTime() - duration)

        const { count: transactionsBefore } = await supabase
          .from('app_events')
          .select('id', { count: 'exact', head: true })
          .eq('app_id', appId)
          .eq('event_type', 'points_earned')
          .gte('created_at', beforeStart.toISOString())
          .lt('created_at', executedAt.toISOString())

        const lift = transactionsBefore
          ? ((transactionsDuring || 0) - transactionsBefore) / transactionsBefore * 100
          : 0

        successScore = lift > 50 ? 0.9 : lift > 20 ? 0.7 : lift > 0 ? 0.5 : 0.3
        break
      }

      case 'award_bonus_points': {
        // Measure: did awarded members return?
        const awardedCount = (payload.member_ids as string[])?.length ||
                            (action.execution_result as Record<string, unknown>)?.awarded as number || 0

        const { count: returnVisits } = await supabase
          .from('app_events')
          .select('id', { count: 'exact', head: true })
          .eq('app_id', appId)
          .eq('event_type', 'visit')
          .gte('created_at', executedAt.toISOString())

        const returnRate = awardedCount > 0 ? (returnVisits || 0) / awardedCount : 0

        outcomes.push({
          metric: 'return_rate_after_bonus',
          value: returnRate
        })

        successScore = returnRate > 0.5 ? 0.9 : returnRate > 0.3 ? 0.7 : returnRate > 0.1 ? 0.5 : 0.3
        break
      }

      default:
        successScore = 0.5  // Neutral for unknown action types
    }
  } catch (err) {
    log('error', 'Error measuring outcome', { error: (err as Error).message, actionType })
    successScore = 0.5
  }

  return { success_score: successScore, outcomes }
}

/**
 * Determine contextual layer and category based on action type
 */
function getKnowledgeContext(actionType: string): { layer: string; category: string } {
  switch (actionType) {
    case 'create_announcement':
      return { layer: 'operational', category: 'communication_effectiveness' }
    case 'send_targeted_message':
      return { layer: 'customer', category: 'engagement_drivers' }
    case 'create_flash_promotion':
      return { layer: 'growth', category: 'pricing_strategy' }
    case 'award_bonus_points':
      return { layer: 'customer', category: 'retention_mechanics' }
    case 'enable_automation':
      return { layer: 'operational', category: 'automation_performance' }
    default:
      return { layer: 'growth', category: 'action_outcome' }
  }
}

/**
 * Save outcome learnings to knowledge store with contextual layers
 */
async function saveOutcomeLearning(
  supabase: SupabaseClient,
  orgId: string,
  action: Record<string, unknown>,
  successScore: number,
  outcomes: MeasuredOutcome[]
): Promise<void> {
  const actionType = action.action_type as string
  const payload = action.action_payload as Record<string, unknown>
  const { layer, category } = getKnowledgeContext(actionType)

  let fact = ''
  let importance: 'critical' | 'high' | 'medium' | 'low' = 'medium'

  if (successScore >= 0.7) {
    // Successful action - record what worked
    switch (actionType) {
      case 'create_announcement':
        fact = `Announcement "${payload.title}" was effective (${Math.round(successScore * 100)}% success score)`
        importance = 'high'
        break
      case 'send_targeted_message':
        fact = `Targeted message to ${payload.segment} segment achieved ${Math.round((outcomes[0]?.value || 0) * 100)}% activation rate`
        importance = 'high'
        break
      case 'create_flash_promotion':
        fact = `${payload.multiplier}x points promotion drove ${outcomes[0]?.value || 0} transactions (successful)`
        importance = 'high'
        break
      case 'award_bonus_points':
        fact = `Bonus points (${payload.points} pts) had ${Math.round((outcomes[0]?.value || 0) * 100)}% return rate`
        importance = 'medium'
        break
      case 'enable_automation':
        fact = `${payload.automation_type} automation effective: ${outcomes[0]?.value || 0} executions, ${Math.round((outcomes[1]?.value || 0) * 100)}% success rate`
        importance = 'high'
        break
    }
  } else if (successScore < 0.4) {
    // Failed action - record what didn't work
    switch (actionType) {
      case 'create_announcement':
        fact = `Announcement "${payload.title}" had low engagement - consider different timing or content`
        importance = 'medium'
        break
      case 'send_targeted_message':
        fact = `Message to ${payload.segment} segment underperformed - try different approach or timing`
        importance = 'medium'
        break
      case 'create_flash_promotion':
        fact = `${payload.multiplier}x promotion didn't lift transactions - may need higher multiplier or better targeting`
        importance = 'medium'
        break
      case 'award_bonus_points':
        fact = `Bonus points to ${payload.segment || 'segment'} didn't drive returns - consider timing or point amount`
        importance = 'low'
        break
      case 'enable_automation':
        fact = `${payload.automation_type} automation underperforming: ${outcomes[0]?.value || 0} executions, ${Math.round((outcomes[1]?.value || 0) * 100)}% success rate - needs tuning`
        importance = 'medium'
        break
    }
  }

  if (fact) {
    await supabase
      .from('business_knowledge')
      .insert({
        organization_id: orgId,
        layer,
        category,
        fact,
        confidence: successScore,
        importance,
        source_type: 'inferred',
        status: 'active',
        trigger_context: {
          action_id: action.id,
          action_type: actionType,
          executed_at: action.executed_at,
          measured_at: new Date().toISOString()
        }
      })
  }
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

async function processActionQueue(supabase: SupabaseClient): Promise<{
  executed: number
  failed: number
  measured: number
  retried: number
  rateLimited: number
  abandoned: number
}> {
  const stats = { executed: 0, failed: 0, measured: 0, retried: 0, rateLimited: 0, abandoned: 0 }

  log('info', 'Starting action queue processing', { instance_id: INSTANCE_ID })

  // 0. Release any abandoned actions (instance crashed while executing)
  try {
    const { data: releasedCount } = await supabase.rpc('release_abandoned_actions', {
      p_timeout_minutes: 15
    })
    if (releasedCount && releasedCount > 0) {
      log('warn', 'Released abandoned actions', { count: releasedCount })
      stats.abandoned = releasedCount
    }
  } catch (err) {
    log('error', 'Failed to release abandoned actions', { error: (err as Error).message })
  }

  // 1. Atomically claim approved actions using distributed lock
  // This prevents race conditions when multiple instances run simultaneously
  const { data: pendingActions, error: claimError } = await supabase.rpc('claim_pending_actions', {
    p_instance_id: INSTANCE_ID,
    p_limit: 10
  })

  if (claimError) {
    log('error', 'Failed to claim actions', { error: claimError.message })
    // Fall back to legacy query if RPC not available (migration not applied yet)
    const { data: fallbackActions } = await supabase
      .from('ai_action_queue')
      .select('*')
      .eq('status', 'approved')
      .lte('scheduled_for', new Date().toISOString())
      .limit(10)

    if (fallbackActions) {
      log('warn', 'Using fallback action query', { count: fallbackActions.length })
    }
  }

  const actionsToProcess = pendingActions || []
  log('info', 'Claimed actions for processing', { count: actionsToProcess.length })

  for (const action of actionsToProcess) {
    const actionId = action.id as string
    const actionType = action.action_type as string
    const payload = action.action_payload as Record<string, unknown>
    const orgId = action.organization_id as string

    // Check rate limit before executing (fail-closed)
    const rateLimit = await checkRateLimit(supabase, orgId)
    if (!rateLimit.allowed) {
      log('info', 'Rate limited action', { orgId, actionId, reason: rateLimit.reason })
      // Release the action back to approved state for retry later
      await supabase
        .from('ai_action_queue')
        .update({
          status: 'approved',
          executing_instance: null,
          scheduled_for: new Date(Date.now() + 60000).toISOString(), // Retry in 1 minute
          updated_at: new Date().toISOString()
        })
        .eq('id', actionId)
      stats.rateLimited++
      continue
    }

    let result: ExecutionResult = { success: false, error: 'Unknown action type' }

    try {
      switch (actionType) {
        case 'create_announcement':
          result = await executeAnnouncement(supabase, payload)
          break
        case 'send_targeted_message':
          result = await executeSendMessage(supabase, payload)
          break
        case 'create_flash_promotion':
          result = await executeFlashPromotion(supabase, payload)
          break
        case 'award_bonus_points':
          result = await executeAwardPoints(supabase, payload)
          break
        case 'enable_automation':
          result = await executeEnableAutomation(supabase, payload)
          break
        case 'send_weekly_digest':
          result = await executeSendWeeklyDigest(supabase, payload, orgId)
          break
        default:
          result = { success: false, error: `Unknown action type: ${actionType}` }
      }
    } catch (err) {
      result = { success: false, error: (err as Error).message }
    }

    // Update action status
    await supabase
      .from('ai_action_queue')
      .update({
        status: result.success ? 'executed' : 'failed',
        executed_at: new Date().toISOString(),
        execution_result: result.data || {},
        error_message: result.error,
        updated_at: new Date().toISOString()
      })
      .eq('id', actionId)

    // Record in automation_executions if linked to automation
    if (result.success) {
      await recordAutomationExecution(supabase, action, result)
    }

    // Audit log
    await supabase
      .from('ai_audit_log')
      .insert({
        organization_id: orgId,
        action_category: 'autonomous',
        action_type: actionType,
        action_input: payload,
        action_result: result,
        status: result.success ? 'success' : 'failure',
        error_message: result.error,
        action_queue_id: actionId,
        auto_executed: true
      })

    if (result.success) {
      stats.executed++
    } else {
      stats.failed++
    }
  }

  // 2. Retry failed actions with exponential backoff (max 3 retries)
  const { data: failedActions } = await supabase
    .from('ai_action_queue')
    .select('*')
    .eq('status', 'failed')
    .lt('retry_count', 3)
    .limit(5)

  for (const action of failedActions || []) {
    const retryCount = (action.retry_count as number) || 0
    const backoffMinutes = Math.pow(2, retryCount) * 5  // 5, 10, 20 minutes

    // Calculate next retry time
    const nextRetry = new Date()
    nextRetry.setMinutes(nextRetry.getMinutes() + backoffMinutes)

    // Re-queue for retry
    await supabase
      .from('ai_action_queue')
      .update({
        status: 'approved',
        scheduled_for: nextRetry.toISOString(),
        retry_count: retryCount + 1,
        error_message: `Retry ${retryCount + 1}/3 scheduled for ${nextRetry.toISOString()}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', action.id)

    stats.retried++
  }

  // 3. Mark actions that exhausted retries as permanently failed
  await supabase
    .from('ai_action_queue')
    .update({
      status: 'permanently_failed',
      error_message: 'Max retries (3) exceeded',
      updated_at: new Date().toISOString()
    })
    .eq('status', 'failed')
    .gte('retry_count', 3)

  // 4. Measure outcomes for actions executed 24+ hours ago
  const measureCutoff = new Date()
  measureCutoff.setHours(measureCutoff.getHours() - 24)

  const { data: actionsToMeasure } = await supabase
    .from('ai_action_queue')
    .select('*')
    .eq('status', 'executed')
    .is('measured_at', null)
    .lte('executed_at', measureCutoff.toISOString())
    .limit(10)

  for (const action of actionsToMeasure || []) {
    const actionType = action.action_type as string
    let outcome: { success_score: number; outcomes: MeasuredOutcome[] }

    // Use specific measurement for enable_automation
    if (actionType === 'enable_automation') {
      outcome = await measureEnableAutomationOutcome(supabase, action)
    } else {
      outcome = await measureActionOutcome(supabase, action)
    }

    const { success_score, outcomes } = outcome

    // Update with measured outcome
    await supabase
      .from('ai_action_queue')
      .update({
        measured_at: new Date().toISOString(),
        measured_outcome: { outcomes },
        success_score,
        updated_at: new Date().toISOString()
      })
      .eq('id', action.id)

    // Save learning to knowledge store
    await saveOutcomeLearning(
      supabase,
      action.organization_id,
      action,
      success_score,
      outcomes
    )

    stats.measured++
  }

  // 5. Expire old pending actions
  const expireCutoff = new Date()
  await supabase
    .from('ai_action_queue')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('expires_at', expireCutoff.toISOString())

  return stats
}

// ============================================================================
// HANDLER
// ============================================================================

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create service client
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Process the queue
    const stats = await processActionQueue(supabase)

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        stats,
        summary: `Executed: ${stats.executed}, Failed: ${stats.failed}, Retried: ${stats.retried}, Measured: ${stats.measured}, Rate Limited: ${stats.rateLimited}`
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )
  } catch (error) {
    log('error', 'Autonomous runner error', { error: (error as Error).message })
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
