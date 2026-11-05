import { describe, it, expect } from 'vitest'
import { appliedEdits, editsByPointer, numericCandidates, parseValue, reviewEdits, rulesReading, searchCandidates, valueKind } from '../lib/edits'
import type { Extraction, Finding, ValueEdit } from '../lib/types'
import extractionFx from './fixtures/extraction-moneda.json'
import findingsFx from './fixtures/findings-moneda.json'

const ex = extractionFx as unknown as Extraction
const e = (over: Partial<ValueEdit>): ValueEdit => ({ id: 'x', upload_id: 'u', pointer: '/tranche_balance/closing', old_value: 15019971.52, new_value: 15020071.52,
  reason: 'Page 2 prints it differently.', actor_role: 'tao_admin', at: '2026-11-05T15:41:00+00:00', ...over })

describe('value edit helpers', () => {
  it('parses typed values in the deal object scale', () => {
    expect(parseValue('15,020,071.52', 'money')).toBe(15020071.52)
    expect(parseValue('$ 6,755,210', 'money')).toBe(6755210)
    expect(parseValue('(12,828.68)', 'money')).toBe(-12828.68)
    expect(parseValue('1.79%', 'pct')).toBe(0.0179)
    expect(parseValue('1.79', 'pct')).toBe(0.0179)
    expect(parseValue('7.75×', 'ratio')).toBe(7.75)
    expect(parseValue('7.75 : 1', 'ratio')).toBe(7.75)
    expect(parseValue('12.5', 'count')).toBeNull()
    expect(parseValue('abc', 'money')).toBeNull()
    expect(parseValue('', 'money')).toBeNull()
  })

  it('names the kind of a value from its place in the deal', () => {
    expect(valueKind(ex.deal, '/tranche_balance/closing')).toBe('money')
    expect(valueKind(ex.deal, '/tranche_balance/change_pct')).toBe('pct')
    expect(valueKind(ex.deal, '/contracts/closing')).toBe('count')
    expect(valueKind(ex.deal, '/period_history/0/closing_contracts')).toBe('count')
    expect(valueKind(ex.deal, '/ratio_history/0/debt_equity_ratio')).toBe('ratio')
    expect(valueKind(ex.deal, '/financial_ratios/0/value')).toBe('pct')
  })

  it('lays edits over the extraction: newest in force wins, reverted and unpublished correction edits do not apply', () => {
    const edits = [
      e({ id: 'a', at: '2026-11-05T10:00:00Z' }),
      e({ id: 'b', at: '2026-11-05T11:00:00Z', old_value: 15020071.52, new_value: 15020000 }),
      e({ id: 'c', pointer: '/tranche_amount/closing', reverted_at: '2026-11-05T12:00:00Z' }),
      e({ id: 'd', pointer: '/program/program_amount', correction_id: 'k1' }),
    ]
    const m = editsByPointer(ex, edits, [{ id: 'k1', status: 'needs_review' } as never])
    expect([...m.keys()]).toEqual(['/tranche_balance/closing'])
    const s = m.get('/tranche_balance/closing')!
    expect(s.current.id).toBe('b')
    expect(s.original).toBe(15019971.52)
    expect(s.chain).toHaveLength(2)
    expect(appliedEdits(edits, [{ id: 'k1', status: 'published' } as never]).map(x => x.id)).toEqual(['a', 'b', 'd'])
    expect(reviewEdits(edits).map(x => x.id)).toEqual(['a', 'b'])
  })

  it('finds the rules whose findings read a value, and searches the picker', () => {
    expect(rulesReading(findingsFx as unknown as Finding[], '/tranche_balance/closing')).toEqual(['R05'])
    expect(rulesReading(findingsFx as unknown as Finding[], '/period_history/3/closing_balance')).toEqual(['R05'])
    expect(rulesReading(findingsFx as unknown as Finding[], '/contracts/closing')).toEqual([])
    const all = numericCandidates(ex)
    expect(all.length).toBeGreaterThan(50)
    expect(searchCandidates(all, 'tranche balance · closing').map(c => c.pointer)).toEqual(['/tranche_balance/closing'])
    expect(searchCandidates(all, 'p. 2', 100).every(c => c.page === 2)).toBe(true)
  })
})
