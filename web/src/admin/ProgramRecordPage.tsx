import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button, Card, DataTable, Field, Select, SkeletonBlock, StatePanel, StatusPill, formatCurrency, formatPercent, icons, type Column, type Tone,
} from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { adminApi, programPartners, type CovenantChange, type CovenantChangeResult, type CovenantDefinition, type Deal } from './data'
import { canEditMaster, useResource, useRole } from './hooks'
import {
  HISTORY_KIND, covenantHistory, covenantKey, isCurrent, lastChangeText, partnerLabel, thresholdText, versionStates, type VersionState,
} from './master'
import { CovenantDialog, DealDialog, ProgramDialog, changeSavedText, type CovenantMode } from './MasterDialogs'
import { LoadError, formatDateTime } from './ui'
import { torontoDate } from './toronto'

const VERSION: Record<VersionState, { tone: Tone; label: string }> = {
  in_force: { tone: 'ok', label: 'In force' },
  superseded: { tone: 'neutral', label: 'Superseded' },
  scheduled: { tone: 'blue', label: 'Scheduled' },
}
/** Covenant dates are Toronto business dates: at 23:30 Toronto on the 31st it is still the 31st, not UTC's 1st. */
const today = () => torontoDate()
const UNIT = { fraction: 'Fraction', ratio: 'Ratio', currency: 'Currency' } as const

/** Program / facility record: limits, deals with template id, covenant definitions with threshold or banded
 * threshold_rule, effective_from and source. tao_admin edits through the PUT routes; other roles read only. */
