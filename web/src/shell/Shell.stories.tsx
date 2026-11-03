import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { App, RouteLoading } from './App'
import { KEY, type Role } from './roles'
import { usePageHeader } from './header'
import { Button, UploadStatusPill, StatePanel, icons } from '@/design/components'

type Args = { role: Role; path: string }
const meta: Meta<Args> = {
  title: 'Shell/App frame',
  parameters: { bare: true },
  argTypes: {
    role: { control: 'select', options: ['tao_admin', 'tao_analyst', 'investor_admin', 'investor_viewer', 'manager_admin', 'manager_viewer'] },
    path: { control: 'text' },
  },
  render: ({ role, path }) => {
    try { localStorage.setItem(KEY, role) } catch { /* storage may be blocked */ }
    return <MemoryRouter key={role + path} initialEntries={[path]}><App /></MemoryRouter>
  },
}
export default meta
type S = StoryObj<Args>

export const AdminDashboard: S = { args: { role: 'tao_admin', path: '/admin' } }
export const AdminNested: S = { args: { role: 'tao_admin', path: '/admin/uploads/queue/7f0b7c3e' } }
export const AnalystNoAccess: S = { args: { role: 'tao_analyst', path: '/admin/partners' } }
export const NotFound: S = { args: { role: 'tao_admin', path: '/admin/does-not-exist' } }
export const InvestorPortal: S = { args: { role: 'investor_admin', path: '/investor/portfolio' } }
export const ManagerViewer: S = { args: { role: 'manager_viewer', path: '/manager/data-room' } }

/** A page setting the top bar through usePageHeader: status pill, subtitle, actions. */
function ReviewDemo() {
  usePageHeader({
    title: 'F-PIL 2.0 - Moneda Capital Corp.',
    status: <UploadStatusPill status="needs_review" />,
    subtitle: 'Collection period Aug 2026 · reporting period Jul 2026 · pass 1',
    actions: <><Button icon={<icons.IconFile />}>View source PDF</Button><Button variant="primary" disabled>Publish to partner</Button></>,
  })
  return <StatePanel kind="empty" title="Page body" message="The UI-Review agent renders findings here." />
}
export const PageSetsHeader: S = {
  render: () => {
    try { localStorage.setItem(KEY, 'tao_admin') } catch { /* ignore */ }
    return (
      <MemoryRouter initialEntries={['/admin/help']}>
        <HeaderOverride />
      </MemoryRouter>
    )
  },
}
function HeaderOverride() {
  // ReviewDemo stands in for a registered page: it only sets the top bar, its body is hidden.
  return <><App /><div hidden><ReviewDemo /></div></>
}

export const RouteLoadingState: S = { render: () => <div style={{ padding: 28, background: 'var(--cream)', minHeight: '100vh' }}><RouteLoading /></div> }
