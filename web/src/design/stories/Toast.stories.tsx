import type { Meta, StoryObj } from '@storybook/react'
import { Button, useToast, type ToastTone } from '../components'

const meta: Meta = { title: 'Design System/Toast', tags: ['autodocs'] }
export default meta
type S = StoryObj

const MESSAGES: Record<ToastTone, { title: string; message: string }> = {
  ok: { title: 'Published', message: 'F-PIL 2.0 - Moneda Capital Corp. · Aug 2026 is now visible to partners.' },
  warn: { title: 'Needs review', message: '1 block finding on R05 must be resolved before publishing.' },
  bad: { title: 'Upload failed', message: 'The API returned an error. Try again.' },
  blue: { title: 'Extraction started', message: 'Status updates every 2 s.' },
}

/** Bottom-right, 6 s, pauses on hover, at most three (the oldest goes). */
export const AllTones: S = {
  render: function Render() {
    const { toast } = useToast()
    return (
      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
        {(Object.keys(MESSAGES) as ToastTone[]).map(t => <Button key={t} onClick={() => toast({ tone: t, ...MESSAGES[t] })}>Show {t}</Button>)}
        <Button variant="primary" onClick={() => (Object.keys(MESSAGES) as ToastTone[]).forEach(t => toast({ tone: t, ...MESSAGES[t] }))}>Fire four (max three)</Button>
        <Button onClick={() => toast({ tone: 'ok', title: 'Title only' })}>Title only</Button>
      </div>
    )
  },
}
