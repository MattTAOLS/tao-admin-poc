import type { ReactNode } from 'react'
import { SeverityPill, FindingStatusPill, type Severity, type FindingStatus } from './StatusPill'
import { formatByUnit, formatDiffByUnit, formatNumber, type ValueUnit } from './format'

/** The fields of contracts/finding.schema.json the card renders. A Finding from the API fits this type as is. */
export type FindingView = {
  id: string
  rule_id: string
  layer?: 'structural' | 'arithmetic' | 'cross_period' | 'cross_source' | 'covenant' | 'reasonableness' | string
  severity: Severity
  message: string
  fields?: string[]
  our_value?: number | string | boolean | null
  report_value?: number | string | boolean | null
  difference?: number | null
  tolerance?: number | null
  unit?: ValueUnit
  source_page?: number | null
  context?: Record<string, unknown>
  status: FindingStatus
  resolution?: { by: string; at: string; choice: string; reason?: string | null } | null
}

export type FindingCardProps = {
  finding: FindingView
  /** Rule title from contracts/rules.yaml, e.g. "Roll-forward closes". */
  ruleTitle?: ReactNode
  /** Page crop slot: an <img> of /uploads/{id}/pages/{n}.png, a zoom button, or a skeleton. The page fetches it. */
  crop?: ReactNode
  /** Action slot: Use ours / Use report / Accept restatement / Acknowledge buttons. Omit for read-only (analysts). */
  actions?: ReactNode
  /** Formats a `context` value; defaults to the finding unit for numbers. */
  formatContext?: (key: string, value: unknown) => ReactNode
  /** Heading level of the rule line inside a list; defaults to h3. */
  headingLevel?: 3 | 4
  className?: string
}

const LAYER: Record<string, string> = {
  structural: 'Structural', arithmetic: 'Arithmetic', cross_period: 'Cross-period', cross_source: 'Cross-source',
  covenant: 'Covenant', reasonableness: 'Reasonableness',
}
const CHOICE: Record<string, string> = {
  use_ours: 'Used our value', use_report: 'Used the report value', restatement: 'Accepted as restatement', reject: 'Rejected', acknowledge: 'Acknowledged',
}

/** Context numbers follow the finding unit, except that a percent_points finding can also carry amounts (R10's
 * enhancement_amount and base): only fractions (|v| <= 1) are shown as percentages, larger numbers as plain numbers. */
export function formatContextNumber(v: number, unit: ValueUnit) {
  if (unit === 'percent_points' && Math.abs(v) > 1) return formatNumber(v, Number.isInteger(v) ? 0 : 2)
  return formatByUnit(v, unit)
}

const humanKey = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

/** One validation finding: rule id, severity, message, ours vs report with the difference, the arithmetic from
 * `context`, a page-crop slot and an action slot. Renders exactly the finding fields; computes nothing. */
export function FindingCard({ finding: f, ruleTitle, crop, actions, formatContext, headingLevel = 3, className }: FindingCardProps) {
  const H = headingLevel === 4 ? 'h4' : 'h3'
  const resolved = f.status !== 'open'
  const hasValues = f.our_value !== undefined || f.report_value !== undefined || f.difference != null
  const withinTol = f.difference != null && f.tolerance != null && Math.abs(f.difference) <= f.tolerance
  const fmtCtx = formatContext ?? ((_k: string, v: unknown) =>
    typeof v === 'number' ? formatContextNumber(v, f.unit) : typeof v === 'boolean' || typeof v === 'string' ? formatByUnit(v, f.unit) : v == null ? '—' : JSON.stringify(v))
  const ctx = f.context ? Object.entries(f.context) : []
  const titleId = `finding-${f.id}-title`

  return (
    <article className={['ds-finding', `ds-finding--${f.severity}`, resolved && 'ds-finding--resolved', className].filter(Boolean).join(' ')} aria-labelledby={titleId}>
      <div className="ds-finding__main">
        <div className="ds-finding__head">
          <span className="ds-finding__rule">{f.rule_id}</span>
          <SeverityPill severity={f.severity} size="sm" />
          <H id={titleId} className="ds-finding__title" style={{ margin: 0, fontSize: 13.5 }}>
            {ruleTitle ?? f.rule_id}
            <span className="ds-visually-hidden">, {f.severity}</span>
          </H>
          {f.layer && <span className="ds-finding__layer">{LAYER[f.layer] ?? f.layer}</span>}
          <FindingStatusPill status={f.status} size="sm" className="ds-finding__status" />
        </div>
        <p className="ds-finding__msg">{f.message}</p>

        {hasValues && (
          <div className="ds-finding__values" role="group" aria-label="Values">
            <span className="ds-finding__vlabel">Ours</span>
            <span className="ds-finding__vlabel">Report</span>
            <span className="ds-finding__vlabel">Difference</span>
            <span className="ds-finding__vlabel">Tolerance</span>
            <span className="ds-finding__v ds-finding__v--ours" data-testid="our-value">{formatByUnit(f.our_value, f.unit)}</span>
            <span className="ds-finding__v" data-testid="report-value">{formatByUnit(f.report_value, f.unit)}</span>
            <span className={['ds-finding__v', f.difference != null && (withinTol ? 'ds-finding__v--diff-ok' : 'ds-finding__v--diff-bad')].filter(Boolean).join(' ')} data-testid="difference">
              {formatDiffByUnit(f.difference, f.unit)}
              {f.difference != null && f.tolerance != null && <span className="ds-visually-hidden">{withinTol ? ' within tolerance' : ' outside tolerance'}</span>}
            </span>
            <span className="ds-finding__v" data-testid="tolerance">{f.tolerance != null ? '±' + formatByUnit(f.tolerance, f.unit) : '—'}</span>
          </div>
        )}

        {ctx.length > 0 && (
          <dl className="ds-finding__ctx">
            {ctx.map(([k, v]) => <Fragmentish key={k} k={humanKey(k)} v={fmtCtx(k, v)} />)}
          </dl>
        )}

        {(f.source_page != null || (f.fields && f.fields.length > 0)) && (
          <div className="ds-finding__meta">
            {f.source_page != null && <span>Source page {f.source_page}</span>}
            {f.fields && f.fields.length > 0 && <span>Fields {f.fields.map((x, i) => <code key={x}>{i > 0 && ', '}{x}</code>)}</span>}
          </div>
        )}

        {f.resolution && (
          <div className="ds-finding__resolution">
            <b>{CHOICE[f.resolution.choice] ?? f.resolution.choice}</b> by {f.resolution.by} · {f.resolution.at.slice(0, 16).replace('T', ' ')}
            {f.resolution.reason && <> · “{f.resolution.reason}”</>}
          </div>
        )}

        {actions && <div className="ds-finding__actions">{actions}</div>}
      </div>

      <aside className="ds-finding__crop" aria-label={f.source_page != null ? `Report page ${f.source_page}` : 'Report page'}>
        <span className="ds-finding__croplabel">{f.source_page != null ? `Page ${f.source_page}` : 'Page'}</span>
        {crop ?? <div className="ds-finding__cropempty">{f.source_page != null ? 'Page image not loaded' : 'No source page for this finding'}</div>}
      </aside>
    </article>
  )
}

function Fragmentish({ k, v }: { k: string; v: ReactNode }) {
  return <><dt>{k}</dt><dd>{v}</dd></>
}
