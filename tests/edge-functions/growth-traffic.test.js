/**
 * Growth tab traffic shaping (plan abstract-gliding-hellman, Phase 6, 2026-11-25).
 *
 * Three gaps found after the tab went live:
 *   - /pricing and /pricing.html showed as two landing pages (Netlify serves both);
 *   - the sign-up page count used only signup_page_viewed (fires since 11-25), not pageviews of it;
 *   - "vs previous period" read "up from 0" because tracking only began on 2026-11-22.
 * buildQueries/shape now live in _shared/growth-traffic.ts, so these tests run the real code.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  ALLOWED_DAYS, TRACKING_FIRST_FULL_DAY, LANDING_PATH, buildQueries, shape,
} from '../../supabase/functions/_shared/growth-traffic.ts'

const root = path.resolve(__dirname, '../..')
const fnSrc = fs.readFileSync(path.join(root, 'supabase/functions/admin-growth-traffic/index.ts'), 'utf8')

describe('the function uses the shared module', () => {
  it('imports buildQueries and shape, defines neither', () => {
    expect(fnSrc).toMatch(/import \{ ALLOWED_DAYS, buildQueries, shape \} from '\.\.\/_shared\/growth-traffic\.ts'/)
    expect(fnSrc).not.toMatch(/function buildQueries|function shape/)
  })
})

describe('buildQueries', () => {
  it('only the allowed windows', () => {
    expect(ALLOWED_DAYS).toEqual([7, 30, 90, 365])
    for (const d of ALLOWED_DAYS) expect(() => buildQueries(d)).not.toThrow()
    for (const d of [0, 1, 31, -7, NaN, 1e9]) expect(() => buildQueries(d)).toThrow()
  })
  it('landing groups by the normalized path: .html stripped, /index and "" → /', () => {
    const q = buildQueries(30).landing
    expect(q).toContain(`SELECT ${LANDING_PATH} AS path`)
    expect(LANDING_PATH).toMatch(/endsWith\(.*'\.html'\)/)
    expect(LANDING_PATH).toMatch(/IN \('\/index', ''\), '\/'/)
    expect(q).toMatch(/GROUP BY path/)
  })
  it('the sign-up page counts its event OR a pageview of /app/signup, with or without .html', () => {
    const q = buildQueries(30).daily
    expect(q).toMatch(/event = 'signup_page_viewed' OR \(event = '\$pageview' AND .*'\/app\/signup', '\/app\/signup\.html'/)
    expect(q).toMatch(/event IN \('\$pageview', 'signup_page_viewed'\)/) // both events reach the query
  })
  it('daily reads twice the window (previous period from the same query)', () => {
    expect(buildQueries(7).daily).toMatch(/toIntervalDay\(13\)/)
    expect(buildQueries(30).landing).toMatch(/toIntervalDay\(29\)/)
  })
})

// Mirror of LANDING_PATH, run on the paths PostHog actually recorded, so the rule is pinned in JS too.
function landingPath(p) {
  const path = p || '/'
  const noHtml = path.endsWith('.html') ? path.slice(0, -5) : path
  return noHtml === '/index' || noHtml === '' ? '/' : noHtml
}

describe('landing path rule', () => {
  it('merges the pairs the tab showed twice', () => {
    expect(landingPath('/pricing.html')).toBe('/pricing')
    expect(landingPath('/pricing')).toBe('/pricing')
    expect(landingPath('/index.html')).toBe('/')
    expect(landingPath('/')).toBe('/')
    expect(landingPath('')).toBe('/')
    expect(landingPath(null)).toBe('/')
    expect(landingPath('/blog/post.html')).toBe('/blog/post')
  })
})

describe('shape', () => {
  const daily = (rows) => ({ daily: rows, sources: [], utm: [], landing: [], hero: [[0, 0, 0, 0, 0]] })

  it('no comparison when the previous window starts before tracking began', () => {
    // 2026-11-25, 7 days: previous window = 11-12 … 11-18, before 11-23.
    const out = shape(7, daily([['2026-11-24', 5, 9, 1]]), new Date('2026-11-25T12:00:00Z'))
    expect(out.totals.prev).toBe(null)
    expect(out.totals.cur).toEqual({ visitors: 5, pageviews: 9, signup_page: 1 })
  })
  it('a comparison once the whole previous window is tracked', () => {
    // 2026-12-06, 7 days: previous window = 11-23 … 11-29.
    expect(TRACKING_FIRST_FULL_DAY).toBe('2026-11-23')
    const out = shape(7, daily([['2026-11-23', 2, 3, 0], ['2026-12-01', 4, 6, 1]]), new Date('2026-12-06T08:00:00Z'))
    expect(out.totals.prev).toEqual({ visitors: 2, pageviews: 3, signup_page: 0 })
    expect(out.totals.cur.visitors).toBe(4)
  })
  it('one day earlier, the previous window touches 11-22 → still null', () => {
    const out = shape(7, daily([]), new Date('2026-12-05T08:00:00Z'))
    expect(out.totals.prev).toBe(null)
  })
  it('the daily query failing → prev null, days zero-filled', () => {
    const out = shape(7, { daily: null, sources: null, utm: null, landing: null, hero: null }, new Date('2026-12-20T00:00:00Z'))
    expect(out.totals.prev).toBe(null)
    expect(out.daily).toHaveLength(7)
    expect(out.daily.every((d) => d.visitors === 0)).toBe(true)
    expect(out.hero).toBe(null)
  })
  it('days run oldest → today, UTC', () => {
    const out = shape(7, daily([]), new Date('2026-11-25T23:30:00Z'))
    expect(out.daily[0].date).toBe('2026-11-19')
    expect(out.daily[6].date).toBe('2026-11-25')
  })
  it('landing rows pass through as the query grouped them', () => {
    const out = shape(30, { ...daily([]), landing: [['/', 4], ['/pricing', 2]] }, new Date('2026-11-25T00:00:00Z'))
    expect(out.landing).toEqual([{ path: '/', visitors: 4 }, { path: '/pricing', visitors: 2 }])
  })
})
