// Supabase Edge Function: Twilio Webhook Handler
// Processes:
// 1. SMS delivery status events (queued, sent, delivered, failed, undelivered)
// 2. Inbound SMS messages for data collection replies

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-twilio-signature',
}

// Twilio webhook payload fields for status updates
interface TwilioStatusPayload {
  MessageSid: string
  MessageStatus: string
  To: string
  From: string
  ErrorCode?: string
  ErrorMessage?: string
  AccountSid: string
}

// Twilio webhook payload fields for inbound messages
interface TwilioInboundPayload {
  MessageSid: string
  Body: string
  From: string
  To: string
  AccountSid: string
  NumMedia?: string
}

// Verify Twilio webhook signature
async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null
): Promise<boolean> {
  if (!twilioAuthToken) {
    console.error('TWILIO_AUTH_TOKEN not configured - rejecting webhook')
    return false  // Fail-closed: reject if not configured
  }

  if (!signature) {
    console.error('Missing X-Twilio-Signature header')
    return false
  }

  try {
    // Build the string to sign: URL + sorted params
    const sortedKeys = Object.keys(params).sort()
    let dataString = url
    for (const key of sortedKeys) {
      dataString += key + params[key]
    }

    // Calculate HMAC-SHA1 signature
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(twilioAuthToken),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )

    const signatureBytes = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(dataString)
    )

    const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))

    if (signature !== expectedSignature) {
      console.error('Signature mismatch')
      return false
    }

    return true
  } catch (e) {
    console.error('Signature verification error:', e)
    return false
  }
}

// Parse URL-encoded form data
function parseFormData(body: string): Record<string, string> {
  const params: Record<string, string> = {}
  const pairs = body.split('&')
  for (const pair of pairs) {
    const [key, value] = pair.split('=')
    if (key && value !== undefined) {
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '))
    }
  }
  return params
}

// Normalize phone number to E.164 format
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) {
    return '+1' + digits
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return '+' + digits
  }
  if (!phone.startsWith('+')) {
    return '+' + digits
  }
  return phone
}

// Parse birthday from user input (flexible formats)
function parseBirthday(input: string): Date | null {
  const cleaned = input.trim().toLowerCase()

  // Common patterns
  const patterns = [
    /(\d{1,2})[\/\-](\d{1,2})/,           // 03/15, 3-15
    /(\w+)\s+(\d{1,2})/,                   // March 15, mar 15
    /(\d{1,2})\s+(\w+)/,                   // 15 March
  ]

  const monthNames: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12
  }

  for (const pattern of patterns) {
    const match = cleaned.match(pattern)
    if (match) {
      let month: number | undefined
      let day: number | undefined

      if (isNaN(parseInt(match[1]))) {
        // Month name first
        month = monthNames[match[1]]
        day = parseInt(match[2])
      } else if (isNaN(parseInt(match[2]))) {
        // Day first, then month name
        day = parseInt(match[1])
        month = monthNames[match[2]]
      } else {
        // Both numbers - assume MM/DD
        month = parseInt(match[1])
        day = parseInt(match[2])
      }

      if (month && day && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return new Date(2000, month - 1, day) // Year doesn't matter for birthday
      }
    }
  }

  return null
}

// Validate email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email.trim())
}

