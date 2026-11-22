import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

// app-config-fallback.js and app-templates-library.js are classic scripts that
// assign to globals, not ES modules. Evaluate them in one shared VM context so
// the fallback module can see getSuggestedAppTemplates the same way it does in
// the browser.
let AppConfigFallback

beforeAll(() => {
  const root = path.resolve(__dirname, '..')
  const ctx = { window: {}, console, module: undefined }
  vm.createContext(ctx)
  for (const f of ['app/app-templates-library.js', 'app/app-config-fallback.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f })
  }
  // Read it off the fake `window` exactly as the browser would: a top-level
  // `const` lands in the context's lexical scope, not on the context object.
  AppConfigFallback = ctx.window.AppConfigFallback
  expect(AppConfigFallback, 'AppConfigFallback failed to load').toBeTruthy()
  // The template library must be visible to the fallback module, or every
  // "template" assertion below would pass vacuously on the hardcoded tier.
  expect(
    vm.runInContext('typeof getSuggestedAppTemplates', ctx),
    'app-templates-library.js did not expose getSuggestedAppTemplates'
  ).toBe('function')
})

// WCAG relative luminance / contrast against white.
function contrastVsWhite(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const ch = c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const L = 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255)
  return 1.05 / (L + 0.05)
}

const FILLER = ['free item of your choice', 'vip treatment', 'birthday bonus', '10% off']

