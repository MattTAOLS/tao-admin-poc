import { useSearchParams, useNavigate } from 'react-router-dom'
import { Button, Card, Field, Input, Select, UPLOAD_STATUS, formatNumber, type UploadStatus } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { adminApi } from './data'
import { useResource, useRole } from './hooks'
import { LoadError, dealOptions } from './ui'
import { UploadsTable } from './UploadsTable'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

/** Upload history: every upload, filtered by deal, status and collection period on the server. Filters live in the
 * URL so a filtered view can be shared. A period is sent only once it is a full YYYY-MM. */
export default function UploadHistoryPage() {
  const nav = useNavigate()
  const role = useRole()
  const [params, setParams] = useSearchParams()
  const deal = params.get('deal') ?? ''
  const status = params.get('status') ?? ''
  const period = params.get('period') ?? ''
  usePageHeader({ title: 'Upload history', subtitle: 'Every settlement report uploaded, newest first.',
    actions: <Button variant="primary" onClick={() => nav('/admin/uploads/new')}>Upload report</Button> })

  const master = useResource(() => Promise.all([adminApi.deals(), adminApi.programs()]), [role])
  const periodFilter = PERIOD.test(period) ? period : ''
  const list = useResource(() => adminApi.uploads({ deal_slug: deal || undefined, status: status || undefined, collection_period: periodFilter || undefined }),
    [deal, status, periodFilter, role])
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }
  const error = master.error ?? list.error
  if (error) return <LoadError error={error} onRetry={() => { master.reload(); list.reload() }} />

  const [deals, programs] = master.data ?? [[], []]
  const rows = (list.data ?? []).slice()
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
  const filtered = !!(deal || status || period)
  const loading = (list.loading && !list.data) || (master.loading && !master.data)

  return (
    <div className="adm-stack">
      <Card>
        <form className="adm-filters" role="search" aria-label="Filter uploads" onSubmit={e => e.preventDefault()}>
          <Field label="Deal">
            <Select value={deal} onChange={e => set('deal', e.target.value)}>
              <option value="">All deals</option>
              {dealOptions(deals, programs).map(g => (
                <optgroup key={g.group} label={g.group}>{g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Collection period" hint="YYYY-MM" error={period && !PERIOD.test(period) ? 'Use YYYY-MM' : undefined}>
            <Input value={period} placeholder="All periods" inputMode="numeric" maxLength={7} onChange={e => set('period', e.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={e => set('status', e.target.value)}>
              <option value="">All statuses</option>
              {(Object.keys(UPLOAD_STATUS) as UploadStatus[]).map(s => <option key={s} value={s}>{UPLOAD_STATUS[s].label}</option>)}
            </Select>
          </Field>
          {filtered && <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button>}
        </form>
      </Card>
      <Card title="Uploads" subtitle={loading ? 'Loading' : `${formatNumber(rows.length)} upload${rows.length === 1 ? '' : 's'}${filtered ? ' match the filters' : ''}`} padding="flush">
        <div aria-live="polite" className="ds-visually-hidden">{loading ? '' : `${rows.length} uploads shown`}</div>
        <UploadsTable uploads={rows} deals={deals} programs={programs} loading={loading} caption="Upload history" showAudit={role === 'tao_admin'}
          empty={filtered
            ? { title: 'No uploads match these filters', action: <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button> }
            : { title: 'No uploads yet', message: 'Upload a settlement report to start the history.', action: <Button variant="primary" onClick={() => nav('/admin/uploads/new')}>Upload report</Button> }} />
      </Card>
    </div>
  )
}
