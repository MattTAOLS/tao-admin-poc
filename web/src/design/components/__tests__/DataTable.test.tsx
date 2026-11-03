// @vitest-environment jsdom
import '../../test-utils'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DataTable, type Column } from '..'

type Row = { id: string; deal: string; balance: number }
const rows: Row[] = [
  { id: 'a', deal: 'Moneda', balance: 300 },
  { id: 'b', deal: 'F-PIL', balance: 100 },
  { id: 'c', deal: 'Atlas', balance: 200 },
]
const cols: Column<Row>[] = [
  { key: 'deal', header: 'Deal', emphasis: true, sortValue: r => r.deal },
  { key: 'balance', header: 'Balance', numeric: true, render: r => r.balance.toFixed(2), sortValue: r => r.balance, footer: '600.00' },
]
const bodyRows = () => within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row')

describe('DataTable', () => {
  it('right-aligns numeric columns in header, body and footer', () => {
    const { container } = render(<DataTable columns={cols} rows={rows} rowKey={r => r.id} caption="Deals" />)
    const ths = container.querySelectorAll('th')
    expect(ths[1].className).toContain('ds-num')
    expect(container.querySelector('tbody td.ds-num')!.textContent).toBe('300.00')
    expect(container.querySelector('tfoot td.ds-num')!.textContent).toBe('600.00')
    expect(screen.getByText('Deals').tagName).toBe('CAPTION')
  })

  it('sorts asc, desc, then back to original order with aria-sort', async () => {
    render(<DataTable columns={cols} rows={rows} rowKey={r => r.id} />)
    const btn = screen.getByRole('button', { name: /Balance/ })
    await userEvent.click(btn)
    expect(bodyRows().map(r => r.textContent)).toEqual(['F-PIL100.00', 'Atlas200.00', 'Moneda300.00'])
    expect(btn.closest('th')!.getAttribute('aria-sort')).toBe('ascending')
    await userEvent.click(btn)
    expect(bodyRows()[0].textContent).toBe('Moneda300.00')
    expect(btn.closest('th')!.getAttribute('aria-sort')).toBe('descending')
    await userEvent.click(btn)
    expect(bodyRows()[0].textContent).toBe('Moneda300.00')
    expect(btn.closest('th')!.getAttribute('aria-sort')).toBe('none')
  })

  it('shows an empty state', () => {
    render(<DataTable columns={cols} rows={[]} rowKey={r => r.id} empty={{ title: 'No uploads yet', message: 'Upload a SetRep to start.' }} />)
    expect(screen.getByText('No uploads yet')).toBeTruthy()
    expect(screen.getByText('Upload a SetRep to start.')).toBeTruthy()
  })

  it('shows skeleton rows while loading, not data', () => {
    const { container } = render(<DataTable columns={cols} rows={rows} rowKey={r => r.id} loading skeletonRows={4} />)
    expect(container.querySelectorAll('tr.ds-table__skel').length).toBe(4)
    expect(screen.queryByText('Moneda')).toBeNull()
    expect(container.firstElementChild!.getAttribute('aria-busy')).toBe('true')
  })

  it('expands and collapses a row from the keyboard', async () => {
    render(<DataTable columns={cols} rows={rows} rowKey={r => r.id} rowLabel={r => r.deal} renderExpanded={r => r.id === 'b' ? null : <p>Detail for {r.deal}</p>} />)
    expect(screen.queryByRole('button', { name: 'Expand F-PIL' })).toBeNull() // no detail, no button
    const exp = screen.getByRole('button', { name: 'Expand Moneda' })
    exp.focus(); await userEvent.keyboard('{Enter}')
    expect(screen.getByText('Detail for Moneda')).toBeTruthy()
    const col = screen.getByRole('button', { name: 'Collapse Moneda' })
    expect(col.getAttribute('aria-expanded')).toBe('true')
    await userEvent.keyboard(' ')
    expect(screen.queryByText('Detail for Moneda')).toBeNull()
  })

  it('supports controlled Expand all / Collapse all', async () => {
    function Harness() {
      const [keys, setKeys] = useState<Set<string>>(new Set())
      return (<>
        <button onClick={() => setKeys(new Set(rows.map(r => r.id)))}>Expand all</button>
        <button onClick={() => setKeys(new Set())}>Collapse all</button>
        <DataTable columns={cols} rows={rows} rowKey={r => r.id} renderExpanded={r => <p>D-{r.id}</p>} expandedKeys={keys} onExpandedChange={setKeys} />
      </>)
    }
    render(<Harness />)
    await userEvent.click(screen.getByText('Expand all'))
    expect(screen.getAllByText(/^D-/).length).toBe(3)
    await userEvent.click(screen.getByText('Collapse all'))
    expect(screen.queryAllByText(/^D-/).length).toBe(0)
  })

  it('activates rows with click and Enter when onRowClick is set', async () => {
    const onRowClick = vi.fn()
    render(<DataTable columns={cols} rows={rows} rowKey={r => r.id} onRowClick={onRowClick} />)
    const first = bodyRows()[0]
    expect(first.getAttribute('tabindex')).toBe('0')
    await userEvent.click(first)
    first.focus(); await userEvent.keyboard('{Enter}')
    expect(onRowClick).toHaveBeenCalledTimes(2)
    expect(onRowClick.mock.calls[0][0]).toBe(rows[0])
  })
})