describe('AppConfigFallback palette', () => {
  it('every industry primary is readable behind white text (WCAG AA, 4.5:1)', () => {
    const palette = AppConfigFallback._INDUSTRY_PALETTE
    // Guard against the assertion passing vacuously if the palette ever moves.
    expect(Object.keys(palette).length).toBeGreaterThanOrEqual(7)
    for (const [industry, colors] of Object.entries(palette)) {
      const ratio = contrastVsWhite(colors.primary)
      expect(ratio, `${industry} primary ${colors.primary} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('secondary is darker than primary so the two never collapse together', () => {
    for (const [industry, colors] of Object.entries(AppConfigFallback._INDUSTRY_PALETTE)) {
      expect(contrastVsWhite(colors.secondary), industry).toBeGreaterThan(contrastVsWhite(colors.primary))
    }
  })
})

describe('AppConfigFallback.build', () => {
  const INDUSTRIES = ['food', 'retail', 'health', 'service', 'technology', 'education', 'other']

  it.each(INDUSTRIES)('produces a coherent config for %s', (industry) => {
    const cfg = AppConfigFallback.build({ prompt: 'a small local business', industry, businessName: 'Nomu' })

    expect(cfg.appName).toContain('Nomu')
    expect(contrastVsWhite(cfg.primaryColor)).toBeGreaterThanOrEqual(4.5)

    // Tier invariants that award_points and the tier UI depend on.
    expect(cfg.tiers).toHaveLength(4)
    expect(cfg.tiers.map(t => t.key)).toEqual(['bronze', 'silver', 'gold', 'platinum'])
    expect(cfg.tiers[0].points).toBe(0)
    for (let i = 1; i < cfg.tiers.length; i++) {
      expect(cfg.tiers[i].points).toBeGreaterThan(cfg.tiers[i - 1].points)
    }

    // Tier names must be branded, not the generic ladder we are replacing.
    const generic = ['bronze', 'silver', 'gold', 'platinum']
    for (const t of cfg.tiers) {
      expect(generic).not.toContain(t.name.toLowerCase())
    }

    // Reward economy.
    expect(cfg.rewards.length).toBeGreaterThanOrEqual(3)
    const cheapest = Math.min(...cfg.rewards.map(r => r.pointsCost))
    expect(cheapest).toBeLessThanOrEqual(cfg.tiers[1].points)
    expect(cfg.welcomePoints).toBeLessThanOrEqual(cheapest)

    for (const r of cfg.rewards) {
      expect(r.pointsCost % 5, `${r.name} is not a multiple of 5`).toBe(0)
      for (const filler of FILLER) {
        expect(r.name.toLowerCase()).not.toContain(filler)
      }
    }
  })

  it('never returns a newsletter or social template for a bar', () => {
    // getSuggestedAppTemplates maps "bar" -> venue-social, which is not a
    // loyalty programme and would render an app nobody asked for.
    const cfg = AppConfigFallback.build({ prompt: 'a cocktail bar and lounge', industry: 'food', businessName: 'Ash' })
    // Assert we actually reached the template tier — otherwise this passes
    // vacuously on the hardcoded config, which is 'loyalty' by construction and
    // proves nothing about the filter.
    expect(cfg.source).toBe('template')
    expect(['newsletter', 'social']).not.toContain(cfg.appType)
  })

  it('falls back cleanly on junk input rather than throwing', () => {
    for (const input of [undefined, {}, { industry: 'nonsense' }, { prompt: null, industry: null }]) {
      const cfg = AppConfigFallback.build(input)
      expect(cfg).toBeTruthy()
      expect(cfg.tiers).toHaveLength(4)
      expect(cfg.rewards.length).toBeGreaterThanOrEqual(3)
      expect(contrastVsWhite(cfg.primaryColor)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('maps an unknown industry onto "other" rather than crashing', () => {
    expect(AppConfigFallback._normalizeIndustry('quantum-basketry')).toBe('other')
    expect(AppConfigFallback._normalizeIndustry('FOOD')).toBe('food')
    expect(AppConfigFallback._normalizeIndustry(undefined)).toBe('other')
  })
})

// 2026-11-22: with the AI step down, "a small coffee shop… called Bean There"
// rendered as "small coffee Rewards" with "1 pts per visit · 1 welcome points ·
// 1 rewards ready" and a 50-point reward (50 visits on the punch-card template).
describe('AppConfigFallback.guessName', () => {
  it.each([
    ['I run a small coffee shop in Austin called Bean There, about 200 regulars', 'Bean There'],
    ['A small coffee shop… called Bean There', 'Bean There'],
    ['Bean There is a coffee shop in Austin', 'Bean There'],
    ['Fade Factory is my barbershop', 'Fade Factory'],
    ['my barbershop is called Fade Factory.', 'Fade Factory'],
    ['We own The Daily Grind, a cafe downtown', 'The Daily Grind'],
    ['i run Cuts by Maria in Miami', 'Cuts by Maria'],
  ])('%s -> %s', (prompt, name) => {
    expect(AppConfigFallback.guessName(prompt)).toBe(name)
  })

  it.each([
    'I run a small coffee shop in Austin',
    'I own a nail salon with 3 chairs',
    'We are a family restaurant',
    'My shop is a bakery',
    '',
  ])('returns no name rather than a wrong one: %s', (prompt) => {
    expect(AppConfigFallback.guessName(prompt)).toBe('')
  })
})

describe('AppConfigFallback niches (AI analysis unavailable)', () => {
  const CASES = [
    ['a small coffee shop in Austin', 'coffee', 'food'],
    ['neighborhood bakery and cupcakes', 'bakery', 'food'],
    ['a barbershop in Queens', 'barber', 'service'],
    ['hair salon with 4 stylists', 'salon', 'service'],
    ['a nail salon', 'nails', 'service'],
    ['yoga and pilates studio', 'yoga', 'health'],
    ['a crossfit gym', 'gym', 'health'],
    ['self-serve car wash', 'carwash', 'service'],
    ['family pizza restaurant', 'restaurant', 'food'],
  ]

  it.each(CASES)('%s is read as %s', (prompt, key, industry) => {
    const niche = AppConfigFallback.detectNiche(prompt)
    expect(niche && niche.key).toBe(key)
    expect(niche.industry).toBe(industry)
  })

  it.each(CASES)('%s gets a coherent app with no industry from the AI', (prompt, key, industry) => {
    const cfg = AppConfigFallback.build({ prompt, industry: '', businessName: '' })
    expect(cfg.primaryColor).toBe(AppConfigFallback._INDUSTRY_PALETTE[industry].primary)
    expect(cfg.appName).not.toMatch(/^Loyalty Rewards$/)
    expect(cfg.rewards.length).toBeGreaterThanOrEqual(3)

    // Economy in VISITS, whatever the template's points per visit.
    const visits = cfg.rewards.map(r => r.pointsCost / cfg.pointsPerScan)
    expect(Math.min(...visits), 'first reward should take a few visits').toBeGreaterThanOrEqual(3)
    expect(Math.min(...visits), 'first reward should not take months').toBeLessThanOrEqual(15)
    const cheapest = Math.min(...cfg.rewards.map(r => r.pointsCost))
    expect(cheapest).toBeLessThanOrEqual(cfg.tiers[1].points)
    // Signup alone never unlocks a reward: at least two visits are needed.
    expect(cfg.welcomePoints + 2 * cfg.pointsPerScan).toBeLessThanOrEqual(cheapest)
  })

  it('the punch-card coffee app is internally consistent', () => {
    const cfg = AppConfigFallback.build({ prompt: 'a small coffee shop in Austin', industry: '', businessName: 'Bean There' })
    expect(cfg.appName).toBe('Bean There Rewards')
    expect(cfg.templateId).toBe('cafe-rewards')
    expect(cfg.pointsPerScan).toBe(1)
    expect(cfg.rewards.map(r => r.name)).toContain('Free House Coffee')
    expect(cfg.rewards.find(r => r.name === 'Free House Coffee').pointsCost).toBe(10)
  })

  it('a niche the AI disagrees with does not override the AI industry', () => {
    // The analysis says retail; the word "coffee" alone must not turn it into a cafe.
    const cfg = AppConfigFallback.build({ prompt: 'we sell coffee machines', industry: 'retail', businessName: 'Brew Supply' })
    expect(cfg.primaryColor).toBe(AppConfigFallback._INDUSTRY_PALETTE.retail.primary)
    expect(cfg.rewards.map(r => r.name)).not.toContain('Free House Coffee')
  })
})
