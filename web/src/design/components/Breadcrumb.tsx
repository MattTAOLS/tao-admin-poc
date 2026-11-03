import type { ComponentType, ReactNode } from 'react'

export type Crumb = { label: ReactNode; href?: string }
export type LinkLike = ComponentType<{ to: string; className?: string; children: ReactNode }>

export type BreadcrumbProps = {
  items: Crumb[]
  /** Router link component (react-router's Link). Defaults to a plain <a href>. The shell passes Link. */
  linkAs?: LinkLike
  className?: string
}

const Anchor: LinkLike = ({ to, className, children }) => <a href={to} className={className}>{children}</a>

/** Trail of links; the last item is the current page (aria-current, purple). */
export function Breadcrumb({ items, linkAs: L = Anchor, className }: BreadcrumbProps) {
  if (items.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className={['ds-crumb', className].filter(Boolean).join(' ')}>
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1
          return (
            <li key={i}>
              {last ? <span aria-current="page">{c.label}</span> : c.href ? <L to={c.href}>{c.label}</L> : <span>{c.label}</span>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
