// Supabase Edge Function: ai-waitlist-notify
// Emails owners who signed up while Royal AI was in early access, once it is on again:
// "Royal AI is on for {Business}". pg_cron calls it hourly (job 'ai-waitlist-notify-hourly');
// it can also be run by hand.
//
// Safe to call by anyone (verify_jwt = false, no secret):
//   - it sends nothing unless Royal AI is on (platform_status 'ai', same rule as get_ai_status);
//   - each org is claimed (notified_at set) BEFORE its email, so each owner gets one email ever;
//   - at most notify_daily_cap (platform_status 'ai', default 50) per rolling 24 h, 25 per run.
// Body { "dry_run": true } reports how many would go out and sends nothing.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { aiEnabledFrom, readAiState } from '../_shared/ai-status.ts'
import { wrapEmail } from '../_shared/email-template.ts'
import { waitlistEmail } from '../_shared/ai-waitlist-email.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM_EMAIL = 'Royal <royal@royaltyapp.ai>'
const PER_RUN = 25
const DEFAULT_DAILY_CAP = 50

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  if (!res.ok) console.error('ai-waitlist-notify: Resend error', res.status, (await res.text()).slice(0, 300))
  return res.ok
}

async function ownerContact(supabase: SupabaseClient, userId: string | null) {
  if (!userId) return null
  const { data: profile } = await supabase
    .from('profiles').select('email, first_name').eq('id', userId).maybeSingle()
  let email = profile?.email as string | undefined
  if (!email) {
    const { data } = await supabase.auth.admin.getUserById(userId)
    email = data?.user?.email
  }
  if (!email) return null
  const { data: prefs } = await supabase
    .from('smb_email_preferences').select('unsubscribed_all').eq('user_id', userId).maybeSingle()
  return { email, firstName: (profile?.first_name as string) || '', unsubscribed: !!prefs?.unsubscribed_all }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let dryRun = false
  try { dryRun = (await req.json())?.dry_run === true } catch { /* empty body */ }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const state = await readAiState(supabase, { fresh: true })
    if (!aiEnabledFrom(state)) return json({ sent: 0, reason: 'ai_off' })
    if (!RESEND_API_KEY) return json({ sent: 0, reason: 'no_resend_key' }, 500)

    const capRaw = state?.notify_daily_cap
    const cap = typeof capRaw === 'number' && capRaw >= 0 ? capRaw : DEFAULT_DAILY_CAP
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { count: sentToday } = await supabase
      .from('ai_waitlist').select('org_id', { count: 'exact', head: true }).gte('notified_at', dayAgo)
    const room = Math.max(0, Math.min(PER_RUN, cap - (sentToday || 0)))

    const { count: pending } = await supabase
      .from('ai_waitlist').select('org_id', { count: 'exact', head: true }).is('notified_at', null)

    if (dryRun) return json({ dry_run: true, pending: pending || 0, would_send: Math.min(room, pending || 0), cap })
    if (room === 0 || !pending) return json({ sent: 0, pending: pending || 0, reason: room === 0 ? 'daily_cap' : 'none' })

    const { data: rows, error } = await supabase
      .from('ai_waitlist').select('org_id, user_id').is('notified_at', null)
      .order('joined_at', { ascending: true }).limit(room)
    if (error) throw error

    let sent = 0
    let skipped = 0
    for (const row of rows || []) {
      // Claim first: a concurrent run can't email the same owner twice.
      const { data: claimed } = await supabase
        .from('ai_waitlist').update({ notified_at: new Date().toISOString() })
        .eq('org_id', row.org_id).is('notified_at', null).select('org_id')
      if (!claimed?.length) continue

      // Release the claim so the next run retries this owner.
      const release = () => supabase.from('ai_waitlist').update({ notified_at: null }).eq('org_id', row.org_id)
      try {
        const contact = await ownerContact(supabase, row.user_id)
        if (!contact || contact.unsubscribed) { skipped++; continue }  // stays claimed: never emailed

        const { data: org } = await supabase.from('organizations').select('name').eq('id', row.org_id).maybeSingle()
        const tpl = waitlistEmail((org?.name as string) || '', contact.firstName)
        const html = wrapEmail(tpl.html, {
          preheader: tpl.preheader,
          unsubscribeUrl: row.user_id ? `https://royaltyapp.ai/app/settings.html?unsubscribe=${row.user_id}` : undefined,
        })

        if (await sendEmail(contact.email, tpl.subject, html)) sent++
        else await release()
      } catch (e) {
        // A network error mid-send must not leave this owner claimed forever, or stop the batch.
        console.error('ai-waitlist-notify: send failed for one org', e)
        await release()
      }
    }

    console.log(`ai-waitlist-notify: sent ${sent}, skipped ${skipped}, pending before run ${pending}`)
    return json({ sent, skipped, pending: (pending || 0) - sent - skipped })
  } catch (e) {
    console.error('ai-waitlist-notify: unhandled error', e)
    return json({ sent: 0, error: 'internal' }, 500)
  }
})
