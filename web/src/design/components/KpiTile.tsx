import type { ReactNode } from 'react'
import { SkeletonBlock } from './SkeletonBlock'

export type KpiTileProps = {
  /** Small uppercase label, e.g. "Tranche balance". */
  label: ReactNode
  /** The big number, already formatted (use formatCurrency / formatPercent). Missing shows an em dash. */
  value?: ReactNode
  /** Small muted suffix after the number, e.g. "/ 60" or "deals". */
  unit?: ReactNode
  /** One line of context under the number, e.g. "2 critical · 2 warning" or "as of Jul 2026". */
  context?: ReactNode
  /** Change versus prior period, shown before the context. `direction` picks the arrow. `tone` picks the colour:
   * whether the move is good or bad for this metric (good green, bad red, neutral grey) and adds "better" / "worse"
   * to the tooltip and screen-reader text. Without `tone` the colour follows the direction (up green, down red). */
  delta?: { value: ReactNode; direction: 'up' | 'down' | 'flat'; label?: string; tone?: DeltaTone }
  /** Colours the number. Pair it with a word in `context`; colour never carries meaning alone. */
  tone?: 'ok' | 'warn' | 'bad' | 'dpv'
  /** Something small next to the label, e.g. a StatusPill. */
  adornment?: ReactNode
  loading?: boolean
  className?: string
}

export type DeltaTone = 'good' | 'bad' | 'neutral'

const ARROW = { up: '▲', down: '▼', flat: '■' }
const SPOKEN = { up: 'Up', down: 'Down', flat: 'Unchanged' }
const JUDGED = { good: 'better', bad: 'worse' } as const

/** Big number, label, one line of context: the tiles across the top of every dashboard. */
export function KpiTile({ label, value, unit, context, delta, tone, adornment, loading = false, className }: KpiTileProps) {
  return (
    <div className={['ds-kpi', className].filter(Boolean).join(' ')} aria-busy={loading || undefined}>
      <div className="ds-kpi__label">{label}{adornment}</div>
      {loading ? (
        <>
          <SkeletonBlock width="55%" height={28} style={{ marginTop: 8 }} />
          <SkeletonBlock width="75%" height={10} style={{ marginTop: 10 }} />
          <span className="ds-visually-hidden">Loading</span>
        </>
      ) : (
        <>
          <div className={['ds-kpi__value', tone && `ds-kpi__value--${tone}`].filter(Boolean).join(' ')}>
            {value ?? '—'}{unit !== undefined && <span className="ds-kpi__unit"> {unit}</span>}
          </div>
          {(context || delta) && (
            <div className="ds-kpi__context">
              {delta && (() => {
                const judged = delta.tone === 'good' || delta.tone === 'bad' ? JUDGED[delta.tone] : undefined
                const spoken = delta.label ?? SPOKEN[delta.direction]
                return (
                  <span className={`ds-kpi__delta ds-kpi__delta--${delta.tone ?? delta.direction}`}
                    title={judged ? `${SPOKEN[delta.direction]}: ${judged}` : undefined}>
                    <span aria-hidden="true">{ARROW[delta.direction]} </span>
                    <span className="ds-visually-hidden">{spoken} </span>
                    {delta.value}
                    {judged && <span className="ds-visually-hidden">, {judged}</span>}
                  </span>
                )
              })()}
              {delta && context && ' · '}
              {context}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Responsive row of tiles (auto-fit, min 180 px each). */
export function KpiRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['ds-kpi-row', className].filter(Boolean).join(' ')}>{children}</div>
}
