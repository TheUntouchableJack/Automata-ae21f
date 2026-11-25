// Supabase Edge Function: admin-growth-traffic
//
// Super Admin → Growth tab, the traffic half. Reads PostHog (project 550932, US cloud) server-side
// with a personal API key scoped to query:read, so the key never reaches a browser and the CSP is
// unchanged: the page only talks to this function.
//
// Auth: same as admin-actions. A user JWT whose profile is_admin, else 401 / 403.
// Input: { days: 7 | 30 | 90 | 365 | null }. null = "All" → 365. Anything else → 30.
// No caller string ever reaches a query: the only interpolated value is a number from ALLOWED_DAYS.
//
// Without the POSTHOG_PERSONAL_API_KEY secret it answers { connected: false } and the tab says
// "Traffic not connected"; the database half of the tab works on its own.
//
// Marketing pages are cookieless (js/analytics.js): one id per visitor per DAY, because the salt
// rotates daily. So visitors are counted per day and only ever summed, never de-duplicated across
// days, and the hero funnel is same-day per id. Days are UTC, like admin_growth_metrics().

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const POSTHOG_QUERY_URL = 'https://us.posthog.com/api/projects/550932/query/'
const ALLOWED_DAYS = [7, 30, 90, 365]
const CACHE_MS = 5 * 60 * 1000

const allowedOrigins = ['https://royaltyapp.ai', 'http://localhost:5173']

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : 'https://royaltyapp.ai',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

// ----- HogQL -----
const HOSTS = `properties.$host IN ('royaltyapp.ai', 'www.royaltyapp.ai')`
const MARKETING = `${HOSTS} AND NOT startsWith(coalesce(properties.$pathname, ''), '/app/')`
// An entry pageview: arrived from outside the site (or typed / bookmarked).
const ENTRY = `coalesce(properties.$referring_domain, '$direct') NOT IN ('royaltyapp.ai', 'www.royaltyapp.ai')`
const DAY = `toString(toDate(toTimeZone(timestamp, 'UTC')))`
const since = (days: number) => `timestamp >= toStartOfDay(toTimeZone(now(), 'UTC')) - toIntervalDay(${days - 1})`

export function buildQueries(days: number) {
  if (!ALLOWED_DAYS.includes(days)) throw new Error('days not allowed')
  return {
    // Twice the window, so the previous period comes from the same query.
    daily: `
      SELECT ${DAY} AS day,
             count(DISTINCT if(event = '$pageview' AND ${MARKETING}, person_id, NULL)) AS visitors,
             countIf(event = '$pageview' AND ${MARKETING}) AS pageviews,
             count(DISTINCT if(event = 'signup_page_viewed', person_id, NULL)) AS signup_page
      FROM events
      WHERE ${since(days * 2)} AND event IN ('$pageview', 'signup_page_viewed') AND ${HOSTS}
      GROUP BY day ORDER BY day`,
    sources: `
      SELECT coalesce(nullIf(properties.$referring_domain, ''), '$direct') AS domain,
             count(DISTINCT person_id) AS visitors
      FROM events
      WHERE ${since(days)} AND event = '$pageview' AND ${MARKETING} AND ${ENTRY}
      GROUP BY domain ORDER BY visitors DESC LIMIT 15`,
    utm: `
      SELECT properties.utm_source AS source, coalesce(properties.utm_campaign, '') AS campaign,
             count(DISTINCT person_id) AS visitors
      FROM events
      WHERE ${since(days)} AND event = '$pageview' AND ${MARKETING}
        AND notEmpty(coalesce(properties.utm_source, ''))
      GROUP BY source, campaign ORDER BY visitors DESC LIMIT 15`,
    landing: `
      SELECT coalesce(properties.$pathname, '/') AS path, count(DISTINCT person_id) AS visitors
      FROM events
      WHERE ${since(days)} AND event = '$pageview' AND ${MARKETING} AND ${ENTRY}
      GROUP BY path ORDER BY visitors DESC LIMIT 15`,
    // Same day, same id. "Preview built" is hero_preview_shown: it also fires when the AI call
    // failed and the template fallback was shown. AI successes are counted separately.
    hero: `
      SELECT countIf(a > 0) AS started,
             countIf(a > 0 AND b > 0) AS analyzed,
             countIf(a > 0 AND b > 0 AND p > 0) AS preview,
             countIf(a > 0 AND b > 0 AND p > 0 AND d > 0) AS clicked_signup,
             countIf(s > 0) AS ai_succeeded
      FROM (
        SELECT person_id, ${DAY} AS day,
               countIf(event IN ('hero_prompt_started', 'hero_prompt_prefilled')) AS a,
               countIf(event = 'hero_analyze_clicked') AS b,
               countIf(event = 'hero_preview_shown') AS p,
               countIf(event = 'hero_confirmed_signup') AS d,
               countIf(event = 'hero_analysis_succeeded') AS s
        FROM events
        WHERE ${since(days)} AND ${HOSTS}
          AND event IN ('hero_prompt_started', 'hero_prompt_prefilled', 'hero_analyze_clicked',
                        'hero_preview_shown', 'hero_confirmed_signup', 'hero_analysis_succeeded')
        GROUP BY person_id, day
      )`,
  }
}

