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
    render(<FindingCard finding={{ ...base, difference: 0.4, unit: 'percent_points', our_value: 4.1, report_value: 3.7, tolerance: 0.5 }} />)
    expect(screen.getByTestId('difference').textContent).toContain('+0.40 pp')
    expect(screen.getByTestId('difference').textContent).toContain('within tolerance')
  })
})
