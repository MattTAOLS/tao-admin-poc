import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button, Card, DataTable, Field, Select, SkeletonBlock, StatePanel, StatusPill, formatCurrency, formatPercent, icons, type Column, type Tone,
} from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { adminApi, programPartners, type CovenantDefinition, type Deal } from './data'
import { canEditMaster, useResource, useRole } from './hooks'
import { partnerLabel, thresholdText, versionStates, type VersionState } from './master'
import { CovenantDialog, DealDialog, ProgramDialog, type CovenantMode } from './MasterDialogs'
import { LoadError } from './ui'

const VERSION: Record<VersionState, { tone: Tone; label: string }> = {
  in_force: { tone: 'ok', label: 'In force' },
  superseded: { tone: 'neutral', label: 'Superseded' },
  scheduled: { tone: 'blue', label: 'Scheduled' },
}
const today = () => new Date().toISOString().slice(0, 10)

/** Program / facility record: limits, deals with template id, covenant definitions with threshold or banded
 * threshold_rule, effective_from and source. tao_admin edits through the PUT routes; other roles read only. */
export default function ProgramRecordPage() {
  const { partnerId = '', programId = '' } = useParams()
  const nav = useNavigate()
  const role = useRole()
  const canEdit = canEditMaster(role)
  const res = useResource(() => Promise.all([adminApi.programs(), adminApi.deals(programId), adminApi.covenants(), adminApi.partners()]), [programId, role])
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

  if (res.error) return <LoadError error={res.error} onRetry={res.reload} />
  if (res.loading && !res.data) return <div className="adm-stack" aria-busy="true"><Card><SkeletonBlock lines={3} /></Card><Card><SkeletonBlock lines={5} /></Card><span className="ds-visually-hidden">Loading program</span></div>
  if (!program) {
    return <StatePanel kind="not-found" title="No such program" message={`${pName} has no program “${programId}”.`}
      actions={<Button onClick={() => nav(`/admin/partners/${encodeURIComponent(partnerId)}`)}>Back to {pName}</Button>} />
  }
  const deals = res.data![1].filter(d => d.program_slug === program.slug).sort((a, b) => a.name.localeCompare(b.name))
  const dealSlugs = new Set(deals.map(d => d.slug))
  const defs = res.data![2].filter(c => dealSlugs.has(c.deal_slug))
  const states = versionStates(defs, today())
  const shown = defs.filter(c => !dealFilter || c.deal_slug === dealFilter)
    .sort((a, b) => a.deal_slug.localeCompare(b.deal_slug) || a.legal_ref.localeCompare(b.legal_ref, undefined, { numeric: true }) || b.effective_from.localeCompare(a.effective_from))
  const dealName = (slug: string) => deals.find(d => d.slug === slug)?.name ?? slug
  const saved = (close: () => void) => () => { close(); res.reload() }

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
    { key: 'kind', header: 'Kind', render: c => (c.kind === 'floor' ? 'Floor' : 'Ceiling') },
    { key: 'threshold', header: 'Threshold', numeric: true, render: c => <span title={c.threshold_rule ? `on ${c.threshold_rule.on}` : undefined}>{thresholdText(c)}</span> },
    { key: 'buffer', header: 'Watch buffer', numeric: true, render: c => formatPercent(c.watch_buffer_pct ?? null, { decimals: 0 }) },
    { key: 'effective', header: 'Effective from', render: c => <time dateTime={c.effective_from}>{c.effective_from}</time>, sortValue: c => c.effective_from },
    { key: 'state', header: 'Version', render: c => { const v = VERSION[states.get(c) ?? 'in_force']; return <StatusPill tone={v.tone} size="sm">{v.label}</StatusPill> } },
    { key: 'source', header: 'Source', render: c => c.source ?? '—' },
    ...(canEdit ? [{
      key: 'edit', header: 'Edit', ariaLabel: 'Edit', render: (c: CovenantDefinition) => (
        <span className="adm-actions" style={{ flexWrap: 'nowrap' }}>
          <Button size="sm" onClick={() => setCovenantMode({ kind: 'edit', def: c })} aria-label={`Edit ${c.legal_ref} for ${dealName(c.deal_slug)}`}>Edit</Button>
          <Button size="sm" onClick={() => setCovenantMode({ kind: 'version', def: c })} aria-label={`New version of ${c.legal_ref} for ${dealName(c.deal_slug)}`}>New version</Button>
        </span>
      ),
    } as Column<CovenantDefinition>] : []),
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
        subtitle="Versioned by effective date: the latest version on or before today is in force; an amendment with a later date is scheduled."
        actions={<div className="adm-actions">
          <Field label="Deal" className="adm-inline-field">
            <Select value={dealFilter} onChange={e => setDealFilter(e.target.value)}>
              <option value="">All deals</option>
              {deals.map(d => <option key={d.slug} value={d.slug}>{d.name}</option>)}
            </Select>
          </Field>
          {canEdit && <Button icon={<icons.IconPlus width={16} height={16} />} onClick={() => setCovenantMode({ kind: 'new', dealSlug: dealFilter || undefined })}>Add definition</Button>}
        </div>}>
        <DataTable columns={covCols} rows={shown} rowKey={(c, i) => c.id ?? `${c.deal_slug}-${c.legal_ref}-${c.effective_from}-${i}`} caption="Covenant definitions" captionHidden
          empty={{ title: 'No covenant definitions', message: dealFilter ? 'None for this deal yet.' : 'None for this program’s deals yet.' }} />
      </Card>
      {editProgram && <ProgramDialog program={program} partners={partners} onClose={() => setEditProgram(false)} onSaved={saved(() => setEditProgram(false))} />}
      {editDeal && <DealDialog deal={editDeal} onClose={() => setEditDeal(undefined)} onSaved={saved(() => setEditDeal(undefined))} />}
      {covenantMode && <CovenantDialog mode={covenantMode} deals={deals} onClose={() => setCovenantMode(undefined)} onSaved={saved(() => setCovenantMode(undefined))} />}
    </div>
  )
}
