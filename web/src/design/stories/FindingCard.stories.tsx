import type { Meta, StoryObj } from '@storybook/react'
import { FindingCard, Button, SkeletonBlock, icons, type FindingView } from '../components'
import { r05Finding } from './fixtures'

const meta: Meta<typeof FindingCard> = {
  title: 'Design System/FindingCard',
  component: FindingCard,
  tags: ['autodocs'],
  args: { finding: r05Finding, ruleTitle: 'Tranche balance roll-forward' },
  decorators: [S => <div style={{ maxWidth: 920, display: 'grid', gap: 14 }}><S /></div>],
}
export default meta
type S = StoryObj<typeof FindingCard>

const actions = (<>
  <Button size="sm" variant="ghost">Use ours</Button>
  <Button size="sm" variant="ghost">Use report</Button>
  <Button size="sm" variant="ghost">Accept as restatement</Button>
  <Button size="sm" variant="ghost">Acknowledge</Button>
</>)
// The page fetches /uploads/{id}/pages/{n}.png; in Storybook the slot shows what the page passes while loading.
const cropLoading = <SkeletonBlock height={150} radius={8} />
const cropZoom = <><SkeletonBlock height={150} radius={8} /><Button size="sm" icon={<icons.IconZoom />}>Zoom page 2</Button></>

/** The real R05 fixture (F-PIL 2.0 Moneda, seeded $1,000 error), with tao_admin actions. */
export const BlockOpenAdmin: S = { args: { actions, crop: cropZoom } }
/** Analysts see the same card with no action buttons. */
export const ReadOnlyAnalyst: S = { args: { crop: cropLoading } }
export const NoCrop: S = { args: {} }
export const Overridden: S = {
  args: {
    finding: { ...r05Finding, status: 'overridden', resolution: { by: 'tao_admin', at: '2026-11-03T10:15:00Z', choice: 'use_ours', reason: 'Report closing balance mistyped; roll-forward terms tie to page 2' } } as FindingView,
  },
}
export const ResolvedByPass2: S = { args: { finding: { ...r05Finding, status: 'resolved_by_pass_2' } as FindingView } }
/** Same finding at review severity, to show the amber rule edge. */
export const ReviewSeverity: S = { args: { finding: { ...r05Finding, severity: 'review' } as FindingView, actions } }
/** A note carries a message and nothing to compare. */
export const NoteWithoutValues: S = {
  args: {
    ruleTitle: 'Provenance and second-pass agreement',
    finding: { id: 'n1', rule_id: 'R22', layer: 'reasonableness', severity: 'note', message: r05Finding.message, status: 'open' },
  },
}
