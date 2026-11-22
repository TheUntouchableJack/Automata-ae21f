import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

// 2026-11-22: "Claim My App — Free" led to a generic four-card "Your Royalty
// Platform" report with no form, white-on-white text and a "Step 3 of 3" label
// after the homepage's "Step 1 of 2". The signup step now shows the visitor's
// own app next to the form.

const root = path.resolve(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

let SignupPreview
let BusinessAnalysis

beforeAll(() => {
  const ctx = { window: {}, console, module: undefined, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }
  vm.createContext(ctx)
  for (const f of ['app/app-templates-library.js', 'app/app-config-fallback.js', 'app/signup-preview.js', 'app/business-analysis.js']) {
    vm.runInContext(read(f), ctx, { filename: f })
  }
  SignupPreview = ctx.window.SignupPreview
  BusinessAnalysis = ctx.window.BusinessAnalysis
  expect(SignupPreview, 'SignupPreview failed to load').toBeTruthy()
  expect(ctx.window.AppConfigFallback, 'AppConfigFallback must be visible to SignupPreview').toBeTruthy()
})

const storedConfig = () => ({
  source: 'template',
  appName: 'Bean There Rewards',
  primaryColor: '#B3261E',
  pointsPerScan: 1,
  welcomePoints: 1,
  tiers: [{ key: 'bronze', name: 'Regular', points: 0 }, { key: 'silver', name: 'Local', points: 50 }],
  rewards: [
    { name: 'Free House Coffee', pointsCost: 10 },
    { name: 'Free Pastry', pointsCost: 5 },
    { name: 'Bag of House Beans', pointsCost: 30 },
  ],
})

describe('SignupPreview.resolveConfig', () => {
  it('uses the config the visitor was shown on the homepage', () => {
    const { config, changed } = SignupPreview.resolveConfig({
      businessPrompt: 'a small coffee shop called Bean There',
      businessDetails: { businessName: 'Bean There' },
      appConfig: storedConfig(),
    })
    expect(config.appName).toBe('Bean There Rewards')
    expect(config.primaryColor).toBe('#B3261E')
    expect(changed).toBe(false)
  })

  it('renames a stale app when the visitor corrected the business name', () => {
    const { config, changed } = SignupPreview.resolveConfig({
      businessPrompt: 'a small coffee shop',
      businessDetails: { businessName: 'Bean Here' },
      appConfig: storedConfig(),
    })
    expect(config.appName).toBe('Bean Here Rewards')
    expect(changed).toBe(true)
  })

  it('rebuilds from the description when nothing was stored', () => {
    const { config, changed } = SignupPreview.resolveConfig({
      businessPrompt: 'a small coffee shop in Austin called Bean There',
      businessContext: { industry: '' },
      businessDetails: { businessName: 'Bean There' },
      appConfig: null,
    })
    expect(changed).toBe(true)
    expect(config.appName).toBe('Bean There Rewards')
    expect(config.rewards.map(r => r.name)).toContain('Free House Coffee')
  })

  it('ignores a malformed stored config', () => {
    const { config } = SignupPreview.resolveConfig({
      businessPrompt: 'a barbershop in Queens',
      businessDetails: { businessName: '' },
      appConfig: { appName: '', tiers: 'nope' },
    })
    expect(config.appName).toBe('Barber Rewards')
  })

  it('returns nothing to show without data', () => {
    expect(SignupPreview.resolveConfig(null).config).toBeNull()
    expect(SignupPreview.resolveConfig({ businessPrompt: '', businessDetails: {} }).config).toBeNull()
  })

  it('firstReward is the cheapest reward, not the first listed', () => {
    expect(SignupPreview.firstReward(storedConfig()).name).toBe('Free Pastry')
    expect(SignupPreview.firstReward({ rewards: [] })).toBeNull()
  })
})

describe('BusinessAnalysis contract', () => {
  it('still exposes what OnboardingSave reads, plus the silent prefetch', () => {
    expect(typeof BusinessAnalysis.getCached).toBe('function')
    expect(typeof BusinessAnalysis.clearCache).toBe('function')
    expect(typeof BusinessAnalysis.prefetch).toBe('function')
  })
})

describe('app/signup.html', () => {
  const html = read('app/signup.html')

  it('labels the step 2 of 2, matching the homepage', () => {
    expect(html).not.toMatch(/Step 3 of 3/)
    expect(html).toMatch(/data-i18n="onboarding\.step2of2"/)
  })

  it('no longer carries the generic four-card report or white-on-white text', () => {
    expect(html).not.toMatch(/analysis-fallback/)
    expect(html).not.toMatch(/analysis\.fallbackTitle/)
    expect(html).not.toMatch(/color:\s*rgba\(255,\s*255,\s*255/)
  })

  it('loads the preview modules before the page script that uses them', () => {
    const order = ['app-config-fallback.js', 'app-preview-card.js', 'signup-preview.js', 'onboarding-save.js']
    const positions = order.map(f => html.indexOf(`src="${f}?v=`))
    positions.forEach((p, i) => expect(p, `${order[i]} not loaded`).toBeGreaterThan(-1))
    for (let i = 1; i < positions.length; i++) expect(positions[i]).toBeGreaterThan(positions[i - 1])
    expect(html.indexOf('SignupPreview.render(')).toBeGreaterThan(positions[2])
  })

  it('keeps firing signup_page_viewed', () => {
    expect(html).toMatch(/track\('signup_page_viewed'/)
  })
})