async function hogql(key: string, name: string, query: string): Promise<unknown[][]> {
  const res = await fetch(POSTHOG_QUERY_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query }, name: `admin-growth-${name}` }),
    signal: AbortSignal.timeout(25000),
  })
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300)
    throw new Error(`${name}: PostHog ${res.status} ${text}`)
  }
  const json = await res.json()
  return Array.isArray(json?.results) ? json.results : []
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

function isoDay(d: Date) { return d.toISOString().slice(0, 10) }

export function shape(days: number, raw: Record<string, unknown[][] | null>) {
  // Daily rows for both windows, zero-filled.
  const byDay = new Map<string, { visitors: number; pageviews: number; signup_page: number }>()
  for (const r of raw.daily || []) {
    byDay.set(String(r[0]), { visitors: num(r[1]), pageviews: num(r[2]), signup_page: num(r[3]) })
  }
  const today = new Date()
  const dayAt = (offset: number) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    d.setUTCDate(d.getUTCDate() - offset)
    return isoDay(d)
  }
  const daily = []
  for (let i = days - 1; i >= 0; i--) {
    const date = dayAt(i)
    daily.push({ date, ...(byDay.get(date) || { visitors: 0, pageviews: 0, signup_page: 0 }) })
  }
  const prev = { visitors: 0, pageviews: 0, signup_page: 0 }
  for (let i = days * 2 - 1; i >= days; i--) {
    const row = byDay.get(dayAt(i))
    if (row) { prev.visitors += row.visitors; prev.pageviews += row.pageviews; prev.signup_page += row.signup_page }
  }
  const cur = daily.reduce((s, d) => ({
    visitors: s.visitors + d.visitors, pageviews: s.pageviews + d.pageviews, signup_page: s.signup_page + d.signup_page,
  }), { visitors: 0, pageviews: 0, signup_page: 0 })

  const h = (raw.hero && raw.hero[0]) || []
  return {
    days,
    daily,
    totals: { cur, prev: raw.daily ? prev : null },
    sources: (raw.sources || []).map((r) => ({ domain: String(r[0] ?? ''), visitors: num(r[1]) })),
    utm: (raw.utm || []).map((r) => ({ source: String(r[0] ?? ''), campaign: String(r[1] ?? ''), visitors: num(r[2]) })),
    landing: (raw.landing || []).map((r) => ({ path: String(r[0] ?? ''), visitors: num(r[1]) })),
    hero: raw.hero ? {
      started: num(h[0]), analyzed: num(h[1]), preview: num(h[2]), clicked_signup: num(h[3]), ai_succeeded: num(h[4]),
    } : null,
  }
}

const cache = new Map<number, { at: number; body: unknown }>()

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  try {
    // ----- caller must be a super admin (copied from admin-actions) -----
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(401, { error: 'Missing authorization header' })

    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return json(401, { error: 'Invalid token' })

    const adminClient = createClient(supabaseUrl, supabaseServiceKey)
    const { data: profile, error: profileError } = await adminClient
      .from('profiles').select('is_admin').eq('id', user.id).single()
    if (profileError || !profile?.is_admin) return json(403, { error: 'Unauthorized: super admin required' })

    // ----- input -----
    let body: { days?: unknown } = {}
    try { body = await req.json() } catch { body = {} }
    const asked = body.days === null || body.days === 'all' ? 365 : Number(body.days)
    const days = ALLOWED_DAYS.includes(asked) ? asked : 30

    const key = Deno.env.get('POSTHOG_PERSONAL_API_KEY')
    if (!key) return json(200, { connected: false, days })

    const hit = cache.get(days)
    if (hit && Date.now() - hit.at < CACHE_MS) return json(200, hit.body)

    const queries = buildQueries(days)
    const names = Object.keys(queries) as (keyof typeof queries)[]
    const settled = await Promise.allSettled(names.map((n) => hogql(key, n, queries[n])))
    const raw: Record<string, unknown[][] | null> = {}
    const errors: string[] = []
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') raw[names[i]] = s.value
      else { raw[names[i]] = null; errors.push(String(s.reason?.message || s.reason).slice(0, 300)) }
    })
    if (errors.length) console.error('admin-growth-traffic query errors:', errors)

    const out = { connected: true, generated_at: new Date().toISOString(), ...shape(days, raw), errors }
    if (!errors.length) cache.set(days, { at: Date.now(), body: out })
    return json(200, out)
  } catch (err) {
    console.error('admin-growth-traffic error:', err)
    return json(500, { error: 'Internal error' })
  }
})
