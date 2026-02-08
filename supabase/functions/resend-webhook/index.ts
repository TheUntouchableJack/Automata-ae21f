// Supabase Edge Function: Resend Webhook Handler
// Processes email engagement events (delivered, opened, clicked, bounced, unsubscribed)
// Updates message_events table and app_message_batches counters

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const resendWebhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
}

// Resend webhook event types
type ResendEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.complained'
  | 'email.bounced'
  | 'email.opened'
  | 'email.clicked'

interface ResendWebhookPayload {
  type: ResendEventType
  created_at: string
  data: {
    email_id: string
    from: string
    to: string[]
    subject: string
    created_at: string
    // For clicks
    click?: {
      ipAddress: string
      link: string
      timestamp: string
      userAgent: string
    }
    // For bounces
    bounce?: {
      message: string
    }
  }
}

// Map Resend event types to our internal types
function mapEventType(resendType: ResendEventType): string | null {
  switch (resendType) {
    case 'email.delivered':
      return 'delivered'
    case 'email.opened':
      return 'opened'
    case 'email.clicked':
      return 'clicked'
    case 'email.bounced':
      return 'bounced'
    case 'email.complained':
      return 'complained'
    default:
      return null  // email.sent and email.delivery_delayed don't need tracking
  }
}

// Verify Resend webhook signature (using Svix)
async function verifyWebhookSignature(
  payload: string,
  headers: Headers
): Promise<boolean> {
  if (!resendWebhookSecret) {
    console.error('RESEND_WEBHOOK_SECRET not configured - rejecting webhook')
    return false  // Fail-closed: reject if not configured
  }

  const svixId = headers.get('svix-id')
  const svixTimestamp = headers.get('svix-timestamp')
  const svixSignature = headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error('Missing Svix headers')
    return false
  }

  // Verify timestamp is recent (within 5 minutes)
  const timestamp = parseInt(svixTimestamp)
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestamp) > 300) {
    console.error('Webhook timestamp too old')
    return false
  }

  // Verify signature
  try {
    const signedPayload = `${svixId}.${svixTimestamp}.${payload}`
    const encoder = new TextEncoder()

    // Decode the base64 secret (remove "whsec_" prefix)
    const secretBytes = Uint8Array.from(
      atob(resendWebhookSecret.replace('whsec_', '')),
      c => c.charCodeAt(0)
    )

    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signatureBytes = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(signedPayload)
    )

    const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))

    // Check if any of the provided signatures match
    const providedSignatures = svixSignature.split(' ')
    for (const sig of providedSignatures) {
      const [version, signature] = sig.split(',')
      if (version === 'v1' && signature === expectedSignature) {
        return true
      }
    }

    console.error('Signature mismatch')
    return false
  } catch (e) {
    console.error('Signature verification error:', e)
    return false
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    const body = await req.text()

    // Verify webhook signature
    const isValid = await verifyWebhookSignature(body, req.headers)
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse payload
    const payload: ResendWebhookPayload = JSON.parse(body)
    const { type, data, created_at } = payload

    console.log(`Processing Resend event: ${type} for email_id: ${data.email_id}`)

    // Map to internal event type
    const eventType = mapEventType(type)
    if (!eventType) {
      // Event type we don't track (e.g., email.sent)
      return new Response(
        JSON.stringify({ received: true, skipped: true, reason: 'Event type not tracked' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build event data
    const eventData: Record<string, unknown> = {}

    if (type === 'email.clicked' && data.click) {
      eventData.link = data.click.link
      eventData.ip_address = data.click.ipAddress
      eventData.user_agent = data.click.userAgent
    }

    if (type === 'email.bounced' && data.bounce) {
      eventData.reason = data.bounce.message
    }

    if (type === 'email.complained') {
      eventData.complaint = true
    }

    // Process event using RPC
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: result, error } = await supabase.rpc('process_email_event', {
      p_message_id: data.email_id,
      p_event_type: eventType,
      p_event_data: Object.keys(eventData).length > 0 ? eventData : null,
      p_occurred_at: created_at
    })

    if (error) {
      console.error('Error processing event:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to process event' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const duration = Date.now() - startTime
    console.log(`Processed ${type} in ${duration}ms:`, result)

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
    return new Response(
      JSON.stringify({ error: 'Internal webhook error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
