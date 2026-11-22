/**
 * The four "noticed, not fixed" items from the owner-journey round
 * (plan twinkling-coalescing-sutherland, 2026-11-22).
 *
 *   1. dashboard.js, welcome-banner.js and counter.js checked a lowercase `i18n` that never
 *      existed (i18n.js exports window.I18n), so their JS-built strings were always English.
 *      They now read window.I18n through a helper that falls back to English while the
 *      language file is still loading (I18n.t answers with the key itself until then).
 *   2. Re-inviting a cancelled/accepted address hit UNIQUE(organization_id, email).
 *   3. get_org_member_limit / count_org_members / check_member_limit were open to anon.
 *   4. A stored pre-rescale hero draft (1 pt a visit, a 50-point first reward) was shown and
 *      would have become the real app.
 *
 * Items 2 and 3 are behaviour-tested on PGlite in
 * ~/Documents/Design Benches/royalty-owner-journey-2026-11-22/pglite/run.mjs (the M8 section;
 * 12 of 13 mutants caught, the 13th is equivalent). These pin the shape.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar']
const FR = JSON.parse(read('i18n/fr.json'))
const DASH = read('app/dashboard.js')
const BANNER = read('app/welcome-banner.js')
const COUNTER = read('app/counter.js')

// ── 1. Translations ─────────────────────────────────────────────────────────

// The real i18n.js, loaded into this jsdom window with French stored as the choice.
let releaseFetch
async function loadRealI18n() {
  localStorage.setItem('royalty_language', 'fr')
  const gate = new Promise((r) => { releaseFetch = r })
  globalThis.fetch = async (url) => {
    await gate // hold the language files until the test says so
    const file = String(url).replace(/^\/i18n\//, '').replace(/\?.*$/, '')
    return { ok: true, json: async () => JSON.parse(read(`i18n/${file}`)) }
  }
  const ready = new Promise((r) => window.addEventListener('i18n:ready', r, { once: true }))
  window.eval(read('i18n/i18n.js'))
  return ready
}

const grab = (src, re, name) => {
  const m = src.match(re)
  if (!m) throw new Error(`${name} not found`)
  return m[0]
}
// eslint-disable-next-line no-new-func
const dashT = new Function(`${grab(DASH, /function dashT\(key, fallback\) \{[\s\S]*?\n}\n/, 'dashT')}; return dashT;`)()
// eslint-disable-next-line no-new-func
const counterT = new Function(`${grab(COUNTER, /function counterT\(key, fallback, replacements\) \{[\s\S]*?\n}\n/, 'counterT')}; return counterT;`)()
// eslint-disable-next-line no-new-func
const bannerFns = new Function(`${grab(BANNER, /    function t\(key, fallback, vars\) \{[\s\S]*?\n    }\n/, 'banner t')}
${grab(BANNER, /    function escapeBannerText\(s\) \{[\s\S]*?\n    }\n/, 'escapeBannerText')}
return { t, escapeBannerText };`)()

describe('1. the dashboard, banner and Counter read window.I18n', () => {
  let ready
  beforeAll(() => { ready = loadRealI18n() })

  it('before the language file loads, every helper gives the English fallback, never the key', () => {
    expect(window.I18n.t('dashboard.launchApp')).toBe('dashboard.launchApp') // the trap
    expect(dashT('dashboard.launchApp', 'Launch App')).toBe('Launch App')
    expect(counterT('counter.title', 'Counter')).toBe('Counter')
    expect(bannerFns.t('welcome.appTitle', 'Your New Application')).toBe('Your New Application')
  })

  it('once French has loaded, they show French', async () => {
    releaseFetch()
    await ready
    expect(FR.dashboard.launchApp).not.toBe('Launch App')
    expect(dashT('dashboard.launchApp', 'Launch App')).toBe(FR.dashboard.launchApp)
    expect(dashT('dashboard.appLive', 'Live')).toBe(FR.dashboard.appLive)
    expect(bannerFns.t('welcome.appTitle', 'x')).toBe(FR.welcome.appTitle)
    const anyCounterKey = Object.keys(FR.counter || {})[0]
    expect(anyCounterKey, 'fr.json has counter keys').toBeTruthy()
    expect(counterT(`counter.${anyCounterKey}`, 'x')).toBe(FR.counter[anyCounterKey])
  })

  it('the banner fills {name} in the translated app card, escaped', () => {
    expect(FR.welcome.appDesc).toContain('{name}')
    const out = bannerFns.t('welcome.appDesc', 'fallback', { name: bannerFns.escapeBannerText('Bean <b>There</b>') })
    expect(out.startsWith('Bean &lt;b&gt;There&lt;/b&gt;')).toBe(true)
    expect(out).not.toContain('{name}')
    expect(BANNER).toContain("{ name: escapeBannerText(orgName) }")
  })

  it('a missing key still falls back in every helper', () => {
    expect(dashT('dashboard.noSuchKeyEver', 'Fallback')).toBe('Fallback')
    expect(counterT('counter.noSuchKeyEver', 'Hi {n}', { n: 2 })).toBe('Hi 2')
    expect(bannerFns.t('welcome.noSuchKeyEver', 'Fallback')).toBe('Fallback')
  })

  it('no lowercase i18n.t is left in the three files; updatePageTranslations stays a no-op', () => {
    for (const src of [DASH, BANNER, COUNTER]) expect(src).not.toMatch(/\bi18n\.t\(/)
    // I18n has no updatePageTranslations; calling applyTranslations there would reset the
    // header button the JS just labelled "Launch App" back to its static "Preview App".
    expect(read('i18n/i18n.js')).not.toMatch(/window\.i18n\s*=/)
    expect(DASH.match(/i18n\.updatePageTranslations\(\)/g)).toHaveLength(2)
  })

  it('returning visitors get the new files', () => {
    expect(read('i18n/i18n.js')).toContain('const TRANSLATION_VERSION = 25;')
    expect(read('app/dashboard.html')).toContain('dashboard.js?v=27"')
    expect(read('app/counter.html')).toContain('counter.js?v=2"')
    expect(read('app/intelligence.html')).toContain('welcome-banner.js?v=19"')
    expect(read('app/settings.html')).toContain('settings.js?v=12"')
    expect(read('app/dashboard.html')).toContain('i18n/i18n.js?v=14"')
  })
})

// ── 2 + 3. Migration 20261122000008 ─────────────────────────────────────────

describe('2 + 3. migration 20261122000008', () => {
  const M8 = read('supabase/migrations/20261122000008_invites_reinvite_member_limit_private.sql')

  it('drops UNIQUE(organization_id, email) found by its columns, for one pending invite per address', () => {
    expect(M8).toMatch(/FROM pg_constraint c[\s\S]*contype = 'u'[\s\S]*= ARRAY\['email', 'organization_id'\]/)
    expect(M8).not.toMatch(/DROP CONSTRAINT (IF EXISTS )?organization_invitations_organization_id_email_key/)
    expect(M8).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_one_pending\s+ON public\.organization_invitations \(organization_id, lower\(email\)\)\s+WHERE status = 'pending';/)
  })

  it('refuses to run over duplicates or a caller the revoke would break', () => {
    expect(M8).toMatch(/duplicate pending invitations/)
    expect(M8).toMatch(/NOT p\.prosecdef/)
    expect(M8).toMatch(/FROM pg_views/)
    expect(M8).toMatch(/FROM pg_policy/)
  })

  it('the three limit functions are service_role only', () => {
    for (const fn of ['get_org_member_limit', 'count_org_members', 'check_member_limit']) {
      expect(M8).toContain(`REVOKE ALL ON FUNCTION public.${fn}(uuid) FROM PUBLIC, anon, authenticated;`)
      expect(M8).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(uuid) TO service_role;`)
    }
  })

  it('org_member_usage answers the org\'s own members only, and not anon', () => {
    const fn = grab(M8, /CREATE OR REPLACE FUNCTION public\.org_member_usage[\s\S]*?\n\$\$;\n/, 'org_member_usage')
    expect(fn).toMatch(/SECURITY DEFINER\s+SET search_path = public/)
    expect(fn).toMatch(/FROM public\.organization_members m\s+WHERE m\.organization_id = p_org_id AND m\.user_id = v_uid/)
    expect(fn).toContain('RETURN public.check_member_limit(p_org_id);')
    expect(M8).toContain('REVOKE ALL ON FUNCTION public.org_member_usage(uuid) FROM PUBLIC, anon;')
    expect(M8).toContain('GRANT EXECUTE ON FUNCTION public.org_member_usage(uuid) TO authenticated, service_role;')
  })

  it('the dashboard asks org_member_usage; no client calls the three directly', () => {
    expect(DASH).toContain("supabase.rpc('org_member_usage', { p_org_id: currentOrganization.id })")
    const clientFiles = [
      ...fs.readdirSync(path.join(ROOT, 'app')).filter((f) => /\.(js|html)$/.test(f)).map((f) => `app/${f}`),
      ...fs.readdirSync(path.join(ROOT, 'customer-app')).filter((f) => /\.(js|html)$/.test(f)).map((f) => `customer-app/${f}`),
    ]
    for (const f of clientFiles) {
      expect(read(f), f).not.toMatch(/rpc\(\s*['"](get_org_member_limit|count_org_members|check_member_limit)['"]/)
    }
  })

  it('Settings says a pending invite exists, in all 8 languages', () => {
    const SETTINGS = read('app/settings.js')
    expect(SETTINGS).toMatch(/error\.code === '23505'[\s\S]{0,200}toasts\.emailAlreadyInvited/)
    for (const l of LANGS) {
      const s = JSON.parse(read(`i18n/${l}.json`)).toasts.emailAlreadyInvited
      expect(s, l).not.toBe('This email has already been invited')
      if (l !== 'en') expect(s, l).not.toMatch(/pending invitation/)
      // Names the button the owner has to press, in that language.
      expect(s, l).toContain(JSON.parse(read(`i18n/${l}.json`)).settings.team.resendInvite)
    }
  })
})

// ── 4. Stored hero drafts ───────────────────────────────────────────────────

let AppConfigFallback
let SignupPreview
beforeAll(() => {
  const ctx = { window: {}, console, module: undefined, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }
  vm.createContext(ctx)
  for (const f of ['app/app-templates-library.js', 'app/app-config-fallback.js', 'app/signup-preview.js']) {
    vm.runInContext(read(f), ctx, { filename: f })
  }
  AppConfigFallback = ctx.window.AppConfigFallback
  SignupPreview = ctx.window.SignupPreview
})

// Jay's stored draft, as built before 9e8f62d: the cafe punch card (1 pt a visit, 1 welcome
// point) with an unscaled 50-point first reward.
const jaysDraft = () => ({
  source: 'template',
  templateId: 'cafe-rewards',
  appName: 'Small Coffee Rewards',
  primaryColor: '#B3261E',
  pointsPerScan: 1,
  welcomePoints: 1,
  tiers: [{ key: 'bronze', name: 'Regular', points: 0 }, { key: 'silver', name: 'Local', points: 50 }],
  rewards: [
    { name: 'Free Pastry', pointsCost: 50 },
    { name: 'Free House Coffee', pointsCost: 100 },
    { name: 'Bag of House Beans', pointsCost: 300 },
  ],
})

describe('4. AppConfigFallback.isSane', () => {
  it("rejects Jay's pre-rescale draft (49 visits to the first reward)", () => {
    expect(AppConfigFallback.isSane(jaysDraft())).toBe(false)
  })

  it('rejects the other broken shapes', () => {
    const c = jaysDraft()
    c.rewards = [{ name: 'A', pointsCost: 5 }]
    expect(AppConfigFallback.isSane(c), '4 visits: fine').toBe(true)
    expect(AppConfigFallback.isSane({ ...c, pointsPerScan: 0 })).toBe(false)
    expect(AppConfigFallback.isSane({ ...c, pointsPerScan: undefined })).toBe(false)
    expect(AppConfigFallback.isSane({ ...c, rewards: [] })).toBe(false)
    expect(AppConfigFallback.isSane({ ...c, rewards: [{ name: 'Free', pointsCost: 0 }] })).toBe(false)
    expect(AppConfigFallback.isSane({ ...c, welcomePoints: 5 }), 'free at signup').toBe(false)
    expect(AppConfigFallback.isSane({ ...c, welcomePoints: 4 }), 'one visit').toBe(false)
    expect(AppConfigFallback.isSane({ ...c, rewards: [{ name: 'A', pointsCost: 21 }], welcomePoints: 0 }), '21 visits').toBe(false)
    expect(AppConfigFallback.isSane({ ...c, rewards: [{ name: 'A', pointsCost: 20 }], welcomePoints: 0 }), '20 visits').toBe(true)
    expect(AppConfigFallback.isSane(null)).toBe(false)
  })

  it('accepts everything build() makes, for every industry and niche', () => {
    const industries = ['food', 'retail', 'health', 'service', 'technology', 'education', 'other', '', 'nonsense']
    const prompts = [
      '', 'a small coffee shop in Austin', 'nail salon downtown', 'barbershop in Queens', 'hair salon',
      'family bakery', 'italian restaurant', 'yoga studio', 'boxing gym', 'car wash', 'bookstore',
      'dental clinic', 'IT repair shop', 'tutoring centre', 'pet groomer',
    ]
    let n = 0
    for (const industry of industries) {
      for (const prompt of prompts) {
        const cfg = AppConfigFallback.build({ prompt, industry, businessName: 'Bean There' })
        expect(AppConfigFallback.isSane(cfg), `${industry} / ${prompt}`).toBe(true)
        n++
      }
    }
    expect(n).toBe(industries.length * prompts.length)
  })

  it('the hardcoded last resort passes too (welcome 30, not 50, against a 50-point reward)', () => {
    // A throwing input sends build() to its catch, which returns hardcodedConfig().
    const quiet = console.error
    console.error = () => {}
    let cfg
    try {
      cfg = AppConfigFallback.build({ get prompt() { throw new Error('boom') }, businessName: 'B' })
    } finally { console.error = quiet }
    expect(cfg.source).toBe('hardcoded')
    expect(cfg.welcomePoints).toBe(30)
    expect(AppConfigFallback.isSane(cfg)).toBe(true)
  })
})

describe('4. a stored draft that fails isSane is rebuilt, not shown or committed', () => {
  it('resolveConfig rebuilds it from the stored description and asks to write it back', () => {
    const { config, changed } = SignupPreview.resolveConfig({
      businessPrompt: 'a small coffee shop',
      businessContext: { industry: 'food' },
      businessDetails: { businessName: 'Small Coffee' },
      appConfig: jaysDraft(),
    })
    expect(changed).toBe(true)
    expect(config.appName).toBe('Small Coffee Rewards')
    expect(AppConfigFallback.isSane(config)).toBe(true)
    const first = SignupPreview.firstReward(config)
    expect((first.pointsCost - config.welcomePoints) / config.pointsPerScan).toBeLessThanOrEqual(20)
  })

  it('a sane stored config is still used as shown', () => {
    const c = jaysDraft()
    c.rewards = c.rewards.map((r) => ({ ...r, pointsCost: r.pointsCost / 10 }))
    const { config, changed } = SignupPreview.resolveConfig({
      businessPrompt: 'a small coffee shop', businessDetails: { businessName: 'Small Coffee' }, appConfig: c,
    })
    expect(changed).toBe(false)
    expect(config.rewards.map((r) => r.pointsCost)).toEqual([5, 10, 30])
  })

  it('OnboardingSave drops an insane stored config before createLoyaltyApp', () => {
    const SAVE = read('app/onboarding-save.js')
    const i = SAVE.indexOf('let appConfig = onboardingData.appConfig || null;')
    const guard = SAVE.indexOf('!AppConfigFallback.isSane(appConfig)', i)
    const rebuild = SAVE.indexOf('appConfig = AppConfigFallback.build(', i)
    const create = SAVE.indexOf('await createLoyaltyApp(', i)
    expect(i).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(i)
    expect(rebuild).toBeGreaterThan(guard)
    expect(create).toBeGreaterThan(rebuild)
    expect(SAVE.slice(guard, rebuild)).toMatch(/appConfig = null;/)
  })

  it('the pages load the new scripts', () => {
    for (const f of ['app/signup.html', 'app/login.html', 'app/get-started.html', 'index.html']) {
      expect(read(f), f).toContain('app-config-fallback.js?v=3"')
    }
    for (const f of ['app/signup.html', 'app/login.html', 'app/get-started.html']) {
      expect(read(f), f).toContain('onboarding-save.js?v=4"')
    }
    expect(read('app/signup.html')).toContain('signup-preview.js?v=2"')
  })
})
