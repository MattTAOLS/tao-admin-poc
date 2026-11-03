import { useNavigate } from 'react-router-dom'
import { Button, Card, KpiRow, icons } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { adminApi } from './data'
import { useResource, useRole } from './hooks'
import { LoadError, QueueTiles, TextLink } from './ui'
import { UploadsTable } from './UploadsTable'

export const RECENT = 10

/** Uploads: the queue at a glance (four tiles) and the ten most recent uploads. */
export default function UploadsPage() {
  const nav = useNavigate()
  const role = useRole()
  usePageHeader({
    title: 'Uploads', subtitle: 'Settlement reports in the intake queue.',
    actions: <>
      <Button onClick={() => nav('/admin/uploads/history')}>Upload history</Button>
      <Button variant="primary" icon={<icons.IconUpload width={16} height={16} />} onClick={() => nav('/admin/uploads/new')}>Upload report</Button>
    </>,
  })
  const res = useResource(() => Promise.all([adminApi.uploads(), adminApi.deals(), adminApi.programs()]), [role])
  if (res.error) return <LoadError error={res.error} onRetry={res.reload} />
  const [uploads, deals, programs] = res.data ?? [undefined, [], []]
  const recent = (uploads ?? []).slice().sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)).slice(0, RECENT)
  return (
    <div className="adm-stack">
      <KpiRow><QueueTiles uploads={uploads} loading={res.loading && !uploads} /></KpiRow>
      <Card title="Recent uploads" subtitle={`The ${RECENT} most recent, newest first.`} padding="flush"
        actions={<TextLink to="/admin/uploads/history">All uploads →</TextLink>}>
        <UploadsTable uploads={recent} deals={deals} programs={programs} loading={res.loading && !uploads} caption="Recent uploads" compact
          showAudit={role === 'tao_admin'}
          empty={{ title: 'No uploads yet', message: 'Upload a settlement report to start the queue.',
            action: <Button variant="primary" onClick={() => nav('/admin/uploads/new')}>Upload report</Button> }} />
      </Card>
    </div>
  )
}
