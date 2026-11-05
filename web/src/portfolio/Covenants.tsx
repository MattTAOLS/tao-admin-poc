import { CovenantPill, DataTable, type Column } from '@/design/components'
import { TREND, covKind } from './fmt'
import { Num } from './Num'
import { covenantTrendTone } from './polarity'
import type { Covenant } from './types'

const JUDGED = { good: 'better', bad: 'worse' } as const

/** The published trend word with its arrow. The colour comes from the covenant's kind (ceiling: falling is better;
 * floor: rising is better; binary: no colour); flat and n/a are grey. The trend itself is never recomputed. The word
 * stays Rising / Falling / Flat; "better" / "worse" goes only in the tooltip and screen-reader text (decision A2). */
export function Trend({ trend, kind }: { trend: string; kind?: string }) {
  const t = TREND[trend]
  if (!t) return <span className="pf-muted">n/a</span>
  const tone = covenantTrendTone(kind, trend)
  const judged = tone === 'good' || tone === 'bad' ? JUDGED[tone] : undefined
  const cls = trend === 'flat' ? 'pf-trend pf-trend--flat' : judged ? `pf-trend pf-trend--${tone}` : 'pf-trend'
  return (
    <span className={cls} title={judged ? `${t.word}: ${judged} for this covenant` : t.word}>
      <span aria-hidden="true">{t.arrow} </span>{t.word}{judged && <span className="ds-visually-hidden">, {judged}</span>}
    </span>
  )
}

const KIND_WORD: Record<string, string> = { ceiling: 'Ceiling: must not exceed the threshold', floor: 'Floor: must stay at or above the threshold', binary: 'Yes / no test reported by the servicer' }

/** Covenant detail: what the test says, its numbers this period and last period. `field` prefixes the data-field
 * paths, e.g. "deals.3.covenants.2". */
export function CovenantDetail({ c, prior, field, priorField, status }: { c: Covenant; prior?: Covenant; field: string; priorField?: string; status?: string }) {
  const kind = covKind(c)
  return (
    <div className="pf-covdetail">
      <p className="pf-covdesc">{c.description}</p>
      <dl className="pf-dl pf-dl--wide">
        <dt>Legal reference</dt><dd>{c.legal_ref}</dd>
        <dt>Category</dt><dd>{c.category}</dd>
        <dt>Test</dt><dd>{KIND_WORD[c.kind] ?? c.kind}</dd>
        <dt>Value</dt><dd><Num v={c.current_value} kind={kind} field={`${field}.current_value`} /></dd>
        <dt>{c.kind === 'floor' ? 'Minimum' : 'Threshold'}</dt><dd><Num v={c.threshold} kind={kind} field={`${field}.threshold`} /></dd>
        <dt>Utilization</dt><dd><Num v={c.utilization_pct} kind="pct" field={`${field}.utilization_pct`} /></dd>
        <dt>Status</dt><dd><CovenantPill status={status ?? c.status} size="sm" />{status && status !== c.status && <span className="pf-muted"> (published: {c.status})</span>}</dd>
        {c.worst_vintage && <><dt>Worst vintage</dt><dd>{c.worst_vintage}</dd></>}
        {prior && <>
          <dt>Last period</dt>
          <dd><Num v={prior.current_value} kind={kind} field={priorField ? `${priorField}.current_value` : undefined} /> · <CovenantPill status={prior.status} size="sm" /></dd>
        </>}
        {c.note && <><dt>Note</dt><dd>{c.note}</dd></>}
      </dl>
    </div>
  )
}

type Row = { c: Covenant; i: number }

/** Deal page covenant table with legal reference and description. */
export function CovenantTable({ covenants }: { covenants: Covenant[] }) {
  const rows: Row[] = covenants.map((c, i) => ({ c, i }))
  const cols: Column<Row>[] = [
    { key: 'ref', header: 'Legal ref', render: r => <span className="pf-nowrap">{r.c.legal_ref}</span>, width: 120 },
    { key: 'desc', header: 'Covenant', render: r => <><div>{r.c.description}</div><div className="pf-muted pf-small">{r.c.category}{r.c.note ? ` · ${r.c.note}` : ''}</div></> },
    { key: 'value', header: 'Value', numeric: true, render: r => <Num v={r.c.current_value} kind={covKind(r.c)} field={`covenants.${r.i}.current_value`} /> },
    { key: 'threshold', header: 'Threshold', numeric: true, render: r => <>{r.c.kind === 'floor' && <span className="pf-muted pf-small">min </span>}<Num v={r.c.threshold} kind={covKind(r.c)} field={`covenants.${r.i}.threshold`} /></> },
    { key: 'util', header: 'Utilization', numeric: true, render: r => <Num v={r.c.utilization_pct} kind="pct" field={`covenants.${r.i}.utilization_pct`} /> },
    { key: 'trend', header: 'Trend', render: r => <Trend trend={r.c.trend} kind={r.c.kind} /> },
    { key: 'status', header: 'Status', render: r => <CovenantPill status={r.c.status} size="sm" /> },
  ]
  return <DataTable columns={cols} rows={rows} rowKey={r => String(r.i)} caption="Covenant tests" captionHidden density="compact" />
}
