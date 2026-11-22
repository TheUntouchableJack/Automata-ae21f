import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

// /loyalty-program/<industry> landing pages (2026-11-22 pilots). How to add one:
// docs/templates/loyalty-program-page.md. Add the slug here too.
const PAGES = [
  { slug: 'coffee-shop', niche: 'coffee' },
  { slug: 'barbershop', niche: 'barber' },
  { slug: 'nail-salon', niche: 'nails' },
]

const root = path.resolve(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

let AppConfigFallback
beforeAll(() => {
  const ctx = { window: {}, console }
  vm.createContext(ctx)
  for (const f of ['app/app-templates-library.js', 'app/app-config-fallback.js']) {
    vm.runInContext(read(f), ctx, { filename: f })
  }
  AppConfigFallback = ctx.window.AppConfigFallback
})

function parse(slug) {
  const doc = new DOMParser().parseFromString(read(`loyalty-program/${slug}.html`), 'text/html')
  return doc
}

describe.each(PAGES)('/loyalty-program/$slug', ({ slug, niche }) => {
  const url = `https://royaltyapp.ai/loyalty-program/${slug}`

  it('has one H1, a short title and description, and a clean canonical', () => {
    const doc = parse(slug)
    expect(doc.querySelectorAll('h1')).toHaveLength(1)
    const title = doc.querySelector('title').textContent
    expect(title.length, title).toBeLessThanOrEqual(60)
    const desc = doc.querySelector('meta[name="description"]').getAttribute('content')
    expect(desc.length, desc).toBeLessThanOrEqual(155)
    expect(desc.length).toBeGreaterThan(80)
    expect(doc.querySelector('link[rel="canonical"]').getAttribute('href')).toBe(url)
    expect(doc.querySelector('meta[property="og:url"]').getAttribute('content')).toBe(url)
  })

  it('headings never skip a level', () => {
    const levels = [...parse(slug).querySelectorAll('main h1, main h2, main h3, main h4')].map(h => Number(h.tagName[1]))
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1], `h${levels[i - 1]} -> h${levels[i]}`).toBeLessThanOrEqual(1)
    }
  })

  it('FAQPage JSON-LD parses and matches the visible FAQ word for word', () => {
    const doc = parse(slug)
    const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent))
    const faq = blocks.find(b => b['@type'] === 'FAQPage')
    expect(faq, 'no FAQPage block').toBeTruthy()
    expect(faq.url).toBe(url)
    const visible = [...doc.querySelectorAll('.industry-faq h3')].map(h => h.textContent.trim())
    expect(faq.mainEntity.map(q => q.name)).toEqual(visible)
    expect(visible.length).toBeGreaterThanOrEqual(3)
    for (const q of faq.mainEntity) expect(q.acceptedAnswer.text.length).toBeGreaterThan(60)
  })

  it('the generator form sends a capped, attributed prompt to the homepage hero', () => {
    const form = parse(slug).querySelector('form.industry-generator')
    expect(form.getAttribute('action')).toBe('/')
    expect(form.getAttribute('method')).toBe('get')
    expect(form.dataset.industry).toBe(slug)
    const ta = form.querySelector('textarea[name="prompt"]')
    expect(ta.getAttribute('maxlength')).toBe('500')
    expect(ta.textContent.length).toBeLessThanOrEqual(500)
    expect(form.querySelector('input[type="hidden"][name="from"]').value).toBe(`industry-${slug}`)
    // The sample must survive the generator's own reading of it.
    expect(AppConfigFallback.guessName(ta.textContent)).not.toBe('')
    expect(AppConfigFallback.detectNiche(ta.textContent).key).toBe(niche)
  })

  it('quotes the same rewards the generator builds from its sample', () => {
    const doc = parse(slug)
    const sample = doc.querySelector('textarea[name="prompt"]').textContent
    const cfg = AppConfigFallback.build({ prompt: sample, industry: '', businessName: AppConfigFallback.guessName(sample) })
    const onPage = [...doc.querySelectorAll('.reward-ladder .reward-name')].map(n => n.textContent.trim())
    const cost = [...doc.querySelectorAll('.reward-ladder .reward-cost')].map(n => n.textContent)
    expect(onPage.length).toBeGreaterThanOrEqual(4)
    for (const r of cfg.rewards) {
      const i = onPage.indexOf(r.name)
      expect(i, `${r.name} is in the app but not on the page`).toBeGreaterThanOrEqual(0)
      const visits = r.pointsCost / cfg.pointsPerScan
      expect(cost[i], `${r.name}`).toContain(`${visits} visits`)
    }
    const tierNames = [...doc.querySelectorAll('.tier-card h3')].map(h => h.textContent.trim())
    expect(tierNames).toEqual(cfg.tiers.map(t => t.name))
  })

  it('is routed, listed in the sitemap, and linked from the other pilots', () => {
    const toml = read('netlify.toml')
    const rule = toml.indexOf(`from = "/loyalty-program/${slug}"`)
    expect(rule).toBeGreaterThan(-1)
    expect(toml.slice(rule, rule + 120)).toContain(`to = "/loyalty-program/${slug}.html"`)
    expect(rule).toBeLessThan(toml.indexOf('from = "/*"\n  to = "/404.html"'))
    expect(read('sitemap.xml')).toContain(`<loc>${url}</loc>`)
    for (const other of PAGES.filter(p => p.slug !== slug)) {
      expect(parse(other.slug).querySelector(`.industry-more a[href="/loyalty-program/${slug}"]`), other.slug).toBeTruthy()
    }
  })

  it('loads only same-origin scripts (CSP) and no gradients', () => {
    const html = read(`loyalty-program/${slug}.html`)
    for (const s of parse(slug).querySelectorAll('script[src]')) {
      expect(s.getAttribute('src').startsWith('/'), s.getAttribute('src')).toBe(true)
    }
    expect(html).not.toMatch(/gradient\(/)
    expect(read('loyalty-program/industry.css')).not.toMatch(/gradient\(/)
  })
})