export default function ProgramRecordPage() {
  const { partnerId = '', programId = '' } = useParams()
  const nav = useNavigate()
  const role = useRole()
  const canEdit = canEditMaster(role)
  // include_history: superseded rows feed the per-covenant History panel; the table shows current rows only.
  const res = useResource(() => Promise.all([adminApi.programs(), adminApi.deals(programId), adminApi.covenants(undefined, true), adminApi.partners()]), [programId, role])
  const partners = res.data?.[3] ?? []
  const program = res.data?.[0].find(p => p.slug === programId && programPartners(p).includes(partnerId))
  const pName = partnerLabel(partners, partnerId)
  usePageHeader({
    title: program?.name ?? 'Program / facility record', subtitle: program ? `${pName} · program / facility record` : undefined,
    crumbs: [{ label: 'TAO Admin' }, { label: 'Partners', href: '/admin/partners' }, { label: pName, href: `/admin/partners/${encodeURIComponent(partnerId)}` }, { label: program?.name ?? programId }],
  })
  const [dealFilter, setDealFilter] = useState('')
  const [editProgram, setEditProgram] = useState(false)
  const [editDeal, setEditDeal] = useState<Deal>()
  const [covenantMode, setCovenantMode] = useState<CovenantMode>()
  const [historyOpen, setHistoryOpen] = useState<Set<string>>(new Set())
  const [lastSave, setLastSave] = useState<{ title: string; message?: string }>()

  if (res.error) return <LoadError error={res.error} onRetry={res.reload} />
  if (res.loading && !res.data) return <div className="adm-stack" aria-busy="true"><Card><SkeletonBlock lines={3} /></Card><Card><SkeletonBlock lines={5} /></Card><span className="ds-visually-hidden">Loading program</span></div>
  if (!program) {
    return <StatePanel kind="not-found" title="No such program" message={`${pName} has no program “${programId}”.`}
      actions={<Button onClick={() => nav(`/admin/partners/${encodeURIComponent(partnerId)}`)}>Back to {pName}</Button>} />
  }
  const deals = res.data![1].filter(d => d.program_slug === program.slug).sort((a, b) => a.name.localeCompare(b.name))
  const dealSlugs = new Set(deals.map(d => d.slug))
  const all = res.data![2].filter(c => dealSlugs.has(c.deal_slug))
  const defs = all.filter(isCurrent)
  const states = versionStates(defs, today())
  const shown = defs.filter(c => !dealFilter || c.deal_slug === dealFilter)
    .sort((a, b) => a.deal_slug.localeCompare(b.deal_slug) || a.legal_ref.localeCompare(b.legal_ref, undefined, { numeric: true }) || b.effective_from.localeCompare(a.effective_from))
  const dealName = (slug: string) => deals.find(d => d.slug === slug)?.name ?? slug
  const saved = (close: () => void) => () => { close(); res.reload() }
  const rowId = (c: CovenantDefinition) => c.id ?? `${c.deal_slug}-${c.legal_ref}-${c.effective_from}`
  // One History control per covenant: on its first (newest) row in the table.
  const firstOfGroup = new Set<CovenantDefinition>()
  { const seen = new Set<string>(); for (const c of shown) if (!seen.has(covenantKey(c))) { seen.add(covenantKey(c)); firstOfGroup.add(c) } }
  const toggleHistory = (c: CovenantDefinition) => setHistoryOpen(o => { const n = new Set(o); if (n.has(rowId(c))) n.delete(rowId(c)); else n.add(rowId(c)); return n })
  const covenantSaved = (r: CovenantChangeResult, change: CovenantChange) => {
    setLastSave(changeSavedText(change.mode, change.legal_ref, r)); setCovenantMode(undefined); res.reload()
  }

  const dealCols: Column<Deal>[] = [
    { key: 'name', header: 'Deal', emphasis: true, render: d => d.name, sortValue: d => d.name },
    { key: 'servicer', header: 'Servicer', render: d => d.servicer },
    { key: 'template', header: 'Template id', render: d => <code className="adm-mono">{d.template_id}</code>, sortValue: d => d.template_id },
    { key: 'covenants', header: 'Covenants in force', numeric: true, render: d => String(defs.filter(c => c.deal_slug === d.slug && states.get(c) === 'in_force').length) },
    ...(canEdit ? [{ key: 'edit', header: 'Edit', ariaLabel: 'Edit', render: (d: Deal) => <Button size="sm" onClick={() => setEditDeal(d)} aria-label={`Edit ${d.name}`}>Edit</Button> } as Column<Deal>] : []),
  ]
  const covCols: Column<CovenantDefinition>[] = [
    { key: 'deal', header: 'Deal', emphasis: true, render: c => dealName(c.deal_slug), sortValue: c => dealName(c.deal_slug) },
    { key: 'ref', header: 'Legal ref', render: c => c.legal_ref, sortValue: c => c.legal_ref },
    { key: 'description', header: 'Description', render: c => c.description },
    { key: 'kind', header: 'Direction', render: c => (c.kind === 'floor' ? 'Floor' : 'Ceiling') },
    { key: 'threshold', header: 'Threshold', numeric: true, render: c => <span title={c.threshold_rule ? `on ${c.threshold_rule.on}` : undefined}>{thresholdText(c)}</span> },
    { key: 'unit', header: 'Unit', render: c => (c.unit ? UNIT[c.unit] : <span className="adm-muted">Not set</span>) },
    { key: 'buffer', header: 'Watch buffer', numeric: true, render: c => formatPercent(c.watch_buffer_pct ?? null, { decimals: 0 }) },
    { key: 'effective', header: 'Effective from', render: c => <time dateTime={c.effective_from}>{c.effective_from}</time>, sortValue: c => c.effective_from },
    { key: 'state', header: 'Version', render: c => { const v = VERSION[states.get(c) ?? 'in_force']; return <StatusPill tone={v.tone} size="sm">{v.label}</StatusPill> } },
    { key: 'last', header: 'Last change', render: c => <span className="adm-lastchange">{lastChangeText(c, all)}</span> },
    {
      key: 'actions', header: canEdit ? 'Actions' : 'History', ariaLabel: canEdit ? 'Actions' : 'History', render: c => {
        const label = `${c.legal_ref} for ${dealName(c.deal_slug)}`
        const open = historyOpen.has(rowId(c))
        return (
          <span className="adm-actions" style={{ flexWrap: 'nowrap' }}>
            {firstOfGroup.has(c) && <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => toggleHistory(c)} aria-label={`History of ${label}`}>History</Button>}
            {canEdit && <Button size="sm" onClick={() => { setLastSave(undefined); setCovenantMode({ kind: 'edit', def: c, versions: defs.filter(x => covenantKey(x) === covenantKey(c)) }) }}
              aria-label={`Edit ${c.legal_ref} from ${c.effective_from} for ${dealName(c.deal_slug)}`}>Edit</Button>}
          </span>
        )
      },
    },
  ]

  return (
    <div className="adm-stack">
      {!canEdit && <div className="adm-note" role="note">Read only. Only TAO Admin can change master data.</div>}
      <Card title="Limits and visibility" subtitle="Partners on the visibility list see this program in their portal."
        actions={canEdit ? <Button onClick={() => setEditProgram(true)} aria-label={`Edit limits and visibility for ${program.name}`}>Edit</Button> : undefined}>
        <dl className="adm-dl">
          <dt>Visible to</dt><dd>{programPartners(program).map(s => partnerLabel(partners, s)).join(', ')}</dd>
          <dt>Currency</dt><dd>{program.currency}</dd>
          <dt>Program limit</dt><dd className="adm-num">{formatCurrency(program.limit, { decimals: 0 })}</dd>
          <dt>Warehouse limit</dt><dd className="adm-num">{program.warehouse_limit == null ? 'None' : formatCurrency(program.warehouse_limit, { decimals: 0 })}</dd>
        </dl>
      </Card>
      <Card title="Deals" subtitle="Template id is the extraction mapping the worker uses for the deal’s reports." padding="flush">
        <DataTable columns={dealCols} rows={deals} rowKey={d => d.slug} caption={`${program.name} deals`} captionHidden
          empty={{ title: 'No deals in this program yet' }} />
      </Card>
      <Card title="Covenant definitions" padding="flush"
        subtitle="Versioned by effective date. R14 checks each report against the version in force on the last day of its collection period; an amendment with a later date is scheduled."
        actions={<div className="adm-actions">
          <Field label="Deal" className="adm-inline-field">
            <Select value={dealFilter} onChange={e => setDealFilter(e.target.value)}>
              <option value="">All deals</option>
              {deals.map(d => <option key={d.slug} value={d.slug}>{d.name}</option>)}
            </Select>
          </Field>
          {canEdit && <Button icon={<icons.IconPlus width={16} height={16} />} onClick={() => { setLastSave(undefined); setCovenantMode({ kind: 'add', dealSlug: dealFilter || undefined }) }}>Add covenant</Button>}
        </div>}>
        {lastSave && <div className="adm-note" role="status" style={{ margin: '0 18px 12px' }}><b>{lastSave.title}.</b> {lastSave.message}</div>}
        {/* The covenant table is wider than the card at common widths (about 1,480 px of columns); it scrolls sideways
            inside the card so Edit and History stay reachable (QA bug report, wave B). */}
        <div className="adm-hscroll" tabIndex={0} role="region" aria-label="Covenant definitions table, scrolls sideways">
        <DataTable columns={covCols} rows={shown} rowKey={rowId} caption="Covenant definitions" captionHidden
          renderExpanded={c => (firstOfGroup.has(c) ? <CovenantHistory rows={all.filter(x => covenantKey(x) === covenantKey(c))} title={`${dealName(c.deal_slug)} · ${c.legal_ref} ${c.description}`} /> : null)}
          expandedKeys={historyOpen} onExpandedChange={setHistoryOpen} rowLabel={c => `history of ${c.legal_ref} for ${dealName(c.deal_slug)}`}
          empty={{ title: 'No covenant definitions', message: dealFilter ? 'None for this deal yet.' : 'None for this program’s deals yet.' }} />
        </div>
      </Card>
      {editProgram && <ProgramDialog program={program} partners={partners} onClose={() => setEditProgram(false)} onSaved={saved(() => setEditProgram(false))} />}
      {editDeal && <DealDialog deal={editDeal} onClose={() => setEditDeal(undefined)} onSaved={saved(() => setEditDeal(undefined))} />}
      {covenantMode && <CovenantDialog mode={covenantMode} deals={deals} onClose={() => { setCovenantMode(undefined); res.reload() }} onSaved={covenantSaved} />}
    </div>
  )
}

