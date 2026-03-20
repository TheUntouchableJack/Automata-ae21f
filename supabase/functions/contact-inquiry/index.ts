// Supabase Edge Function: Contact Inquiry
// Sends contact form emails to jay@24hour.design via Resend.
// Used by: estimate page, pricing enterprise, settings support, upgrade, app-builder errors.
// No JWT required — rate limited by IP.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { wrapEmail } from '../_shared/email-template.ts'

const NOTIFY_EMAIL = 'jay@24hour.design'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function sanitize(s: string, maxLen = 500): string {
  return String(s || '').replace(/[<>]/g, '').slice(0, maxLen).trim()
}

const TYPE_SUBJECTS: Record<string, string> = {
  'custom-app': 'Custom App Consultation Request',
  'enterprise': 'Enterprise Plan Inquiry',
  'support': 'Support Request',
  'general': 'Contact Inquiry',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const type = sanitize(body.type || 'general', 50)
    const name = sanitize(body.name || '', 200)
    const email = sanitize(body.email || '', 200)
    const phone = sanitize(body.phone || '', 50)
    const message = sanitize(body.message || '', 2000)
    const source = sanitize(body.source || '', 100)

    if (!email || !email.includes('@')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Valid email required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Rate limit: 5 per hour per IP
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

    try {
      const { data: allowed } = await supabase.rpc('check_and_record_rate_limit', {
        p_identifier: `contact_${clientIp}`,
        p_action_type: 'contact_inquiry',
        p_max_attempts: 5,
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

    const subject = TYPE_SUBJECTS[type] || TYPE_SUBJECTS['general']

    const htmlBody = wrapEmail(`
      <h2 style="margin: 0 0 4px; color: #1a1a2e; font-size: 20px;">${subject}</h2>
      <p style="margin: 0 0 20px; color: #71717a; font-size: 14px;">From ${source || 'royaltyapp.ai'}</p>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px 0; color: #6b7280; width: 100px;">Name</td><td style="padding: 8px 0;">${name || 'Not provided'}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7280;">Email</td><td style="padding: 8px 0;"><a href="mailto:${email}" style="color: #7c3aed;">${email}</a></td></tr>
        ${phone ? `<tr><td style="padding: 8px 0; color: #6b7280;">Phone</td><td style="padding: 8px 0;">${phone}</td></tr>` : ''}
        <tr><td style="padding: 8px 0; color: #6b7280;">Type</td><td style="padding: 8px 0;">${type}</td></tr>
      </table>
      ${message ? `<div style="margin-top: 16px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;"><p style="margin: 0; white-space: pre-wrap;">${message}</p></div>` : ''}
    `, { footerText: 'Internal notification — contact inquiry received on royaltyapp.ai' })

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Royalty <notifications@royaltyapp.ai>',
        to: [NOTIFY_EMAIL],
        reply_to: email,
        subject: `[Royalty] ${subject} — ${name || email}`,
        html: htmlBody,
      }),
    })

    if (!resendRes.ok) {
      const errText = await resendRes.text()
      console.error('Resend API error:', resendRes.status, errText)
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to send email' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    console.error('Unhandled error in contact-inquiry:', e)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