// Handle inbound SMS for data collection
async function handleInboundSMS(
  supabase: ReturnType<typeof createClient>,
  from: string,
  body: string,
  _messageSid: string
): Promise<{ handled: boolean; response?: string }> {
  const normalizedPhone = normalizePhone(from)
  const reply = body.trim()

  // Find member by phone number with pending collection
  const { data: member, error: memberError } = await supabase
    .from('app_members')
    .select(`
      id,
      app_id,
      pending_collection_type,
      pending_collection_campaign_id,
      name,
      phone,
      email,
      birthday
    `)
    .eq('phone', normalizedPhone)
    .not('pending_collection_type', 'is', null)
    .single()

  if (memberError || !member) {
    // Check without pending filter - might be opt-out or general reply
    const { data: anyMember } = await supabase
      .from('app_members')
      .select('id, app_id')
      .eq('phone', normalizedPhone)
      .single()

    if (anyMember) {
      // Check for STOP/opt-out
      if (/^(stop|unsubscribe|cancel|quit|end)$/i.test(reply)) {
        // Handle opt-out
        await supabase
          .from('customer_preferences')
          .upsert({
            member_id: anyMember.id,
            sms_opt_in: false,
            do_not_contact: true,
            opted_out_at: new Date().toISOString()
          })

        return {
          handled: true,
          response: 'You have been unsubscribed. Reply START to resubscribe.'
        }
      }

      // Check for START/opt-in
      if (/^(start|subscribe|yes)$/i.test(reply)) {
        await supabase
          .from('customer_preferences')
          .upsert({
            member_id: anyMember.id,
            sms_opt_in: true,
            do_not_contact: false,
            opted_out_at: null
          })

        return {
          handled: true,
          response: 'Welcome back! You will now receive our messages.'
        }
      }
    }

    // No pending collection and not opt-out - ignore
    console.log(`No pending collection for ${normalizedPhone}`)
    return { handled: false }
  }

  // Get organization ID from app
  const { data: app } = await supabase
    .from('apps')
    .select('organization_id')
    .eq('id', member.app_id)
    .single()

  if (!app) {
    return { handled: false }
  }

  const organizationId = app.organization_id
  const collectionType = member.pending_collection_type
  const campaignId = member.pending_collection_campaign_id

  console.log(`Processing ${collectionType} collection reply from ${normalizedPhone}: "${reply}"`)

  let success = false
  let responseMessage = ''

  switch (collectionType) {
    case 'birthday': {
      const parsed = parseBirthday(reply)
      if (parsed) {
        // Update member birthday
        const { error: updateError } = await supabase
          .from('app_members')
          .update({
            birthday: parsed.toISOString().split('T')[0],
            pending_collection_type: null,
            pending_collection_campaign_id: null,
            pending_collection_sent_at: null
          })
          .eq('id', member.id)

        if (!updateError) {
          success = true
          const monthDay = parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
          responseMessage = `Got it! See you ${monthDay}! We'll have a special treat for you.`

          // Award points
          await supabase.rpc('award_profile_completion_points', {
            p_member_id: member.id,
            p_field: 'birthday',
            p_organization_id: organizationId
          })
        }
      } else {
        responseMessage = `Hmm, I didn't catch that. Reply with your birthday like "03/15" or "March 15"`
      }
      break
    }

    case 'email': {
      if (isValidEmail(reply)) {
        const { error: updateError } = await supabase
          .from('app_members')
          .update({
            email: reply.trim().toLowerCase(),
            pending_collection_type: null,
            pending_collection_campaign_id: null,
            pending_collection_sent_at: null
          })
          .eq('id', member.id)

        if (!updateError) {
          success = true
          responseMessage = `Email added! Check your inbox for a welcome gift.`

          await supabase.rpc('award_profile_completion_points', {
            p_member_id: member.id,
            p_field: 'email',
            p_organization_id: organizationId
          })
        }
      } else {
        responseMessage = `That doesn't look like an email address. Try again?`
      }
      break
    }

    case 'preferences': {
      // Handle numbered choice replies (1, 2, 3, 4)
      const choice = parseInt(reply.trim())
      if (!isNaN(choice) && choice >= 1 && choice <= 4) {
        const { error: updateError } = await supabase
          .from('app_members')
          .update({
            pending_collection_type: null,
            pending_collection_campaign_id: null,
            pending_collection_sent_at: null
          })
          .eq('id', member.id)

        if (!updateError) {
          success = true
          responseMessage = `Perfect, noted!`

          await supabase.rpc('award_profile_completion_points', {
            p_member_id: member.id,
            p_field: 'preferences',
            p_organization_id: organizationId
          })
        }
      } else {
        responseMessage = `Just reply with 1, 2, 3, or 4`
      }
      break
    }

    default:
      console.log(`Unknown collection type: ${collectionType}`)
      return { handled: false }
  }

  // Record the attempt outcome
  if (campaignId) {
    await supabase.rpc('record_collection_attempt', {
      p_campaign_id: campaignId,
      p_member_id: member.id,
      p_organization_id: organizationId,
      p_touchpoint: 'sms_reply',
      p_channel: 'sms',
      p_outcome: success ? 'collected' : 'invalid',
      p_collected_value: null // Don't store PII
    })
  }

  return {
    handled: true,
    response: responseMessage
  }
}

