import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, CovenantPill, DataTable, Dialog, Field, Select, formatPeriod, icons, type Column } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { CovenantDetail, Trend } from './Covenants'
import { paths, usePublished } from './data'
import { commonDealNamePrefix, covKind, displayStatus, shortName, stableKey, terms, worstOf } from './fmt'
import { links, usePortfolioParams, useShell } from './nav'
import { Num } from './Num'
import { PeriodPicker } from './ProgramSummary'
import { AsOfPill, BehindNote, LoadGate, ProgramTiles, crumbs, dealMonth, programName, programSlug } from './shared'
import type { Covenant, Deal, ProgramAggregate } from './types'

/** Program Dashboard: Portfolio Metrics, Covenant Status & Review, watch threshold, print. */
export function ProgramDashboard() {
  const shell = useShell()
  const L = links(shell)
  const { programId, period } = usePortfolioParams()
  const load = usePublished<ProgramAggregate>(programId ? paths.program(programId, period) : null)
  const name = load.state === 'ok' ? programName(load.data) : programId ?? ''
  usePageHeader({
    title: load.state === 'ok' ? `${name} Dashboard` : 'Program Dashboard',
    subtitle: load.state === 'ok' ? <>Collection period {formatPeriod(load.data.period)} · {load.data.deal_count} deals</> : undefined,
    crumbs: crumbs(shell, L.portfolio(), { label: name, href: programId ? L.program(programId) : undefined }, { label: 'Dashboard' }),
  })
  return <LoadGate load={load}>{p => <ProgramDashboardView p={p} />}</LoadGate>
}

type Row = { d: Deal; di: number; c: Covenant; ci: number; prior?: Covenant; pi?: number; status: string; key: string; label: string }
const BUFFERS = [5, 10, 15, 20, 25]

