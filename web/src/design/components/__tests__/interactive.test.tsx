// @vitest-environment jsdom
import '../../test-utils'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Dialog, Button, Field, Input, Select, Textarea, FileDrop, fileMatchesAccept, ToastProvider, useToast, TOAST_DURATION } from '..'

describe('Field', () => {
  it('links label, hint and error to the control', () => {
    render(<Field label="Reason" hint="Shown in the audit log" error="A reason is required" required><Textarea /></Field>)
    const tb = screen.getByLabelText(/Reason/)
    expect(tb.tagName).toBe('TEXTAREA')
    expect(tb.getAttribute('aria-invalid')).toBe('true')
    const described = tb.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)!.textContent)
    expect(described).toEqual(['Shown in the audit log', 'A reason is required'])
    expect((tb as HTMLTextAreaElement).required).toBe(true)
  })
  it('Select renders grouped options and a placeholder', () => {
    render(<Field label="Deal"><Select defaultValue="" placeholder="Choose a deal" options={[{ group: 'MOVE Trust', options: [{ value: 'm1', label: 'Deal one' }] }]} /></Field>)
    const sel = screen.getByLabelText('Deal') as HTMLSelectElement
    expect(sel.querySelector('optgroup')!.getAttribute('label')).toBe('MOVE Trust')
    expect(sel.options[0].textContent).toBe('Choose a deal')
  })
  it('Input numeric aligns right', () => {
    render(<Field label="Amount"><Input numeric /></Field>)
    expect(screen.getByLabelText('Amount').className).toContain('ds-input--num')
  })
})

describe('Dialog', () => {
  function Harness({ onClose }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false)
    return (<>
      <Button onClick={() => setOpen(true)}>Reject…</Button>
      <Dialog open={open} onClose={() => { onClose?.(); setOpen(false) }} title="Reject report" description="Tell the uploader why."
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger">Reject</Button></>}>
        <Field label="Reason"><Textarea /></Field>
      </Dialog>
    </>)
  }

  it('opens with focus inside, Escape closes, focus returns to the opener', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Reject…' })
    await userEvent.click(opener)
    const dlg = screen.getByRole('dialog', { name: 'Reject report' })
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText('Reason'))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('traps Tab inside the dialog', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Reject…' }))
    const reject = screen.getByRole('button', { name: 'Reject' })
    reject.focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(reject)
  })

  it('backdrop click closes; not when dismissable is false', async () => {
    const onClose = vi.fn()
    const { rerender } = render(<Dialog open onClose={onClose} title="T">x</Dialog>)
    fireEvent.mouseDown(screen.getByTestId('dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<Dialog open onClose={onClose} title="T" dismissable={false}>x</Dialog>)
    fireEvent.mouseDown(screen.getByTestId('dialog-backdrop'))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('FileDrop', () => {
  const pdf = () => new File(['%PDF-1.7'], 'Moneda-202608 -SETTREP.pdf', { type: 'application/pdf' })
  it('matches accept by extension and mime', () => {
    expect(fileMatchesAccept(pdf(), '.pdf')).toBe(true)
    expect(fileMatchesAccept(pdf(), 'application/pdf')).toBe(true)
    expect(fileMatchesAccept(new File(['x'], 'a.txt', { type: 'text/plain' }), '.pdf,application/pdf')).toBe(false)
    expect(fileMatchesAccept(new File(['x'], 'a.png', { type: 'image/png' }), 'image/*')).toBe(true)
  })
  it('accepts a dropped PDF and rejects other types', () => {
    const onFiles = vi.fn(), onReject = vi.fn()
    render(<FileDrop accept=".pdf" onFiles={onFiles} onReject={onReject} />)
    const zone = screen.getByTestId('filedrop')
    fireEvent.drop(zone, { dataTransfer: { files: [pdf()] } })
    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0][0][0].name).toBe('Moneda-202608 -SETTREP.pdf')
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } })
    expect(onReject).toHaveBeenCalledTimes(1)
  })
  it('rejects files over maxBytes', () => {
    const onFiles = vi.fn(), onReject = vi.fn()
    render(<FileDrop accept=".pdf" maxBytes={4} onFiles={onFiles} onReject={onReject} />)
    fireEvent.drop(screen.getByTestId('filedrop'), { dataTransfer: { files: [pdf()] } })
    expect(onFiles).not.toHaveBeenCalled()
    expect(onReject.mock.calls[0][0]).toMatch(/larger than/)
  })
  it('opens the picker from the keyboard and accepts a chosen file', async () => {
    const onFiles = vi.fn()
    render(<FileDrop accept=".pdf" onFiles={onFiles} label="Choose the SetRep PDF" />)
    const zone = screen.getByRole('button', { name: 'Choose the SetRep PDF' })
    const input = screen.getByTestId('filedrop-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    zone.focus(); await userEvent.keyboard('{Enter}')
    expect(click).toHaveBeenCalled()
    await userEvent.upload(input, pdf())
    expect(onFiles).toHaveBeenCalledTimes(1)
  })
  it('shows the chosen file with a remove button', async () => {
    const onClear = vi.fn()
    render(<FileDrop onFiles={() => {}} value={pdf()} onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: /Remove Moneda/ }))
    expect(onClear).toHaveBeenCalled()
  })
  it('disabled ignores drops', () => {
    const onFiles = vi.fn()
    render(<FileDrop onFiles={onFiles} disabled />)
    fireEvent.drop(screen.getByTestId('filedrop'), { dataTransfer: { files: [pdf()] } })
    expect(onFiles).not.toHaveBeenCalled()
  })
})

describe('Toast', () => {
  afterEach(() => { vi.useRealTimers() })
  function Fire({ n = 1 }: { n?: number }) {
    const { toast } = useToast()
    return <button onClick={() => { for (let i = 0; i < n; i++) toast({ tone: 'ok', title: `Published ${i + 1}` }) }}>fire</button>
  }

  it('auto-dismisses after 6 s', () => {
    vi.useFakeTimers()
    render(<ToastProvider><Fire /></ToastProvider>)
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('Published 1')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(TOAST_DURATION - 10) })
    expect(screen.queryByText('Published 1')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(20) })
    expect(screen.queryByText('Published 1')).toBeNull()
  })

  it('pauses while hovered', () => {
    vi.useFakeTimers()
    render(<ToastProvider><Fire /></ToastProvider>)
    fireEvent.click(screen.getByText('fire'))
    const t = screen.getByRole('status')
    fireEvent.mouseEnter(t)
    act(() => { vi.advanceTimersByTime(TOAST_DURATION * 2) })
    expect(screen.queryByText('Published 1')).not.toBeNull()
    fireEvent.mouseLeave(t)
    act(() => { vi.advanceTimersByTime(TOAST_DURATION) })
    expect(screen.queryByText('Published 1')).toBeNull()
  })

  it('never stacks more than three, and can be dismissed', async () => {
    render(<ToastProvider><Fire n={5} /></ToastProvider>)
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getAllByRole('status').length).toBe(3)
    expect(screen.queryByText('Published 1')).toBeNull()
    expect(screen.getByText('Published 5')).toBeTruthy()
    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0])
    expect(screen.getAllByRole('status').length).toBe(2)
  })

  it('useToast outside the provider throws a clear error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Fire />)).toThrow(/ToastProvider/)
    spy.mockRestore()
  })
})
