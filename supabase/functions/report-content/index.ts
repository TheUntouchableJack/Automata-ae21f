// Supabase Edge Function: Report Content
//
// The safety valve for open posting. ViibeView posts go live instantly
// (create_social_post hardcodes status = 'approved'), so reporting — not
// pre-moderation — is what keeps the feed honest. A report does two things,
// in this order:
//
//   1. INSERT into content_reports (service role). This is the record.
//   2. Email pahkie@viibeview.com via Resend. This is the alert.
//
// The insert comes first on purpose: an email outage must not lose a report.
// A delivered email is therefore not proof the log worked, and a logged row is
// not proof the email arrived — when verifying, check both.
//
// Auth is OPTIONAL. If the caller sends a real user JWT we resolve it and
// record reporter_user_id; the anon key produces an anonymous report.
// Reporting bad content should never require an account.
//
// Deploy: supabase functions deploy report-content
//   NOT --no-verify-jwt — the client sends the anon key as bearer, exactly
//   like the existing contact-inquiry call in social.js.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { wrapEmail } from '../_shared/email-template.ts'

const NOTIFY_EMAIL = 'pahkie@viibeview.com'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function sanitize(s: string, maxLen = 500): string {
  return String(s || '').replace(/[<>]/g, '').slice(0, maxLen).trim()
}

// Free text from the client is not trusted to be one of these; anything else
// is recorded as 'other' so the column stays queryable.
const REASONS = ['inappropriate', 'spam', 'harassment', 'other']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json()
    const appId = sanitize(body.app_id || '', 64)
    const mediaId = sanitize(body.media_id || '', 64)
    const rawReason = sanitize(body.reason || 'other', 40).toLowerCase()
    const reason = REASONS.includes(rawReason) ? rawReason : 'other'
    const note = sanitize(body.note || '', 1000)

    if (!UUID_RE.test(appId) || !UUID_RE.test(mediaId)) {
      return json({ success: false, error: 'A post and app must be identified' }, 400)
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey)

    // Rate limit by IP, 5/hour. The report button is public, so the IP is the
    // only identifier an anonymous reporter has.
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    try {
      const { data: allowed } = await admin.rpc('check_and_record_rate_limit', {
        p_identifier: `report_${clientIp}`,
        p_action_type: 'content_report',
        p_max_attempts: 5,
        p_window_minutes: 60,
      })
      if (allowed === false) {
        return json({ success: false, error: 'Too many reports. Please try again later.' }, 429)
      }
    } catch (e) {
      console.warn('Rate limit check failed, continuing:', e)
    }

    // Optional identity. The anon key is a valid bearer here and resolves to
    // no user — that is an anonymous report, not an error.
    let reporterUserId: string | null = null
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (token && token !== supabaseAnonKey) {
      try {
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } },
        })
        const { data: userData } = await userClient.auth.getUser(token)
        reporterUserId = userData?.user?.id ?? null
      } catch (e) {
        console.warn('Could not resolve reporter identity, recording anonymously:', e)
      }
    }

    // Context for the email. Read after the identity check so a failure here
    // never blocks the insert — the report still lands with whatever we know.
    const { data: media } = await admin
      .from('venue_media')
      .select('id, url, caption, venue_id, uploaded_by_user_id, created_at, app_id')
      .eq('id', mediaId)
      .maybeSingle()

    if (!media || media.app_id !== appId) {
      return json({ success: false, error: 'That post could not be found' }, 404)
    }

    let venueName = ''
    if (media.venue_id) {
      const { data: venue } = await admin
        .from('venues')
        .select('name')
        .eq('id', media.venue_id)
        .maybeSingle()
      venueName = venue?.name || ''
    }

    // 1. The record. A duplicate from the same user on the same post hits
    // content_reports_once_per_user (23505) — that is a no-op success, not a
    // failure the reporter should see.
    const { error: insertError } = await admin
      .from('content_reports')
      .insert({
        app_id: appId,
        media_id: mediaId,
        reporter_user_id: reporterUserId,
        reason,
        reporter_note: note || null,
      })

    if (insertError && insertError.code !== '23505') {
      console.error('Failed to log content report:', insertError.message)
      return json({ success: false, error: 'Could not record your report' }, 500)
    }

    const alreadyReported = insertError?.code === '23505'

    // 2. The alert. Skipped for a duplicate — Pahkie already has that email.
    if (!alreadyReported) {
      const htmlBody = wrapEmail(`
        <h2 style="margin: 0 0 4px; color: #1a1a2e; font-size: 20px;">Content reported</h2>
        <p style="margin: 0 0 20px; color: #71717a; font-size: 14px;">Reason: ${reason}</p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 120px;">Post</td><td style="padding: 8px 0;"><a href="${media.url}" style="color: #7c3aed;">${media.url}</a></td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Caption</td><td style="padding: 8px 0;">${sanitize(media.caption || '', 500) || '—'}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Venue</td><td style="padding: 8px 0;">${venueName || 'No venue attached'}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Author user id</td><td style="padding: 8px 0;">${media.uploaded_by_user_id || 'unknown (pre-UGC post)'}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Media id</td><td style="padding: 8px 0;">${mediaId}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Reported by</td><td style="padding: 8px 0;">${reporterUserId || 'anonymous'}</td></tr>
        </table>
        ${note ? `<div style="margin-top: 16px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;"><p style="margin: 0; white-space: pre-wrap;">${note}</p></div>` : ''}
        <p style="margin: 24px 0 0;"><a href="https://royaltyapp.ai/app/venues.html" style="color: #7c3aed;">Open venue admin →</a></p>
      `, { footerText: 'Internal notification — content reported in ViibeView' })

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          // Must stay on the verified Resend domain.
          from: 'ViibeView <notifications@royaltyapp.ai>',
          to: [NOTIFY_EMAIL],
          subject: `[ViibeView] Content reported — ${reason}`,
          html: htmlBody,
        }),
      })

      if (!resendRes.ok) {
        // The report IS logged at this point. Say so rather than returning an
        // error that would invite the reporter to file it again.
        const errText = await resendRes.text()
        console.error('Resend API error:', resendRes.status, errText)
      }
    }

    return json({ success: true })
  } catch (e) {
    console.error('Unhandled error in report-content:', e)
    return json({ success: false, error: 'Internal error' }, 500)
  }
})
