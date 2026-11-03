// @vitest-environment jsdom
import '../../test-utils'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FindingCard, Button, type FindingView } from '..'

// Shape of contracts/finding.schema.json. Values are illustrative card inputs, not deal data.
const base: FindingView = {
  id: '00000000-0000-0000-0000-000000000001',
  rule_id: 'R05',
  layer: 'arithmetic',
  severity: 'block',
  message: 'Closing balance does not equal opening plus additions minus collections minus write-offs.',
  fields: ['/balances/closing', '/balances/opening'],
  our_value: 1000.5,
  report_value: 1012.5,
  difference: -12,
  tolerance: 1,
  unit: 'currency',
  source_page: 3,
  context: { opening: 900, additions: 200.5, collections: 100 },
  status: 'open',
}

describe('FindingCard', () => {
  it('renders rule id, severity, message and ours vs report with difference and tolerance', () => {
    render(<FindingCard finding={base} ruleTitle="Roll-forward closes" />)
    expect(screen.getByText('R05')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: /Roll-forward closes/ })).toBeTruthy()
    expect(screen.getByText('Block')).toBeTruthy()
    expect(screen.getByTestId('our-value').textContent).toBe('$1,000.50')
    expect(screen.getByTestId('report-value').textContent).toBe('$1,012.50')
    expect(screen.getByTestId('difference').textContent).toContain('−$12.00')
    expect(screen.getByTestId('difference').textContent).toContain('outside tolerance')
    expect(screen.getByTestId('tolerance').textContent).toBe('±$1.00')
  })

  it('renders the context arithmetic and source page', () => {
    render(<FindingCard finding={base} />)
    expect(screen.getByText('Opening')).toBeTruthy()
    expect(screen.getByText('$900.00')).toBeTruthy()
    expect(screen.getByText('Source page 3')).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Report page 3' })).toBeTruthy()
  })

  it('fills the crop and action slots, and omits actions when read-only', () => {
    const { rerender } = render(<FindingCard finding={base} crop={<img alt="Page 3 crop" src="data:," />} actions={<Button>Use ours</Button>} />)
    expect(screen.getByAltText('Page 3 crop')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use ours' })).toBeTruthy()
    rerender(<FindingCard finding={base} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Page image not loaded')).toBeTruthy()
  })

  it('shows a resolution and the resolved status', () => {
    render(<FindingCard finding={{ ...base, status: 'overridden', resolution: { by: 'tao_admin', at: '2026-11-03T10:15:00Z', choice: 'use_report', reason: 'Report restated in note 4' } }} />)
    expect(screen.getByText('Overridden')).toBeTruthy()
    expect(screen.getByText('Used the report value')).toBeTruthy()
    expect(screen.getByText(/Report restated in note 4/)).toBeTruthy()
  })

  it('handles a note without values', () => {
    render(<FindingCard finding={{ id: 'x', rule_id: 'R22', severity: 'note', message: 'Informational.', status: 'open' }} />)
    expect(screen.getByText('Note')).toBeTruthy()
    expect(screen.queryByTestId('our-value')).toBeNull()
    expect(screen.getByText('No source page for this finding')).toBeTruthy()
  })

  it('marks a difference within tolerance', () => {
    render(<FindingCard finding={{ ...base, difference: 0.004, unit: 'percent_points', our_value: 0.041, report_value: 0.037, tolerance: 0.005 }} />)
    expect(screen.getByTestId('difference').textContent).toContain('+0.40 pp')
    expect(screen.getByTestId('difference').textContent).toContain('within tolerance')
  })

  // Stride Aug 2026 R14 as UI-Review saw it (shape of rules/tests/fixtures/findings/r14-fail.json, values from the
  // Stride finding): percent_points values are fractions, so 0.04 must read 4.00%, not 0.04%.
  it('formats percent_points fractions as percentages (Stride R14)', () => {
    const r14: FindingView = {
      id: 'fecb6400-bc89-5b75-ba53-fb4bbbde5e21', rule_id: 'R14', layer: 'cross_source', severity: 'review',
      message: 'SLFA 9.1 (c): report threshold 0.035, master record says 0.04',
      fields: ['/covenants/0/threshold', 'master:/covenant_definitions'],
      our_value: 0.04, report_value: 0.035, difference: -0.005, tolerance: 0, unit: 'percent_points', source_page: 14,
      context: { legal_ref: 'SLFA 9.1 (c)', effective_from: '2022-12-09', master_threshold: 0.04 },
      status: 'open',
    }
    render(<FindingCard finding={r14} ruleTitle="Covenant thresholds equal the master record" />)
    expect(screen.getByTestId('our-value').textContent).toBe('4.00%')
    expect(screen.getByTestId('report-value').textContent).toBe('3.50%')
    expect(screen.getByTestId('difference').textContent).toContain('−0.50 pp')
    expect(screen.getByTestId('difference').textContent).toContain('outside tolerance')
    expect(screen.getByTestId('tolerance').textContent).toBe('±0.00%')
    expect(screen.getByText('4.00%', { selector: 'dd' })).toBeTruthy()
    expect(screen.getByText('SLFA 9.1 (c)', { selector: 'dd' })).toBeTruthy()
  })

  it('keeps amounts in a percent_points context as numbers (R10 shape)', () => {
    render(<FindingCard finding={{ ...base, rule_id: 'R10', unit: 'percent_points', our_value: 0.134574, report_value: 0.1728, difference: 0.038226, tolerance: 0.0001,
      context: { enhancement_amount: 957208.59, base: 7112902.11 } }} />)
    expect(screen.getByTestId('our-value').textContent).toBe('13.46%')
    expect(screen.getByText('957,208.59')).toBeTruthy()
    expect(screen.getByTestId('tolerance').textContent).toBe('±0.01%')
  })
})
