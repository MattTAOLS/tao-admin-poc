import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconClose } from './icons'

export type ToastTone = 'ok' | 'warn' | 'bad' | 'blue'
export type ToastInput = { tone?: ToastTone; title: ReactNode; message?: ReactNode; /** ms, default 6000 */ duration?: number }
type ToastItem = ToastInput & { id: number }

const KIND: Record<ToastTone, string> = { ok: 'Done', warn: 'Check', bad: 'Error', blue: 'Info' }
export const TOAST_DURATION = 6000
export const TOAST_MAX = 3

type Ctx = { toast: (t: ToastInput) => number; dismiss: (id: number) => void }
const ToastContext = createContext<Ctx | null>(null)

/** Wrap the app once (the shell does). Toasts sit bottom-right, enter with `panel`, auto-dismiss after 6 s unless
 * hovered or focused, and never stack more than three (the oldest goes). The only notification channel. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setItems(xs => xs.filter(x => x.id !== id)), [])
  const toast = useCallback((t: ToastInput) => {
    const id = ++seq.current
    setItems(xs => [...xs, { ...t, id }].slice(-TOAST_MAX))
    return id
  }, [])
  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ds-toasts" role="region" aria-label="Notifications">
        {items.map(t => <ToastView key={t.id} item={t} onDismiss={() => dismiss(t.id)} />)}
      </div>
    </ToastContext.Provider>
  )
}

/** `const { toast } = useToast(); toast({ tone: 'ok', title: 'Published', message: 'Moneda Aug 2026' })` */
export function useToast(): Ctx {
  const c = useContext(ToastContext)
  if (!c) throw new Error('useToast must be used inside <ToastProvider> (the shell provides one).')
  return c
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const tone = item.tone ?? 'blue'
  const [paused, setPaused] = useState(false)
  const remaining = useRef(item.duration ?? TOAST_DURATION)
  useEffect(() => {
    if (paused) return
    const started = Date.now()
    const h = setTimeout(onDismiss, remaining.current)
    return () => { clearTimeout(h); remaining.current -= Date.now() - started }
  }, [paused, onDismiss])
  return (
    <div className={`ds-toast ds-toast--${tone}`} role={tone === 'bad' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span className="ds-toast__dot" aria-hidden="true" />
      <div>
        <div className="ds-toast__kind">{KIND[tone]}</div>
        <div className="ds-toast__title">{item.title}</div>
        {item.message && <div className="ds-toast__msg">{item.message}</div>}
      </div>
      <button type="button" className="ds-iconbtn" aria-label="Dismiss notification" onClick={onDismiss}><IconClose /></button>
    </div>
  )
}
