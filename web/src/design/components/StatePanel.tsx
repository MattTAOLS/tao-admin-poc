import type { ReactNode } from 'react'
import { IconAlert, IconCompass, IconInbox, IconLock } from './icons'

export type StatePanelProps = {
  kind: 'empty' | 'error' | 'no-access' | 'not-found'
  title?: ReactNode
  message?: ReactNode
  /** Buttons, e.g. Retry or Go home. */
  actions?: ReactNode
  className?: string
}

const DEFAULTS = {
  empty: { icon: <IconInbox />, title: 'Nothing here yet', message: 'There is no data for this view yet.', tone: '' },
  error: { icon: <IconAlert />, title: 'Something went wrong', message: 'The request failed. Try again in a moment.', tone: 'ds-state--bad' },
  'no-access': { icon: <IconLock />, title: 'You don’t have access', message: 'This page isn’t available to your role. Switch role in the sidebar to see it.', tone: 'ds-state--warn' },
  'not-found': { icon: <IconCompass />, title: 'Page not found', message: 'The address doesn’t match any page in this portal.', tone: '' },
}

/** Whole-region state: empty, error, no access, not found. Every page uses these so the states read the same. */
export function StatePanel({ kind, title, message, actions, className }: StatePanelProps) {
  const d = DEFAULTS[kind]
  return (
    <div className={['ds-state', d.tone, className].filter(Boolean).join(' ')} role={kind === 'error' ? 'alert' : undefined} data-state={kind}>
      <span className="ds-state__icon" aria-hidden="true">{d.icon}</span>
      <h2>{title ?? d.title}</h2>
      <p>{message ?? d.message}</p>
      {actions && <div className="ds-state__actions">{actions}</div>}
    </div>
  )
}
