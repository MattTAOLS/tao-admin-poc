import type { Meta, StoryObj } from '@storybook/react'
import { Breadcrumb, PageHeader, Button, UploadStatusPill, StatePanel, SkeletonBlock, icons } from '../components'

const meta: Meta = { title: 'Design System/Navigation and states', tags: ['autodocs'] }
export default meta
type S = StoryObj

export const BreadcrumbTrail: S = {
  render: () => <Breadcrumb items={[{ label: 'Portfolio Executive Summary', href: '#' }, { label: 'MOVE Trust Executive Summary', href: '#' }, { label: 'MOVE Trust Dashboard', href: '#' }, { label: 'Covenant Status & Review' }]} />,
}
export const BreadcrumbSingle: S = { render: () => <Breadcrumb items={[{ label: 'Dashboard' }]} /> }

export const PageHeaderFull: S = {
  render: () => (
    <div className="topbar" style={{ position: 'static' }}>
      <PageHeader crumbs={[{ label: 'Uploads', href: '#' }, { label: 'Approval queue', href: '#' }, { label: 'Review report' }]}
        title="F-PIL 2.0 - Moneda Capital Corp." status={<UploadStatusPill status="needs_review" />}
        subtitle="Collection period Aug 2026 · reporting period Jul 2026 · pass 1"
        actions={<><Button icon={<icons.IconFile />}>View source PDF</Button><Button variant="primary" disabled title="1 block finding open">Publish to partner</Button></>} />
    </div>
  ),
}
export const PageHeaderMinimal: S = { render: () => <PageHeader title="Upload history" /> }

export const SkeletonShapes: S = {
  render: () => (
    <div style={{ display: 'grid', gap: 14, maxWidth: 420 }}>
      <SkeletonBlock height={28} width="50%" />
      <SkeletonBlock lines={4} />
      <SkeletonBlock height={120} radius={12} />
    </div>
  ),
}

export const StateEmpty: S = { render: () => <StatePanel kind="empty" title="No published reports" message="Reports appear here once a reviewer publishes them." /> }
export const StateError: S = { render: () => <StatePanel kind="error" actions={<Button>Retry</Button>} /> }
export const StateNoAccess: S = { render: () => <StatePanel kind="no-access" /> }
export const StateNotFound: S = { render: () => <StatePanel kind="not-found" actions={<Button variant="primary">Go to home</Button>} /> }
