import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { FileDrop, useToast } from '../components'

const meta: Meta<typeof FileDrop> = { title: 'Design System/FileDrop', component: FileDrop, tags: ['autodocs'], decorators: [S => <div style={{ maxWidth: 520 }}><S /></div>] }
export default meta
type S = StoryObj<typeof FileDrop>

/** Drop or choose a PDF; wrong types are rejected with a message. */
export const Interactive: S = {
  render: function Render() {
    const [file, setFile] = useState<File | null>(null)
    const [error, setError] = useState<string | null>(null)
    const { toast } = useToast()
    return <FileDrop accept=".pdf,application/pdf" maxBytes={25 * 1024 * 1024} label="Choose the SetRep PDF" hint="PDF, up to 25 MB"
      value={file} onClear={() => setFile(null)} error={error}
      onFiles={([f]) => { setFile(f); setError(null); toast({ tone: 'ok', title: 'File ready', message: f.name }) }}
      onReject={reason => setError(reason)} />
  },
}
export const Idle: S = { args: { onFiles: () => {}, hint: 'PDF, up to 25 MB', accept: '.pdf' } }
export const WithFile: S = { args: { onFiles: () => {}, value: new File(['%PDF'], 'Moneda-202608 -SETTREP.pdf', { type: 'application/pdf' }), onClear: () => {} } }
export const ErrorState: S = { args: { onFiles: () => {}, error: 'Wrong file type. Expected .pdf.', hint: 'PDF, up to 25 MB' } }
export const Disabled: S = { args: { onFiles: () => {}, disabled: true, title: 'Choose a deal and period first', hint: 'The file comes last' } }
