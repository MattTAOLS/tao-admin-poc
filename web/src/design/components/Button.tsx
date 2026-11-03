import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'danger'
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  /** Icon element placed before the label (use one from the icons module). */
  icon?: ReactNode
  /** Icon element placed after the label, e.g. IconArrowRight on a forward action. */
  iconAfter?: ReactNode
  /** Shows a busy indicator, sets aria-busy and blocks clicks. */
  loading?: boolean
  block?: boolean
}

/** Primary (one per view), ghost (secondary), danger (reject / destructive). Always a real <button>. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', icon, iconAfter, loading = false, block = false, className, children, disabled, type = 'button', onClick, ...rest }, ref,
) {
  const cls = ['ds-btn', `ds-btn--${variant}`, size === 'sm' && 'ds-btn--sm', block && 'ds-btn--block', className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick} {...rest}>
      {loading ? <span className="ds-btn__spin" aria-hidden="true" /> : icon}
      {children}
      {iconAfter}
    </button>
  )
})
