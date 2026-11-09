/** Read-only sections of the company profile, in D6 order. Figures come from the published deal object or from
 * CompanyInsights; nothing is computed here beyond picking which series to draw. No industry averages (decision D2). */
import { useState, type ReactNode } from 'react'
import { Button, Card, DataTable, KpiRow, KpiTile, StatusPill, formatPeriod, type Column } from '@/design/components'
import { HISTORY_LABELS, historyKind, type NumKind } from '../fmt'
import { Num, fmtNum } from '../Num'
import { kpiDelta } from '../polarity'
import type { Deal } from '../types'
import { BalanceBars, LineChart, unitKind, type Line } from './charts'
import type { AdverseItem, CompanyInsights, CompanyRow, LossPeer, MetricSeries, Month, NewsItem, SeriesPoint, WatchSignal } from './types'
import { fmtDay, monthsEnding, shortMonth } from './util'


/** A restated field as people read it: ratio_history keys by their label; a TAO correction such as
 * 'period_history.interest' as 'Interest (period history)'. */
function fieldLabel(f: string): string {
  if (HISTORY_LABELS[f]) return HISTORY_LABELS[f]
  const m = /^([a-z_]+)\.([a-z_]+)$/.exec(f)
  if (!m) return f
  const words = (s: string) => s.replace(/_/g, ' ')
  const name = words(m[2])
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} (${words(m[1])})`
}

export function Section({ id, title, subtitle, actions, children, tao }: {
  id: string; title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; tao?: boolean
}) {
  return (
    <Card id={id} className="co-anchor" title={<>{title}{tao && <StatusPill tone="dpv" size="sm" className="pf-asof">TAO only</StatusPill>}</>}
      subtitle={subtitle} actions={actions}>
      {children}
    </Card>
  )
}

export function KpiSection({ d }: { d: Deal }) {
  const tb = d.tranche_balance, c = d.contracts, cs = d.covenant_summary
  return (
    <KpiRow>
      <KpiTile label="Closing tranche balance" value={<Num v={tb.closing} kind="money" field="tranche_balance.closing" />}
        delta={{ ...kpiDelta('tranche_balance', tb.change_abs), label: 'Change vs last period', value: <Num v={tb.change_pct} kind="pct" field="tranche_balance.change_pct" /> }}
        context="vs last period" />
      {d.program && (
        <KpiTile label="Program limit used" value={<Num v={d.program.program_utilization_pct} kind="pct" field="program.program_utilization_pct" />}
          context={<>of <Num v={d.program.program_limit} kind="money" field="program.program_limit" /></>} />
      )}
      <KpiTile label="Contracts" value={<Num v={c.closing} kind="count" field="contracts.closing" />} context={<>from <Num v={c.opening} kind="count" field="contracts.opening" /></>} />
      {d.total_enhancement && (
        <KpiTile label="Total enhancement" value={<Num v={d.total_enhancement.total_enhancement_amount} kind="money" field="total_enhancement.total_enhancement_amount" />}
          context={<Num v={d.total_enhancement.total_enhancement_pct} kind="pct" field="total_enhancement.total_enhancement_pct" />} />
      )}
      <KpiTile label="Covenants" tone={cs.BREACH ? 'bad' : cs.WATCH ? 'warn' : 'ok'}
        value={<><Num v={cs.BREACH} kind="count" field="covenant_summary.BREACH" /> <span className="pf-kpiword">breach</span> · <Num v={cs.WATCH} kind="count" field="covenant_summary.WATCH" /> <span className="pf-kpiword">watch</span></>}
        context={<><Num v={cs.OK} kind="count" field="covenant_summary.OK" /> OK · <Num v={cs.AVAILABLE} kind="count" field="covenant_summary.AVAILABLE" /> available</>} />
    </KpiRow>
  )
}

const SEVERITY: Record<string, { tone: 'warn' | 'bad' | 'blue'; word: string }> = {
  watch: { tone: 'warn', word: 'Watch' }, rising: { tone: 'bad', word: 'Rising' }, info: { tone: 'blue', word: 'Info' },
}
export function SignalsSection({ signals, period }: { signals: WatchSignal[]; period: string }) {
  return (
    <Section id="what-to-watch" title="What to watch"
      subtitle={`Early-warning signals from the ${formatPeriod(period)} report · ${signals.length} signal${signals.length === 1 ? '' : 's'} · computed from published data, the same for TAO and partners`}>
      {signals.length === 0 ? <p className="pf-muted">No signals in the latest report.</p> : (
        <ul className="co-signals">
          {signals.map((s, i) => {
            const sv = SEVERITY[s.severity] ?? SEVERITY.info
            return (
              <li key={i} className="co-signal">
                <span><StatusPill tone={sv.tone} size="sm">{sv.word}</StatusPill></span>
                <div><a href={`#${s.anchor}`}>{s.title}</a><p>{s.detail}</p></div>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

