import type { HTMLAttributes, ReactNode } from 'react'

export type CardProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  /** Heading shown in the card header row. */
  title?: ReactNode
  subtitle?: ReactNode
  /** Right-aligned header content: buttons, a legend, a pill. */
  actions?: ReactNode
  /** Heading level for the title; defaults to h2. */
  headingLevel?: 2 | 3
  /** `pad` (default) pads the body; `flush` removes body padding and clips, for a table that fills the card. */
  padding?: 'pad' | 'flush'
  as?: 'section' | 'div' | 'article'
}

/** White surface on the cream canvas. With `title` or `actions` it gets a header row; without, it is a padded box. */
export function Card({ title, subtitle, actions, headingLevel = 2, padding = 'pad', as: Tag = 'section', className, children, ...rest }: CardProps) {
  const H = headingLevel === 3 ? 'h3' : 'h2'
  const hasHead = title !== undefined || actions !== undefined
  const cls = ['ds-card', padding === 'flush' && 'ds-card--flush', !hasHead && padding === 'pad' && 'ds-card--pad', className].filter(Boolean).join(' ')
  if (!hasHead) return <Tag className={cls} {...rest}>{children}</Tag>
  return (
    <Tag className={cls} {...rest}>
      <div className="ds-card__head">
        <div>{title !== undefined && <H>{title}</H>}{subtitle && <div className="ds-card__sub">{subtitle}</div>}</div>
        {actions && <div className="ds-card__actions">{actions}</div>}
      </div>
      <div className="ds-card__body">{children}</div>
    </Tag>
  )
}
