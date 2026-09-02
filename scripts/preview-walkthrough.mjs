#!/usr/bin/env node
/**
 * Opens the REAL homepage in a real browser with analyze-business-signup stubbed,
 * so you can drive the actual hero flow by hand without touching anything remote.
 *
 * Nothing leaves your machine: no edge function call, so no rate_limits row and
 * no Haiku tokens. The browser stays open until you close it or press Ctrl-C.
 *
 *   npm run dev                                   # in another terminal
 *   node scripts/preview-walkthrough.mjs          # happy path
 *   node scripts/preview-walkthrough.mjs slow     # 12s response — watch the loader
 *   node scripts/preview-walkthrough.mjs fail     # network killed mid-request
 *   node scripts/preview-walkthrough.mjs timeout  # never responds — exercises the 25s abort
 *   node scripts/preview-walkthrough.mjs control  # ?preview=0, the old confirm state
 *
 *   node scripts/preview-walkthrough.mjs fail de  # any scenario + a language code
 */
import { chromium } from 'playwright'

const SCENARIO = (process.argv[2] || 'ok').toLowerCase()
const LANG = (process.argv[3] || 'en').toLowerCase()
const BASE = process.env.BASE_URL || 'http://localhost:5173'

const SCENARIOS = {
  ok:      'responds in ~1s with a Portland ramen shop',
  slow:    'responds after 12s — the loader has to carry the wait',
  fail:    'connection killed mid-request',
  timeout: 'never responds — the 25s client abort should fire',
  control: '?preview=0 — the old confirm state, for side-by-side comparison'
}
if (!SCENARIOS[SCENARIO]) {
  console.error(`Unknown scenario "${SCENARIO}". Options: ${Object.keys(SCENARIOS).join(', ')}`)
  process.exit(1)
}

// A plausible payload, shaped exactly like the real function's response.
const ANALYSIS = {
  success: true,
  analysis: {
    businessSummary: 'Nomu is a Portland ramen shop serving a weekday office crowd who mostly come on Fridays.',
    extractedDetails: {
      businessName: 'Nomu', industry: 'food', businessType: 'food',
      location: 'Portland', customerCount: '201-500', websiteUrl: ''
    },
    impactMetrics: [],
    opportunities: [
      { title: 'Your Branded Loyalty App', description: 'A branded app for Nomu.', impact: 'More midweek visits.',
        icon: 'loyalty', source: 'stub', actionSteps: ['Step one', 'Step two', 'Step three'] }
    ],
    platformHighlights: []
  }
}

// Only the headless shell is downloaded in this checkout, so the bundled
// browser cannot open a window. Fall back to the system Chrome, which avoids a
// ~150MB `npx playwright install chromium` just to look at a page.
async function launchHeaded() {
  try {
    return await chromium.launch({ headless: false, args: ['--window-size=1440,1000'] })
  } catch (bundledError) {
    try {
      console.log('  (bundled chromium not downloaded — using your system Google Chrome)')
      return await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,1000'] })
    } catch (chromeError) {
      console.error('\nCould not open a browser.')
      console.error('Bundled: ' + String(bundledError.message).split('\n')[0])
      console.error('Chrome : ' + String(chromeError.message).split('\n')[0])
      console.error('\nFix with:  npx playwright install chromium\n')
      process.exit(1)
    }
  }
}

const browser = await launchHeaded()
const context = await browser.newContext({ viewport: null })
const page = await context.newPage()

await page.addInitScript(l => { try { localStorage.setItem('royalty_language', l) } catch (e) {} }, LANG)

let stubHits = 0
await page.route('**/functions/v1/analyze-business-signup', async route => {
  stubHits++
  console.log(`  [stub] analyze-business-signup intercepted (#${stubHits}) — scenario "${SCENARIO}", nothing sent upstream`)
  if (SCENARIO === 'fail') return route.abort('failed')
  if (SCENARIO === 'timeout') return                       // never fulfil; the client should abort at 25s
  if (SCENARIO === 'slow') await new Promise(r => setTimeout(r, 12000))
  else await new Promise(r => setTimeout(r, 900))
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ANALYSIS) })
})

// Hard stop on anything that would reach a real backend. If this ever fires,
// the "no DB writes" claim is wrong and I want to know loudly.
await page.route('**://*.supabase.co/**', route => {
  console.log(`  [BLOCKED] outbound Supabase call: ${route.request().url()}`)
  route.abort('failed')
})

page.on('console', m => { if (m.type() === 'error') console.log('  [console error]', m.text()) })
page.on('pageerror', e => console.log('  [page error]', e.message))

const url = BASE + '/index.html' + (SCENARIO === 'control' ? '?preview=0' : '')
await page.goto(url, { waitUntil: 'domcontentloaded' })

// Pre-fill the description so you can go straight to clicking the button.
await page.fill('#hero-business-prompt',
  "We're a ramen shop in Portland called Nomu. Tonkotsu broth simmered 18 hours, gyoza, Japanese beer. About 200 regulars, mostly the lunch crowd from nearby offices. We want them coming back midweek, not just Fridays.")
await page.locator('#discovery-card').scrollIntoViewIfNeeded()

console.log(`
  scenario : ${SCENARIO} — ${SCENARIOS[SCENARIO]}
  language : ${LANG}
  url      : ${url}

  The description is already typed in. Click "Build My App" to watch it run.
  Every Supabase call is blocked at the browser, so nothing can be written.

  Close the window (or Ctrl-C) when you're done.
`)

await page.waitForEvent('close', { timeout: 0 }).catch(() => {})
await browser.close().catch(() => {})
