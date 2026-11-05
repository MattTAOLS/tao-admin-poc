import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, StatusPill, DataTable, Dialog, Field, Select, StatePanel, UploadStatusPill, formatPeriod, useToast, type Column } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { ADMIN_PAGES } from '@/shell/pages'
import { access, errorText, reviewApi } from './lib/api'
import { useLoad } from './lib/useLoad'
import { useMasterNames } from './lib/master'
import { formatDateTime } from './lib/format'
import type { Program, Upload } from './lib/types'
import { reviewPath } from './QueuePage'
import { ReissueTag } from './components/Reissue'
import { CorrectedTag, CorrectionDialog, correctionPath } from './components/Corrections'
import './review.css'

const routeRegex = (pattern: string) => new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '/?$')
const registered = (path: string) => ADMIN_PAGES.some(p => routeRegex(p.path).test(path))

/** The admin-shell page that renders a published deal as partners see it. Uses the deepest portfolio route the shell
 * registers (deal, then program, then the portfolio summary), so the link never lands on "not found". */
export function partnerViewPath(u: Pick<Upload, 'program_slug' | 'deal_slug' | 'collection_period'>) {
  const q = `?period=${encodeURIComponent(u.collection_period)}`
  const deal = `/admin/portfolio/${encodeURIComponent(u.program_slug)}/deals/${encodeURIComponent(u.deal_slug)}`
  if (registered(deal)) return deal + q
  const program = `/admin/portfolio/${encodeURIComponent(u.program_slug)}`
  if (registered(program)) return program + q
  return '/admin/portfolio'
}

export default function ReportsLibraryPage() {
  const { tao, admin } = access()
  const [regen, setRegen] = useState(false)
  usePageHeader({
    title: 'Reports library',
    subtitle: 'Published reports by deal and period',
    actions: tao && admin ? <Button variant="primary" onClick={() => setRegen(true)}>Regenerate dashboard…</Button> : undefined,
  })
  if (!tao) return <StatePanel kind="no-access" />
  return <Library regenOpen={regen} onRegenClose={() => setRegen(false)} admin={admin} />
}

