/**
 * Item 8 (plan cool-anything-here-wiggly-valiant, 2026-11-22): Settings → Upgrade sold the retired
 * $299/$749 Pro/Max plans and its checkout failed with "Invalid price key". It is now one card that
 * links to /app/upgrade.html (current plans, working checkout, Royalty Pro for AppSumo).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const HTML = read('app/settings.html')
const JS = read('app/settings.js')

describe('Settings upgrade card', () => {
  const card = HTML.match(/<div class="settings-card" id="upgrade-section">[\s\S]*?\n {32}<\/div>\n/)[0]

  it('links to /app/upgrade.html and sells nothing itself', () => {
    expect(card).toContain('<a href="/app/upgrade.html" class="btn btn-primary" id="upgrade-see-plans-btn"')
    expect(card).not.toMatch(/checkout-btn|data-plan=|\$299|\$749|billing-toggle/)
  })

  it('no retired plan card is left anywhere on the page', () => {
    expect(HTML).not.toMatch(/data-monthly="299"|data-monthly="749"|class="upgrade-plan-card/)
    expect(HTML).not.toMatch(/class="[^"]*checkout-btn/)
  })

  it('its words are translated', () => {
    for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar']) {
      const plan = JSON.parse(read(`i18n/${lang}.json`)).settings.plan
      for (const k of ['upgrade', 'upgradeSubtitle', 'seePlans']) expect(typeof plan[k]).toBe('string')
    }
  })
})

describe('updateUpgradePlansVisibility', () => {
  const src = JS.match(/function updateUpgradePlansVisibility\(\) \{[\s\S]*?\n}\n/)[0]
  const run = (org) => {
    document.body.innerHTML = '<div id="upgrade-section" style="display:block"></div>'
    // eslint-disable-next-line no-new-func
    new Function('currentOrganization', `${src}; updateUpgradePlansVisibility();`)(org)
    return document.getElementById('upgrade-section').style.display
  }

  beforeEach(() => { document.body.innerHTML = '' })

  it('hidden only when there is nothing left to buy', () => {
    expect(run({ plan_type: 'subscription', subscription_tier: 'scale' })).toBe('none')
    expect(run({ plan_type: 'subscription', subscription_tier: 'max' })).toBe('none')
    expect(run({ plan_type: 'appsumo_lifetime', appsumo_tier: 3, has_royalty_pro: true })).toBe('none')
  })

  it('shown to everyone else', () => {
    expect(run({ plan_type: 'subscription', subscription_tier: 'starter' })).toBe('block')
    expect(run({ plan_type: 'subscription', subscription_tier: 'growth' })).toBe('block')
    expect(run({ plan_type: 'subscription', subscription_tier: 'pro' })).toBe('block')
    expect(run({ plan_type: 'appsumo_lifetime', appsumo_tier: 1, has_royalty_pro: false })).toBe('block')
    expect(run({ plan_type: 'free' })).toBe('block')
    expect(run(null)).toBe('block')
  })

  it('upgrade.html is the page that works: it builds current price keys', () => {
    const up = read('app/upgrade.js')
    expect(up).toMatch(/plan === 'royalty_pro'\s*\?\s*'royalty_pro_monthly'/)
    expect(up).not.toMatch(/['"]pro_monthly['"]|['"]max_monthly['"]/)
  })
})