export type Compare = 'median' | 'mean' | 'both'
const LOSS_METRICS = ['rolling_3month_loss_ratio_pct', 'rolling_12month_loss_ratio_pct']

/** The x axis: the months the deal's series carry (the last 13), else the 13 months ending at the publication month. */
export function axisMonths(ins: CompanyInsights): Month[] {
  const ms = [...new Set(ins.series.flatMap(s => s.deal.map(p => p.month)))].sort()
  if (ms.length) return ms.slice(-13)
  return /^\d{4}-\d{2}$/.test(ins.collection_period) ? monthsEnding(ins.collection_period) : []
}

const latest = (pts: SeriesPoint[]) => [...pts].reverse().find(p => p.value !== null) ?? null

function SeriesChart({ s, months, compare, dealLabel }: { s: MetricSeries; months: Month[]; compare: Compare; dealLabel: string }) {
  const kind = unitKind(s.unit)
  const peers = latest(s.peers_in_month.map(p => ({ month: p.month, value: p.count })))?.value ?? 0
  const lines: Line[] = [{ id: 'deal', label: dealLabel, cls: 'deal', points: s.deal, dots: true }]
  if (compare !== 'mean') lines.push({ id: 'median', label: `Program median${peers ? `, ${peers} other ${peers === 1 ? 'company' : 'companies'}` : ''}`, cls: 'median', points: s.program_median })
  if (compare !== 'median') lines.push({ id: 'mean', label: 'Program mean', cls: 'mean', points: s.program_mean })
  const last = latest(s.deal)
  return (
    <div className="co-chart co-anchor" id={`chart-${s.metric}`}>
      <h3>{s.label}{last && <span className="pf-muted pf-small"> · {shortMonth(last.month)} <span className="pf-num">{fmtNum(last.value, kind)}</span></span>}</h3>
      <LineChart title={`${s.label}, ${dealLabel} and program`} months={months} kind={kind} lines={lines}
        limit={s.limit ? { value: s.limit.threshold, label: `${s.limit.kind === 'floor' ? 'Floor' : 'Limit'} ${s.limit.legal_ref}` } : null} />
    </div>
  )
}

/** The covenant featured on its own: a series whose covenant is at WATCH in the published deal, else interest coverage. */
export function featuredSeries(ins: CompanyInsights, d: Deal | null): { s: MetricSeries; atWatch: boolean } | null {
  const watchRefs = new Set((d?.covenants ?? []).filter(c => c.status === 'WATCH').map(c => c.legal_ref))
  const w = ins.series.find(s => s.limit && watchRefs.has(s.limit.legal_ref) && !LOSS_METRICS.includes(s.metric))
  if (w) return { s: w, atWatch: true }
  const icr = ins.series.find(s => s.metric === 'interest_coverage_ratio')
  return icr ? { s: icr, atWatch: false } : null
}