function Library({ regenOpen, onRegenClose, admin }: { regenOpen: boolean; onRegenClose: () => void; admin: boolean }) {
  const list = useLoad(() => reviewApi.uploads('published'), [])
  const { dealName, programName, programs, deals } = useMasterNames()
  const [program, setProgram] = useState('')
  const [deal, setDeal] = useState('')
  const [correcting, setCorrecting] = useState<Upload | null>(null)

  const rows = useMemo(() => (list.data ?? [])
    .filter(u => (!program || u.program_slug === program) && (!deal || u.deal_slug === deal))
    .sort((a, b) => programName(a.program_slug).localeCompare(programName(b.program_slug))
      || dealName(a.deal_slug).localeCompare(dealName(b.deal_slug))
      || b.collection_period.localeCompare(a.collection_period)),
  [list.data, program, deal, dealName, programName])

  if (list.error && !list.data) return <StatePanel kind="error" message={errorText(list.error)} actions={<Button onClick={() => list.reload()}>Retry</Button>} />

  const dealOptions = deals.filter(d => !program || d.program_slug === program).map(d => ({ value: d.slug, label: d.name }))
  const columns: Column<Upload>[] = [
    { key: 'program', header: 'Program', render: u => programName(u.program_slug), sortValue: u => programName(u.program_slug) },
    { key: 'deal', header: 'Deal', emphasis: true, render: u => dealName(u.deal_slug), sortValue: u => dealName(u.deal_slug) },
    { key: 'period', header: 'Collection period', sortValue: u => u.collection_period,
      render: u => <>{formatPeriod(u.collection_period)}{u.reporting_period && <span className="rv-sub">reporting {formatPeriod(u.reporting_period)}</span>}</> },
    { key: 'status', header: 'Status', render: u => u.replaced_by_upload_id
      ? <span className="rv-pills"><StatusPill tone="neutral" size="sm">Replaced</StatusPill>{u.published_version != null && <span className="rv-ver">v{u.published_version}</span>}</span>
      : <span className="rv-pills"><UploadStatusPill status={u.status} size="sm" />{u.published_version != null && <span className="rv-ver" data-testid="library-version">v{u.published_version}</span>}
        {(u.published_version ?? 1) > 1 && <CorrectedTag />}{u.replaces_upload_id && <ReissueTag />}
        {u.pending_correction_id && <StatusPill tone="warn" size="sm">Correction waiting</StatusPill>}</span> },
    { key: 'published_at', header: 'Published', numeric: true, sortValue: u => u.published_at ?? '', render: u => formatDateTime(u.published_at) },
    { key: 'file', header: 'File', render: u => <span className="rv-muted">{u.file_name}</span> },
    { key: 'links', header: 'Open', align: 'right', render: u => (
      <span className="rv-pills">
        {!u.replaced_by_upload_id && <Link to={partnerViewPath(u)} aria-label={`Partner view of ${dealName(u.deal_slug)} ${formatPeriod(u.collection_period)}`}>Partner view</Link>}
        <Link to={reviewPath(u.id)} aria-label={`Review record of ${dealName(u.deal_slug)} ${formatPeriod(u.collection_period)}`}>Review record</Link>
        {u.replaces_upload_id && <Link to={reviewPath(u.replaces_upload_id)} aria-label={`Report replaced by this re-issue of ${dealName(u.deal_slug)} ${formatPeriod(u.collection_period)}`}>Replaces earlier report</Link>}
        {u.replaced_by_upload_id && <Link to={reviewPath(u.replaced_by_upload_id)} aria-label={`Re-issue that replaced ${dealName(u.deal_slug)} ${formatPeriod(u.collection_period)}`}>Replaced by re-issue</Link>}
        {u.pending_correction_id && <Link to={correctionPath(u.id, u.pending_correction_id)} aria-label={`Correction waiting for ${dealName(u.deal_slug)} ${formatPeriod(u.collection_period)}`}>Correction in queue</Link>}
        {admin && !u.replaced_by_upload_id && u.status === 'published' && (
          <button type="button" className="rv-linkbtn" onClick={() => setCorrecting(u)} disabled={!!u.pending_correction_id}
            aria-label={`Correct a value of ${dealName(u.deal_slug)} ${formatPeriod(u.collection_period)}`}>Correct a value…</button>
        )}
      </span>
    ) },
  ]

  return (
    <div className="rv-page">
      <div className="rv-toolbar">
        <Field label="Program">
          <Select value={program} onChange={e => { setProgram(e.target.value); setDeal('') }}
            options={[{ value: '', label: 'All programs' }, ...programs.map(p => ({ value: p.slug, label: p.name }))]} />
        </Field>
        <Field label="Deal">
          <Select value={deal} onChange={e => setDeal(e.target.value)} options={[{ value: '', label: 'All deals' }, ...dealOptions]} />
        </Field>
      </div>
      <DataTable<Upload> caption="Published reports" captionHidden columns={columns} rows={rows} rowKey={u => u.id}
        loading={list.loading && !list.data}
        empty={{ title: program || deal ? 'No published reports match' : 'No published reports yet', message: 'Approved reports appear here once published.' }} />
      {admin && <RegenerateDialog open={regenOpen} onClose={onRegenClose} programs={programs} />}
      {admin && correcting && <CorrectionDialog upload={correcting} open title={`${dealName(correcting.deal_slug)} · ${formatPeriod(correcting.collection_period)}`}
        onClose={() => setCorrecting(null)} onDone={() => { list.reload() }} />}
    </div>
  )
}

function RegenerateDialog({ open, onClose, programs }: { open: boolean; onClose: () => void; programs: Program[] }) {
  const { toast } = useToast()
  const [program, setProgram] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const close = () => { setErr(undefined); onClose() }
  const submit = async () => {
    setBusy(true); setErr(undefined)
    try {
      const res = await reviewApi.regenerate(program || undefined)
      const name = program ? programs.find(p => p.slug === program)?.name ?? program : 'All programs'
      const n = res?.publications
      toast({ tone: 'ok', title: 'Dashboards regenerated', message: typeof n === 'number' ? `${name}: rebuilt from ${n} published report${n === 1 ? '' : 's'}.` : `${name}: roll-up queued.` })
      close()
    } catch (e) { setErr(errorText(e)) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={close} dismissable={!busy} title="Regenerate dashboard"
      description="Rebuilds the program roll-ups from the published deal reports. Partner dashboards update; nothing is re-extracted."
      footer={<><Button onClick={close} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Regenerate</Button></>}>
      <Field label="Program">
        <Select value={program} onChange={e => setProgram(e.target.value)} options={[{ value: '', label: 'All programs' }, ...programs.map(p => ({ value: p.slug, label: p.name }))]} />
      </Field>
      {err && <div className="rv-dialog-error" role="alert">{err}</div>}
    </Dialog>
  )
}
