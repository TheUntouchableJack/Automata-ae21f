// Supabase Edge Function: Proposal Visitor Notification
// Sends branded emails to proposal visitors when:
//   - AI auto-responds to their question
//   - Admin confirms/edits an answer
//   - Admin approves a feature request

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const ADMIN_KEY = '24hd-jay-admin-2026'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface NotifyPayload {
  type: 'qa_ai_response' | 'qa_answered' | 'feature_approved'
  admin_key: string
  proposal_id: string
  proposal_name: string
  question?: string
  answer?: string
  feature_name?: string
  feature_description?: string
  hours_low?: number
  hours_high?: number
  new_total_hours?: number
  new_total_price?: number
}

interface Visitor {
  first_name: string
  last_name: string
  email: string
}

function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text || ''
  return text.substring(0, max) + '...'
}

function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatProposalName(id: string): string {
  return id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function proposalUrl(id: string): string {
  return `https://24hourdesigns.netlify.app/?client=${id}`
}

// --- Email Templates ---

function qaAiResponseEmail(visitor: Visitor, payload: NotifyPayload): { subject: string; html: string } {
  const name = escapeHtml(payload.proposal_name || formatProposalName(payload.proposal_id))
  const question = escapeHtml(truncate(payload.question || '', 500))
  const answer = escapeHtml(truncate(payload.answer || '', 500))
  const url = proposalUrl(payload.proposal_id)

  return {
    subject: `We received your question \u2014 ${payload.proposal_name || formatProposalName(payload.proposal_id)}`,
    html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
  <div style="background: #1a1a2e; padding: 24px 32px;">
    <h1 style="color: #ffffff; font-size: 18px; margin: 0; font-weight: 600;">24 Hour Designs</h1>
  </div>
  <div style="padding: 32px;">
    <p style="color: #333; font-size: 16px; margin-bottom: 8px;">Hi ${escapeHtml(visitor.first_name)},</p>
    <p style="color: #666; margin-bottom: 24px;">Thanks for your question on the <strong>${name}</strong> proposal. Here's an initial response while Jay reviews it.</p>

    <div style="background: #f8f9fa; border-left: 4px solid #8b5cf6; padding: 16px; margin-bottom: 16px;">
      <p style="color: #999; font-size: 12px; text-transform: uppercase; margin: 0 0 8px 0;">Your Question</p>
      <p style="color: #333; margin: 0; font-style: italic;">&ldquo;${question}&rdquo;</p>
    </div>

    <div style="background: #f0f0ff; border-left: 4px solid #8b5cf6; padding: 16px; margin-bottom: 24px;">
      <p style="color: #999; font-size: 12px; text-transform: uppercase; margin: 0 0 8px 0;">AI Response</p>
      <p style="color: #333; margin: 0;">${answer}</p>
    </div>

    <p style="color: #666; font-size: 14px; margin-bottom: 24px;">Jay will follow up personally if needed. You'll receive another email when a final answer is posted.</p>

    <a href="${url}" style="display: inline-block; background: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">View Your Proposal</a>

    <p style="color: #999; font-size: 12px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">
      24 Hour Designs &middot; <a href="mailto:jay@24hour.design" style="color: #8b5cf6;">jay@24hour.design</a>
    </p>
  </div>
</div>`
  }
}

function qaAnsweredEmail(visitor: Visitor, payload: NotifyPayload): { subject: string; html: string } {
  const name = escapeHtml(payload.proposal_name || formatProposalName(payload.proposal_id))
  const question = escapeHtml(truncate(payload.question || '', 500))
  const answer = escapeHtml(truncate(payload.answer || '', 500))
  const url = proposalUrl(payload.proposal_id)

  return {
    subject: `Your question has been answered \u2014 ${payload.proposal_name || formatProposalName(payload.proposal_id)}`,
    html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
  <div style="background: #1a1a2e; padding: 24px 32px;">
    <h1 style="color: #ffffff; font-size: 18px; margin: 0; font-weight: 600;">24 Hour Designs</h1>
  </div>
  <div style="padding: 32px;">
    <p style="color: #333; font-size: 16px; margin-bottom: 8px;">Hi ${escapeHtml(visitor.first_name)},</p>
    <p style="color: #666; margin-bottom: 24px;">Jay has responded to your question on the <strong>${name}</strong> proposal.</p>

    <div style="background: #f8f9fa; border-left: 4px solid #8b5cf6; padding: 16px; margin-bottom: 16px;">
      <p style="color: #999; font-size: 12px; text-transform: uppercase; margin: 0 0 8px 0;">Your Question</p>
      <p style="color: #333; margin: 0; font-style: italic;">&ldquo;${question}&rdquo;</p>
    </div>

    <div style="background: #f0f0ff; border-left: 4px solid #8b5cf6; padding: 16px; margin-bottom: 24px;">
      <p style="color: #999; font-size: 12px; text-transform: uppercase; margin: 0 0 8px 0;">Jay&rsquo;s Answer</p>
      <p style="color: #333; margin: 0;">${answer}</p>
    </div>

    <a href="${url}" style="display: inline-block; background: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">View Your Proposal</a>

    <p style="color: #999; font-size: 12px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">
      24 Hour Designs &middot; <a href="mailto:jay@24hour.design" style="color: #8b5cf6;">jay@24hour.design</a>
    </p>
  </div>
</div>`
  }
}

function featureApprovedEmail(visitor: Visitor, payload: NotifyPayload): { subject: string; html: string } {
  const name = escapeHtml(payload.proposal_name || formatProposalName(payload.proposal_id))
  const featureName = escapeHtml(payload.feature_name || 'New Feature')
  const featureDesc = payload.feature_description ? escapeHtml(truncate(payload.feature_description, 300)) : ''
  const url = proposalUrl(payload.proposal_id)

  const hoursStr = payload.hours_low && payload.hours_high
    ? `${payload.hours_low}\u2013${payload.hours_high} hours`
    : payload.hours_low ? `${payload.hours_low} hours` : ''

  const totalsBlock = payload.new_total_price ? `
    <div style="background: #f0f0ff; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <p style="color: #999; font-size: 12px; text-transform: uppercase; margin: 0 0 8px 0;">Updated Project Totals</p>
      <p style="color: #1a1a2e; font-size: 18px; font-weight: 600; margin: 0;">
        $${Number(payload.new_total_price).toLocaleString()}
      </p>
    </div>` : ''

  return {
    subject: `Your proposal has been updated \u2014 ${payload.proposal_name || formatProposalName(payload.proposal_id)}`,
    html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
  <div style="background: #1a1a2e; padding: 24px 32px;">
    <h1 style="color: #ffffff; font-size: 18px; margin: 0; font-weight: 600;">24 Hour Designs</h1>
  </div>
  <div style="padding: 32px;">
    <p style="color: #333; font-size: 16px; margin-bottom: 8px;">Hi ${escapeHtml(visitor.first_name)},</p>
    <p style="color: #666; margin-bottom: 24px;">A new feature has been approved and added to your <strong>${name}</strong> proposal.</p>

    <div style="background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <h3 style="color: #1a1a2e; margin: 0 0 8px 0; font-size: 16px;">${featureName}</h3>
      ${featureDesc ? `<p style="color: #666; margin: 0 0 12px 0; font-size: 14px;">${featureDesc}</p>` : ''}
      ${hoursStr ? `<span style="color: #8b5cf6; font-size: 14px; font-weight: 500;">+${hoursStr}</span>` : ''}
    </div>

    ${totalsBlock}

    <a href="${url}" style="display: inline-block; background: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">View Updated Proposal</a>

    <p style="color: #999; font-size: 12px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">
      24 Hour Designs &middot; <a href="mailto:jay@24hour.design" style="color: #8b5cf6;">jay@24hour.design</a>
    </p>
  </div>
</div>`
  }
}

// --- Main Handler ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const contentLength = parseInt(req.headers.get('Content-Length') || '0')
    if (contentLength > 10000) {
      return new Response(
        JSON.stringify({ error: 'Payload too large' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const payload: NotifyPayload = await req.json()

    // Validate admin key
    if (payload.admin_key !== ADMIN_KEY) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate required fields
    if (!payload.proposal_id || !payload.type) {
      return new Response(
        JSON.stringify({ error: 'Missing proposal_id or type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured')
      return new Response(
        JSON.stringify({ error: 'Email service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Look up all visitors for this proposal
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: visitors, error: dbError } = await supabase
      .from('proposal_visitors')
      .select('first_name, last_name, email')
      .eq('proposal_id', payload.proposal_id)

    if (dbError) {
      console.error('DB lookup error:', dbError)
      return new Response(
        JSON.stringify({ error: 'Failed to look up visitors' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!visitors || visitors.length === 0) {
      return new Response(
        JSON.stringify({ success: true, emails_sent: 0, reason: 'no_visitors' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Send personalized email to each visitor
    const results = await Promise.all(visitors.map(async (visitor: Visitor) => {
      let email: { subject: string; html: string }

      switch (payload.type) {
        case 'qa_ai_response':
          email = qaAiResponseEmail(visitor, payload)
          break
        case 'qa_answered':
          email = qaAnsweredEmail(visitor, payload)
          break
        case 'feature_approved':
          email = featureApprovedEmail(visitor, payload)
          break
        default:
          return { email: visitor.email, success: false, error: 'Unknown type' }
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: '24 Hour Designs <noreply@24hour.design>',
          to: [visitor.email],
          subject: email.subject,
          html: email.html,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error(`Failed to email ${visitor.email}:`, errText)
        return { email: visitor.email, success: false, error: errText }
      }

      const data = await res.json()
      console.log(`Email sent to ${visitor.email}:`, data.id)
      return { email: visitor.email, success: true, id: data.id }
    }))

    const sent = results.filter(r => r.success).length
    return new Response(
      JSON.stringify({ success: true, emails_sent: sent, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error processing notification:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