// Handle status webhook (delivery receipts)
async function handleStatusWebhook(
  supabase: ReturnType<typeof createClient>,
  payload: TwilioStatusPayload
): Promise<{ success: boolean; result?: unknown }> {
  const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = payload

  const { data: result, error } = await supabase.rpc('process_sms_event', {
    p_message_sid: MessageSid,
    p_status: MessageStatus.toLowerCase(),
    p_error_code: ErrorCode || null,
    p_error_message: ErrorMessage || null,
    p_occurred_at: new Date().toISOString()
  })

  if (error) {
    console.error('Error processing status event:', error)
    return { success: false }
  }

  return { success: true, result }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    // Twilio sends form-urlencoded data
    const body = await req.text()
    const params = parseFormData(body)

    // Get the full URL for signature verification
    const url = req.url

    // Verify webhook signature
    const signature = req.headers.get('x-twilio-signature')
    const isValid = await verifyTwilioSignature(url, params, signature)
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Determine if this is inbound message or status callback
    // Inbound messages have Body but no MessageStatus
    const isInbound = params.Body !== undefined && !params.MessageStatus

    if (isInbound) {
      // Handle inbound SMS
      const inboundPayload: TwilioInboundPayload = {
        MessageSid: params.MessageSid || params.SmsSid,
        Body: params.Body,
        From: params.From,
        To: params.To,
        AccountSid: params.AccountSid,
        NumMedia: params.NumMedia
      }

      console.log(`Inbound SMS from ${inboundPayload.From}: "${inboundPayload.Body}"`)

      const { handled, response } = await handleInboundSMS(
        supabase,
        inboundPayload.From,
        inboundPayload.Body,
        inboundPayload.MessageSid
      )

      const duration = Date.now() - startTime
      console.log(`Processed inbound SMS in ${duration}ms, handled: ${handled}`)

      // Return TwiML response if we have a reply
      if (response) {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${response}</Message>
</Response>`
        return new Response(twiml, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
        })
      }

      // Empty response if no reply needed
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      )
    }

    // Handle status webhook
    const statusPayload: TwilioStatusPayload = {
      MessageSid: params.MessageSid || params.SmsSid,
      MessageStatus: params.MessageStatus || params.SmsStatus,
      To: params.To,
      From: params.From,
      ErrorCode: params.ErrorCode,
      ErrorMessage: params.ErrorMessage,
      AccountSid: params.AccountSid
    }

    if (!statusPayload.MessageSid || !statusPayload.MessageStatus) {
      return new Response(
        JSON.stringify({ error: 'Missing MessageSid or MessageStatus' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Processing Twilio status: ${statusPayload.MessageStatus} for ${statusPayload.MessageSid}`)

    const { success, result } = await handleStatusWebhook(supabase, statusPayload)

    const duration = Date.now() - startTime
    console.log(`Processed status in ${duration}ms:`, result)

    return new Response(
      JSON.stringify({
        received: true,
        result,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (e) {
    console.error('Webhook error:', e)
    // Return 200 to prevent Twilio retries on parsing errors
    return new Response(
      JSON.stringify({ error: 'Internal webhook error' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