export function PerformanceSection({ ins, dealLabel, compare, setCompare, exclude }: {
  ins: CompanyInsights; dealLabel: string; compare: Compare; setCompare: (c: Compare) => void; exclude?: string
}) {
  const months = axisMonths(ins)
  const series = ins.series.filter(s => !LOSS_METRICS.includes(s.metric) && s.metric !== exclude)
  return (
    <Section id="performance" title="Performance from the monthly reports"
      subtitle={`${shortMonth(months[0] ?? '')} to ${shortMonth(months[months.length - 1] ?? '')} · ratio history from each published report · program lines use the other companies in the same program, same month, one point per company`}
      actions={
        <div className="co-toggle" role="group" aria-label="Compare with the program">
          {(['median', 'mean', 'both'] as Compare[]).map(c => (
            <button key={c} type="button" aria-pressed={compare === c} onClick={() => setCompare(c)}>{c === 'both' ? 'Both' : c === 'median' ? 'Median' : 'Mean'}</button>
          ))}
        </div>
      }>
      {series.length === 0 ? <p className="pf-muted">This deal's report has no ratio history to chart.</p> : (
        <div className="co-chartgrid">{series.map(s => <SeriesChart key={s.metric} s={s} months={months} compare={compare} dealLabel={dealLabel} />)}</div>
      )}
    </Section>
  )
}

/** Decision D4: losses are compared only with named peers on the same measure. Peers off this deal's scale are listed,
 * not drawn. */
export function LossSection({ ins, dealLabel }: { ins: CompanyInsights; dealLabel: string }) {
  const months = axisMonths(ins)
  const own = ins.series.filter(s => LOSS_METRICS.includes(s.metric))
  if (!own.length && !ins.loss_peers.length) return null
  const lines: Line[] = own.map(s => ({ id: s.metric, label: `${dealLabel} ${s.metric.startsWith('rolling_3') ? '3-month' : '12-month'}`, cls: s.metric.startsWith('rolling_3') ? 'alt' : 'deal', points: s.deal, dots: s.metric.startsWith('rolling_12') }))
  const drawn = ins.loss_peers.filter(p => p.drawn)
  const listed = ins.loss_peers.filter(p => !p.drawn)
  const word = (p: LossPeer) => (p.metric.startsWith('rolling_3') ? '3-month' : p.metric.startsWith('rolling_12') ? '12-month' : HISTORY_LABELS[p.metric] ?? p.metric)
  for (const p of drawn) lines.push({ id: `peer-${p.deal_slug}-${p.metric}`, label: `${p.deal_name} ${word(p)}`, cls: 'peer', points: p.series })
  const limitSeries = own.find(s => s.metric.startsWith('rolling_12') && s.limit) ?? own.find(s => s.limit)
  return (
    <Section id="loss-ratios" title="Rolling loss ratios"
      subtitle={drawn.length || listed.length ? `Compared with named deals in the same program that report the same measure` : 'No other deal in the program reports the same measure'}>
      {lines.length ? (
        <div className="co-chart">
          <LineChart title={`Rolling loss ratios, ${dealLabel}`} months={months} kind="pct" lines={lines}
            limit={limitSeries?.limit ? { value: limitSeries.limit.threshold, label: `Limit ${limitSeries.limit.legal_ref}` } : null} />
        </div>
      ) : <p className="pf-muted">This deal does not report rolling loss ratios.</p>}
      {listed.length > 0 && (
        <p className="co-hint" data-testid="peers-listed">
          Listed, not drawn (far off this deal's scale): {listed.map(p => {
            const vals = p.series.map(x => x.value).filter((v): v is number => v !== null)
            return `${p.deal_name} ${word(p)}${vals.length ? ` (${fmtNum(Math.min(...vals), 'pct')} to ${fmtNum(Math.max(...vals), 'pct')})` : ''}`
          }).join('; ')}.
        </p>
      )}
    </Section>
  )
}

