// Supabase Edge Function: send-approved-outreach
// Sends emails from outreach_queue that are approved or past their veto window.
//
// Two modes:
//   Single:  POST { outreach_id: "uuid" }  — send one specific item immediately
//   Batch:   POST {}                        — process all pending approved items
//
// Called from:
//   - ceo.js immediately after Jay clicks "Approve & Send" (single mode)
//   - Cron every 30 min to auto-send veto-window-expired drafts (batch mode)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM_EMAIL = 'Royal <royal@royaltyapp.ai>'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ============================================================================
// EMAIL TEMPLATE
// ============================================================================

function wrapInTemplate(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color:#7c3aed;padding:24px 32px;">
              <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Royalty</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;color:#18181b;font-size:15px;line-height:1.7;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none;border-top:1px solid #e4e4e7;margin:0;">
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#fafafa;padding:20px 32px;">
              <p style="margin:0;font-size:12px;color:#71717a;line-height:1.6;">
                You received this message because you signed up for Royalty.<br>
                <a href="https://royaltyapp.ai" style="color:#7c3aed;text-decoration:none;">royaltyapp.ai</a>
                &nbsp;&middot;&nbsp; Royalty &middot; United States
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ============================================================================
// RESEND
// ============================================================================

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!RESEND_API_KEY) {
    console.log('[stub] Would send email to', to, '— no RESEND_API_KEY')
    return { success: true, messageId: 'stub-' + Date.now() }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      text,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    return { success: false, error: `Resend ${response.status}: ${err.slice(0, 200)}` }
  }

  const data = await response.json()
  return { success: true, messageId: data.id }
}

// ============================================================================
// SEND ONE ITEM
// ============================================================================

interface OutreachItem {
  id: string
  target_email: string
  target_name: string | null
  subject: string | null
  body_html: string
  body_text: string | null
  status: string
  veto_window_ends: string | null
}

async function sendItem(
  supabase: ReturnType<typeof createClient>,
  item: OutreachItem
): Promise<{ success: boolean; error?: string }> {
  const subject = item.subject || `A message from Royal at Royalty`
  const html = wrapInTemplate(item.body_html)
  const text = item.body_text || item.body_html.replace(/<[^>]+>/g, '')

  const result = await sendEmail(item.target_email, subject, html, text)

  if (result.success) {
    const { error } = await supabase
      .from('outreach_queue')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        outcome: result.messageId ? `Delivered via Resend (id: ${result.messageId})` : 'Sent (stub)',
      })
      .eq('id', item.id)

    if (error) {
      console.error('[send-approved-outreach] DB update failed after send:', error.message)
    }

    await supabase.from('self_growth_log').insert({
      action_type: 'outreach_sent',
      description: `Sent outreach email to ${item.target_name || item.target_email}: "${subject}"`,
      status: 'completed',
      metadata: { outreach_id: item.id, to: item.target_email, resend_id: result.messageId },
    })

    return { success: true }
  } else {
    // Mark as failed so it doesn't retry forever
    await supabase
      .from('outreach_queue')
      .update({
        status: 'draft',  // leave as draft so it retries next cycle
        outcome: `Send failed: ${result.error}`,
      })
      .eq('id', item.id)

    await supabase.from('self_growth_log').insert({
      action_type: 'outreach_failed',
      description: `Failed to send outreach to ${item.target_email}: ${result.error}`,
      status: 'failed',
      metadata: { outreach_id: item.id, error: result.error },
    })

    return { success: false, error: result.error }
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Auth: accept service role (cron) or admin JWT (CEO dashboard)
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // For non-service-role calls, verify the user is admin
  if (token && token !== supabaseServiceKey) {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const { data: profile } = await supabase
      .from('profiles').select('is_admin').eq('id', user.id).single()
    if (!profile?.is_admin) {
      return new Response(JSON.stringify({ error: 'Admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* no body = batch mode */ }

  const outreachId = body.outreach_id as string | undefined

  if (outreachId) {
    // ── Single mode: send one specific item ─────────────────────────────
    const { data: item, error } = await supabase
      .from('outreach_queue')
      .select('id, target_email, target_name, subject, body_html, body_text, status, veto_window_ends')
      .eq('id', outreachId)
      .in('status', ['approved', 'draft'])
      .single()

    if (error || !item) {
      return new Response(JSON.stringify({ success: false, error: 'Outreach item not found or already sent' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const result = await sendItem(supabase, item as OutreachItem)
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } else {
    // ── Batch mode: process all approved + auto-approved expired drafts ──
    const now = new Date().toISOString()

    const { data: approvedItems } = await supabase
      .from('outreach_queue')
      .select('id, target_email, target_name, subject, body_html, body_text, status, veto_window_ends')
      .eq('status', 'approved')
      .limit(20)

    const { data: expiredItems } = await supabase
      .from('outreach_queue')
      .select('id, target_email, target_name, subject, body_html, body_text, status, veto_window_ends')
      .eq('status', 'draft')
      .lt('veto_window_ends', now)
      .limit(20)

    const items = [...(approvedItems || []), ...(expiredItems || [])] as OutreachItem[]

    if (items.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: 'No items to send' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Auto-approve the expired drafts before sending
    const expiredIds = (expiredItems || []).map((i: OutreachItem) => i.id)
    if (expiredIds.length > 0) {
      await supabase
        .from('outreach_queue')
        .update({ status: 'approved', approved_by: 'auto-veto-expired' })
        .in('id', expiredIds)
    }

    let sent = 0
    let failed = 0
    const errors: string[] = []

    for (const item of items) {
      const result = await sendItem(supabase, item)
      if (result.success) {
        sent++
      } else {
        failed++
        errors.push(`${item.target_email}: ${result.error}`)
      }
    }

    console.log(`[send-approved-outreach] Batch complete: ${sent} sent, ${failed} failed`)

    return new Response(
      JSON.stringify({ success: true, sent, failed, errors: errors.slice(0, 5) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
