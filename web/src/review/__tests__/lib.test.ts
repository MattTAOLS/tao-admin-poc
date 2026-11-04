/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { RULE_TITLES, parseRuleTitles } from '../lib/rules'
import { provenance, findingBoxes, focusBox, carriedLabel } from '../lib/provenance'
import { covenantValue, byFormat } from '../lib/format'
import type { Extraction } from '../lib/types'
import extractionFx from './fixtures/extraction-moneda.json'
import findingsFx from './fixtures/findings-moneda.json'

const ex = extractionFx as unknown as Extraction

describe('rule titles from contracts/rules.yaml', () => {
  it('reads every rule id with its title', () => {
    expect(Object.keys(RULE_TITLES)).toHaveLength(22)
    expect(RULE_TITLES.R05).toBe('Tranche balance roll-forward')
    expect(RULE_TITLES.R14).toBe('Covenant thresholds equal the master record')
  })
  it('takes the rule title, not a nested one', () => {
    expect(parseRuleTitles('rules:\n  - id: R01\n    title: "A"\n    x:\n      title: B\n')).toEqual({ R01: 'A' })
  })
})

describe('provenance', () => {
  it('finds the page of a leaf', () => {
    const p = provenance(ex, '/tranche_balance/closing')
    expect(p.kind === 'pages' && p.pages.map(x => x.page)).toEqual([2])
  })
  it('collects the pages under a row', () => {
    // The August roll-forward row reads page 2, its period label page 1 and its amounts page 4.
    const p = provenance(ex, '/period_history/3')
    expect(p.kind === 'pages' && p.pages.map(x => x.page)).toEqual([1, 2, 4])
  })
  it('labels months carried from the last publication', () => {
    expect(provenance(ex, '/period_history/0')).toEqual({ kind: 'carried', label: 'from published Jul 2026' })
    expect(provenance(ex, '/prior_closing_contracts')).toEqual({ kind: 'carried', label: 'from published Jul 2026' })
    expect(carriedLabel({ ...ex, meta: { ...ex.meta, history: undefined } })).toBe('from an earlier publication')
  })
  it('returns the bboxes on the finding page for the R05 fields', () => {
    const f = findingsFx[0]
    expect(findingBoxes(ex, f.fields, f.source_page)).toEqual([[427.41, 582.84, 485.7, 592.84], [1206.42, 582.84, 1264.71, 592.84]])
    expect(findingBoxes(ex, ['master:/covenant_definitions'], 14)).toEqual([])
    // The crop centres on the closing balance, the figure the report states
    expect(focusBox(ex, f.fields, f.source_page, f.report_value)).toEqual([1206.42, 582.84, 1264.71, 592.84])
  })
})

describe('display formats', () => {
  it('formats covenant values on the threshold scale', () => {
    expect(covenantValue(0.033, 0.035)).toBe('3.30%')
    expect(covenantValue(1.27, 1.1)).toBe('1.27')
    expect(covenantValue(6755120, 2500000)).toBe('$6,755,120')
    expect(byFormat(0.0179, 'pct')).toBe('1.79%')
  })
})

describe('tokens only in web/src/review', () => {
  const dir = resolve(__dirname, '..')
  const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? (n === '__tests__' ? [] : walk(p)) : /\.(css|tsx?)$/.test(n) ? [p] : []
  })
  const tokens = new Set([...readFileSync(resolve(dir, '../../../contracts/tokens.css'), 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]))
  for (const f of walk(dir)) {
    it(`${f.slice(dir.length + 1).replace(/\\/g, '/')} uses tokens, never raw colours`, () => {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(src.match(/#[0-9a-fA-F]{3,8}\b(?![\w-])|rgba?\(|hsla?\(/g) ?? []).toEqual([])
      for (const m of src.matchAll(/var\((--[a-z0-9-]+)/g)) expect(tokens.has(m[1]) || m[1].startsWith('--ds-'), m[1]).toBe(true)
    })
  }
})

describe('corrections preview', async () => {
  const { pointerLabel, writesFor, plannedCorrections } = await import('../lib/corrections')
  const r05 = findingsFx[0] as unknown as import('../lib/types').Finding
  it('labels pointers readably', () => {
    expect(pointerLabel(ex.deal, '/period_history/3/closing_balance')).toBe('Roll-forward Aug 2026 · closing balance')
    expect(pointerLabel(ex.deal, '/covenants/0/threshold')).toBe('Covenant SLFA 9.1 (c) · threshold')
    expect(pointerLabel(ex.deal, '/program/program_utilization_pct')).toBe('Facility · program utilization %')
  })
  it('previews the writes of use ours and use report', () => {
    expect(writesFor(ex, r05, 'use_ours').filter(w => w.changed)).toHaveLength(5)
    expect(writesFor(ex, r05, 'use_report').filter(w => w.changed)).toHaveLength(0)
    expect(writesFor(ex, { ...r05, targets: undefined }, 'use_ours')).toEqual([])
    expect(plannedCorrections(ex, [{ ...r05, status: 'acknowledge' as never }])).toEqual([])
  })
})
