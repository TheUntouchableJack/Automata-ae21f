/**
 * Generate Stripe branding PNGs from SVG source files.
 * Uses Playwright (already installed) for accurate rendering.
 *
 * Usage: node scripts/generate-stripe-assets.js
 * Output: stripe/icon.png, stripe/logo.png
 */

import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function svgToHtml(svgContent, width, height) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: transparent; }
  img { display: block; width: ${width}px; height: ${height}px; }
</style>
</head>
<body>
  <img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}" width="${width}" height="${height}"/>
</body>
</html>`
}

async function generate() {
  mkdirSync(resolve(root, 'stripe'), { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage()

  // --- Icon: 512×512 ---
  console.log('Generating stripe/icon.png...')
  const iconSvg = readFileSync(resolve(root, 'stripe/icon.svg'), 'utf-8')
  await page.setViewportSize({ width: 512, height: 512 })
  await page.setContent(svgToHtml(iconSvg, 512, 512))
  await page.waitForTimeout(200)
  await page.screenshot({
    path: resolve(root, 'stripe/icon.png'),
    clip: { x: 0, y: 0, width: 512, height: 512 },
    omitBackground: false,
  })
  console.log('  ✓ stripe/icon.png (512×512)')

  // --- Logo: 800×200 ---
  console.log('Generating stripe/logo.png...')
  const logoSvg = readFileSync(resolve(root, 'stripe/logo.svg'), 'utf-8')
  await page.setViewportSize({ width: 800, height: 200 })
  await page.setContent(svgToHtml(logoSvg, 800, 200))
  await page.waitForTimeout(200)
  await page.screenshot({
    path: resolve(root, 'stripe/logo.png'),
    clip: { x: 0, y: 0, width: 800, height: 200 },
    omitBackground: false,
  })
  console.log('  ✓ stripe/logo.png (800×200)')

  await browser.close()
  console.log('\nDone! Upload to Stripe:')
  console.log('  Icon  → stripe/icon.png')
  console.log('  Logo  → stripe/logo.png')
}

generate().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
