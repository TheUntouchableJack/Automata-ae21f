// Supabase Edge Function: Automation Engine
// Detects triggers, evaluates conditions, and schedules automation executions
// Called on events (member_joined, visit, etc.) or by cron for scheduled triggers

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://royaltyapp.ai',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// TYPES
// ============================================================================

interface TriggerEvent {
  type: 'event' | 'schedule' | 'cron'
  event_name?: string  // For event triggers: 'member_joined', 'visit', 'birthday', etc.
  schedule_type?: string  // For schedule triggers: 'daily', 'weekly', 'monthly', 'birthday', 'anniversary'
  organization_id?: string
  app_id?: string
  member_id?: string
  event_data?: Record<string, unknown>
}

interface AutomationDef {
  id: string
  organization_id: string
  app_id: string | null
  name: string
  category: string
  trigger_type: string
  trigger_event: string | null
  trigger_condition: Record<string, unknown> | null
  action_type: string
  action_config: Record<string, unknown>
  delay_minutes: number
  max_frequency_days: number | null
  daily_limit: number | null
  cooldown_hours: number
  is_enabled: boolean
  confidence_threshold: number
}

interface Member {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  tier: string | null
  points_balance: number
  visit_count: number
  current_streak: number
  last_visit_at: string | null
  joined_at: string
  birth_date: string | null
  locale: string
  timezone: string
}

// ============================================================================
// CONDITION EVALUATOR
// ============================================================================

/**
 * Evaluate if a member matches the trigger condition
 */
function evaluateCondition(
  condition: Record<string, unknown> | null,
  member: Member,
  eventData?: Record<string, unknown>
): boolean {
  if (!condition || Object.keys(condition).length === 0) {
    return true  // No condition = always match
  }

  for (const [key, value] of Object.entries(condition)) {
    switch (key) {
      case 'tier':
        if (Array.isArray(value)) {
          if (!value.includes(member.tier)) return false
        } else if (member.tier !== value) {
          return false
        }
        break

      case 'visit_count':
      case 'visit_count_eq':
        if (member.visit_count !== value) return false
        break

      case 'visit_count_gte':
        if (member.visit_count < (value as number)) return false
        break

      case 'visit_count_lte':
        if (member.visit_count > (value as number)) return false
        break

      case 'streak_days':
        if (member.current_streak < (value as number)) return false
        break

      case 'points_balance_gte':
        if (member.points_balance < (value as number)) return false
        break

      case 'days_since_visit': {
        if (!member.last_visit_at) break
        const lastVisit = new Date(member.last_visit_at)
        const daysSince = Math.floor((Date.now() - lastVisit.getTime()) / (1000 * 60 * 60 * 24))
        if (daysSince < (value as number)) return false
        break
      }

      case 'days_since_join': {
        const joinDate = new Date(member.joined_at)
        const daysSince = Math.floor((Date.now() - joinDate.getTime()) / (1000 * 60 * 60 * 24))
        if (daysSince < (value as number)) return false
        break
      }

      case 'amount_gte':
        // For transaction events
        if (!eventData?.amount || (eventData.amount as number) < (value as number)) return false
        break

      case 'direction':
        // For tier change events
        if (eventData?.direction !== value) return false
        break

      case 'milestones':
        // For points milestone events
        if (eventData?.milestone && !(value as number[]).includes(eventData.milestone as number)) return false
        break

      case 'no_review_requested':
        // Would need to check review_requests table
        // For now, pass through
        break

      default:
        // Check event data for custom conditions
        if (eventData && eventData[key] !== value) return false
    }
  }

  return true
}

// ============================================================================
// TRIGGER DETECTION
// ============================================================================

/**
 * Find all automations that should fire for this event
 */
