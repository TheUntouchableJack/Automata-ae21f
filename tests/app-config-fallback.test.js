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
