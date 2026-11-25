/**
 * Super Admin → Growth tab (app/admin-growth.js), rendered from fixtures into the real
 * markup of app/admin.html (plan can-we-enhance-our-breezy-flute, 2026-11-25).
 * Fixtures: zero data, one org, traffic not connected, a traffic error.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const ADMIN_HTML = read('app/admin.html')
const SECTION = ADMIN_HTML.slice(ADMIN_HTML.indexOf('<section id="tab-growth">'),
  ADMIN_HTML.indexOf('</section>', ADMIN_HTML.indexOf('<section id="tab-growth">')) + '</section>'.length)

const charts = []
class FakeApexCharts {
  constructor(el, opts) { this.el = el; this.opts = opts; charts.push(this) }
  render() {}
  destroy() { this.destroyed = true }
}

const day = (offset) => {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - offset)
  return d.toISOString().slice(0, 10)
}
const days = (n, fill = () => ({})) => Array.from({ length: n }, (_, i) => ({
  date: day(n - 1 - i), signups: 0, new_members: 0, checkins: 0, redemptions: 0, paid: 0, ...fill(i),
}))
const zeroKpis = { signups: 0, first_customer: 0, activated: 0, paid: 0, churned: 0, new_members: 0, checkins: 0, redemptions: 0 }

function zeroDb() {
  return {
    window: { days: 30, from: day(29), to: day(0), include_internal: false, generated_at: new Date().toISOString() },
    kpis: { cur: { ...zeroKpis }, prev: { ...zeroKpis }, active_7d: 0, paid_total: 0, paid_by_tier: {}, est_mrr: 0, orgs_total: 0, internal_orgs: 3 },
    daily: days(30),
    funnel: { account: 0, confirmed: 0, came_back: 0, has_rewards: 0, first_customer: 0, activated: 0, paid: 0 },
    sources: [],
    cohorts: Array.from({ length: 12 }, (_, i) => ({ week: day(i * 7), signups: 0, confirmed: 0, came_back: 0, has_rewards: 0, first_customer: 0, activated: 0, paid: 0 })),
    recent_signups: [],
  }
}

const EVIL = '<img src=x onerror="window.__xss=1">'
function oneOrgDb() {
  const db = zeroDb()
  db.kpis.cur = { ...zeroKpis, signups: 1, new_members: 3, checkins: 2 }
  db.kpis.prev = { ...zeroKpis, signups: 2 }
  db.kpis.orgs_total = 1
  db.daily = days(30, (i) => (i === 29 ? { signups: 1, new_members: 3, checkins: 2 } : {}))
  db.funnel = { account: 1, confirmed: 1, came_back: 0, has_rewards: 1, first_customer: 1, activated: 0, paid: 0 }
  db.sources = [{ source: 'plan-check', signups: 1, first_customer: 1, activated: 0, paid: 0 }]
  db.cohorts[0] = { ...db.cohorts[0], signups: 1, confirmed: 1, has_rewards: 1, first_customer: 1 }
  db.recent_signups = [{
    id: '00000000-0000-0000-0000-000000000111', name: 'Ann ' + EVIL, is_internal: false, owner_email: 'ann@shop.test',
    created_at: new Date(Date.now() - 3 * 864e5).toISOString(), source: { utm_source: 'plan-check', landing: '/pricing.html', via_hero: true },
    source_label: 'plan-check', confirmed: true, came_back: false, has_rewards: true, first_customer: true, activated: false,
    paid: false, tier: null, stuck_at: 'came_back', members: 3, checkins: 2, last_seen: new Date().toISOString(),
  }]
  return db
}

function traffic(visitors = 50) {
  return {
    connected: true, days: 30, errors: [],
    daily: days(30).map((d, i) => ({ date: d.date, visitors: i === 29 ? visitors : 0, pageviews: 0, signup_page: 0 })),
    totals: { cur: { visitors, pageviews: visitors * 2, signup_page: 4 }, prev: { visitors: 20, pageviews: 40, signup_page: 1 } },
    sources: [{ domain: '$direct', visitors: 30 }, { domain: 'google.com', visitors: 20 }],
    utm: [{ source: 'plan-check', campaign: '', visitors: 1 }],
    landing: [{ path: '/', visitors: 40 }],
    hero: { started: 10, analyzed: 6, preview: 5, clicked_signup: 2, ai_succeeded: 0 },
  }
}

// Text nodes joined with spaces (textContent runs adjacent cells together).
const text = (id) => {
  const out = []
  const walker = document.createTreeWalker(document.getElementById(id), NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) out.push(walker.currentNode.nodeValue)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

beforeAll(() => {
  window.ApexCharts = FakeApexCharts
  window.eval(read('app/admin-growth.js'))
})
beforeEach(() => {
  document.body.innerHTML = SECTION
  charts.length = 0
  window.__xss = undefined
  window.AdminGrowth._state.days = 30
})

describe('Growth tab: zero data, traffic not connected', () => {
  it('renders zeros, dashes and the not-connected line, never NaN / undefined / null / Infinity', () => {
    window.AdminGrowth.render(zeroDb(), { connected: false, days: 30 }, null)
    const all = document.body.textContent
    expect(all).not.toMatch(/NaN|undefined|null|Infinity/)
    expect(text('growth-traffic-status')).toMatch(/Traffic not connected/)
    expect(text('growth-kpis')).toMatch(/Visitors — /)
    expect(text('growth-kpis')).toMatch(/Sign-ups 0/)
    expect(text('growth-kpis')).toMatch(/Est\. MRR \$0\.00/)
    expect(text('growth-internal-count')).toBe('(3)')
    expect(text('growth-recent')).toMatch(/No sign-ups yet/)
    expect(text('growth-sources-signups')).toMatch(/No sign-ups in this period/)
    expect(text('growth-chart-visitors')).toMatch(/Traffic not connected/)
  })

  it('a traffic error is shown, and the database half still renders', () => {
    window.AdminGrowth.render(zeroDb(), null, 'HTTP 403')
    expect(text('growth-traffic-status')).toMatch(/Traffic unavailable: HTTP 403/)
    expect(text('growth-funnel')).toMatch(/Account created/)
  })
})

describe('Growth tab: one org, traffic connected', () => {
  beforeEach(() => window.AdminGrowth.render(oneOrgDb(), traffic(50), null))

  it('KPIs carry counts next to percentages and compare with the period before', () => {
    const k = text('growth-kpis')
    expect(k).toMatch(/Visitors 50 .*up 30 vs 20 the 30 days before/)
    expect(k).toMatch(/Sign-ups 1 .*down 1 vs 2 the 30 days before/)
    expect(k).toMatch(/Visit → sign-up 2\.0% 1 of 50 visitors/)
  })

  it('the funnel has two blocks, each with its own start, and a divider between them', () => {
    const f = text('growth-funnel')
    expect(f).toMatch(/Visitors 50/)
    expect(f).toMatch(/Started a prompt 10 20% of previous/)
    expect(f).toMatch(/Clicked sign-up 2 40% of previous/)
    expect(f).toMatch(/0 by AI, the rest by the template fallback/)
    expect(document.querySelector('.growth-funnel-divider')).not.toBeNull()
    expect(f).toMatch(/Account created 1 /)
    expect(f).toMatch(/Came back \(next day or later\) 0 0% of previous/)
    expect(f).toMatch(/Has a reward 1 /) // after a 0 step: no "of previous" percentage
  })

  it('sources: traffic and sign-ups side by side', () => {
    expect(text('growth-sources-traffic')).toMatch(/Direct \/ typed 30/)
    expect(text('growth-sources-traffic')).toMatch(/google\.com 20/)
    expect(text('growth-sources-signups')).toMatch(/plan-check 1 1 0 0/)
    expect(text('growth-sources-traffic')).toMatch(/Landing pages Page Visitors \/ 40/)
  })

  it('recent sign-ups: escaped, stuck-at, source details', () => {
    const r = text('growth-recent')
    expect(r).toMatch(/Ann <img src=x onerror="window\.__xss=1">/)
    expect(document.querySelector('#growth-recent img')).toBeNull()
    expect(window.__xss).toBeUndefined()
    expect(r).toMatch(/Come back/)
    expect(r).toMatch(/plan-check landed \/pricing\.html · via builder/)
  })

  it('cohorts show the share and the count', () => {
    const first = document.querySelector('#growth-cohorts tbody tr')
    expect(first.textContent.replace(/\s+/g, ' ')).toMatch(/100% \(1\)/)
    expect(first.querySelector('.growth-cell').getAttribute('style')).toMatch(/--share:100%/)
  })

  it('charts: one series each, one hue, no legend, no second y-axis', () => {
    expect(charts.map((c) => c.el.id).sort()).toEqual([
      'growth-chart-checkins', 'growth-chart-members', 'growth-chart-redemptions', 'growth-chart-signups', 'growth-chart-visitors'])
    charts.forEach((c) => {
      expect(c.opts.series).toHaveLength(1)
      expect(c.opts.colors).toHaveLength(1)
      expect(c.opts.legend.show).toBe(false)
      expect(Array.isArray(c.opts.yaxis)).toBe(false)
      expect(c.opts.chart.type).toBe('bar')
    })
    const visitors = charts.find((c) => c.el.id === 'growth-chart-visitors')
    expect(visitors.opts.series[0].data[29]).toBe(50)
  })

  it('re-rendering destroys the old charts', () => {
    const old = charts.slice()
    window.AdminGrowth.render(oneOrgDb(), traffic(50), null)
    expect(old.every((c) => c.destroyed)).toBe(true)
  })

  it('row click opens the org detail; the eye button views as the org', () => {
    const calls = []
    window.openOrgDetail = (id) => calls.push(['detail', id])
    window.viewAsOrg = (id, name) => calls.push(['view-as', id, name])
    // bind() runs in init(); init() also loads, so bind by hand through a fresh init with a stubbed rpc
    window.AdminGrowth._state.loadedKey = '30:false'
    window.AdminGrowth._state.db = oneOrgDb()
    return window.AdminGrowth.init().then(() => {
      window.AdminGrowth.render(oneOrgDb(), traffic(50), null)
      document.querySelector('#growth-recent tr[data-org-id] td').click()
      document.querySelector('[data-growth-action="view-as"]').click()
      expect(calls).toEqual([
        ['detail', '00000000-0000-0000-0000-000000000111'],
        ['view-as', '00000000-0000-0000-0000-000000000111', 'Ann ' + EVIL],
      ])
    })
  })
})

describe('Growth tab: long periods', () => {
  it('more than 90 days draws lines, not 365 hairline bars', () => {
    const db = zeroDb()
    db.window.days = 365
    db.daily = days(365)
    window.AdminGrowth.render(db, { connected: false }, null)
    expect(charts.find((c) => c.el.id === 'growth-chart-signups').opts.chart.type).toBe('line')
  })

  it('All: no comparison, says "all time"', () => {
    const db = zeroDb()
    db.window.days = null
    db.kpis.prev = null
    window.AdminGrowth._state.days = null
    window.AdminGrowth.render(db, { connected: false }, null)
    expect(text('growth-kpis')).toMatch(/Sign-ups 0 all time/)
    expect(text('growth-window')).toMatch(/^All time since/)
  })
})

describe('admin.html wiring', () => {
  it('Growth is the first tab and opens by default; Orgs starts hidden', () => {
    const tabs = [...ADMIN_HTML.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1])
    expect(tabs[0]).toBe('growth')
    expect(ADMIN_HTML).toMatch(/<button class="admin-tab active" data-tab="growth">/)
    expect(ADMIN_HTML).toMatch(/<section id="tab-orgs" style="display: none;">/)
  })

  it('loads ApexCharts from the same pinned URL as the dashboard, before admin-growth.js', () => {
    const apex = 'https://cdn.jsdelivr.net/npm/apexcharts@3.45.0/dist/apexcharts.min.js'
    expect(read('app/dashboard.html')).toContain(apex)
    const i = ADMIN_HTML.indexOf(apex)
    expect(i).toBeGreaterThan(-1)
    expect(ADMIN_HTML.indexOf('admin-growth.js?v=')).toBeGreaterThan(i)
    expect(ADMIN_HTML.indexOf('"admin.js?v=')).toBeGreaterThan(ADMIN_HTML.indexOf('admin-growth.js?v='))
  })

  it('admin-growth.js adds only window.AdminGrowth to the shared global scope', () => {
    const src = read('app/admin-growth.js')
    expect(src.trim().startsWith('// ===== Super Admin')).toBe(true)
    expect(src).toMatch(/^\(function \(\) \{/m)
    expect(src.match(/window\.\w+ = /g)).toEqual(['window.AdminGrowth = '])
  })
})