// The homepage half of the hand-off: script.js reads ?prompt= into the hero.
describe('script.js HERO_URL_PROMPT', () => {
  const src = read('script.js')
  const start = src.indexOf('const HERO_URL_PROMPT = (function () {')
  const end = src.indexOf('})();', start) + '})();'.length
  const block = src.slice(start, end)

  function run(search) {
    const calls = []
    const ctx = {
      URLSearchParams,
      window: { location: { search, pathname: '/', hash: '' } },
      history: { state: null, replaceState: (_s, _t, u) => calls.push(u) },
    }
    vm.createContext(ctx)
    vm.runInContext(block + '\nthis.__out = HERO_URL_PROMPT;', ctx)
    return { out: ctx.__out, calls }
  }

  it('was found in script.js', () => {
    expect(start).toBeGreaterThan(-1)
    expect(block).toContain('slice(0, 500)')
  })

  it('reads the prompt, strips it from the URL and keeps a sanitised from', () => {
    const { out, calls } = run('?prompt=' + encodeURIComponent('I run a barbershop called Fade Factory.') + '&from=industry-barbershop')
    expect(out).toEqual({ value: 'I run a barbershop called Fade Factory.', from: 'industry-barbershop' })
    expect(calls).toEqual(['/?from=industry-barbershop'])
  })

  it('caps the prompt at 500 characters and drops junk in from', () => {
    const { out } = run('?prompt=' + 'a'.repeat(900) + '&from=' + encodeURIComponent('<img src=x>'))
    expect(out.value).toHaveLength(500)
    expect(out.from).toBe('imgsrcx')
  })

  it('does nothing without a prompt', () => {
    const { out, calls } = run('?from=industry-barbershop')
    expect(out).toBeNull()
    expect(calls).toEqual([])
  })
})
