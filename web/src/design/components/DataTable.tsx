import { Fragment, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { SkeletonBlock } from './SkeletonBlock'
import { IconChevronRight, IconSort, IconChevronUp, IconChevronDown } from './icons'

export type Column<T> = {
  /** Unique column key. Also the default field read from the row when `render` is absent. */
  key: string
  header: ReactNode
  /** Cell content. Defaults to String(row[key]). */
  render?: (row: T, index: number) => ReactNode
  /** Right-aligned, tabular numerals. Use for every number. */
  numeric?: boolean
  align?: 'left' | 'center' | 'right'
  /** Render the cell as the row's key cell (indigo, semibold), e.g. deal name. */
  emphasis?: boolean
  width?: CSSProperties['width']
  /** Makes the header a sort button. Return a comparable value. Sorting is client-side display only. */
  sortValue?: (row: T) => string | number | null | undefined
  /** Footer cell content (totals row). Shown when any column has a footer. */
  footer?: ReactNode
  /** Accessible header text when `header` is not plain text (e.g. an icon). */
  ariaLabel?: string
}

export type DataTableProps<T> = {
  columns: Column<T>[]
  rows: T[]
  /** Stable key per row. */
  rowKey: (row: T, index: number) => string
  /** Visible or screen-reader caption describing the table. */
  caption?: ReactNode
  captionHidden?: boolean
  loading?: boolean
  /** Number of skeleton rows while loading. */
  skeletonRows?: number
  /** Shown when rows is empty and not loading. */
  empty?: { title: ReactNode; message?: ReactNode; action?: ReactNode }
  /** Expandable rows: return the detail panel for a row, or null if that row has none. */
  renderExpanded?: (row: T) => ReactNode | null
  /** Controlled expanded keys (for Expand all / Collapse all). Omit for uncontrolled. */
  expandedKeys?: ReadonlySet<string>
  onExpandedChange?: (keys: Set<string>) => void
  /** Row activation (click, Enter or Space on the focused row). Makes rows focusable. */
  onRowClick?: (row: T) => void
  /** Accessible name for the row in the expand button and row link, e.g. the deal name. */
  rowLabel?: (row: T) => string
  selectedKey?: string | null
  /** Scroll container height; the header stays sticky inside it. Omit to let the page scroll. */
  maxHeight?: CSSProperties['maxHeight']
  density?: 'normal' | 'compact'
  className?: string
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null

/** Dense data table: 13 px Inter, sticky header, numeric columns right-aligned with tabular numerals, optional
 * sort, row expand (panel motion), empty state, loading skeleton. Rows never animate on load. */
export function DataTable<T>({
  columns, rows, rowKey, caption, captionHidden = false, loading = false, skeletonRows = 5, empty, renderExpanded,
  expandedKeys, onExpandedChange, onRowClick, rowLabel, selectedKey, maxHeight, density = 'normal', className,
}: DataTableProps<T>) {
  const [innerExpanded, setInnerExpanded] = useState<Set<string>>(() => new Set())
  const expanded = expandedKeys ?? innerExpanded
  const [sort, setSort] = useState<Sort>(null)
  const expandable = !!renderExpanded
  const hasFooter = columns.some(c => c.footer !== undefined)
  const colCount = columns.length + (expandable ? 1 : 0)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find(c => c.key === sort.key)
    if (!col?.sortValue) return rows
    const get = col.sortValue
    const out = rows.map((r, i) => ({ r, i }))
    out.sort((a, b) => {
      const va = get(a.r), vb = get(b.r)
      if (va == null && vb == null) return a.i - b.i
      if (va == null) return 1
      if (vb == null) return -1
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })
      return (sort.dir === 'asc' ? c : -c) || a.i - b.i
    })
    return out.map(o => o.r)
  }, [rows, sort, columns])

  const toggle = (key: string) => {
    const next = new Set(expanded)
    if (next.has(key)) next.delete(key); else next.add(key)
    if (!expandedKeys) setInnerExpanded(next)
    onExpandedChange?.(next)
  }
  const cycleSort = (key: string) => setSort(s => !s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null)

  const cellClass = (c: Column<T>) => [c.numeric || c.align === 'right' ? 'ds-num' : c.align === 'center' ? 'ds-center' : '', c.emphasis ? 'ds-key' : ''].filter(Boolean).join(' ') || undefined
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick?.(row) }
  }

  return (
    <div className={['ds-table-wrap', maxHeight !== undefined && 'ds-table-wrap--scroll', className].filter(Boolean).join(' ')} style={{ maxHeight }} aria-busy={loading || undefined}
      tabIndex={maxHeight ? 0 : undefined} role={maxHeight ? 'region' : undefined} aria-label={maxHeight && typeof caption === 'string' ? caption : undefined}>
      <table className={['ds-table', density === 'compact' && 'ds-table--compact'].filter(Boolean).join(' ')}>
        {caption && <caption className={captionHidden ? 'ds-visually-hidden' : undefined}>{caption}</caption>}
        <thead>
          <tr>
            {expandable && <th className="ds-table__expcell" aria-label="Expand row" />}
            {columns.map(c => {
              const active = sort?.key === c.key
              return (
                <th key={c.key} scope="col" className={cellClass({ ...c, emphasis: false })} style={{ width: c.width }}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined}
                  aria-label={c.ariaLabel}>
                  {c.sortValue ? (
                    <button type="button" className="ds-table__sort" data-active={active} onClick={() => cycleSort(c.key)}>
                      {c.header}
                      {active ? (sort!.dir === 'asc' ? <IconChevronUp /> : <IconChevronDown />) : <IconSort />}
                    </button>
                  ) : c.header}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: skeletonRows }, (_, i) => (
              <tr key={i} className="ds-table__skel">
                {expandable && <td />}
                {columns.map(c => <td key={c.key} className={cellClass(c)}><SkeletonBlock height={10} width={c.numeric ? '60%' : '80%'} style={c.numeric ? { marginLeft: 'auto' } : undefined} /></td>)}
              </tr>
            ))
          ) : sorted.length === 0 ? (
            <tr className="ds-table__empty">
              <td colSpan={colCount}>
                <b>{empty?.title ?? 'Nothing here yet'}</b>
                {empty?.message && <span>{empty.message}</span>}
                {empty?.action && <div style={{ marginTop: 12 }}>{empty.action}</div>}
              </td>
            </tr>
          ) : sorted.map((row, i) => {
            const key = rowKey(row, i)
            const detail = renderExpanded ? renderExpanded(row) : null
            const open = expanded.has(key) && detail != null
            const label = rowLabel?.(row) ?? `row ${i + 1}`
            const detailId = `ds-row-detail-${key}`
            return (
              <Fragment key={key}>
                <tr className={['ds-row', open && 'ds-row--open', selectedKey === key && 'ds-row--selected', onRowClick && 'ds-row--clickable'].filter(Boolean).join(' ')}
                  tabIndex={onRowClick ? 0 : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? e => onRowKey(e, row) : undefined} aria-selected={selectedKey != null ? selectedKey === key : undefined}>
                  {expandable && (
                    <td className="ds-table__expcell">
                      {detail != null && (
                        <button type="button" className="ds-table__exp" aria-expanded={open} aria-controls={open ? detailId : undefined}
                          aria-label={(open ? 'Collapse ' : 'Expand ') + label}
                          onClick={e => { e.stopPropagation(); toggle(key) }} onKeyDown={e => e.stopPropagation()}>
                          <IconChevronRight />
                        </button>
                      )}
                    </td>
                  )}
                  {columns.map(c => (
                    <td key={c.key} className={cellClass(c)}>{c.render ? c.render(row, i) : String((row as Record<string, unknown>)[c.key] ?? '—')}</td>
                  ))}
                </tr>
                {open && (
                  <tr className="ds-table__detail" id={detailId}>
                    <td colSpan={colCount}><div className="ds-table__detailinner">{detail}</div></td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
        {hasFooter && !loading && sorted.length > 0 && (
          <tfoot>
            <tr>
              {expandable && <td />}
              {columns.map(c => <td key={c.key} className={cellClass({ ...c, emphasis: false })}>{c.footer}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