export function ProgramDashboardView({ p }: { p: ProgramAggregate }) {
  const L = links(useShell())
  const nav = useNavigate()
  const slug = programSlug(p)
  const t = terms(p.terminology ?? undefined)
  const prefix = commonDealNamePrefix(p.deals.map(d => d.deal_name))
  const published = p.deals[0]?.watch_buffer_pct ?? 0.1
  const [bufferPct, setBufferPct] = useState(Math.round(published * 100))
  const [draft, setDraft] = useState(String(bufferPct))
  const [dialog, setDialog] = useState(false)
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const buffer = bufferPct / 100
  const atPublished = p.deals.every(d => Math.abs(d.watch_buffer_pct - buffer) < 1e-9)

  // Deals keep their index in p.deals so data-field paths point into the published object.
  const order = useMemo(() => p.deals.map((d, di) => ({ d, di })).sort((a, b) => a.d.deal_name.localeCompare(b.d.deal_name)), [p.deals])
  const allRows: Row[] = useMemo(() => order.flatMap(({ d, di }) => {
    const priorIdx = new Map((d.prior_covenants ?? []).map((c, i) => [stableKey(c), i]))
    return d.covenants.map((c, ci) => {
      const pi = priorIdx.get(stableKey(c))
      return { d, di, c, ci, pi, prior: pi === undefined ? undefined : d.prior_covenants![pi], status: displayStatus(c, buffer, d.watch_buffer_pct), key: `${d.deal_slug}#${ci}`, label: `${shortName(d.deal_name, prefix)} ${c.legal_ref}` }
    })
  }), [order, buffer, prefix])
  const rows = flaggedOnly ? allRows.filter(r => r.status === 'WATCH' || r.status === 'BREACH') : allRows

  // Print: expand every row, print, then restore what the viewer had open (reference printDashboard).
  const restoreRef = useRef<Set<string> | null>(null)
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    if (!printing) return
    const after = () => { if (restoreRef.current) setExpanded(restoreRef.current); restoreRef.current = null; setPrinting(false); window.removeEventListener('afterprint', after) }
    window.addEventListener('afterprint', after)
    const id = requestAnimationFrame(() => { window.print(); if (!('onafterprint' in window)) after() })
    return () => { cancelAnimationFrame(id); window.removeEventListener('afterprint', after) }
  }, [printing])
  const print = () => { restoreRef.current = expanded; setExpanded(new Set(rows.map(r => r.key))); setPrinting(true) }

  const statusCell = (r: Row) => <CovenantPill status={r.status} size="sm" />
  const cols: Column<Row>[] = [
    { key: 'deal', header: 'Deal', emphasis: true, sortValue: r => r.d.deal_name, render: r => <span className="pf-nowrap">{shortName(r.d.deal_name, prefix)}<AsOfPill p={p} dealSlug={r.d.deal_slug} /></span> },
    { key: 'ref', header: 'Covenant', render: r => <><div className="pf-nowrap">{r.c.legal_ref}</div><div className="pf-muted pf-small pf-clip">{r.c.description}</div></> },
    { key: 'status', header: 'Status', render: statusCell, sortValue: r => ({ BREACH: 0, WATCH: 1, OK: 2, AVAILABLE: 3 } as Record<string, number>)[r.status] ?? 4 },
    { key: 'value', header: 'Value', numeric: true, render: r => <Num v={r.c.current_value} kind={covKind(r.c)} field={`deals.${r.di}.covenants.${r.ci}.current_value`} /> },
    { key: 'threshold', header: 'Threshold', numeric: true, render: r => <>{r.c.kind === 'floor' && <span className="pf-muted pf-small">min </span>}<Num v={r.c.threshold} kind={covKind(r.c)} field={`deals.${r.di}.covenants.${r.ci}.threshold`} /></> },
    { key: 'util', header: 'Utilization', numeric: true, sortValue: r => r.c.utilization_pct, render: r => <Num v={r.c.utilization_pct} kind="pct" field={`deals.${r.di}.covenants.${r.ci}.utilization_pct`} /> },
    { key: 'trend', header: 'Trend', render: r => <Trend trend={r.c.trend} /> },
  ]

  type MRow = { d: Deal; di: number }
  const mcols: Column<MRow>[] = [
    { key: 'deal', header: 'Deal', emphasis: true, sortValue: r => r.d.deal_name, render: r => <span className="pf-nowrap"><Link className="pf-link" to={L.deal(slug, r.d.deal_slug, dealMonth(p, r.d.deal_slug))} aria-label={`Open deal ${r.d.deal_name}`}>{shortName(r.d.deal_name, prefix)}</Link><AsOfPill p={p} dealSlug={r.d.deal_slug} /></span> },
    { key: 'status', header: 'Status', render: r => <CovenantPill status={atPublished ? r.d.worst_status : worstOf(r.d.covenants.map(c => ({ category: c.category, status: displayStatus(c, buffer, r.d.watch_buffer_pct) })))} size="sm" /> },
    { key: 'bal', header: t.balance, numeric: true, sortValue: r => r.d.tranche_balance.closing, render: r => <Num v={r.d.tranche_balance.closing} kind="money" field={`deals.${r.di}.tranche_balance.closing`} /> },
    { key: 'chg', header: 'Change', numeric: true, render: r => <><Num v={r.d.tranche_balance.change_abs} kind="signed-money" field={`deals.${r.di}.tranche_balance.change_abs`} /> <span className="pf-muted">(<Num v={r.d.tranche_balance.change_pct} kind="pct" field={`deals.${r.di}.tranche_balance.change_pct`} />)</span></> },
    { key: 'ct', header: 'Contracts', numeric: true, render: r => <Num v={r.d.contracts.closing} kind="count" field={`deals.${r.di}.contracts.closing`} /> },
    { key: 'ctc', header: 'Change', numeric: true, render: r => <Num v={r.d.contracts.change_abs} kind="signed-count" field={`deals.${r.di}.contracts.change_abs`} /> },
    { key: 'enh', header: 'Enhancement', numeric: true, render: r => <Num v={r.d.total_enhancement?.total_enhancement_pct} kind="pct" field={r.d.total_enhancement ? `deals.${r.di}.total_enhancement.total_enhancement_pct` : undefined} /> },
    { key: 'lim', header: 'Facility limit', numeric: true, render: r => <Num v={r.d.program?.program_limit} kind="money" field={r.d.program ? `deals.${r.di}.program.program_limit` : undefined} /> },
    { key: 'util', header: 'Utilization', numeric: true, sortValue: r => r.d.program?.program_utilization_pct, render: r => <Num v={r.d.program?.program_utilization_pct} kind="pct" field={r.d.program ? `deals.${r.di}.program.program_utilization_pct` : undefined} /> },
  ]

  return (
    <div className="pf-stack pf-dash">
      <div className="pf-toolbar pf-noprint">
        <PeriodPicker periods={p.available_periods} value={p.period} onChange={per => nav(L.dashboard(slug, per))} />
        <span className="pf-spacer" />
        <Button icon={<icons.IconFile width={15} height={15} />} onClick={print}>Print / Save as PDF</Button>
      </div>

      <section aria-labelledby="pf-pm" className="pf-stack">
        <h2 id="pf-pm" className="pf-section">Portfolio Metrics</h2>
        <ProgramTiles p={p} />
        <BehindNote p={p} />
        <Card title="Deals" subtitle={`${p.deal_count} deals · ${formatPeriod(p.period)}`} padding="flush">
          <DataTable columns={mcols} rows={order} rowKey={r => r.d.deal_slug} caption="Deal metrics" captionHidden density="compact" />
        </Card>
      </section>

      <section aria-labelledby="pf-cs" className="pf-stack pf-pagebreak">
        <Card padding="flush" title={<span id="pf-cs">Covenant Status &amp; Review</span>}
          subtitle={atPublished ? `Published status at a ${bufferPct}% watch buffer` : `Display at a ${bufferPct}% watch buffer (published at ${Math.round(published * 100)}%). Display only; the published status is unchanged.`}
          actions={<div className="pf-noprint pf-actions">
            <label className="pf-check"><input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} /> Flagged only</label>
            <Button size="sm" onClick={() => { setDraft(String(bufferPct)); setDialog(true) }}>Watch threshold: {bufferPct}%</Button>
            <Button size="sm" onClick={() => setExpanded(new Set(rows.map(r => r.key)))}>Expand all</Button>
            <Button size="sm" onClick={() => setExpanded(new Set())}>Collapse all</Button>
          </div>}>
          <DataTable columns={cols} rows={rows} rowKey={r => r.key} rowLabel={r => r.label} caption="Covenant status and review" captionHidden density="compact"
            expandedKeys={expanded} onExpandedChange={setExpanded}
            renderExpanded={r => <CovenantDetail c={r.c} prior={r.prior} status={r.status} field={`deals.${r.di}.covenants.${r.ci}`} priorField={r.pi === undefined ? undefined : `deals.${r.di}.prior_covenants.${r.pi}`} />}
            empty={{ title: 'No flagged covenants', message: `Nothing is at WATCH or BREACH at a ${bufferPct}% watch buffer.` }} />
        </Card>
      </section>

      <Dialog open={dialog} onClose={() => setDialog(false)} title="Watch threshold" size="sm"
        description="A covenant shows WATCH when its utilization is within this distance of the threshold. This changes the display on this page only; published statuses are not changed."
        footer={<>
          <Button onClick={() => { setBufferPct(Math.round(published * 100)); setDialog(false) }}>Reset to published</Button>
          <Button variant="primary" onClick={() => { setBufferPct(Number(draft)); setDialog(false) }}>Apply</Button>
        </>}>
        <Field label="Watch buffer">
          <Select value={draft} onChange={e => setDraft(e.target.value)} options={[...new Set([...BUFFERS, Math.round(published * 100)])].sort((a, b) => a - b).map(b => ({ value: String(b), label: `${b}%${b === Math.round(published * 100) ? ' (published)' : ''}` }))} />
        </Field>
      </Dialog>
    </div>
  )
}
