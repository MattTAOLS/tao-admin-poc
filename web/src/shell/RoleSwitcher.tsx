import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { icons } from '@/design/components'
import { ROLES, type Role } from './roles'
import { SEED_USERS, type SeedUser } from './users'
import type { SessionMode } from './session'

const SHELL_LABEL = { admin: 'TAO Solutions Inc.', investor: 'Investor Portal', manager: 'Manager Portal' } as const
const initials = (label: string) => label.split(/[\s·.]+/).filter(w => /^[A-Z]/.test(w)).slice(0, 2).map(w => w[0]).join('') || label.slice(0, 2).toUpperCase()

/** The menu items in order: seeded users grouped by role, in the ROLES order. */
const GROUPS = ROLES.map(r => ({ role: r, users: SEED_USERS.filter(u => u.role === r.id) })).filter(g => g.users.length)
const ITEMS: SeedUser[] = GROUPS.flatMap(g => g.users)

/** Accessible name of a menu item. The first user of each role carries the role id, so the e2e helper (which picks a
 * `menuitemradio` by role id) finds exactly one item per role; a second user of the same role does not. */
export function itemName(u: SeedUser) {
  const label = ROLES.find(r => r.id === u.role)!.label
  const first = SEED_USERS.find(x => x.role === u.role) === u
  return first ? `${u.name}, ${label} (${u.role})` : `${u.name}, ${label}`
}

export type RoleSwitcherProps = {
  role: Role
  /** The signed-in seeded user id, or null in role-only mode. */
  userId: string | null
  /** The user's name as the API has it (a person can rename themselves on Profile); falls back to the seed name. */
  userName?: string
  mode: SessionMode
  onPick: (u: SeedUser) => void
}

/** The sidebar footer user card. Doubles as "Sign in as (POC)": click (or Enter / Space / Arrow Up) opens a menu of the
 * seeded users grouped by role; arrows move, Enter picks, Escape closes and returns focus. It stands in for real sign-in. */
export function RoleSwitcher({ role, userId, userName, mode, onPick }: RoleSwitcherProps) {
  const [open, setOpen] = useState(false)
  const current = () => Math.max(0, ITEMS.findIndex(u => u.id === userId && mode !== 'role-only'))
  const [active, setActive] = useState(current)
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const meta = ROLES.find(r => r.id === role)!
  const signedIn = mode !== 'role-only' ? ITEMS.find(u => u.id === userId) : undefined
  const name = signedIn ? (userName || signedIn.name) : undefined

  useEffect(() => {
    if (!open) return
    menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[active]?.focus()
  }, [open, active])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const openMenu = () => { setActive(current()); setOpen(true) }
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus() }
  const pick = (u: SeedUser) => { close(); if (!(signedIn && u.id === signedIn.id)) onPick(u) }

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); openMenu() }
  }
  const onMenuKey = (e: KeyboardEvent) => {
    const n = ITEMS.length
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % n) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + n) % n) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(n - 1) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') { close(false) }
  }

  return (
    <div className="usercard" ref={root}>
      {open && (
        <div className="rolemenu" role="menu" id={menuId} aria-label="Sign in as (POC)" ref={menu} onKeyDown={onMenuKey}>
          <div className="rolemenu__head">Sign in as (POC)</div>
          <p className="rolemenu__note">Stands in for real sign-in: no password. Pick a sample user; the app acts as that person and role.</p>
          {GROUPS.map(g => (
            <div key={g.role.id} role="group" aria-label={g.role.label}>
              <div className="rolemenu__group" aria-hidden="true">{g.role.label} <code>{g.role.id}</code></div>
              {g.users.map(u => {
                const i = ITEMS.indexOf(u)
                const on = signedIn?.id === u.id
                return (
                  <div key={u.id} role="menuitemradio" aria-checked={on} aria-label={itemName(u)} tabIndex={i === active ? 0 : -1}
                    className={['rolemenu__opt', on && 'is-current'].filter(Boolean).join(' ')}
                    onClick={() => pick(u)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(u) } }}
                    onMouseEnter={() => setActive(i)}>
                    <span className="avatar avatar--sm" aria-hidden="true">{initials(u.name)}</span>
                    <span>{u.name}<small>{u.email}</small></span>
                    <icons.IconCheck className="rolemenu__check" width={15} height={15} />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      <button ref={btn} type="button" className="usercard__btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : openMenu())} onKeyDown={onButtonKey} data-testid="role-switcher">
        <span className="avatar" aria-hidden="true">{initials(name ?? meta.label)}</span>
        {name
          ? <span className="usercard__text"><b>{name}</b><small>{meta.label}</small></span>
          : <span className="usercard__text"><b>{meta.label}</b><small>{mode === 'role-only' ? 'Role only · not a user' : SHELL_LABEL[meta.shell]}</small></span>}
        <span className="ds-visually-hidden">, sign in as another user (POC)</span>
        <icons.IconChevronUp className="usercard__chev" width={15} height={15} />
      </button>
    </div>
  )
}
