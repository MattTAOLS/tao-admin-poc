import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router-dom'

export type ButtonVariant = 'primary' | 'ghost' | 'danger'
type Common = {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  /** Icon element placed before the label (use one from the icons module). */
  icon?: ReactNode
  /** Icon element placed after the label, e.g. IconArrowRight on a forward action. */
  iconAfter?: ReactNode
  block?: boolean
}
/** A real <button>. */
export type ButtonAsButton = Common & ButtonHTMLAttributes<HTMLButtonElement> & {
  as?: 'button'
  /** Shows a busy indicator, sets aria-busy and blocks clicks. */
  loading?: boolean
}
/** A router link that looks like a button: `<Button as="link" to="/admin/uploads/new" variant="primary">`.
 * Needs a react-router context (the shell has one). `disabled` renders a non-focusable span with aria-disabled. */
export type ButtonAsLink = Common & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  as: 'link'
  to: string
  replace?: boolean
  state?: unknown
  disabled?: boolean
}
/** A plain anchor (downloads, external pages): `<Button as="a" href={pdfUrl} download>`. */
export type ButtonAsAnchor = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { as: 'a'; href: string; disabled?: boolean }
export type ButtonProps = ButtonAsButton | ButtonAsLink | ButtonAsAnchor

const classes = (variant: ButtonVariant, size: 'md' | 'sm', block: boolean, className?: string, disabled?: boolean) =>
  ['ds-btn', `ds-btn--${variant}`, size === 'sm' && 'ds-btn--sm', block && 'ds-btn--block', disabled && 'ds-btn--disabled', className].filter(Boolean).join(' ')

/** Primary (one per view), ghost (secondary), danger (reject / destructive). A <button> by default; `as="link"` for
 * navigation (react-router Link), `as="a"` for a plain href. Never style a link with ds-btn classes by hand. */
export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Button(props, ref) {
  if (props.as === 'link' || props.as === 'a') {
    const { as, variant = 'ghost', size = 'md', icon, iconAfter, block = false, className, children, disabled, ...rest } = props
    const cls = classes(variant, size, block, className, disabled)
    const body = <>{icon}{children}{iconAfter}</>
    if (disabled) {
      const { to: _to, replace: _r, state: _s, href: _h, ...spanRest } = rest as Record<string, unknown>
      return <span className={cls} aria-disabled="true" {...(spanRest as AnchorHTMLAttributes<HTMLSpanElement>)}>{body}</span>
    }
    if (as === 'link') {
      const { to, replace, state, ...aRest } = rest as Omit<ButtonAsLink, keyof Common | 'as' | 'disabled' | 'className' | 'children'>
      return <Link ref={ref as Ref<HTMLAnchorElement>} to={to} replace={replace} state={state} className={cls} {...aRest}>{body}</Link>
    }
    return <a ref={ref as Ref<HTMLAnchorElement>} className={cls} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>{body}</a>
  }
  const { as: _as, variant = 'ghost', size = 'md', icon, iconAfter, loading = false, block = false, className, children, disabled, type = 'button', onClick, ...rest } = props
  return (
    <button ref={ref as Ref<HTMLButtonElement>} type={type} className={classes(variant, size, block, className)} disabled={disabled || loading}
      aria-busy={loading || undefined} onClick={loading ? undefined : onClick} {...rest}>
      {loading ? <span className="ds-btn__spin" aria-hidden="true" /> : icon}
      {children}
      {iconAfter}
    </button>
  )
})
