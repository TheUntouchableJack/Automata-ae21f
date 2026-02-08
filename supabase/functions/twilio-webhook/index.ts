// Supabase Edge Function: Twilio Webhook Handler
// Processes SMS delivery status events (queued, sent, delivered, failed, undelivered)
// Updates message_events table and app_message_batches counters

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-twilio-signature',
}

// Twilio webhook payload fields
interface TwilioWebhookPayload {
  MessageSid: string
  MessageStatus: string
  To: string
  From: string
  ErrorCode?: string
  ErrorMessage?: string
  AccountSid: string
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

    // Extract Twilio payload
    const payload: TwilioWebhookPayload = {
      MessageSid: params.MessageSid || params.SmsSid,
      MessageStatus: params.MessageStatus || params.SmsStatus,
      To: params.To,
      From: params.From,
      ErrorCode: params.ErrorCode,
      ErrorMessage: params.ErrorMessage,
      AccountSid: params.AccountSid
    }

    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = payload

    if (!MessageSid || !MessageStatus) {
      return new Response(
        JSON.stringify({ error: 'Missing MessageSid or MessageStatus' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Processing Twilio event: ${MessageStatus} for MessageSid: ${MessageSid}`)

    // Process event using RPC
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: result, error } = await supabase.rpc('process_sms_event', {
      p_message_sid: MessageSid,
      p_status: MessageStatus.toLowerCase(),
      p_error_code: ErrorCode || null,
      p_error_message: ErrorMessage || null,
      p_occurred_at: new Date().toISOString()
    })

    if (error) {
      console.error('Error processing event:', error)
      // Return 200 to Twilio even on error (they'll retry on non-2xx)
      return new Response(
        JSON.stringify({ received: true, error: 'Failed to process event' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const duration = Date.now() - startTime
    console.log(`Processed ${MessageStatus} in ${duration}ms:`, result)

    // Twilio expects empty 200 response or TwiML
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
