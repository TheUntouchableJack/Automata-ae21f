// org-invite-send — emails a staff invitation (plan cool-anything-here-wiggly-valiant, item 4).
//
// POST { invitation_id, lang? }   Authorization: Bearer <the owner's or admin's session JWT>
//   → { success: true } once Resend accepted the email
//
// Settings → Team inserts the organization_invitations row (RLS: owner/admin of the org), then calls
// this. The caller is checked here (auth.getUser), and again in SQL: org_invite_claim_send()
// refuses anyone who isn't the org's owner/admin, throttles (60 s between sends of one invite,
// 5 per invite, 30 invites per org per day) and restarts the invite's 7 days. The invitee accepts at
// /app/accept-invite.html?token=… (accept_org_invitation, migration 20261122000006).
//
// Deploy: supabase functions deploy org-invite-send --use-api   (verify_jwt = false in config.toml:
// the caller is verified here, as the other dashboard functions do)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { acceptUrl, inviteEmail, pickLang, plainEmail, SITE_ORIGINS } from '../_shared/org-invite.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_ADDRESS = 'noreply@royaltyapp.ai'

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': SITE_ORIGINS.includes(origin) ? origin : 'https://royaltyapp.ai',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const REFUSALS: Record<string, [number, string]> = {
  not_found: [404, 'That invitation no longer exists.'],
  forbidden: [403, 'Only the owner or an admin can send invitations.'],
  not_pending: [409, 'That invitation was already accepted or cancelled.'],
  too_soon: [429, 'Wait a minute before sending this invitation again.'],
  too_many: [429, 'This invitation has been sent 5 times. Cancel it and invite again if needed.'],
  org_limit: [429, 'You have sent 30 invitations today. Try again tomorrow.'],
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405)

  // Who is asking: a signed-in dashboard user. Checked before anything is read.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ success: false, code: 'not_signed_in', error: 'Please sign in again.' }, 401)
  const admin = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  const caller = userData?.user
  if (userErr || !caller) return json({ success: false, code: 'not_signed_in', error: 'Please sign in again.' }, 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ success: false, code: 'invalid', error: 'Bad request' }, 400) }
  const invitationId = String(body.invitation_id || '').trim()
  if (!UUID_RE.test(invitationId)) return json({ success: false, code: 'invalid', error: 'Bad request' }, 400)
  if (!RESEND_API_KEY) return json({ success: false, code: 'unavailable', error: 'Email is not set up' }, 503)

  try {
    const { data: claim, error: claimErr } = await admin.rpc('org_invite_claim_send', {
      p_invitation_id: invitationId, p_caller: caller.id,
    })
    if (claimErr) throw new Error('claim: ' + claimErr.message)
    const result = String(claim?.result || '')
    if (result !== 'ok') {
      const [status, error] = REFUSALS[result] || [400, 'Could not send the invitation.']
      return json({ success: false, code: result || 'error', error }, status)
    }

    // The address came from the browser's INSERT: send only to one plain address.
    const to = plainEmail(claim.email)
    if (!to) return json({ success: false, code: 'bad_email', error: 'That email address does not look right. Cancel the invitation and invite again.' }, 400)

    const mail = inviteEmail({
      orgName: String(claim.org_name || ''),
      inviterName: claim.inviter_name ? String(claim.inviter_name) : null,
      role: String(claim.role || 'member'),
      url: acceptUrl(req.headers.get('origin'), String(claim.token)),
      lang: pickLang(body.lang),
    })
    const replyTo = plainEmail(claim.inviter_email)
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `"Royalty" <${FROM_ADDRESS}>`,
        to: [to],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        tags: [{ name: 'type', value: 'org_invite' }],
      }),
    })
    if (!res.ok) {
      console.error('org-invite-send: Resend', res.status, (await res.text()).slice(0, 300))
      return json({ success: false, code: 'send_failed', error: 'We could not send the email. Copy the invite link instead, or try again in a minute.' }, 502)
    }
    return json({ success: true })
  } catch (e) {
    console.error('org-invite-send:', e instanceof Error ? e.message : e)
    return json({ success: false, code: 'error', error: 'Could not send the invitation.' }, 500)
  }
})
