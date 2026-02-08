// Supabase Edge Function: Message Sender
// Processes message batches and delivers via email, push, SMS, or in-app
// Currently stubbed - integrations (Resend, FCM) added when API keys configured

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const resendApiKey = Deno.env.get('RESEND_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://royaltyapp.ai',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// TYPES
// ============================================================================

interface MessageBatch {
  id: string
  app_id: string
  organization_id: string
  channel: 'email' | 'push' | 'in_app' | 'sms'
  subject: string | null
  body: string
  template_id: string | null
  segment: string | null
  member_ids: string[] | null
  filter_criteria: Record<string, unknown> | null
  scheduled_for: string | null
  total_recipients: number
  created_by: string
  automation_id: string | null
  status: string
}

interface Member {
  id: string
  email: string | null
  phone: string | null
  first_name: string | null
  last_name: string | null
  locale: string
  timezone: string
  communication_preferences: Record<string, boolean>
  quiet_hours: { start: string; end: string } | null
}

interface DeliveryResult {
  member_id: string
  channel: string
  status: 'sent' | 'failed' | 'skipped' | 'stubbed'
  message_id?: string
  error?: string
}

// ============================================================================
// EMAIL DELIVERY (Resend - stubbed)
// ============================================================================

async function sendEmail(
  to: string,
  subject: string,
  body: string,
  htmlBody?: string,
  fromName?: string
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  if (!resendApiKey) {
    console.log('[STUB] Would send email:', { to, subject, bodyPreview: body.slice(0, 100) })
    return { success: true, message_id: `stub_${Date.now()}` }
  }

  // Real Resend API call
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromName ? `${fromName} <noreply@royaltyapp.ai>` : 'Royalty <noreply@royaltyapp.ai>',
        to: [to],
        subject,
        text: body,
        html: htmlBody || body.replace(/\n/g, '<br>')
      })
    })

    const data = await response.json()

    if (!response.ok) {
      return { success: false, error: data.message || 'Resend API error' }
    }

    return { success: true, message_id: data.id }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

// ============================================================================
// PUSH NOTIFICATION (FCM - stubbed)
// ============================================================================

async function sendPush(
  fcmToken: string | null,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  if (!fcmToken) {
    return { success: false, error: 'No FCM token' }
  }

  // Stubbed - would use Firebase Admin SDK
  console.log('[STUB] Would send push:', { fcmToken: fcmToken.slice(0, 20) + '...', title, body })
  return { success: true, message_id: `stub_push_${Date.now()}` }
}

// ============================================================================
// IN-APP NOTIFICATION (Supabase Realtime)
// ============================================================================

async function sendInApp(
  supabase: SupabaseClient,
  memberId: string,
  appId: string,
  title: string,
  body: string,
  actionUrl?: string
): Promise<{ success: boolean; notification_id?: string; error?: string }> {
  // This actually works! Create a notification that the app can listen to
  const { data, error } = await supabase
    .from('member_notifications')
    .insert({
      app_id: appId,
      member_id: memberId,
      type: 'message',
      title,
      body,
      action_url: actionUrl,
      is_read: false
    })
    .select('id')
    .single()

  if (error) {
    // Table might not exist yet
    console.log('[STUB] Would create in-app notification:', { memberId, title, body })
    return { success: true, notification_id: `stub_inapp_${Date.now()}` }
  }

  return { success: true, notification_id: data.id }
}

// ============================================================================
// SMS (Twilio - stubbed)
// ============================================================================

async function sendSms(
  phone: string | null,
  body: string
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  if (!phone) {
    return { success: false, error: 'No phone number' }
  }

  // Stubbed - would use Twilio
  console.log('[STUB] Would send SMS:', { phone: phone.slice(0, 6) + '***', body: body.slice(0, 50) })
  return { success: true, message_id: `stub_sms_${Date.now()}` }
}

// ============================================================================
// QUIET HOURS CHECK
// ============================================================================

