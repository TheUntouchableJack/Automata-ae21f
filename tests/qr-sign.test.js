/**
 * Item 7 (plan cool-anything-here-wiggly-valiant, 2026-11-22): a print-quality QR and a counter sign.
 *
 * Before: the dashboard and the builder loaded qrcode@1.5.3/build/qrcode.min.js, which 404s, so
 * they fell back to a 72/220 px image from api.qrserver.com, and "Download" saved that. The builder
 * printed from a popup before its QR image loaded (a blank sign).
 *
 * Now app/qr-sign.js (RoyaltyQR) draws the QR on a canvas with qrcode-generator@1.4.4, downloads it
 * at >= 1024 px, and prints a one-page counter sign from a print-only block of the same page, once
 * its images are ready.
 *
 * jsdom has no canvas and the CDN library is not installed, so both are stubbed here: these tests
 * cover sizing, the sign's DOM and safety, and the print sequencing. The real library is checked in
 * Chrome (the drawn QR decoded with jsQR) — see the round's bench README.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const SRC = read('app/qr-sign.js')

// A fake qrcode-generator: a 25-module symbol, dark where (row + col) % 3 === 0.
const MODULES = 25
function fakeQrcode(type, ecl) {
  fakeQrcode.calls.push({ type, ecl })
  let data = null
  return {
    addData: (d) => { data = d; fakeQrcode.data.push(d) },
    make: () => { if (data === null) throw new Error('no data') },
    getModuleCount: () => MODULES,
    isDark: (r, c) => (r + c) % 3 === 0,
  }
}

let rects
function installCanvasStub() {
  rects = []
  HTMLCanvasElement.prototype.getContext = function () {
    const ctx = { fillStyle: '', fillRect: (x, y, w, h) => rects.push({ x, y, w, h, fill: ctx.fillStyle }) }
    return ctx
  }
  HTMLCanvasElement.prototype.toDataURL = function () { return `data:image/png;base64,FAKE${this.width}` }
}

function load() {
  fakeQrcode.calls = []
  fakeQrcode.data = []
  window.qrcode = fakeQrcode
  delete window.RoyaltyQR
  // eslint-disable-next-line no-new-func
  new Function('window', SRC)(window)
  return window.RoyaltyQR
}

beforeEach(() => {
  installCanvasStub()
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="app-layout">dashboard</div>'
  delete window.I18n
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('RoyaltyQR.canvas', () => {
  it('encodes the text with error correction M, auto version', () => {
    const Q = load()
    Q.canvas('https://royaltyapp.ai/a/joes/checkin', 288)
    expect(fakeQrcode.calls).toEqual([{ type: 0, ecl: 'M' }])
    expect(fakeQrcode.data).toEqual(['https://royaltyapp.ai/a/joes/checkin'])
  })

  it('integer module size, a 4-module quiet zone, at least the asked size', () => {
    const Q = load()
    const c = Q.canvas('x', 288)
    const total = MODULES + 8
    const scale = Math.ceil(288 / total)
    expect(c.width).toBe(scale * total)
    expect(c.height).toBe(c.width)
    expect(c.width).toBeGreaterThanOrEqual(288)
    // First fill is the white background; the first dark module (0,0) sits inside the quiet zone.
    expect(rects[0]).toEqual({ x: 0, y: 0, w: c.width, h: c.width, fill: '#ffffff' })
    expect(rects[1]).toEqual({ x: 4 * scale, y: 4 * scale, w: scale, h: scale, fill: '#111827' })
    const dark = rects.slice(1)
    let expected = 0
    for (let r = 0; r < MODULES; r++) for (let col = 0; col < MODULES; col++) if ((r + col) % 3 === 0) expected++
    expect(dark).toHaveLength(expected)
  })

  it('is unavailable without the library', () => {
    load()
    delete window.qrcode
    expect(window.RoyaltyQR.available()).toBe(false)
  })
})

describe('RoyaltyQR.downloadPng', () => {
  it('saves a PNG of at least 1024 px under the given name', () => {
    const Q = load()
    const clicks = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicks.push({ download: this.download, href: this.href }) })
    const c = Q.downloadPng('https://royaltyapp.ai/a/joes/checkin', 'joes-qr-code.png')
    expect(c.width).toBeGreaterThanOrEqual(1024)
    expect(clicks).toEqual([{ download: 'joes-qr-code.png', href: `data:image/png;base64,FAKE${c.width}` }])
    expect(document.querySelector('a[download]')).toBeNull() // the link is cleaned up
  })
})

describe('the counter sign', () => {
  const base = { name: "Joe's Cafe", color: '#7c3aed', qrText: 'https://royaltyapp.ai/a/joes/checkin', displayUrl: 'royaltyapp.ai/a/joes' }

  it('shows the name, the call to action, the QR and the URL', () => {
    const Q = load()
    const sign = Q.buildSign({ ...base, ...Q.texts() })
    expect(sign.id).toBe('royalty-print-sign')
    expect(sign.querySelector('.rps-name').textContent).toBe("Joe's Cafe")
    expect(sign.querySelector('.rps-headline').textContent).toBe('Scan every visit to earn points')
    expect(sign.querySelector('.rps-qr').getAttribute('src')).toMatch(/^data:image\/png;base64,FAKE\d+$/)
    expect(Number(sign.querySelector('.rps-qr').getAttribute('src').replace(/\D/g, ''))).toBeGreaterThanOrEqual(1024)
    expect(sign.querySelector('.rps-url-text').textContent).toBe('royaltyapp.ai/a/joes')
    expect(sign.querySelector('.rps-logo').textContent).toBe('J') // no logo: the initial
  })

  it('owner data is text, never markup', () => {
    const Q = load()
    const sign = Q.buildSign({ ...base, name: '<img src=x onerror=alert(1)>', displayUrl: '<b>x</b>' })
    expect(sign.querySelector('.rps-name img')).toBeNull()
    expect(sign.querySelector('.rps-name').textContent).toBe('<img src=x onerror=alert(1)>')
    expect(sign.querySelector('.rps-url b')).toBeNull()
  })

  it('only a #hex colour reaches the style; text colour follows the band', () => {
    const Q = load()
    expect(Q.buildSign({ ...base, color: 'red;background:url(https://evil)' }).querySelector('.rps-band').style.background).toBe('rgb(124, 58, 237)')
    expect(Q.safeColor('#abc', '#000')).toBe('#abc')
    expect(Q.safeColor('url(x)', '#000')).toBe('#000')
    expect(Q.inkFor('#111827')).toBe('#ffffff')
    expect(Q.inkFor('#facc15')).toBe('#111827')
    expect(Q.buildSign({ ...base, color: '#facc15' }).querySelector('.rps-band').style.color).toBe('rgb(17, 24, 39)')
  })

  it('a logo must be https; anything else falls back to the initial', () => {
    const Q = load()
    expect(Q.buildSign({ ...base, logoUrl: 'https://cdn.example/logo.png' }).querySelector('.rps-logo img').getAttribute('src')).toBe('https://cdn.example/logo.png')
    for (const bad of ['javascript:alert(1)', 'http://plain.example/l.png', 'data:image/svg+xml,<svg onload=alert(1)>']) {
      const s = Q.buildSign({ ...base, logoUrl: bad })
      expect(s.querySelector('.rps-logo img')).toBeNull()
      expect(s.querySelector('.rps-logo').textContent).toBe('J')
    }
  })

  it("uses the owner's language when I18n has it, English otherwise", () => {
    const Q = load()
    window.I18n = { t: (k) => (k === 'qrSign.headline' ? 'Scannez à chaque visite' : k) }
    const t = Q.texts()
    expect(t.headline).toBe('Scannez à chaque visite')
    expect(t.powered).toBe('Powered by Royalty') // I18n returned the key: fallback
  })

  it('the qrSign strings exist in all 8 languages', () => {
    for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar']) {
      const j = JSON.parse(read(`i18n/${lang}.json`))
      for (const k of ['headline', 'sub', 'orVisit', 'powered']) expect(typeof j.qrSign?.[k]).toBe('string')
    }
  })
})

describe('printing the sign', () => {
  const opts = { name: 'Joe', color: '#7c3aed', qrText: 'https://royaltyapp.ai/a/joes/checkin', displayUrl: 'royaltyapp.ai/a/joes' }
  // jsdom never loads images: settle them by hand, as a browser would.
  const settle = (img, ok = true) => {
    if (ok) Object.defineProperty(img, 'naturalWidth', { value: 200, configurable: true })
    img.dispatchEvent(new Event(ok ? 'load' : 'error'))
  }
  const settleQr = () => settle(document.querySelector('#royalty-print-sign .rps-qr'))

  it('prints only after the logo has loaded, from this page, then cleans up', async () => {
    const Q = load()
    const print = vi.fn()
    window.print = print
    const p = Q.printSign({ ...opts, logoUrl: 'https://cdn.example/logo.png' })
    await Promise.resolve()
    expect(print).not.toHaveBeenCalled()
    settleQr()
    await Promise.resolve()
    expect(print).not.toHaveBeenCalled() // the QR alone is not enough: the logo is still loading
    settle(document.querySelector('#royalty-print-sign .rps-logo img'))
    await p
    expect(print).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('#royalty-print-sign')).toHaveLength(1)
    expect(document.getElementById('royalty-print-sign-style').textContent).toMatch(/@media print[\s\S]*body > \*:not\(#royalty-print-sign\)/)
    window.dispatchEvent(new Event('afterprint'))
    expect(document.getElementById('royalty-print-sign')).toBeNull()
    expect(document.getElementById('app-layout')).not.toBeNull()
  })

  it('a logo that fails becomes the initial, and the sign still prints', async () => {
    const Q = load()
    window.print = vi.fn()
    const p = Q.printSign({ ...opts, logoUrl: 'https://cdn.example/missing.png' })
    await Promise.resolve()
    settleQr()
    settle(document.querySelector('#royalty-print-sign .rps-logo img'), false)
    await p
    expect(window.print).toHaveBeenCalledTimes(1)
    expect(document.querySelector('#royalty-print-sign .rps-logo').textContent).toBe('J')
  })

  it('a logo that never answers does not hold the print forever (4 s cap)', async () => {
    vi.useFakeTimers()
    const Q = load()
    window.print = vi.fn()
    const p = Q.printSign({ ...opts, logoUrl: 'https://cdn.example/slow.png' })
    settleQr()
    await vi.advanceTimersByTimeAsync(3900)
    expect(window.print).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    await p
    expect(window.print).toHaveBeenCalledTimes(1)
  })

  it('printing twice leaves one sign', async () => {
    const Q = load()
    window.print = vi.fn()
    const p1 = Q.printSign(opts); settleQr(); await p1
    const p2 = Q.printSign(opts); settleQr(); await p2
    expect(window.print).toHaveBeenCalledTimes(2)
    expect(document.querySelectorAll('#royalty-print-sign')).toHaveLength(1)
    expect(document.querySelectorAll('#royalty-print-sign-style')).toHaveLength(1)
  })
})

describe('wiring: the dashboard and the builder use it, and nothing else', () => {
  const pages = { 'app/dashboard.html': 'dashboard.js', 'app/app-builder.html': 'app-builder.js' }
  for (const [page, script] of Object.entries(pages)) {
    it(`${page} loads qrcode-generator@1.4.4 and qr-sign.js before ${script}`, () => {
      const html = read(page)
      const lib = html.indexOf('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js')
      const sign = html.indexOf('src="qr-sign.js?v=')
      const own = html.indexOf(`src="${script}?v=`)
      expect(lib).toBeGreaterThan(-1)
      expect(sign).toBeGreaterThan(lib)
      expect(own).toBeGreaterThan(sign)
      expect(html).not.toContain('<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3')
    })
  }

  it('no third-party QR image and no QRCode.toCanvas left in either script', () => {
    for (const f of ['app/dashboard.js', 'app/app-builder.js']) {
      const js = read(f)
      expect(js).not.toContain('api.qrserver.com')
      expect(js).not.toContain('QRCode.toCanvas')
      expect(js).toContain('RoyaltyQR.')
    }
  })

  it('the dashboard downloads and prints only a published program', () => {
    const js = read('app/dashboard.js')
    for (const fn of ['downloadPreviewQR', 'printPreviewQR']) {
      const body = js.match(new RegExp(`function ${fn}\\(\\) \\{[\\s\\S]*?\\n}\\n`))[0]
      expect(body).toMatch(/if \(!currentApp\?\.is_published \|\|/)
    }
  })

  it('the builder says a draft QR works only once published', () => {
    expect(read('app/app-builder.html')).toMatch(/id="qr-draft-hint" hidden>This QR code starts working when you publish\./)
    expect(read('app/app-builder.js')).toContain("if (draftHint) draftHint.hidden = !!currentApp?.is_published;")
  })
})
