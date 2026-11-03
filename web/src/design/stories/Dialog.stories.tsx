import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Dialog, Button, Field, Textarea, Select } from '../components'

const meta: Meta<typeof Dialog> = { title: 'Design System/Dialog', component: Dialog, tags: ['autodocs'] }
export default meta
type S = StoryObj<typeof Dialog>

function Demo({ label, ...p }: Partial<ComponentProps<typeof Dialog>> & { label: string }) {
  const [open, setOpen] = useState(!!p.open)
  return (<>
    <Button onClick={() => setOpen(true)}>{label}</Button>
    <Dialog title="Dialog" {...p} open={open} onClose={() => setOpen(false)} />
  </>)
}

/** Reject with a reason. Escape closes; focus returns to the button. */
export const RejectWithReason: S = {
  render: function Render() {
    const [open, setOpen] = useState(false)
    const [reason, setReason] = useState('')
    const [tried, setTried] = useState(false)
    return (<>
      <Button variant="danger" onClick={() => setOpen(true)}>Reject…</Button>
      <Dialog open={open} onClose={() => setOpen(false)} role="alertdialog" title="Reject this report?" description="The uploader sees the reason. The upload moves to Rejected and cannot be published."
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => { setTried(true); if (reason.trim()) setOpen(false) }}>Reject report</Button></>}>
        <Field label="Reason" required error={tried && !reason.trim() ? 'A reason is required' : undefined}><Textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </Dialog>
    </>)
  },
}
export const Publish: S = {
  render: () => <Demo label="Publish…" description="Partners will see this period on their dashboards." title="Publish to partner"
    footer={<><Button>Cancel</Button><Button variant="primary">Publish</Button></>} children={<p style={{ margin: 0 }}>F-PIL 2.0 - Moneda Capital Corp. · collection period Aug 2026.</p>} />,
}
export const Large: S = {
  render: () => <Demo label="Regenerate dashboard…" size="lg" title="Regenerate dashboard"
    footer={<><Button>Cancel</Button><Button variant="primary">Regenerate</Button></>}
    children={<Field label="Program"><Select options={[{ value: 'move', label: 'MOVE Trust' }, { value: 'fpil', label: 'F-PIL 2.0' }]} /></Field>} />,
}
export const Small: S = { render: () => <Demo label="Small" size="sm" title="Discard changes?" footer={<><Button>Keep editing</Button><Button variant="danger">Discard</Button></>} /> }
/** While a request is in flight: Escape, backdrop and close do nothing. */
export const Busy: S = {
  render: () => <Demo label="Busy" title="Publishing…" dismissable={false} footer={<><Button disabled>Cancel</Button><Button variant="primary" loading>Publishing…</Button></>} children={<p style={{ margin: 0 }}>Please wait.</p>} />,
}
export const OpenByDefault: S = { render: () => <Demo label="Open again" open title="Open on load" children={<p style={{ margin: 0 }}>Shown open so the visual can be reviewed.</p>} footer={<Button variant="primary">OK</Button>} /> }