export function CovenantFocus({ f, ins, dealLabel, buffer }: { f: { s: MetricSeries; atWatch: boolean }; ins: CompanyInsights; dealLabel: string; buffer: number | undefined }) {
  const kind = unitKind(f.s.unit)
  const ref = f.s.limit?.legal_ref
  return (
    <Section id={`chart-${f.s.metric}`} title={f.s.label}
      subtitle={f.atWatch ? `The covenant at watch${ref ? ` · ${ref}` : ''}` : ref ? `Covenant ${ref}` : 'From the ratio history'}>
      <div className="co-chart">
        <LineChart title={`${f.s.label}, ${dealLabel}`} months={axisMonths(ins)} kind={kind}
          lines={[{ id: 'deal', label: dealLabel, cls: 'deal', points: f.s.deal, dots: true }]}
          limit={f.s.limit ? { value: f.s.limit.threshold, label: f.s.limit.kind === 'floor' ? 'Floor' : 'Limit' } : null} />
        {typeof buffer === 'number' && f.s.limit && <p className="co-hint">Watch starts within {fmtNum(buffer, 'pct').replace('.00', '')} of the limit (the program watch buffer).</p>}
      </div>
    </Section>
  )
}

export function BalanceSection({ d, ins }: { d: Deal; ins: CompanyInsights }) {
  const ph = d.period_history ?? []
  const median = new Map((ins.balance_median_change ?? []).map(p => [p.month, p.value]))
  type R = (typeof ph)[number]
  const cols: Column<R>[] = [
    { key: 'period', header: 'Period', render: r => formatPeriod(r.period) },
    { key: 'opening', header: 'Opening', numeric: true, render: r => <Num v={r.opening_balance} kind="money" /> },
    { key: 'closing', header: 'Closing', numeric: true, render: r => <Num v={r.closing_balance} kind="money" /> },
    { key: 'change', header: 'Change', numeric: true, render: r => <Num v={r.opening_balance ? r.closing_balance / r.opening_balance - 1 : null} kind="pct" /> },
    { key: 'median', header: 'Program median', numeric: true, render: r => <Num v={median.get(r.period) ?? null} kind="pct" /> },
    { key: 'losses', header: 'Losses', numeric: true, render: r => <Num v={r.losses} kind="money" /> },
    { key: 'contracts', header: 'Contracts', numeric: true, render: r => <Num v={r.closing_contracts} kind="count" /> },
  ]
  return (
    <Section id="pool-balance-table" title="Pool balance by period"
      subtitle="Change is closing against opening; opening includes each month's new tranche.">
      <DataTable caption="Pool balance by period" captionHidden density="compact" columns={cols} rows={ph} rowKey={r => r.period} />
    </Section>
  )
}

/** The pool balance chart, its own card in the chart grid; the table by period is BalanceSection below the grid. */
export function BalanceChartSection({ d, ins }: { d: Deal; ins: CompanyInsights }) {
  const ph = d.period_history ?? []
  const last = ph.length ? ph[ph.length - 1].period : ins.collection_period
  const months = monthsEnding(last)
  const values = new Map(ph.map(p => [p.period, p.closing_balance] as [Month, number]))
  return (
    <Section id="pool-balance" title="Pool balance" subtitle={`Closing tranche balance by collection period · ${values.size} of ${months.length} months loaded`}>
      <div className="co-chart">
        <BalanceBars title="Closing tranche balance" months={months} values={values} limit={d.program?.program_limit ?? null} />
        <p className="co-hint">Grey slots are months not loaded yet. They fill as older reports are processed.</p>
      </div>
    </Section>
  )
}

