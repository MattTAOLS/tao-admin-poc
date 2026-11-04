import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test as setup } from '@playwright/test'
import { findings, findUpload, tao, waitSettled } from '../lib/api'
import { API_URL, PYTHON, REPO, SAMPLES, WEB_URL } from '../lib/env'
import { DEALS, HISTORY_MONTHS, SEEDED, STEP1, STEP4, STEP6, period, samplePath, type DealKey } from '../lib/facts'
import { record, resetMeasurements } from '../lib/measure'

/** Brings a freshly seeded stack (docker compose up + `python -m app.seed`) to the demo's starting point: May-Jul
 * published for the three F-PIL 2.0 deals through the HTTP API, as an earlier month-end would have left it. The
 * demo steps then upload Xpedite Aug (clean), the seeded Moneda Aug (one R05 block) and Stride Aug (the next month). */

setup('stack is up, seeded and fresh', async () => {
  resetMeasurements()
  const health = await fetch(API_URL + '/health').catch(e => { throw new Error(`API not reachable at ${API_URL}: ${e}`) })
  expect(health.status, `GET ${API_URL}/health`).toBe(200)
  const web = await fetch(WEB_URL).catch(e => { throw new Error(`web app not reachable at ${WEB_URL}: ${e}`) })
  expect(web.status, `GET ${WEB_URL}`).toBe(200)
  const deals = (await tao.get('/master/deals')).body as any[]
  expect(deals.map(d => d.slug), 'master data is seeded (docker compose exec api python -m app.seed)').toEqual(
    expect.arrayContaining(Object.values(DEALS).map(d => d.slug)))
  for (const s of [STEP1, STEP4, STEP6]) {
    const u = await findUpload(s.deal, s.period)
    expect(u, `${s.deal} ${s.period} already uploaded (${u?.status}): the demo needs a fresh stack; see docs/demo.md "Reset"`).toBeUndefined()
  }
  for (const d of Object.keys(DEALS) as DealKey[]) for (const m of [...HISTORY_MONTHS, '202608'])
    expect(fs.existsSync(samplePath(d, m)), `sample PDF ${samplePath(d, m)} (place the SetRep PDFs in ${SAMPLES})`).toBe(true)
})

setup('seeded-error PDF is built', async () => {
  // The seeding tool is the Lead's scripts/demo_data.py (seeded_moneda_aug): one digit on page 2, R05 off by -100.00.
  fs.mkdirSync(path.dirname(SEEDED.file), { recursive: true })
  const code = 'import sys; sys.path.insert(0, "scripts"); import demo_data; sys.stdout.buffer.write(demo_data.seeded_moneda_aug())'
  const pdf = execFileSync(PYTHON, ['-c', code], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 })
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  fs.writeFileSync(SEEDED.file, pdf)
})

setup('May-Jul published for Moneda, Xpedite and Stride', async () => {
  setup.setTimeout(20 * 60_000)
  for (const m of HISTORY_MONTHS) {
    for (const d of ['moneda', 'xpedite', 'stride'] as DealKey[]) {
      const per = period(m)
      const existing = await findUpload(d, per, 'published')
      if (existing) continue
      const r = await tao.upload(DEALS[d].slug, per, samplePath(d, m))
      expect(r.status, `upload ${d} ${per}: ${JSON.stringify(r.body)}`).toBe(201)
      const { upload, seconds } = await waitSettled(r.body.id)
      record('extraction', { deal: d, period: per, pages: upload.page_count, seconds, status: upload.status, finding_counts: upload.finding_counts, via: 'setup' })
      expect(upload.status, `${d} ${per}`).toBe('needs_review')
      // Xpedite revises earlier months (R11 restatement, as the reference object's `restatements` records): accept them.
      for (const f of await findings(upload.id)) {
        if (f.status === 'open' && f.context?.restatement) {
          const o = await tao.post(`/uploads/${upload.id}/findings/${f.id}/override`,
            { choice: 'restatement', reason: 'servicer revised an earlier month; matches the reference restatements' })
          expect(o.status, JSON.stringify(o.body)).toBe(200)
        }
      }
      const a = await tao.post(`/uploads/${upload.id}/approve`)
      expect(a.status, `approve ${d} ${per}: ${JSON.stringify(a.body)}`).toBe(200)
      expect(a.body.status).toBe('published')
    }
  }
})
