// Supabase Edge Function: ai-health
// Brings Royal AI back after an outage. pg_cron calls it every 15 minutes
// (migration 20261122000001, job 'ai-health-probe').
//
// While Royal AI is up, or in mode 'on' / 'waitlist', claim_ai_probe() returns false and this
// exits without calling Anthropic. Only in auto mode with the AI marked unavailable does it make
// one 1-token Haiku call; a success flips the status back on. claim_ai_probe() also stamps the
// probe time, so it probes at most once per 5 minutes however often it is called. That is why
// it runs verify_jwt = false with no secret: calling it can't cost more than that.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classifyClaudeError, isOutage, reportAiHealth } from '../_shared/ai-status.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MODEL_HAIKU = 'claude-haiku-4-5-20251001'

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: claimed, error: claimError } = await supabase.rpc('claim_ai_probe')
    if (claimError) {
      console.error('ai-health: claim_ai_probe failed', claimError)
      return json({ probed: false, error: 'claim failed' }, 500)
    }
    if (!claimed) return json({ probed: false })

    if (!ANTHROPIC_API_KEY) {
      console.error('ai-health: ANTHROPIC_API_KEY not configured')
      return json({ probed: true, ok: false, kind: 'auth' })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_HAIKU,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (response.ok) {
      if (!(await reportAiHealth(supabase, true, null))) {
        // The probe worked but the switch didn't move. The next run (≥5 min) tries again.
        console.error('ai-health: probe succeeded but report_ai_health failed; still off')
        return json({ probed: true, ok: true, recorded: false }, 500)
      }
      console.log('ai-health: probe succeeded, Royal AI is back on')
      return json({ probed: true, ok: true, recorded: true })
    }

    const body = await response.text().catch(() => '')
    const kind = classifyClaudeError(response.status, body)
    console.warn('ai-health: probe failed', response.status, kind, body.slice(0, 300))
    // A credit or key failure keeps it off (report_ai_health writes nothing when the state
    // hasn't changed). A passing overload says nothing about credits, so it changes nothing.
    if (isOutage(kind)) await reportAiHealth(supabase, false, kind)
    return json({ probed: true, ok: false, kind })
  } catch (e) {
    console.error('ai-health: unhandled error', e)
    return json({ probed: false, error: 'internal' }, 500)
  }
})
