import type { ReactNode } from 'react'
import { Breadcrumb, type Crumb, type LinkLike } from './Breadcrumb'

export type PageHeaderProps = {
  title: ReactNode
  crumbs?: Crumb[]
  /** Muted line under the title, e.g. "Moneda · collection Aug 2026 · reporting Jul 2026". */
  subtitle?: ReactNode
  /** A StatusPill next to the title. */
  status?: ReactNode
  /** Right-aligned buttons; the primary action last. */
  actions?: ReactNode
  linkAs?: LinkLike
  className?: string
}

/** Breadcrumb, h1, subtitle, status and actions, as in the mockup's top bar. The shell renders it in the top bar;
 * pages feed it through usePageHeader() from '@/shell/header' rather than rendering their own h1. */
export function PageHeader({ title, crumbs, subtitle, status, actions, linkAs, className }: PageHeaderProps) {
  return (
    <div className={['ds-pagehead', className].filter(Boolean).join(' ')}>
      <div className="ds-pagehead__text">
        {crumbs && crumbs.length > 0 && <Breadcrumb items={crumbs} linkAs={linkAs} />}
        <div className="ds-pagehead__titlerow"><h1>{title}</h1>{status}</div>
        {subtitle && <div className="ds-pagehead__sub">{subtitle}</div>}
      </div>
      {actions && <div className="ds-pagehead__actions">{actions}</div>}
    </div>
  )
}
