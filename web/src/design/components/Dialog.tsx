import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './icons'

export type DialogProps = {
  open: boolean
  /** Called on Escape, the close button, or a backdrop click (unless dismissable is false). */
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Buttons, right-aligned. Put the primary action last. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** False while a request is in flight: Escape and backdrop do nothing. */
  dismissable?: boolean
  /** Element to focus on open; defaults to the first focusable control in the body, else the dialog. */
  initialFocus?: RefObject<HTMLElement>
  /** alertdialog for destructive confirmations (Reject). */
  role?: 'dialog' | 'alertdialog'
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Modal dialog: focus moves in and is trapped, Escape closes, focus returns to the opener on close.
 * Rendered in a portal on document.body. */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', dismissable = true, initialFocus, role = 'dialog' }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId(), descId = useId()
  const closeRef = useRef(onClose); closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const node = ref.current!
    const body = node.querySelector<HTMLElement>('.ds-dialog__body')
    const first = initialFocus?.current ?? body?.querySelector<HTMLElement>(FOCUSABLE) ?? node
    first.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow; opener?.focus?.() }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (dismissable) closeRef.current(); return }
    if (e.key !== 'Tab') return
    const els = Array.from(ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (els.length === 0) { e.preventDefault(); return }
    const firstEl = els[0], lastEl = els[els.length - 1]
    if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === ref.current)) { e.preventDefault(); lastEl.focus() }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus() }
  }

  return createPortal(
    <div className="ds-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && dismissable) onClose() }} data-testid="dialog-backdrop">
      <div ref={ref} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined}
        className={['ds-dialog', size !== 'md' && `ds-dialog--${size}`].filter(Boolean).join(' ')} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="ds-dialog__head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <div className="ds-dialog__desc" id={descId}>{description}</div>}
          </div>
          <button type="button" className="ds-iconbtn ds-dialog__close" aria-label="Close" onClick={onClose} disabled={!dismissable}><IconClose /></button>
        </div>
        {children && <div className="ds-dialog__body">{children}</div>}
        {footer && <div className="ds-dialog__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