async function findMatchingAutomations(
  supabase: SupabaseClient,
  trigger: TriggerEvent
): Promise<AutomationDef[]> {
  const { organization_id, app_id, event_name, schedule_type } = trigger

  let query = supabase
    .from('automation_definitions')
    .select('id, organization_id, app_id, name, category, trigger_type, trigger_event, trigger_condition, action_type, action_config, delay_minutes, max_frequency_days, daily_limit, cooldown_hours, is_enabled, confidence_threshold, trigger_count, success_count, failure_count')
    .eq('is_enabled', true)
    .eq('is_archived', false)
    .or('target_type.eq.app_members,target_type.is.null')  // Only process member-targeting automations

  if (trigger.type === 'event' && event_name) {
    query = query
      .eq('trigger_type', 'event')
      .eq('trigger_event', event_name)
  } else if (trigger.type === 'schedule' && schedule_type) {
    query = query
      .eq('trigger_type', 'schedule')
      .eq('trigger_event', schedule_type)
  }

  // Filter by org/app if provided
  if (organization_id) {
    query = query.or(`organization_id.eq.${organization_id},organization_id.is.null`)
  }
  if (app_id) {
    query = query.or(`app_id.eq.${app_id},app_id.is.null`)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error finding automations:', error)
    return []
  }

  return (data || []) as AutomationDef[]
}

/**
 * Check if automation should fire based on frequency limits
 */
async function shouldFireAutomation(
  supabase: SupabaseClient,
  automation: AutomationDef,
  memberId: string
): Promise<boolean> {
  // Check max frequency per member
  if (automation.max_frequency_days) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - automation.max_frequency_days)

    const { count } = await supabase
      .from('automation_executions')
      .select('id', { count: 'exact', head: true })
      .eq('automation_id', automation.id)
      .eq('member_id', memberId)
      .eq('status', 'completed')
      .gte('executed_at', cutoff.toISOString())

    if ((count || 0) > 0) {
      return false
    }
  }

  // Check daily limit
  if (automation.daily_limit) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { count } = await supabase
      .from('automation_executions')
      .select('id', { count: 'exact', head: true })
      .eq('automation_id', automation.id)
      .gte('triggered_at', today.toISOString())

    if ((count || 0) >= automation.daily_limit) {
      return false
    }
  }

  // Check cooldown
  if (automation.cooldown_hours > 0) {
    const cutoff = new Date()
    cutoff.setHours(cutoff.getHours() - automation.cooldown_hours)

    const { count } = await supabase
      .from('automation_executions')
      .select('id', { count: 'exact', head: true })
      .eq('automation_id', automation.id)
      .eq('member_id', memberId)
      .gte('triggered_at', cutoff.toISOString())

    if ((count || 0) > 0) {
      return false
    }
  }

  return true
}

// ============================================================================
// ACTION EXECUTION
// ============================================================================

/**
 * Execute or schedule an automation action
 */
async function executeAutomation(
  supabase: SupabaseClient,
  automation: AutomationDef,
  member: Member,
  triggerContext: Record<string, unknown>
): Promise<{ executionId: string; status: string }> {
  // Calculate scheduled time if there's a delay
  let scheduledFor: Date | null = null
  if (automation.delay_minutes > 0) {
    scheduledFor = new Date()
    scheduledFor.setMinutes(scheduledFor.getMinutes() + automation.delay_minutes)
  }

  // Create execution record
  const { data: execution, error: execError } = await supabase
    .from('automation_executions')
    .insert({
      automation_id: automation.id,
      organization_id: automation.organization_id,
      member_id: member.id,
      trigger_context: triggerContext,
      scheduled_for: scheduledFor?.toISOString(),
      status: scheduledFor ? 'scheduled' : 'pending'
    })
    .select('id')
    .single()

  if (execError) {
    console.error('Error creating execution:', execError)
    throw execError
  }

  const executionId = execution.id

  // If no delay, execute immediately
  if (!scheduledFor) {
    await processExecution(supabase, executionId, automation, member)
  }

  // Update automation stats
  await supabase
    .from('automation_definitions')
    .update({
      trigger_count: automation.trigger_count + 1,
      last_triggered_at: new Date().toISOString()
    })
    .eq('id', automation.id)

  return { executionId, status: scheduledFor ? 'scheduled' : 'executing' }
}

/**
 * Process a single automation execution
 */
