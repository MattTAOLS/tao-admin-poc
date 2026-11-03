import type { Meta, StoryObj } from '@storybook/react'
import { StatusPill, UploadStatusPill, SeverityPill, CovenantPill, FindingStatusPill, UPLOAD_STATUS, FINDING_STATUS, type UploadStatus, type FindingStatus } from '../components'
import { programMove } from './fixtures'

const meta: Meta<typeof StatusPill> = {
  title: 'Design System/StatusPill',
  component: StatusPill,
  tags: ['autodocs'],
  args: { tone: 'ok', children: 'Published' },
  argTypes: { tone: { control: 'inline-radio', options: ['ok', 'warn', 'bad', 'blue', 'dpv', 'neutral'] }, size: { control: 'inline-radio', options: ['md', 'sm'] } },
}
export default meta
type S = StoryObj<typeof StatusPill>

const row = { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center', marginBottom: 14 }

export const Tones: S = {
  render: () => (
    <>
      <div style={row}>
        <StatusPill tone="ok">OK</StatusPill><StatusPill tone="warn">Needs review</StatusPill><StatusPill tone="bad">Block</StatusPill>
        <StatusPill tone="blue">Reformatted</StatusPill><StatusPill tone="dpv">Derived</StatusPill><StatusPill tone="neutral">Received</StatusPill>
      </div>
      <div style={row}>
        <StatusPill tone="ok" size="sm">OK</StatusPill><StatusPill tone="warn" size="sm">WATCH</StatusPill><StatusPill tone="bad" size="sm">BREACH</StatusPill>
        <StatusPill tone="bad" count={2}>Block</StatusPill><StatusPill tone="warn" count={5}>Review</StatusPill><StatusPill tone="blue" count={1}>Note</StatusPill>
      </div>
    </>
  ),
}
export const Playground: S = {}

export const UploadStatuses: S = { render: () => <div style={row}>{(Object.keys(UPLOAD_STATUS) as UploadStatus[]).map(s => <UploadStatusPill key={s} status={s} />)}</div> }
export const Severities: S = { render: () => <div style={row}><SeverityPill severity="block" /><SeverityPill severity="review" /><SeverityPill severity="note" /></div> }
export const FindingStatuses: S = { render: () => <div style={row}>{(Object.keys(FINDING_STATUS) as FindingStatus[]).map(s => <FindingStatusPill key={s} status={s} />)}</div> }

/** Covenant totals from the real MOVE Trust program object (period 2026-07). */
export const CovenantStatuses: S = {
  render: () => (
    <div style={row}>
      {(['OK', 'WATCH', 'BREACH', 'AVAILABLE'] as const).map(s => <CovenantPill key={s} status={s} count={programMove.covenant_totals[s]} />)}
    </div>
  ),
}
