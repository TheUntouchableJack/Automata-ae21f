// Supabase Edge Function: Message Sender
// Processes message batches and delivers via email, push, SMS, or in-app
// Currently stubbed - integrations (Resend, FCM) added when API keys configured

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { wrapEmail } from '../_shared/email-template.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const resendApiKey = Deno.env.get('RESEND_API_KEY')

// Twilio configuration
const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN')
const twilioPhoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER')
const twilioWebhookUrl = `${supabaseUrl}/functions/v1/twilio-webhook`

// Firebase (FCM) configuration
const firebaseServiceAccount = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
const firebaseProjectId = Deno.env.get('FIREBASE_PROJECT_ID')

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
  fcm_token: string | null
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
        html: htmlBody ? wrapEmail(htmlBody) : wrapEmail(body.replace(/\n/g, '<br>'))
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
// PUSH NOTIFICATION (FCM HTTP v1 API)
// ============================================================================

let cachedFcmAccessToken: string | null = null
let fcmTokenExpiresAt = 0

async function getFcmAccessToken(): Promise<string> {
  if (cachedFcmAccessToken && Date.now() < fcmTokenExpiresAt - 300_000) {
    return cachedFcmAccessToken
  }

  if (!firebaseServiceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT not configured')
  }

  const sa = JSON.parse(firebaseServiceAccount)
  const { importPKCS8, SignJWT } = await import('https://deno.land/x/jose@v5.2.0/index.ts')
  const privateKey = await importPKCS8(sa.private_key, 'RS256')

  const now = Math.floor(Date.now() / 1000)
  const jwt = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.messaging'
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant_type:jwt-bearer',
      assertion: jwt
    })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(`OAuth2 token error: ${data.error_description || data.error}`)
  }

  cachedFcmAccessToken = data.access_token
  fcmTokenExpiresAt = Date.now() + (data.expires_in * 1000)
  return cachedFcmAccessToken!
}

async function sendPush(
  fcmToken: string | null,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  if (!fcmToken) {
    return { success: false, error: 'No FCM token' }
  }

  if (!firebaseServiceAccount || !firebaseProjectId) {
    console.log('[STUB] Would send push:', { fcmToken: fcmToken.slice(0, 20) + '...', title, body })
    return { success: true, message_id: `stub_push_${Date.now()}` }
  }

  try {
    const accessToken = await getFcmAccessToken()

    const message: Record<string, unknown> = {
      message: {
        token: fcmToken,
        notification: { title, body },
        webpush: {
          notification: {
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-72.png',
            tag: data?.tag || 'royalty-notification'
          },
          fcm_options: {
            link: data?.url || '/customer-app/app.html'
          }
        },
        ...(data ? { data } : {})
      }
    }

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      }
    )

    const result = await response.json()

    if (!response.ok) {
      const errorCode = result.error?.details?.[0]?.errorCode || result.error?.status
      if (errorCode === 'UNREGISTERED' || errorCode === 'NOT_FOUND') {
        return { success: false, error: 'TOKEN_EXPIRED' }
      }
      return { success: false, error: result.error?.message || 'FCM API error' }
    }

    return { success: true, message_id: result.name }
  } catch (error) {
    console.error('FCM send failed:', error)
    return { success: false, error: (error as Error).message }
  }
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
// SMS (Twilio)
// ============================================================================

async function sendSms(
  phone: string | null,
  body: string
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  if (!phone) {
    return { success: false, error: 'No phone number' }
  }

  // Check if Twilio is configured
  if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
    console.log('[STUB] Would send SMS:', { phone: phone.slice(0, 6) + '***', body: body.slice(0, 50) })
    return { success: true, message_id: `stub_sms_${Date.now()}` }
  }

  // Real Twilio API call
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(twilioAccountSid + ':' + twilioAuthToken)}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          To: phone,
          From: twilioPhoneNumber,
          Body: body,
          StatusCallback: twilioWebhookUrl
        })
      }
    )

    const data = await response.json()

    if (!response.ok || data.error_code) {
      console.error('Twilio API error:', data)
      return {
        success: false,
        error: data.message || data.error_message || 'Twilio API error'
      }
    }

    return { success: true, message_id: data.sid }
  } catch (error) {
    console.error('Twilio request failed:', error)
    return { success: false, error: (error as Error).message }
  }
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
// QUOTA CHECKING
// ============================================================================

interface QuotaCheckResult {
  allowed: boolean
  remaining: number
  limit: number
  error?: string
}

async function checkAndIncrementQuota(
  supabase: SupabaseClient,
  organizationId: string,
  channel: 'email' | 'sms',
  count: number = 1
): Promise<QuotaCheckResult> {
  try {
    // Use the appropriate increment function based on channel
    const rpcName = channel === 'sms' ? 'increment_sms_usage' : 'increment_email_usage'

    const { data, error } = await supabase.rpc(rpcName, {
      p_organization_id: organizationId,
      p_count: count
    })

    if (error) {
      console.error(`Quota check error for ${channel}:`, error)
      // On error, allow sending (fail open) but log it
      return { allowed: true, remaining: -1, limit: -1, error: error.message }
    }

    const result = data?.[0] || data
    const limitReached = result?.limit_reached === true
    const monthlyLimit = result?.monthly_limit || 0

    if (limitReached) {
      return {
        allowed: false,
        remaining: 0,
        limit: monthlyLimit,
        error: `Monthly ${channel} limit reached (${monthlyLimit})`
      }
    }

    return {
      allowed: true,
      remaining: monthlyLimit - (result?.new_count || 0),
      limit: monthlyLimit
    }
  } catch (err) {
    console.error(`Quota check exception for ${channel}:`, err)
    // Fail open on exceptions
    return { allowed: true, remaining: -1, limit: -1, error: (err as Error).message }
  }
}