async function processExecution(
  supabase: SupabaseClient,
  executionId: string,
  automation: AutomationDef,
  member: Member
): Promise<void> {
  // Mark as executing
  await supabase
    .from('automation_executions')
    .update({ status: 'executing' })
    .eq('id', executionId)

  try {
    let result: Record<string, unknown> = {}

    switch (automation.action_type) {
      case 'send_message': {
        result = await executeSendMessage(supabase, automation, member)
        break
      }
      case 'award_points': {
        result = await executeAwardPoints(supabase, automation, member)
        break
      }
      case 'create_promo': {
        result = await executeCreatePromo(supabase, automation, member)
        break
      }
      case 'notify_staff': {
        result = await executeNotifyStaff(supabase, automation, member)
        break
      }
      case 'update_tier': {
        result = await executeUpdateTier(supabase, automation, member)
        break
      }
      default:
        throw new Error(`Unknown action type: ${automation.action_type}`)
    }

    // Mark as completed
    await supabase
      .from('automation_executions')
      .update({
        status: 'completed',
        executed_at: new Date().toISOString(),
        result
      })
      .eq('id', executionId)

    // Update success count
    await supabase
      .from('automation_definitions')
      .update({ success_count: automation.success_count + 1 })
      .eq('id', automation.id)

  } catch (error) {
    // Mark as failed
    await supabase
      .from('automation_executions')
      .update({
        status: 'failed',
        executed_at: new Date().toISOString(),
        error_message: (error as Error).message,
        retry_count: 1
      })
      .eq('id', executionId)

    // Update failure count
    await supabase
      .from('automation_definitions')
      .update({ failure_count: automation.failure_count + 1 })
      .eq('id', automation.id)
  }
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

async function executeSendMessage(
  supabase: SupabaseClient,
  automation: AutomationDef,
  member: Member
): Promise<Record<string, unknown>> {
  const config = automation.action_config
  const channel = (config.channel as string) || 'push'
  const templateKey = config.template_key as string

  // Get template for member's locale
  const { data: template } = await supabase
    .from('message_templates')
    .select('subject, title, body')
    .eq('template_key', templateKey)
    .eq('channel', channel)
    .eq('locale', member.locale || 'en')
    .single()

  if (!template) {
    // Fallback to English
    const { data: fallback } = await supabase
      .from('message_templates')
      .select('subject, title, body')
      .eq('template_key', templateKey)
      .eq('channel', channel)
      .eq('locale', 'en')
      .single()

    if (!fallback) {
      throw new Error(`Template not found: ${templateKey}`)
    }
  }

  const finalTemplate = template

  // Interpolate variables
  const interpolate = (text: string | null) => {
    if (!text) return text
    return text
      .replace(/\{\{name\}\}/g, member.first_name || 'Friend')
      .replace(/\{\{points\}\}/g, String(member.points_balance || 0))
      .replace(/\{\{tier\}\}/g, member.tier || 'Member')
      .replace(/\{\{streak_days\}\}/g, String(member.current_streak || 0))
      .replace(/\{\{bonus_points\}\}/g, String(config.bonus_points || 50))
  }

  const subject = interpolate(finalTemplate?.subject)
  const title = interpolate(finalTemplate?.title)
  const body = interpolate(finalTemplate?.body)

  // Create message batch (single recipient)
  const { data: batch, error } = await supabase
    .from('app_message_batches')
    .insert({
      app_id: automation.app_id,
      organization_id: automation.organization_id,
      channel,
      subject,
      body,
      template_id: templateKey,
      member_ids: [member.id],
      total_recipients: 1,
      created_by: 'automation',
      automation_id: automation.id,
      status: 'scheduled',
      scheduled_for: new Date().toISOString()
    })
    .select('id')
    .single()

  if (error) {
    console.log('Message batch creation (stub):', { channel, subject, to: member.email })
  }

  return {
    message_sent: true,
    channel,
    template_key: templateKey,
    batch_id: batch?.id,
    recipient: member.id
  }
}

async function executeAwardPoints(
  supabase: SupabaseClient,
  automation: AutomationDef,
  member: Member
): Promise<Record<string, unknown>> {
  const config = automation.action_config
  const points = (config.points as number) || 0
  const reason = (config.reason as string) || 'Automation reward'

  // Update member points
  const { error } = await supabase
    .from('app_members')
    .update({
      points_balance: member.points_balance + points,
      total_points_earned: (member.points_balance || 0) + points
    })
    .eq('id', member.id)

  if (error) {
    throw error
  }

  // Log event
  await supabase
    .from('app_events')
    .insert({
      app_id: automation.app_id,
      member_id: member.id,
      event_type: 'bonus_points_awarded',
      event_data: { points, reason, automation_id: automation.id }
    })

  return { points_awarded: points, reason, member_id: member.id }
}

async function executeCreatePromo(
  supabase: SupabaseClient,
  automation: AutomationDef,
  member: Member
): Promise<Record<string, unknown>> {
  const config = automation.action_config
  const multiplier = (config.multiplier as number) || 2.0
  const durationHours = (config.duration_hours as number) || 24

  const startsAt = new Date()
  const endsAt = new Date(startsAt.getTime() + durationHours * 60 * 60 * 1000)

  const { data, error } = await supabase
    .from('app_promotions')
    .insert({
      app_id: automation.app_id,
      organization_id: automation.organization_id,
      name: `${automation.name} - ${member.first_name || 'Member'}`,
      promotion_type: 'multiplier',
      multiplier,
      member_ids: [member.id],
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      max_per_member: 1,
      created_by: 'automation',
      status: 'active'
    })
    .select('id')
    .single()

  if (error) {
    console.log('Promo creation (stub):', { multiplier, member: member.id })
  }

  return { promo_created: true, promo_id: data?.id, multiplier, duration_hours: durationHours }
}

async function executeNotifyStaff(
  supabase: SupabaseClient,
  automation: AutomationDef,
  member: Member
): Promise<Record<string, unknown>> {
  const config = automation.action_config
  const message = (config.message as string) || `Automation triggered for ${member.first_name}`

  // Create staff notification (in-app)
  const { data } = await supabase
    .from('staff_notifications')
    .insert({
      organization_id: automation.organization_id,
      title: automation.name,
      body: message.replace(/\{\{name\}\}/g, member.first_name || 'Member'),
      type: 'automation',
      metadata: { automation_id: automation.id, member_id: member.id }
    })
    .select('id')
    .single()

  return { notification_sent: true, notification_id: data?.id }
}

async function executeUpdateTier(
  supabase: SupabaseClient,
  automation: AutomationDef,
  member: Member
): Promise<Record<string, unknown>> {
  const config = automation.action_config
  const newTier = config.new_tier as string

  if (!newTier) {
    throw new Error('new_tier not specified in action_config')
  }

  const oldTier = member.tier

  const { error } = await supabase
    .from('app_members')
    .update({ tier: newTier })
    .eq('id', member.id)

  if (error) {
    throw error
  }

  // Log tier change event
  await supabase
    .from('app_events')
    .insert({
      app_id: automation.app_id,
      member_id: member.id,
      event_type: 'tier_changed',
      event_data: { old_tier: oldTier, new_tier: newTier, automation_id: automation.id }
    })

  return { tier_updated: true, old_tier: oldTier, new_tier: newTier }
}

// ============================================================================
// SCHEDULED TRIGGERS PROCESSOR
// ============================================================================

/**
 * Process scheduled triggers (birthday, anniversary, daily checks)
 */
async function processScheduledTriggers(
  supabase: SupabaseClient,
  scheduleType: string
): Promise<{ processed: number; triggered: number }> {
  const stats = { processed: 0, triggered: 0 }

  // Find enabled automations for this schedule type
  const automations = await findMatchingAutomations(supabase, {
    type: 'schedule',
    schedule_type: scheduleType
  })

  for (const automation of automations) {
    // Get members matching this schedule type
    let memberQuery = supabase
      .from('app_members')
      .select('id, email, phone, first_name, last_name, tier, points_balance, total_points_earned, visit_count, current_streak, last_visit_at, joined_at, locale, timezone, communication_preferences, quiet_hours, app_id')
      .is('deleted_at', null)

    if (automation.organization_id) {
      // Get app_id for this org
      const { data: app } = await supabase
        .from('customer_apps')
        .select('id')
        .eq('organization_id', automation.organization_id)
        .single()

      if (app) {
        memberQuery = memberQuery.eq('app_id', app.id)
      }
    }

    // Apply schedule-specific filters
    const today = new Date()
    switch (scheduleType) {
      case 'birthday':
        // Members with birthday today
        memberQuery = memberQuery
          .not('birth_date', 'is', null)
        // Note: Would need to filter by month/day in SQL
        break

      case 'anniversary':
        // Members whose join anniversary is today
        // Note: Would need date math in SQL
        break

      case 'daily':
        // All members (condition will filter)
        break
    }

    const { data: members } = await memberQuery.limit(100)

    for (const member of (members || []) as Member[]) {
      stats.processed++

      // Filter by actual date matching for birthday/anniversary
      if (scheduleType === 'birthday' && member.birth_date) {
        const birthDate = new Date(member.birth_date)
        if (birthDate.getMonth() !== today.getMonth() || birthDate.getDate() !== today.getDate()) {
          continue
        }
      }

      if (scheduleType === 'anniversary') {
        const joinDate = new Date(member.joined_at)
        if (joinDate.getMonth() !== today.getMonth() || joinDate.getDate() !== today.getDate()) {
          continue
        }
        // Also check it's been at least 1 year
        const yearsDiff = today.getFullYear() - joinDate.getFullYear()
        if (yearsDiff < 1) continue
      }

      // Evaluate condition
      if (!evaluateCondition(automation.trigger_condition, member)) {
        continue
      }

      // Check frequency limits
      if (!await shouldFireAutomation(supabase, automation, member.id)) {
        continue
      }

      // Execute!
      await executeAutomation(supabase, automation, member, { schedule_type: scheduleType })
      stats.triggered++
    }
  }

  return stats
}

/**
 * Process pending scheduled executions
 */
async function processPendingExecutions(supabase: SupabaseClient): Promise<number> {
  let processed = 0

  // Get scheduled executions that are due
  const { data: executions } = await supabase
    .from('automation_executions')
    .select(`
      id,
      automation_id,
      member_id,
      trigger_context,
      automation_definitions (*)
    `)
    .eq('status', 'scheduled')
    .lte('scheduled_for', new Date().toISOString())
    .limit(20)

  for (const exec of (executions || [])) {
    const automation = exec.automation_definitions as unknown as AutomationDef

    // Get member
    const { data: member } = await supabase
      .from('app_members')
      .select('id, email, phone, first_name, last_name, tier, points_balance, total_points_earned, visit_count, current_streak, last_visit_at, joined_at, locale, timezone, communication_preferences, quiet_hours, app_id')
      .eq('id', exec.member_id)
      .single()

    if (!member || !automation) continue

    await processExecution(supabase, exec.id, automation, member as Member)
    processed++
  }

  return processed
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const body = await req.json().catch(() => ({}))

    const triggerType = body.type as string || 'cron'
    const result: Record<string, unknown> = { timestamp: new Date().toISOString() }

    if (triggerType === 'event') {
      // Event-based trigger (called from app when events occur)
      const trigger: TriggerEvent = {
        type: 'event',
        event_name: body.event_name,
        organization_id: body.organization_id,
        app_id: body.app_id,
        member_id: body.member_id,
        event_data: body.event_data
      }

      // Get member
      const { data: member } = await supabase
        .from('app_members')
        .select('id, email, phone, first_name, last_name, tier, points_balance, total_points_earned, visit_count, current_streak, last_visit_at, joined_at, locale, timezone, communication_preferences, quiet_hours, app_id')
        .eq('id', trigger.member_id)
        .single()

      if (!member) {
        return new Response(
          JSON.stringify({ success: false, error: 'Member not found' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        )
      }

      // Find matching automations
      const automations = await findMatchingAutomations(supabase, trigger)
      const triggered: string[] = []

      for (const automation of automations) {
        // Evaluate condition
        if (!evaluateCondition(automation.trigger_condition, member as Member, trigger.event_data)) {
          continue
        }

        // Check frequency limits
        if (!await shouldFireAutomation(supabase, automation, member.id)) {
          continue
        }

        // Execute
        const { executionId, status } = await executeAutomation(
          supabase,
          automation,
          member as Member,
          { event_name: trigger.event_name, event_data: trigger.event_data }
        )
        triggered.push(`${automation.name} (${status})`)
      }

      result.triggered = triggered
      result.automations_checked = automations.length

    } else if (triggerType === 'schedule') {
      // Scheduled trigger (called by cron)
      const scheduleType = body.schedule_type as string || 'daily'
      const stats = await processScheduledTriggers(supabase, scheduleType)
      result.schedule_type = scheduleType
      result.processed = stats.processed
      result.triggered = stats.triggered

    } else {
      // Cron mode: process all scheduled types and pending executions
      const birthdayStats = await processScheduledTriggers(supabase, 'birthday')
      const anniversaryStats = await processScheduledTriggers(supabase, 'anniversary')
      const pendingProcessed = await processPendingExecutions(supabase)

      result.birthday = birthdayStats
      result.anniversary = anniversaryStats
      result.pending_processed = pendingProcessed
    }

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Automation engine error:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Automation processing failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
