// Supabase Edge Function: Send Analysis Report
// Emails the pre-signup business analysis to a user without requiring an account.
// Rate limited: 3 per IP per hour. Uses Resend for delivery.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function sanitize(s: string, maxLen = 500): string {
  return String(s || '').replace(/[<>]/g, '').slice(0, maxLen).trim()
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const ICON_MAP: Record<string, string> = {
  revenue: '💰', retention: '🔄', engagement: '📈',
  loyalty: '👑', automation: '⚡', insights: '📊', growth: '🚀'
}

const COLOR_MAP: Record<string, string> = {
  green: '#10b981', purple: '#8b5cf6', blue: '#3b82f6'
}

function buildEmailHtml(analysis: any, businessName: string): string {
  const name = escapeHtml(businessName) || 'Your Business'
  const summary = escapeHtml(analysis.businessSummary || '')

  // Impact metrics
  const metricsHtml = (analysis.impactMetrics || []).map((m: any) => {
    const color = COLOR_MAP[m.color] || '#8b5cf6'
    const icon = ICON_MAP[m.icon] || '📊'
    return `
      <td style="padding: 12px; text-align: center; width: 33%;">
        <div style="font-size: 24px; margin-bottom: 4px;">${icon}</div>
        <div style="font-size: 28px; font-weight: 700; color: ${color}; margin-bottom: 4px;">${escapeHtml(m.value)}</div>
        <div style="font-size: 13px; color: #94a3b8;">${escapeHtml(m.label)}</div>
      </td>`
  }).join('')

  // Opportunities
  const oppsHtml = (analysis.opportunities || []).map((opp: any) => {
    const icon = ICON_MAP[opp.icon] || '🚀'
    const steps = (opp.actionSteps || []).map((s: string) =>
      `<li style="margin-bottom: 6px; color: #cbd5e1;">${escapeHtml(s)}</li>`
    ).join('')
    return `
      <div style="background: #1e1b4b; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
        <div style="font-size: 18px; font-weight: 600; color: #f8fafc; margin-bottom: 8px;">
          ${icon} ${escapeHtml(opp.title)}
        </div>
        <p style="color: #cbd5e1; font-size: 14px; line-height: 1.5; margin: 0 0 12px;">${escapeHtml(opp.description)}</p>
        <div style="font-size: 13px; font-weight: 600; color: #a78bfa; margin-bottom: 8px;">${escapeHtml(opp.impact)}</div>
        ${steps ? `<ul style="padding-left: 20px; margin: 0; font-size: 13px;">${steps}</ul>` : ''}
      </div>`
  }).join('')

  // Platform highlights
  const highlightsHtml = (analysis.platformHighlights || []).map((h: any) =>
    `<div style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
      <div style="font-weight: 600; color: #f8fafc; font-size: 14px;">✨ ${escapeHtml(h.name)}</div>
      <div style="color: #94a3b8; font-size: 13px; margin-top: 4px;">${escapeHtml(h.reason)}</div>
    </div>`
  ).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #0f0a2a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px;">

    <!-- Header -->
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="font-size: 32px; margin-bottom: 8px;">👑</div>
      <h1 style="color: #f8fafc; font-size: 22px; margin: 0;">Your Royalty Analysis</h1>
      <p style="color: #a78bfa; font-size: 15px; margin: 8px 0 0;">${name}</p>
    </div>

    <!-- Summary -->
    <div style="background: linear-gradient(135deg, #1e1b4b, #312e81); border-radius: 16px; padding: 24px; margin-bottom: 24px;">
      <p style="color: #e2e8f0; font-size: 15px; line-height: 1.6; margin: 0;">${summary}</p>
    </div>

    <!-- Impact Metrics -->
    <table style="width: 100%; margin-bottom: 24px;" cellpadding="0" cellspacing="0">
      <tr>${metricsHtml}</tr>
    </table>

    <!-- Opportunities -->
    <h2 style="color: #f8fafc; font-size: 18px; margin: 0 0 16px;">What Royalty Will Do For You</h2>
    ${oppsHtml}

    <!-- Platform Highlights -->
    <div style="background: #1e1b4b; border-radius: 12px; padding: 20px; margin-top: 24px;">
      <h2 style="color: #f8fafc; font-size: 16px; margin: 0 0 12px;">Platform Highlights</h2>
      ${highlightsHtml}
    </div>

    <!-- CTA -->
    <div style="text-align: center; margin-top: 32px;">
      <a href="https://royaltyapp.ai" style="display: inline-block; background: linear-gradient(135deg, #7c3aed, #a78bfa); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">
        Get Started Free
      </a>
      <p style="color: #64748b; font-size: 12px; margin-top: 16px;">
        Royalty — AI-powered loyalty for local businesses
      </p>
    </div>

  </div>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { email, analysis, businessName, language } = body

    // Validate email
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Valid email required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate analysis
    if (!analysis || !analysis.businessSummary) {
      return new Response(
        JSON.stringify({ success: false, error: 'Analysis data required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Rate limit: 3 per IP per hour
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

    try {
      const { data: allowed } = await supabase.rpc('check_and_record_rate_limit', {
        p_identifier: `report_email_${clientIp}`,
        p_action_type: 'report_email',
        p_max_attempts: 3,
        p_window_minutes: 60
      })

      if (allowed === false) {
        return new Response(
          JSON.stringify({ success: false, error: 'Too many requests. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } catch (e) {
      console.warn('Rate limit check failed, continuing:', e)
    }

    // Check Resend key
    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured')
      return new Response(
        JSON.stringify({ success: false, error: 'Email service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build and send email
    const safeName = sanitize(businessName, 200)
    const htmlBody = buildEmailHtml(analysis, safeName)
    const subject = safeName
      ? `Your Royalty Analysis — ${safeName}`
      : 'Your Royalty Business Analysis'

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Royalty <noreply@royaltyapp.ai>',
        to: [sanitize(email, 320)],
        subject,
        html: htmlBody
      })
    })

    const resendData = await resendRes.json()

    if (!resendRes.ok) {
      console.error('Resend error:', resendData)
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to send email' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, message_id: resendData.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (e) {
    console.error('Unhandled error in send-analysis-report:', e)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
