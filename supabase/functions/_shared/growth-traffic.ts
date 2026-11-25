// HogQL queries and response shaping for admin-growth-traffic (Super Admin → Growth tab).
// Moved out of the function on 2026-11-25 (plan abstract-gliding-hellman, Phase 6) so vitest tests
// the real code. This file imports nothing (tests/edge-functions/growth-traffic.test.js).
//
// No caller string ever reaches a query: the only interpolated value is a number from ALLOWED_DAYS.

export const ALLOWED_DAYS = [7, 30, 90, 365]

/**
 * Marketing pages only report to PostHog since 2026-11-22 09:32Z, so 11-22 is a partial day.
 * A previous period that starts before this day has nothing real to compare against.
 */
export const TRACKING_FIRST_FULL_DAY = '2026-11-23'

const HOSTS = `properties.$host IN ('royaltyapp.ai', 'www.royaltyapp.ai')`
const MARKETING = `${HOSTS} AND NOT startsWith(coalesce(properties.$pathname, ''), '/app/')`
// An entry pageview: arrived from outside the site (or typed / bookmarked).
const ENTRY = `coalesce(properties.$referring_domain, '$direct') NOT IN ('royaltyapp.ai', 'www.royaltyapp.ai')`
const DAY = `toString(toDate(toTimeZone(timestamp, 'UTC')))`
const since = (days: number) => `timestamp >= toStartOfDay(toTimeZone(now(), 'UTC')) - toIntervalDay(${days - 1})`

// Netlify pretty URLs serve /pricing and /pricing.html alike: count them as one page.
const PATH = `coalesce(nullIf(properties.$pathname, ''), '/')`
const NO_HTML = `if(endsWith(${PATH}, '.html'), substring(${PATH}, 1, length(${PATH}) - 5), ${PATH})`
export const LANDING_PATH = `if(${NO_HTML} IN ('/index', ''), '/', ${NO_HTML})`

// The sign-up page: its own event (fires since 2026-11-25) or a plain pageview of it.
const SIGNUP_PAGE = `(event = 'signup_page_viewed' OR (event = '$pageview' AND coalesce(properties.$pathname, '') IN ('/app/signup', '/app/signup.html', '/app/signup/')))`

export function buildQueries(days: number) {
  if (!ALLOWED_DAYS.includes(days)) throw new Error('days not allowed')
  return {
    // Twice the window, so the previous period comes from the same query.
    daily: `
      SELECT ${DAY} AS day,
             count(DISTINCT if(event = '$pageview' AND ${MARKETING}, person_id, NULL)) AS visitors,
             countIf(event = '$pageview' AND ${MARKETING}) AS pageviews,
             count(DISTINCT if(${SIGNUP_PAGE}, person_id, NULL)) AS signup_page
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
      SELECT ${LANDING_PATH} AS path, count(DISTINCT person_id) AS visitors
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

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

function isoDay(d: Date) { return d.toISOString().slice(0, 10) }

export function shape(days: number, raw: Record<string, unknown[][] | null>, today: Date = new Date()) {
  // Daily rows for both windows, zero-filled.
  const byDay = new Map<string, { visitors: number; pageviews: number; signup_page: number }>()
  for (const r of raw.daily || []) {
    byDay.set(String(r[0]), { visitors: num(r[1]), pageviews: num(r[2]), signup_page: num(r[3]) })
  }
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

  // No comparison when the previous window reaches back before tracking began: it would read
  // "up from 0". The tab then shows "last N days" alone (admin-growth.js delta()).
  const prevComparable = !!raw.daily && dayAt(days * 2 - 1) >= TRACKING_FIRST_FULL_DAY

  const h = (raw.hero && raw.hero[0]) || []
  return {
    days,
    daily,
    totals: { cur, prev: prevComparable ? prev : null },
    sources: (raw.sources || []).map((r) => ({ domain: String(r[0] ?? ''), visitors: num(r[1]) })),
    utm: (raw.utm || []).map((r) => ({ source: String(r[0] ?? ''), campaign: String(r[1] ?? ''), visitors: num(r[2]) })),
    landing: (raw.landing || []).map((r) => ({ path: String(r[0] ?? ''), visitors: num(r[1]) })),
    hero: raw.hero ? {
      started: num(h[0]), analyzed: num(h[1]), preview: num(h[2]), clicked_signup: num(h[3]), ai_succeeded: num(h[4]),
    } : null,
  }
}