/** Version history of one covenant (every row of the deal + legal ref, superseded ones included), newest first:
 * when, who, old → new per field, the effective date, the kind of change and the reason. */
function CovenantHistory({ rows, title }: { rows: CovenantDefinition[]; title: string }) {
  const entries = covenantHistory(rows)
  return (
    <div className="adm-covhist">
      <h3 className="adm-covhist__title">Version history · {title}</h3>
      <table className="adm-ba" aria-label={`Version history · ${title}`}>
        <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Change</th><th scope="col">Effective from</th><th scope="col">Kind</th><th scope="col">Reason</th></tr></thead>
        <tbody>
          {entries.map((h, i) => {
            let change: ReactNode
            if (h.created) change = <span>Created: {h.created}{h.row.source ? <><br /><span className="adm-muted">Source: {h.row.source}</span></> : null}</span>
            else if (h.changes.length) {
              change = (
                <span className="adm-covhist__change">
                  {h.changes.map(x => (
                    <span key={x.field}>{x.field} <span className="adm-before">{x.before}</span><span className="adm-arrow" aria-label="changed to">→</span><span className="adm-after">{x.after}</span></span>
                  ))}
                </span>
              )
            } else change = <span className="adm-muted">No field changed</span>
            return (
              <tr key={h.row.id ?? i}>
                <td className="adm-nowrap">{h.kind === 'seed' && !h.at ? 'Seed load' : formatDateTime(h.at)}</td>
                <td>{h.who}</td>
                <td>{change}</td>
                <td><time dateTime={h.row.effective_from}>{h.row.effective_from}</time></td>
                <td>{HISTORY_KIND[h.kind]}{h.replacedAt ? <><br /><span className="adm-muted">replaced {formatDateTime(h.replacedAt)}</span></> : null}</td>
                <td>{h.reason}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
