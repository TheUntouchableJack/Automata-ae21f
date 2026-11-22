/**
 * Owner journey, items 2 and 3 (plan cool-anything-here-wiggly-valiant, 2026-11-22).
 *
 * Item 2: a new owner's app is a draft (OnboardingSave creates it unpublished), but the dashboard
 * showed the live URL, Copy and the check-in QR for it. Customers who scanned got "This app doesn't
 * exist". Now a draft shows "not live yet", its rewards and Review and publish; the QR and link
 * appear only once it is published; a first publish lands on the dashboard QR (?app=<id>#qr); the
 * welcome banner's "Customize App" opens the org's own app instead of starting a second draft.
 *
 * Item 3: signup and forgot-password refused to submit when Turnstile never loaded (no fallback),
 * and the token is checked nowhere server-side. All three auth pages now give way when the widget
 * errors or api.js never loads.
 *
 * The dashboard and banner tests run the real scripts in jsdom against the real dashboard markup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const DASHBOARD_HTML = read('app/dashboard.html')
const DASHBOARD_JS = read('app/dashboard.js')
const BUILDER_JS = read('app/app-builder.js')
const BANNER_JS = read('app/welcome-banner.js')

function escapeHtml(text) {
  if (text === null || text === undefined) return ''
  const div = document.createElement('div')
  div.textContent = String(text)
  return div.innerHTML
}

// A thenable query builder: every chain method returns itself; awaiting it yields `result`.
function query(result, calls = []) {
  const q = {}
  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'in', 'neq', 'gte', 'update', 'insert', 'single']) {
    q[m] = (...args) => { calls.push([m, ...args]); return q }
  }
  q.then = (res, rej) => Promise.resolve(result).then(res, rej)
  return q
}

// The real preview <aside> and header toggle from dashboard.html, so ids in the markup are tested too.
function mountDashboardMarkup() {
  const aside = DASHBOARD_HTML.match(/<aside class="dashboard-preview-col"[\s\S]*?<\/aside>/)
  if (!aside) throw new Error('preview <aside> not found in dashboard.html')
  document.body.innerHTML = `
    <div id="dashboard-with-preview">
      <button id="preview-toggle-btn" style="display:none"><span>Preview App</span></button>
      ${aside[0]}
    </div>`
}

// Run dashboard.js in a function scope and hand back what the tests drive.
function loadDashboard(supabaseStub) {
  const body = `${DASHBOARD_JS}
    ;return {
      setApp: (a) => { currentApp = a; },
      updatePreviewContent, loadDraftRewards, draftPublishUrl, revealPreviewQR,
    };`
  // eslint-disable-next-line no-new-func
  return new Function('supabase', 'AppUtils', 'i18n', body)(
    supabaseStub,
    { escapeHtml, generateSlug: (s) => s, showToast: () => {} },
    undefined,
  )
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('item 2: dashboard draft state', () => {
  let calls
  let rewardsResult
  let dash

  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
    window.location.search = ''
    vi.restoreAllMocks()
    mountDashboardMarkup()
    calls = []
    rewardsResult = { data: [], error: null }
    dash = loadDashboard({ from: (table) => { calls.push(['from', table]); return query(rewardsResult, calls) } })
  })

  const el = (id) => document.getElementById(id)

  it('a draft shows "not live yet" and hides the QR, the link and Copy', async () => {
    rewardsResult = { data: [{ name: 'Free Coffee', points_cost: 100 }, { name: '10% Off', points_cost: 50 }], error: null }
    dash.setApp({ id: 'app-1', slug: 'joes-cafe', name: "Joe's Cafe", is_published: false, branding: {} })
    dash.updatePreviewContent()
    await flush()

    expect(el('preview-draft-notice').hidden).toBe(false)
    expect(el('preview-qr-section').style.display).toBe('none')
    expect(el('preview-panel-footer').style.display).toBe('none')
    expect(el('preview-qr-code').innerHTML).toBe('')
    expect(el('preview-url-display').textContent).toBe('')
    // No QR image or canvas was generated for the draft.
    expect(document.querySelector('#preview-qr-code img, #preview-qr-code canvas')).toBeNull()
  })

  it('Review and publish opens the builder on THIS app with review=1', () => {
    dash.setApp({ id: 'app-1', slug: 'joes-cafe', is_published: false, branding: {} })
    dash.updatePreviewContent()
    expect(el('preview-draft-publish-btn').getAttribute('href')).toBe('/app/app-builder.html?id=app-1&review=1')
  })

  it("lists the draft's active rewards, escaped", async () => {
    rewardsResult = { data: [{ name: '<img src=x onerror=alert(1)>', points_cost: 100 }, { name: 'Free Item', points_cost: 0 }], error: null }
    dash.setApp({ id: 'app-1', slug: 's', is_published: false, branding: {} })
    dash.updatePreviewContent()
    await flush()

    const items = [...el('preview-draft-rewards').querySelectorAll('li')]
    expect(items).toHaveLength(2)
    expect(el('preview-draft-rewards').querySelector('img')).toBeNull()
    expect(items[0].textContent).toContain('<img src=x onerror=alert(1)>')
    expect(items[0].textContent).toContain('100 pts')
    // The query is this app's active, non-deleted rewards in display order.
    expect(calls).toContainEqual(['from', 'app_rewards'])
    expect(calls).toContainEqual(['eq', 'app_id', 'app-1'])
    expect(calls).toContainEqual(['eq', 'is_active', true])
    expect(calls).toContainEqual(['is', 'deleted_at', null])
  })

  it('a draft with no rewards says so', async () => {
    dash.setApp({ id: 'app-1', slug: 's', is_published: false, branding: {} })
    dash.updatePreviewContent()
    await flush()
    expect(el('preview-draft-rewards').textContent).toContain('No rewards yet')
  })

  it('a rewards answer for an app the owner switched away from is dropped', async () => {
    rewardsResult = { data: [{ name: 'Old App Reward', points_cost: 10 }], error: null }
    dash.setApp({ id: 'app-1', slug: 's', is_published: false, branding: {} })
    const pending = dash.loadDraftRewards('app-1')
    dash.setApp({ id: 'app-2', slug: 't', is_published: false, branding: {} })
    await pending
    expect(el('preview-draft-rewards').textContent).not.toContain('Old App Reward')
  })

  it('a draft ignores "hide preview": not live yet must be seen', () => {
    localStorage.setItem('previewHidden', 'true')
    dash.setApp({ id: 'app-1', slug: 's', is_published: false, branding: {} })
    dash.updatePreviewContent()
    expect(el('dashboard-preview-col').style.display).toBe('flex')
  })

  it('a published app shows the QR section, the live URL and Copy, and no draft notice', () => {
    dash.setApp({ id: 'app-1', slug: 'joes-cafe', name: "Joe's", is_published: true, branding: {} })
    dash.updatePreviewContent()

    expect(el('preview-draft-notice').hidden).toBe(true)
    expect(el('preview-qr-section').style.display).toBe('')
    expect(el('preview-panel-footer').style.display).toBe('')
    expect(el('preview-url-display').textContent).toBe(`${window.location.origin}/a/joes-cafe`)
    expect(el('preview-qr-code').innerHTML).not.toBe('')
  })

  it('a published app still honours "hide preview"', () => {
    localStorage.setItem('previewHidden', 'true')
    dash.setApp({ id: 'app-1', slug: 's', is_published: true, branding: {} })
    dash.updatePreviewContent()
    expect(el('dashboard-preview-col').style.display).toBe('none')
  })

  it('switching from a draft to a live app swaps the panel back', () => {
    dash.setApp({ id: 'a', slug: 'a', is_published: false, branding: {} })
    dash.updatePreviewContent()
    dash.setApp({ id: 'b', slug: 'b', is_published: true, branding: {} })
    dash.updatePreviewContent()
    expect(el('preview-draft-notice').hidden).toBe(true)
    expect(el('preview-qr-section').style.display).toBe('')
  })

  it('arriving with #qr (from publish) un-hides and opens the panel, then drops the hash', () => {
    // tests/setup.js replaces window.location with a plain object.
    window.location.hash = '#qr'
    window.location.search = '?app=app-1'
    const replace = vi.spyOn(history, 'replaceState')
    localStorage.setItem('previewHidden', 'true')
    dash.setApp({ id: 'app-1', slug: 's', is_published: true, branding: {} })
    dash.updatePreviewContent()

    expect(localStorage.getItem('previewHidden')).toBeNull()
    expect(el('dashboard-preview-col').style.display).toBe('flex')
    expect(el('dashboard-preview-col').classList.contains('open')).toBe(true)
    expect(replace).toHaveBeenCalledWith(null, '', '/app/dashboard.html?app=app-1')
  })

  it('#qr on a draft opens nothing extra: the draft notice is what shows', () => {
    window.location.hash = '#qr'
    dash.setApp({ id: 'app-1', slug: 's', is_published: false, branding: {} })
    dash.updatePreviewContent()
    expect(el('preview-draft-notice').hidden).toBe(false)
    expect(el('preview-qr-section').style.display).toBe('none')
  })

  it('loadAppMetrics picks the app named in ?app= and falls back to the newest', () => {
    const fn = DASHBOARD_JS.match(/async function loadAppMetrics\(\)[\s\S]*?\n}\n/)[0]
    expect(fn).toMatch(/new URLSearchParams\(window\.location\.search\)\.get\('app'\)/)
    expect(fn).toMatch(/\(wantedAppId && apps\.find\(a => a\.id === wantedAppId\)\) \|\| apps\[0\]/)
  })
})

describe('item 2: App Builder publish lands on the dashboard QR', () => {
  const publish = BUILDER_JS.match(/async function publishApp\(\)[\s\S]*?\n}\n/)[0]

  it('reads the draft state BEFORE saveApp replaces currentApp', () => {
    expect(publish.indexOf('const wasDraft')).toBeGreaterThan(-1)
    expect(publish.indexOf('const wasDraft')).toBeLessThan(publish.indexOf('await saveApp(true)'))
  })

  it('a first publish (or the onboarding run) goes to /app/dashboard.html?app=<id>#qr', () => {
    expect(publish).toMatch(/\(isOnboardingRun \|\| wasDraft\) && appId/)
    expect(publish).toContain('`/app/dashboard.html?app=${encodeURIComponent(appId)}#qr`')
    expect(publish).not.toContain("'/app/intelligence.html'")
  })

  it('still sets is_published and is_active', () => {
    expect(publish).toMatch(/is_active: true,\s*is_published: true/)
  })

  it('?review=1 relabels publish only on a draft', () => {
    expect(BUILDER_JS).toMatch(/urlParams\.get\('review'\) === '1' && currentApp && !currentApp\.is_published\) applyPublishAndQrLabel\(\)/)
  })
})

describe('item 2: welcome banner "Customize App" never starts a second draft', () => {
  function loadBanner() {
    // eslint-disable-next-line no-new-func
    return new Function('i18n', `${BANNER_JS}\n;return WelcomeBanner;`)(undefined)
  }

  beforeEach(() => {
    document.body.innerHTML = '<div id="welcome-banner-container"></div><div id="crown-dashboard"></div>'
    window.location.pathname = '/app/intelligence.html'
  })

  const appCta = () => document.querySelector('.welcome-cta[data-card="app"]')
  const profile = { welcome_progress: { ai: 'done', automations: null, app: null, rewards: null } }

  it('points at the dashboard until the lookup answers, never at a bare builder', () => {
    const banner = loadBanner()
    const never = { from: () => query(new Promise(() => {})) }
    banner.show(never, profile, 'Joe', 'org-1')
    expect(appCta().getAttribute('href')).toBe('/app/dashboard.html')
  })

  it("then opens the org's newest app in the builder, with review=1 while it is a draft", async () => {
    const calls = []
    const banner = loadBanner()
    const sb = {
      from: (t) => { calls.push(['from', t]); return query({ data: [{ id: 'app-9', is_published: false }], error: null }, calls) },
    }
    banner.show(sb, profile, 'Joe', 'org-1')
    await flush()
    expect(appCta().getAttribute('href')).toBe('/app/app-builder.html?id=app-9&review=1')
    expect(calls).toContainEqual(['eq', 'organization_id', 'org-1'])
    expect(calls).toContainEqual(['is', 'deleted_at', null])
  })

  it('a live app opens without review=1', async () => {
    const banner = loadBanner()
    const sb = { from: () => query({ data: [{ id: 'app-9', is_published: true }], error: null }) }
    banner.show(sb, profile, 'Joe', 'org-1')
    await flush()
    expect(appCta().getAttribute('href')).toBe('/app/app-builder.html?id=app-9')
  })

  it('no org app (or an error) leaves the dashboard link', async () => {
    const banner = loadBanner()
    banner.show({ from: () => query({ data: [], error: null }) }, profile, 'Joe', 'org-1')
    await flush()
    expect(appCta().getAttribute('href')).toBe('/app/dashboard.html')
  })

  it('intelligence.js passes the organization id', () => {
    expect(read('app/intelligence.js')).toContain("WelcomeBanner.show(supabase, userInfo, fullOrg?.name || 'Your', organizationId)")
  })
})

describe('item 3: Turnstile never locks the auth forms', () => {
  const PAGES = ['app/signup.html', 'app/forgot-password.html', 'app/login.html']

  for (const page of PAGES) {
    describe(page, () => {
      const html = read(page)

      it('the widget has an error callback that unlocks the form', () => {
        expect(html).toMatch(/class="cf-turnstile"[^>]*data-error-callback="onTurnstileError"/)
        expect(html).toMatch(/function onTurnstileError\(\) \{[\s\S]*?turnstileToken = 'captcha-unavailable';/)
      })

      it('the submit gate gives way when api.js never loaded', () => {
        expect(html).toContain("if (siteKey && siteKey !== 'YOUR_SITE_KEY' && !turnstileToken && turnstileLoaded()) {")
        expect(html).toMatch(/function turnstileLoaded\(\) \{\s*return typeof window\.turnstile !== 'undefined';\s*\}/)
      })

      it('there is exactly one CAPTCHA gate', () => {
        expect(html.match(/!turnstileToken/g)).toHaveLength(1)
      })
    })
  }

  // The gate itself, run: blocked only when Turnstile loaded AND produced no token.
  it('gate behaviour', () => {
    const src = read('app/signup.html').match(/function turnstileLoaded\(\) \{[\s\S]*?\n {8}\}/)[0]
    // eslint-disable-next-line no-new-func
    const turnstileLoaded = new Function(`${src}; return turnstileLoaded;`)()
    const blocked = (token) => Boolean('key' && 'key' !== 'YOUR_SITE_KEY' && !token && turnstileLoaded())

    delete window.turnstile
    expect(blocked(null)).toBe(false) // script blocked: let them through
    window.turnstile = {}
    expect(blocked(null)).toBe(true) // loaded, challenge not done yet
    expect(blocked('captcha-unavailable')).toBe(false) // widget errored
    expect(blocked('tok')).toBe(false)
    delete window.turnstile
  })
})