const CELL_WORD: Record<string, string> = { OK: 'OK', WATCH: 'Watch', BREACH: 'Breach', AVAILABLE: 'Avail.' }
const CELL_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = { OK: 'ok', WATCH: 'warn', BREACH: 'bad', AVAILABLE: 'neutral' }
export function CovenantHistorySection({ ins }: { ins: CompanyInsights }) {
  const months = [...new Set(ins.covenant_history.flatMap(r => r.cells.map(c => c.month)))].sort()
  const published = months.filter(m => ins.covenant_history.some(r => r.cells.some(c => c.month === m && c.source === 'published')))
  return (
    <Section id="covenant-history" title="Covenant status history"
      subtitle={published.length
        ? `Outlined cells are as published (${published.map(shortMonth).join(', ')}). Other months are recomputed from the ratio history with the limits in force that month and the program watch buffer.`
        : 'Recomputed from the ratio history with the limits in force that month and the program watch buffer.'}>
      {ins.covenant_history.length === 0 ? <p className="pf-muted">No covenant history for this deal.</p> : (
        <div className="co-hist-wrap">
          <table className="co-hist">
            <caption className="ds-visually-hidden">Covenant status by month</caption>
            <thead><tr><th scope="col">Covenant</th>{months.map(m => <th key={m} scope="col">{shortMonth(m)}</th>)}</tr></thead>
            <tbody>
              {ins.covenant_history.map(r => (
                <tr key={r.legal_ref + r.description}>
                  <th scope="row">{r.legal_ref}<small>{r.description}</small></th>
                  {months.map(m => {
                    const c = r.cells.find(x => x.month === m)
                    if (!c || !c.status) return <td key={m} aria-label={`${shortMonth(m)}: no value`}>—</td>
                    const how = c.source === 'published' ? 'as published' : 'recomputed from ratio history with the limits in force that month'
                    return (
                      <td key={m} className={c.source === 'published' ? 'is-published' : 'is-recomputed'} data-source={c.source ?? ''}
                        title={`${shortMonth(m)}: ${CELL_WORD[c.status] ?? c.status}, ${how}`} tabIndex={c.source === 'recomputed' ? 0 : undefined}
                        aria-label={`${shortMonth(m)}: ${CELL_WORD[c.status] ?? c.status}, ${how}`}>
                        <StatusPill tone={CELL_TONE[c.status] ?? 'neutral'} size="sm">{CELL_WORD[c.status] ?? c.status}</StatusPill>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function restatedKind(field: string, v: number | null): NumKind {
  if (HISTORY_LABELS[field]) return historyKind(field)
  return v !== null && Math.abs(v) >= 1000 ? 'money' : 'ratio'
}
export function RestatementsSection({ ins }: { ins: CompanyInsights }) {
  type R = CompanyInsights['restatements'][number]
  const cols: Column<R>[] = [
    { key: 'month', header: 'Month', render: r => (/^\d{4}-\d{2}$/.test(r.month) ? shortMonth(r.month) : r.month) },
    { key: 'field', header: 'Field', render: r => fieldLabel(r.field) },
    { key: 'first', header: 'First reported', numeric: true, render: r => <Num v={r.first_reported} kind={restatedKind(r.field, r.first_reported)} /> },
    { key: 'now', header: 'Now', numeric: true, render: r => <Num v={r.now} kind={restatedKind(r.field, r.now)} /> },
    { key: 'changed', header: 'Changed in', render: r => (/^\d{4}-\d{2}$/.test(r.changed_in) ? `${r.changed_in} report` : `Applied ${r.changed_in}`) },
    { key: 'type', header: 'Type', render: r => (r.type === 'tao_correction'
      ? <StatusPill tone="dpv" size="sm">TAO correction</StatusPill>
      : <StatusPill tone="blue" size="sm">Restated by company</StatusPill>) },
  ]
  return (
    <Section id="restatements" title="Restatements and corrections" subtitle="Figures changed after they were first reported">
      <DataTable caption="Restatements and corrections" captionHidden density="compact" columns={cols} rows={ins.restatements} rowKey={(r, i) => `${r.month}-${r.field}-${i}`}
        empty={{ title: 'Nothing restated', message: 'No figure in this deal has changed since it was first reported.' }} />
    </Section>
  )
}

const SENTIMENT: Record<string, { tone: 'ok' | 'neutral' | 'bad'; word: string }> = {
  positive: { tone: 'ok', word: 'Positive' }, neutral: { tone: 'neutral', word: 'Neutral' }, negative: { tone: 'bad', word: 'Negative' },
}
const SOURCE: Record<string, string> = { google_news: 'Google News', gdelt: 'GDELT', fixture: 'Test fixture' }

export function NewsSection({ items, screened }: { items: NewsItem[] | null | 'error'; screened: boolean | null }) {
  const [only, setOnly] = useState<'all' | 'negative'>('all')
  const list = Array.isArray(items) ? items.filter(n => only === 'all' || n.sentiment === 'negative') : []
  const week = Array.isArray(items) ? items.filter(n => Date.now() - Date.parse(n.found_at) <= 7 * 864e5).length : 0
  return (
    <Section id="news" title="Latest news"
      subtitle={`Daily search of free news sources by company name and aliases · last 30 days${Array.isArray(items) ? ` · ${week} new this week` : ''} · sentiment from our keyword screening`}
      actions={
        <div className="co-toggle" role="group" aria-label="Filter news">
          <button type="button" aria-pressed={only === 'all'} onClick={() => setOnly('all')}>All</button>
          <button type="button" aria-pressed={only === 'negative'} onClick={() => setOnly('negative')}>Negative</button>
        </div>
      }>
      {items === null ? <p className="pf-muted">Loading news…</p>
        : items === 'error' ? <p className="co-err" role="alert">The news could not be loaded.</p>
        : items.length === 0 ? <p className="pf-muted">{screened === false ? 'Not screened yet. The daily news search has not covered this company.' : 'No news in 30 days.'}</p>
        : list.length === 0 ? <p className="pf-muted">No negative news in 30 days.</p>
        : (
          <ul className="co-items" aria-label="News items">
            {list.map(n => {
              const s = SENTIMENT[n.sentiment] ?? SENTIMENT.neutral
              return (
                <li key={n.id} className="co-item">
                  <span className="co-item__when">{fmtDay(n.published_at ?? n.found_at)}</span>
                  <div>
                    <div className="co-item__title">{n.title}</div>
                    <div className="co-item__meta">
                      <StatusPill tone={s.tone} size="sm">{s.word}</StatusPill>
                      <span>{n.publisher ?? 'Unknown publisher'} · {SOURCE[n.source] ?? n.source}</span>
                      <a href={n.url} target="_blank" rel="noopener noreferrer">Open source<span className="ds-visually-hidden"> (opens in a new tab)</span></a>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
    </Section>
  )
}

const CATS = ['litigation', 'regulatory', 'fraud', 'insolvency', 'sanctions'] as const
const CAT_WORD: Record<string, string> = { litigation: 'Litigation', regulatory: 'Regulatory', fraud: 'Fraud', insolvency: 'Insolvency', sanctions: 'Sanctions' }
const STATE: Record<string, { tone: 'warn' | 'ok' | 'neutral'; word: string }> = {
  open: { tone: 'warn', word: 'Open' }, reviewed: { tone: 'ok', word: 'Reviewed' }, dismissed: { tone: 'neutral', word: 'Dismissed' },
}

export function AdverseSection({ items, row, partnerView, admin, onAct }: {
  items: AdverseItem[] | null | 'error'; row: CompanyRow | null; partnerView: boolean; admin: boolean
  onAct: (item: AdverseItem, action: 'review' | 'dismiss') => void
}) {
  // Partners see reviewed items only (decision D6); "View as partner" hides the rest the same way.
  const visible = Array.isArray(items) ? items.filter(a => !partnerView || a.state === 'reviewed') : []
  const open = Array.isArray(items) ? items.filter(a => a.state === 'open').length : 0
  const counted = visible.filter(a => a.state !== 'dismissed')
  const state = row?.adverse.state === 'not_screened' ? 'not_screened' : !partnerView && open ? 'to_review' : 'clear'
  const pill = state === 'not_screened' ? <StatusPill tone="neutral">Not screened</StatusPill>
    : state === 'to_review' ? <StatusPill tone="warn">{open} to review</StatusPill> : <StatusPill tone="ok">Clear</StatusPill>
  type R = AdverseItem
  const cols: Column<R>[] = [
    { key: 'date', header: 'Date', render: a => <span className="pf-nowrap">{fmtDay(a.found_at)}</span> },
    { key: 'cat', header: 'Category', render: a => CAT_WORD[a.category] ?? a.category },
    { key: 'item', header: 'Item', render: a => (
      <span className="co-name"><span>{a.title}</span>
        <small>{a.publisher ?? 'Unknown publisher'} · <a href={a.url} target="_blank" rel="noopener noreferrer">Open source<span className="ds-visually-hidden"> (opens in a new tab)</span></a></small>
      </span>
    ) },
    { key: 'state', header: 'State', render: a => <StatusPill tone={STATE[a.state].tone} size="sm">{STATE[a.state].word}</StatusPill> },
    { key: 'by', header: 'Reviewed by', render: a => (a.state_by
      ? <span className="co-name"><span>{a.state_by.name} · {fmtDay(a.state_at)}</span>{a.note && <small>{a.note}</small>}</span>
      : admin && !partnerView && a.state === 'open'
        ? <span className="pf-actions">
            <Button size="sm" variant="primary" onClick={() => onAct(a, 'review')} aria-label={`Mark reviewed: ${a.title}`}>Mark reviewed</Button>
            <Button size="sm" onClick={() => onAct(a, 'dismiss')} aria-label={`Dismiss: ${a.title}`}>Dismiss</Button>
          </span>
        : <span className="pf-muted">—</span>) },
  ]
  return (
    <Section id="adverse" title="Adverse media screening"
      subtitle={partnerView ? 'Items TAO has reviewed. Daily keyword screening of news in five categories.' : 'Daily keyword screening of news in five categories. New hits arrive as Open; only TAO Admin marks them reviewed or dismisses them.'}
      actions={pill}>
      <div className="pf-stack">
        <p className="co-hint">
          Categories: {CATS.map(c => `${CAT_WORD[c]} ${counted.filter(a => a.category === c).length}`).join(' · ')}.{' '}
          “Sanctions” is a keyword hit in news text, not a check against sanctions lists.
        </p>
        {items === null ? <p className="pf-muted">Loading screening results…</p>
          : items === 'error' ? <p className="co-err" role="alert">The screening results could not be loaded.</p>
          : <DataTable caption="Adverse media items" captionHidden density="compact" columns={cols} rows={visible} rowKey={a => a.id}
              empty={{ title: state === 'not_screened' ? 'Not screened yet' : 'Nothing found', message: state === 'not_screened' ? 'The daily screening has not covered this company yet.' : partnerView ? 'No reviewed items.' : 'No adverse media items for this company.' }} />}
      </div>
    </Section>
  )
}

export function DocumentsSection({ d, href, tao, linkLabel }: { d: Deal; href: string; tao: boolean; linkLabel: string }) {
  const periods = (Array.isArray(d.available_periods) && d.available_periods.length ? d.available_periods : [d.published_period as string | undefined])
    .filter((p): p is string => typeof p === 'string').sort().reverse()
  type R = { period: string; name: string }
  const rows: R[] = periods.map(p => ({ period: p, name: p === d.published_period && d.source_file ? d.source_file : `${formatPeriod(p)} SetRep` }))
  const cols: Column<R>[] = [
    { key: 'doc', header: 'Document', emphasis: true, render: r => r.name },
    { key: 'type', header: 'Type', render: () => 'SetRep' },
    { key: 'period', header: 'Period', render: r => formatPeriod(r.period) },
    { key: 'visible', header: 'Visible to', render: () => (tao ? 'TAO, partners' : 'You') },
    { key: 'open', header: '', ariaLabel: 'Open', align: 'right', render: () => <Button as="link" size="sm" to={href}>{linkLabel}</Button> },
  ]
  return (
    <Section id="documents" title="Documents" subtitle={`Settlement reports for ${d.deal_name.replace(/\.$/, '')}. Other documents (agreements, financials) cannot be uploaded here yet.`}>
      <DataTable caption="Documents" captionHidden density="compact" columns={cols} rows={rows} rowKey={r => r.period}
        empty={{ title: 'No reports yet', message: 'Settlement reports appear here once published.' }} />
    </Section>
  )
}
