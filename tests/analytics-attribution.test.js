/**
 * js/analytics.js: attribution carried in ?src= (no storage), and identify/group queued
 * until PostHog loads (plan can-we-enhance-our-breezy-flute, 2026-11-25).
 *
 * The REAL analytics.js is evaluated in this jsdom window for every test, with a stubbed
 * location / referrer and a fake posthog that records calls.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const ANALYTICS = read('js/analytics.js')

let listeners = []
const realAdd = document.addEventListener.bind(document)

function load({ url = 'https://royaltyapp.ai/', referrer = '', notrack = false, dnt = undefined, gpc = undefined } = {}) {
  const u = new URL(url)
  window.location = {
    href: u.href, origin: u.origin, hostname: u.hostname, pathname: u.pathname,
    search: u.search, hash: u.hash, assign: () => {}, replace: () => {},
  }
  Object.defineProperty(document, 'referrer', { value: referrer, configurable: true })
  Object.defineProperty(navigator, 'doNotTrack', { value: dnt, configurable: true })
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: gpc, configurable: true })
  window.POSTHOG_TOKEN = 'phc_test'
  window.RoyaltyNoTrack = { isDisabled: () => notrack }
  delete window.Analytics
  delete window.posthog
  window.eval(ANALYTICS)
  return window.Analytics
}

// The posthog loader script analytics.js appended; "loads" it.
function finishLoading() {
  const calls = []
  window.posthog = {
    init: (_t, cfg) => { cfg.loaded() },
    capture: (...a) => calls.push(['capture', ...a]),
    identify: (...a) => calls.push(['identify', ...a]),
    group: (...a) => calls.push(['group', ...a]),
    reset: () => calls.push(['reset']),
  }
  const scripts = [...document.head.querySelectorAll('script[src*="/ingest/static/array.js"]')]
  scripts[scripts.length - 1].onload()
  return calls
}

function click(href) {
  const a = document.createElement('a')
  a.setAttribute('href', href)
  document.body.appendChild(a)
  a.addEventListener('click', (e) => e.preventDefault()) // jsdom can't navigate
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return a.getAttribute('href')
}

beforeEach(() => {
  listeners = []
  document.addEventListener = (type, fn, opts) => { listeners.push([type, fn, opts]); realAdd(type, fn, opts) }
  document.body.innerHTML = ''
  document.head.querySelectorAll('script').forEach((s) => s.remove())
})
afterEach(() => {
  listeners.forEach(([t, f, o]) => document.removeEventListener(t, f, o))
  document.addEventListener = realAdd
})

describe('attribution: the arrival page', () => {
  it('packs utm, click id, external referrer and landing path into src', () => {
    const A = load({ url: 'https://royaltyapp.ai/pricing.html?utm_source=plan-check&utm_campaign=Nov&gclid=abc', referrer: 'https://www.google.com/search?q=x' })
    expect(A.attribution()).toEqual({
      utm_source: 'plan-check', utm_campaign: 'Nov', click_id: 'gclid', referrer: 'google.com', landing: '/pricing.html',
    })
  })

  it('a direct visit still records its landing page', () => {
    const A = load({ url: 'https://royaltyapp.ai/blog/x.html' })
    expect(A.attribution()).toEqual({ landing: '/blog/x.html' })
  })

  it('mid-visit without src (internal referrer) is unknown, not "direct"', () => {
    const A = load({ url: 'https://royaltyapp.ai/pricing.html', referrer: 'https://royaltyapp.ai/' })
    expect(A.attribution()).toBeNull()
    expect(A.withAttribution('/app/signup.html')).toBe('/app/signup.html')
  })

  it('reads a carried src, and a bare tag as a utm_source', () => {
    expect(load({ url: 'https://royaltyapp.ai/app/signup.html?src=' + encodeURIComponent('s=news&l=/'), referrer: 'https://royaltyapp.ai/' })
      .attribution()).toEqual({ utm_source: 'news', landing: '/' })
    expect(load({ url: 'https://royaltyapp.ai/app/signup.html?src=blog_widget', referrer: 'https://royaltyapp.ai/blog/x.html' })
      .attribution()).toEqual({ utm_source: 'blog_widget' })
  })

  it('clips long values', () => {
    const A = load({ url: 'https://royaltyapp.ai/?utm_source=' + 'x'.repeat(300) })
    expect(A.attribution().utm_source).toHaveLength(80)
  })

  it.each([
    ['?notrack=1', { notrack: true }],
    ['Do Not Track', { dnt: '1' }],
    ['Global Privacy Control', { gpc: true }],
  ])('is off when the visitor opted out (%s)', (_n, opts) => {
    const A = load({ url: 'https://royaltyapp.ai/?utm_source=x', ...opts })
    expect(A.attribution()).toBeNull()
    expect(click('/pricing.html')).toBe('/pricing.html')
  })
})

describe('attribution: carried on links and forms, never stored', () => {
  it('internal links get ?src=, external links and same-page anchors do not', () => {
    load({ url: 'https://royaltyapp.ai/?utm_source=plan-check', referrer: '' })
    const href = click('/pricing.html?plan=growth')
    const u = new URL(href, 'https://royaltyapp.ai')
    expect(u.pathname).toBe('/pricing.html')
    expect(u.searchParams.get('plan')).toBe('growth')
    expect(new URLSearchParams(u.searchParams.get('src')).get('s')).toBe('plan-check')
    expect(click('https://example.com/x')).toBe('https://example.com/x')
    expect(click('#features')).toBe('#features')
    expect(click('mailto:hi@example.com')).toBe('mailto:hi@example.com')
  })

  it('a link that already has src keeps it', () => {
    load({ url: 'https://royaltyapp.ai/?utm_source=a' })
    expect(click('/app/signup.html?src=blog_widget')).toBe('/app/signup.html?src=blog_widget')
  })

  it('same-origin GET forms get a hidden src field (the industry-page generator)', () => {
    load({ url: 'https://royaltyapp.ai/loyalty-program/coffee-shop.html?utm_source=ig', referrer: '' })
    document.body.innerHTML = '<form action="/" method="get"><textarea name="prompt">x</textarea></form>'
    const form = document.querySelector('form')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    const input = form.querySelector('input[name="src"]')
    expect(input.type).toBe('hidden')
    expect(new URLSearchParams(input.value).get('l')).toBe('/loyalty-program/coffee-shop.html')
  })

  it('product pages are not decorated (only marketing, signup and login)', () => {
    load({ url: 'https://royaltyapp.ai/app/dashboard.html?utm_source=email', referrer: '' })
    expect(click('/app/customers.html')).toBe('/app/customers.html')
    load({ url: 'https://royaltyapp.ai/app/login.html?utm_source=email', referrer: '' })
    expect(click('/app/signup.html')).toMatch(/[?&]src=/)
    // Netlify pretty URLs: the same pages without .html, and links rewritten to match
    load({ url: 'https://royaltyapp.ai/app/login?utm_source=email', referrer: '' })
    expect(click('/app/signup')).toMatch(/^\/app\/signup\?src=/)
    load({ url: 'https://royaltyapp.ai/app/signup?src=' + encodeURIComponent('s=email&l=/app/login'), referrer: 'https://royaltyapp.ai/app/login' })
    expect(window.Analytics.attribution()).toEqual({ utm_source: 'email', landing: '/app/login' })
  })

  it('withAttribution keeps the path relative and its own params', () => {
    const A = load({ url: 'https://royaltyapp.ai/?utm_source=x' })
    const out = A.withAttribution('/app/signup.html?onboarding=true')
    expect(out.startsWith('/app/signup.html?onboarding=true&src=')).toBe(true)
    expect(A.withAttribution('https://other.example/')).toBe('https://other.example/')
  })

  it('writes nothing to localStorage or cookies on a marketing page', () => {
    localStorage.setItem.mockClear()
    const before = document.cookie
    load({ url: 'https://royaltyapp.ai/?utm_source=x' })
    click('/pricing.html')
    expect(localStorage.setItem).not.toHaveBeenCalled()
    expect(document.cookie).toBe(before)
  })
})

describe('queue: nothing is lost before PostHog loads', () => {
  it('identify and group fired early are replayed in call order', () => {
    const A = load({ url: 'https://royaltyapp.ai/app/dashboard.html' })
    A.track('first')
    A.identify('user-1', { plan: 'free' })
    A.group('organization', 'org-1', { plan: 'free' })
    A.track('second', { x: 1 })
    const calls = finishLoading()
    expect(calls).toEqual([
      ['capture', 'first', {}],
      ['identify', 'user-1', { plan: 'free' }],
      ['group', 'organization', 'org-1', { plan: 'free' }],
      ['capture', 'second', { x: 1 }],
    ])
    A.identify('user-1')
    expect(calls[calls.length - 1]).toEqual(['identify', 'user-1', {}])
  })

  it('a reset before load stays in order (sign-out right after sign-in)', () => {
    const A = load({ url: 'https://royaltyapp.ai/app/dashboard.html' })
    A.identify('user-1')
    A.reset()
    const calls = finishLoading()
    expect(calls).toEqual([['identify', 'user-1', {}], ['reset']])
  })

  it('opted out: the API is a working no-op that still answers attribution()', () => {
    const A = load({ url: 'https://royaltyapp.ai/?utm_source=x', notrack: true })
    expect(() => { A.track('x'); A.identify('u'); A.group('organization', 'o'); A.reset() }).not.toThrow()
    expect(A.attribution()).toBeNull()
    expect(A.withAttribution('/a')).toBe('/a')
  })
})

describe('call sites', () => {
  const SIGNUP = read('app/signup.html')
  const LOGIN = read('app/login.html')
  const AUTH = read('app/auth.js')

  it('signup sends signup_source in the auth metadata and fires account_created on both branches', () => {
    const submit = SIGNUP.slice(SIGNUP.indexOf("signupForm.addEventListener('submit'"))
    expect(submit).toMatch(/if \(source\) metadata\.signup_source = source;/)
    expect(submit).toMatch(/options: \{\s*data: metadata,/)
    const created = submit.indexOf("A.track('account_created'")
    expect(created).toBeGreaterThan(submit.indexOf('if (signUpError) throw signUpError;'))
    expect(created).toBeLessThan(submit.indexOf('if (!signUpData.session)'))
    expect(submit).toMatch(/\$set_once: source \? \{ signup_source: source \} : \{\}/)
  })

  it('signup_page_viewed waits for the deferred analytics.js', () => {
    expect(SIGNUP).toMatch(/royaltyWhenAnalytics\(A => A\.track\('signup_page_viewed'/)
    expect(SIGNUP).not.toMatch(/window\.Analytics\?\.track\('signup_page_viewed'/)
  })

  it('login fires logged_in and email_confirmed, identifying first', () => {
    expect(LOGIN).toMatch(/A\.identify\(user\.id\);\s+A\.track\('logged_in'/)
    expect(LOGIN).toMatch(/A\.identify\(user\.id\);\s+A\.track\('email_confirmed'/)
  })

  it('royaltyWhenAnalytics runs now, or after the deferred scripts', () => {
    // eslint-disable-next-line no-new-func
    const when = new Function(`${AUTH.match(/function royaltyWhenAnalytics\(fn\) \{[\s\S]*?\n}\n/)[0]}; return royaltyWhenAnalytics;`)()
    const seen = []
    delete window.Analytics
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })
    when((A) => seen.push(A.tag))
    expect(seen).toEqual([])
    window.Analytics = { tag: 'late' }
    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(seen).toEqual(['late'])
    when((A) => seen.push(A.tag + '-now'))
    expect(seen).toEqual(['late', 'late-now'])
    when(() => { throw new Error('boom') }) // never throws into the page
    delete document.readyState
  })

  it('every page that loads analytics.js loads v=2, and accept-invite has it', () => {
    // Tracked files only: blog/<post>.html are gitignored build output of blog/post.html.
    const htmls = execFileSync('git', ['ls-files', '*.html'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
    const loaders = htmls.filter((f) => read(f).includes('/js/analytics.js'))
    expect(loaders.length).toBeGreaterThan(40)
    loaders.forEach((f) => expect(read(f), f).toContain('/js/analytics.js?v=2'))
    expect(loaders.map((f) => path.normalize(f))).toContain(path.normalize('app/accept-invite.html'))
  })

  it('blog widgets point at the real signup page', () => {
    const W = read('app/embed-widgets.js')
    expect(W).not.toMatch(/'\/signup\.html/)
    expect(W).toMatch(/const base = '\/app\/signup\.html';/)
    expect(W).toMatch(/base \+ '\?src=blog_widget'/)
  })
})