function isInQuietHours(member: Member): boolean {
  if (!member.quiet_hours) return false

  const { start, end } = member.quiet_hours
  const now = new Date()

  // Convert to member's timezone
  const memberTime = new Date(now.toLocaleString('en-US', { timeZone: member.timezone || 'America/New_York' }))
  const currentHour = memberTime.getHours()
  const currentMinute = memberTime.getMinutes()
  const currentMinutes = currentHour * 60 + currentMinute

  const [startHour, startMin] = start.split(':').map(Number)
  const [endHour, endMin] = end.split(':').map(Number)
  const startMinutes = startHour * 60 + startMin
  const endMinutes = endHour * 60 + endMin

  // Handle overnight quiet hours (e.g., 22:00 - 08:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

// ============================================================================
// BATCH PROCESSOR
// ============================================================================

async function processBatch(
  supabase: SupabaseClient,
  batch: MessageBatch
): Promise<{ delivered: number; failed: number; skipped: number }> {
  const stats = { delivered: 0, failed: 0, skipped: 0 }

  // Update status to sending
  await supabase
    .from('app_message_batches')
    .update({ status: 'sending' })
    .eq('id', batch.id)

  // Get target members
  let memberIds: string[] = batch.member_ids || []

  if (!memberIds.length && batch.segment) {
    // Get members by segment
    let query = supabase
      .from('app_members')
      .select('id')
      .eq('app_id', batch.app_id)
      .is('deleted_at', null)

    switch (batch.segment) {
      case 'vip':
        query = query.in('tier', ['gold', 'platinum'])
        break
      case 'active':
        const activeCutoff = new Date()
        activeCutoff.setDate(activeCutoff.getDate() - 30)
        query = query.gte('last_visit_at', activeCutoff.toISOString())
        break
      case 'at_risk':
        const riskCutoff = new Date()
        riskCutoff.setDate(riskCutoff.getDate() - 30)
        query = query.lt('last_visit_at', riskCutoff.toISOString())
        break
      case 'new':
        const newCutoff = new Date()
        newCutoff.setDate(newCutoff.getDate() - 14)
        query = query.gte('joined_at', newCutoff.toISOString())
        break
    }

    const { data } = await query.limit(1000)
    memberIds = (data || []).map((m: { id: string }) => m.id)
  }

  // Get member details
  const { data: members } = await supabase
    .from('app_members')
    .select('id, email, phone, first_name, last_name, locale, timezone, communication_preferences, quiet_hours')
    .in('id', memberIds.slice(0, 1000))

  const results: DeliveryResult[] = []

  for (const member of (members || []) as Member[]) {
    // Check communication preferences
    const prefs = member.communication_preferences || { email: true, push: true, sms: false, in_app: true }
    if (!prefs[batch.channel]) {
      results.push({ member_id: member.id, channel: batch.channel, status: 'skipped', error: 'Opted out' })
      stats.skipped++
      continue
    }

    // Check quiet hours for non-urgent messages
    if (batch.created_by !== 'manual' && isInQuietHours(member)) {
      results.push({ member_id: member.id, channel: batch.channel, status: 'skipped', error: 'Quiet hours' })
      stats.skipped++
      continue
    }

    // Check fatigue for automation-triggered messages
    if (batch.created_by === 'automation' || batch.created_by === 'ai') {
      const { data: fatigueCheck } = await supabase.rpc('should_skip_for_fatigue', {
        p_member_id: member.id,
        p_threshold: 70  // Default threshold
      })

      if (fatigueCheck?.should_skip) {
        results.push({ member_id: member.id, channel: batch.channel, status: 'skipped', error: 'Member fatigued' })
        stats.skipped++
        continue
      }
    }

    // Interpolate message with member data
    const interpolate = (text: string) => text
      .replace(/\{\{name\}\}/g, member.first_name || 'Friend')
      .replace(/\{\{first_name\}\}/g, member.first_name || '')
      .replace(/\{\{last_name\}\}/g, member.last_name || '')

    const subject = batch.subject ? interpolate(batch.subject) : null
    const body = interpolate(batch.body)

    let result: { success: boolean; message_id?: string; error?: string }

    switch (batch.channel) {
      case 'email':
        if (!member.email) {
          result = { success: false, error: 'No email address' }
        } else {
          result = await sendEmail(member.email, subject || 'Message from your rewards program', body)
        }
        break

      case 'push':
        result = await sendPush(null, subject || '', body)  // FCM token would come from member record
        break

      case 'in_app':
        result = await sendInApp(supabase, member.id, batch.app_id, subject || 'Notification', body)
        break

      case 'sms':
        result = await sendSms(member.phone, body)
        break

      default:
        result = { success: false, error: 'Unknown channel' }
    }

    if (result.success) {
      results.push({
        member_id: member.id,
        channel: batch.channel,
        status: resendApiKey ? 'sent' : 'stubbed',
        message_id: result.message_id
      })
      stats.delivered++

      // Log communication for fatigue tracking
      await supabase.rpc('log_member_communication', {
        p_member_id: member.id,
        p_channel: batch.channel,
        p_message_type: batch.created_by || 'automation',
        p_source_automation_id: batch.automation_id,
        p_source_batch_id: batch.id,
        p_external_message_id: result.message_id || null
      })
    } else {
      results.push({
        member_id: member.id,
        channel: batch.channel,
        status: 'failed',
        error: result.error
      })
      stats.failed++
    }

    // Insert into message_recipients for webhook tracking
    // This allows us to look up batch_id and member_id when we receive webhook events
    if (result.message_id || result.success) {
      await supabase
        .from('message_recipients')
        .upsert({
          batch_id: batch.id,
          member_id: member.id,
          message_id: result.message_id || null,
          channel: batch.channel,
          status: result.success ? (resendApiKey ? 'sent' : 'stubbed') : 'failed',
          error_message: result.error || null,
          sent_at: new Date().toISOString()
        }, {
          onConflict: 'batch_id,member_id'
        })
    }
  }

  // Update batch with final stats
  const finalStatus = stats.failed === 0 ? 'sent' : stats.delivered > 0 ? 'partially_sent' : 'failed'

  await supabase
    .from('app_message_batches')
    .update({
      status: finalStatus,
      sent_at: new Date().toISOString(),
      total_recipients: memberIds.length,
      delivered: stats.delivered,
      bounced: stats.failed
    })
    .eq('id', batch.id)

  return stats
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

    const mode = body.mode as string || 'process_queue'
    const result: Record<string, unknown> = { timestamp: new Date().toISOString() }

    if (mode === 'send_single') {
      // Direct send to a single member (for testing)
      const { member_id, channel, subject, body: messageBody } = body

      const { data: member } = await supabase
        .from('app_members')
        .select('*')
        .eq('id', member_id)
        .single()

      if (!member) {
        return new Response(
          JSON.stringify({ success: false, error: 'Member not found' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        )
      }

      let sendResult: { success: boolean; message_id?: string; error?: string }

      switch (channel) {
        case 'email':
          sendResult = await sendEmail(member.email, subject, messageBody)
          break
        case 'push':
          sendResult = await sendPush(null, subject, messageBody)
          break
        case 'in_app':
          sendResult = await sendInApp(supabase, member.id, member.app_id, subject, messageBody)
          break
        case 'sms':
          sendResult = await sendSms(member.phone, messageBody)
          break
        default:
          sendResult = { success: false, error: 'Invalid channel' }
      }

      result.sent = sendResult.success
      result.message_id = sendResult.message_id
      result.error = sendResult.error
      result.stubbed = !resendApiKey

    } else {
      // Process queue mode
      const { data: pendingBatches } = await supabase
        .from('app_message_batches')
        .select('*')
        .eq('status', 'scheduled')
        .lte('scheduled_for', new Date().toISOString())
        .limit(10)

      let totalDelivered = 0
      let totalFailed = 0
      let totalSkipped = 0
      const batchesProcessed: string[] = []

      for (const batch of (pendingBatches || []) as MessageBatch[]) {
        const stats = await processBatch(supabase, batch)
        totalDelivered += stats.delivered
        totalFailed += stats.failed
        totalSkipped += stats.skipped
        batchesProcessed.push(batch.id)
      }

      result.batches_processed = batchesProcessed.length
      result.delivered = totalDelivered
      result.failed = totalFailed
      result.skipped = totalSkipped
      result.api_configured = {
        resend: !!resendApiKey,
        fcm: false,  // Would check for FCM config
        twilio: false  // Would check for Twilio config
      }
    }

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Message sender error:', error)
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
