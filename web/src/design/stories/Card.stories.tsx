import type { Meta, StoryObj } from '@storybook/react'
import { Card, Button, StatusPill, SkeletonBlock } from '../components'

const meta: Meta<typeof Card> = { title: 'Design System/Card', component: Card, tags: ['autodocs'] }
export default meta
type S = StoryObj<typeof Card>

export const Plain: S = { args: { children: 'A padded white surface on the cream canvas.' } }
export const WithHeader: S = {
  args: {
    title: 'Recent uploads', subtitle: 'Last 30 days', actions: <Button size="sm">View all</Button>,
    children: 'Card body. Put a table in a flush card to let it fill the width.',
  },
}
export const WithStatus: S = { args: { title: 'MOVE Trust - Essex Lease Financial Corp.', actions: <StatusPill tone="warn">WATCH</StatusPill>, children: 'Escalated deal card.' } }
export const Flush: S = {
  args: {
    title: 'Flush body', padding: 'flush',
    children: <table className="ds-table"><thead><tr><th>Deal</th><th className="ds-num">Closing</th></tr></thead><tbody><tr><td className="ds-key">MOVE Trust - VCC IV LP</td><td className="ds-num">42,003,551.15</td></tr></tbody></table>,
  },
}
export const Loading: S = { args: { title: 'Loading', children: <SkeletonBlock lines={3} /> } }
