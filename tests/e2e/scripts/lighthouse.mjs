// Lighthouse accessibility on the four main pages (build plan acceptance: 90 or higher). Run after the demo
// (npm run test:e2e) so the pages have data:  npm run lighthouse
// Uses Playwright's Chromium with a persistent profile so the POC role (localStorage) carries into Lighthouse's tab.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'
import lighthouse from 'lighthouse'

const WEB = (process.env.E2E_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const API = (process.env.E2E_API_URL ?? 'http://localhost:8000').replace(/\/$/, '') + '/api/v1'
const PORT = Number(process.env.E2E_LH_PORT ?? 9333)
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '.cache', 'lighthouse')

const uploads = await (await fetch(`${API}/uploads?deal_slug=f-pil-2-0-moneda-capital-corp`, { headers: { 'X-Role': 'tao_admin' } })).json()
const review = uploads.find(u => u.collection_period === '2026-08') ?? uploads[0]
if (!review) throw new Error('no Moneda upload: run npm run test:e2e first')
const PAGES = [
  { name: 'TAO Admin dashboard', role: 'tao_admin', url: '/admin' },
  { name: 'Review report', role: 'tao_admin', url: `/admin/uploads/queue/${review.id}` },
  { name: 'Portfolio executive summary', role: 'investor_viewer', url: '/investor/portfolio' },
  { name: 'Deal page', role: 'investor_viewer', url: '/investor/portfolio/f-pil-2-0/deals/f-pil-2-0-xpedite-leasing' },
]

fs.mkdirSync(OUT, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tao-lh-'))
const ctx = await chromium.launchPersistentContext(profile, { headless: true, args: [`--remote-debugging-port=${PORT}`] })
const results = []
try {
  const page = ctx.pages()[0] ?? await ctx.newPage()
  for (const p of PAGES) {
    await page.goto(WEB + '/')
    await page.evaluate(r => localStorage.setItem('tao-admin-poc.role', r), p.role)
    const run = await lighthouse(WEB + p.url, { port: PORT, output: 'html', onlyCategories: ['accessibility'], disableStorageReset: true, formFactor: 'desktop',
      screenEmulation: { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false }, logLevel: 'error' })
    const score = Math.round(run.lhr.categories.accessibility.score * 100)
    const failedAudits = Object.values(run.lhr.audits).filter(a => a.score === 0 && a.scoreDisplayMode === 'binary')
    const failed = failedAudits.map(a => a.id)
    const offenders = Object.fromEntries(failedAudits.map(a => [a.id, (a.details?.items ?? []).slice(0, 6).map(i =>
      (i.node?.snippet ?? '').slice(0, 140) + (i.node?.explanation ? ' :: ' + i.node.explanation.split('\n').slice(-1)[0].slice(0, 120) : ''))]))
    fs.writeFileSync(path.join(OUT, `${p.name.replace(/\W+/g, '-').toLowerCase()}.html`), run.report)
    const landed = new URL(run.lhr.finalDisplayedUrl).pathname
    if (landed !== p.url) throw new Error(`${p.name}: landed on ${landed}, expected ${p.url} (role not applied?)`)
    results.push({ page: p.name, url: p.url, role: p.role, accessibility: score, failed_audits: failed, offenders })
    console.log(`${String(score).padStart(3)}  ${p.name}  ${p.url}${failed.length ? '  failed: ' + failed.join(', ') : ''}`)
  }
} finally {
  await ctx.close()
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 2))
const low = results.filter(r => r.accessibility < 90)
if (low.length) { console.error(`below 90: ${low.map(r => r.page).join(', ')}`); process.exitCode = 1 }