// ============================================================================
// BATCH PROCESSOR
// ============================================================================

async function processBatch(
  supabase: SupabaseClient,
  batch: MessageBatch
): Promise<{ delivered: number; failed: number; skipped: number; quota_exceeded?: boolean }> {
  const stats = { delivered: 0, failed: 0, skipped: 0, quota_exceeded: false }

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
    .select('id, email, phone, fcm_token, first_name, last_name, locale, timezone, communication_preferences, quiet_hours')
    .in('id', memberIds.slice(0, 1000))

  const results: DeliveryResult[] = []

  // Batch fatigue check: single query for all members instead of N individual RPCs
  const fatiguedMemberIds = new Set<string>()
  if (batch.created_by === 'automation' || batch.created_by === 'ai') {
    const { data: fatigueResults } = await supabase.rpc('batch_check_fatigue', {
      p_member_ids: memberIds.slice(0, 1000),
      p_threshold: 70
    })
    if (fatigueResults) {
      for (const result of fatigueResults) {
        if (result.should_skip) {
          fatiguedMemberIds.add(result.member_id)
        }
      }
    }
  }

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

    // Check fatigue using pre-fetched batch results
    if (fatiguedMemberIds.has(member.id)) {
      results.push({ member_id: member.id, channel: batch.channel, status: 'skipped', error: 'Member fatigued' })
      stats.skipped++
      continue
    }

    // Interpolate message with member data
    const interpolate = (text: string) => text
      .replace(/\{\{name\}\}/g, member.first_name || 'Friend')
      .replace(/\{\{first_name\}\}/g, member.first_name || '')
      .replace(/\{\{last_name\}\}/g, member.last_name || '')

    const subject = batch.subject ? interpolate(batch.subject) : null
    const body = interpolate(batch.body)

    let result: { success: boolean; message_id?: string; error?: string }

    // Check quota for email and SMS channels
    if (batch.channel === 'email' || batch.channel === 'sms') {
      const quotaCheck = await checkAndIncrementQuota(supabase, batch.organization_id, batch.channel, 1)

      if (!quotaCheck.allowed) {
        results.push({
          member_id: member.id,
          channel: batch.channel,
          status: 'skipped',
          error: quotaCheck.error || 'Quota exceeded'
        })
        stats.skipped++
        stats.quota_exceeded = true
        // Stop processing this batch if quota is exceeded
        console.log(`Quota exceeded for org ${batch.organization_id}, stopping batch processing`)
        break
      }
    }

    switch (batch.channel) {
      case 'email':
        if (!member.email) {
          result = { success: false, error: 'No email address' }
        } else {
          result = await sendEmail(member.email, subject || 'Message from your rewards program', body)
        }
        break

      case 'push':
        result = await sendPush(member.fcm_token, subject || '', body)
        if (!result.success && result.error === 'TOKEN_EXPIRED') {
          await supabase.from('app_members').update({ fcm_token: null }).eq('id', member.id)
        }
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
    return new Response('ok', { headers: getCorsHeaders(req) })
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
        .select('id, email, phone, fcm_token, first_name, last_name, locale, timezone, communication_preferences, quiet_hours')
        .eq('id', member_id)
        .single()

      if (!member) {
        return new Response(
          JSON.stringify({ success: false, error: 'Member not found' }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 404 }
        )
      }

      let sendResult: { success: boolean; message_id?: string; error?: string }

      switch (channel) {
        case 'email':
          sendResult = await sendEmail(member.email, subject, messageBody)
          break
        case 'push':
          sendResult = await sendPush(member.fcm_token, subject, messageBody)
          if (!sendResult.success && sendResult.error === 'TOKEN_EXPIRED') {
            await supabase.from('app_members').update({ fcm_token: null }).eq('id', member.id)
          }
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
      // Process queue mode (limit to 3 batches per invocation for backpressure)
      const { data: pendingBatches } = await supabase
        .from('app_message_batches')
        .select('id, organization_id, app_id, channel, subject, body, automation_id, segment, member_ids, scheduled_for, status, created_by')
        .eq('status', 'scheduled')
        .lte('scheduled_for', new Date().toISOString())
        .limit(3)

      let totalDelivered = 0
      let totalFailed = 0
      let totalSkipped = 0
      const batchesProcessed: string[] = []
      const executionStart = Date.now()
      const MAX_EXECUTION_MS = 25000  // 25s safety margin (Deno limit is 60s)

      for (const batch of (pendingBatches || []) as MessageBatch[]) {
        // Execution time guard: defer remaining batches if running long
        if (Date.now() - executionStart > MAX_EXECUTION_MS) {
          console.warn(`Execution time limit reached (${Date.now() - executionStart}ms), deferring remaining batches`)
          break
        }

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
        fcm: !!firebaseServiceAccount && !!firebaseProjectId,
        twilio: !!twilioAccountSid && !!twilioAuthToken && !!twilioPhoneNumber
      }
    }

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Message sender error:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Message sending failed' }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
