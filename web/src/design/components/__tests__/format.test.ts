import { describe, it, expect } from 'vitest'
import { formatCurrency, formatPercent, formatNumber, formatSigned, formatPeriod, formatByUnit, formatDiffByUnit } from '../format'

describe('format', () => {
  it('currency', () => {
    expect(formatCurrency(1234567.891)).toBe('$1,234,567.89')
    expect(formatCurrency(1234567.891, { decimals: 0 })).toBe('$1,234,568')
    expect(formatCurrency(1234567.891, { compact: true })).toBe('$1.23M')
    expect(formatCurrency(-5, { symbol: false })).toBe('-5.00')
    expect(formatCurrency(null)).toBe('—')
    expect(formatCurrency(NaN)).toBe('—')
  })
  it('percent from ratio or points', () => {
    expect(formatPercent(0.0412)).toBe('4.12%')
    expect(formatPercent(4.12, { points: true })).toBe('4.12%')
    expect(formatPercent(0.5, { decimals: 0 })).toBe('50%')
  })
  it('number and signed', () => {
    expect(formatNumber(1234)).toBe('1,234')
    expect(formatSigned(12.5)).toBe('+12.50')
    expect(formatSigned(-3)).toBe('−3.00')
    expect(formatSigned(0)).toBe('0.00')
    expect(formatSigned(-0.001)).toBe('0.00')
  })
  it('period', () => {
    expect(formatPeriod('2026-08')).toBe('Aug 2026')
    expect(formatPeriod('2026-07')).toBe('Jul 2026')
    expect(formatPeriod('2026-13')).toBe('2026-13')
    expect(formatPeriod(undefined)).toBe('—')
  })
  it('by finding unit', () => {
    expect(formatByUnit(1000.5, 'currency')).toBe('$1,000.50')
    expect(formatByUnit(4.1, 'percent_points')).toBe('4.10%')
    expect(formatByUnit(3, 'count')).toBe('3')
    expect(formatByUnit(12, 'months')).toBe('12 mo')
    expect(formatByUnit(true, 'text')).toBe('Yes')
    expect(formatByUnit('2026-08', 'text')).toBe('2026-08')
    expect(formatByUnit(null, 'currency')).toBe('—')
    expect(formatDiffByUnit(-12, 'currency')).toBe('−$12.00')
    expect(formatDiffByUnit(12, 'currency')).toBe('+$12.00')
    expect(formatDiffByUnit(0, 'currency')).toBe('$0.00')
    expect(formatDiffByUnit(0.25, 'percent_points')).toBe('+0.25 pp')
  })
})
