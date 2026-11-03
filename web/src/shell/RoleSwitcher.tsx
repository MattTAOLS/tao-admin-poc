import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { icons } from '@/design/components'
import { ROLES, type Role } from './roles'

const SHELL_LABEL = { admin: 'TAO Solutions Inc.', investor: 'Investor Portal', manager: 'Manager Portal' } as const
const initials = (label: string) => label.split(/[\s·]+/).filter(w => /^[A-Z]/.test(w)).slice(0, 2).map(w => w[0]).join('') || label.slice(0, 2).toUpperCase()

/** The sidebar footer user card from the mockup. Doubles as the POC role switcher: click (or Enter / Space /
 * Arrow Up) opens a menu of the six roles; arrows move, Enter picks, Escape closes and returns focus. */
export function RoleSwitcher({ role, onChange }: { role: Role; onChange: (r: Role) => void }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(() => ROLES.findIndex(r => r.id === role))
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const meta = ROLES.find(r => r.id === role)!

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

  const openMenu = () => { setActive(ROLES.findIndex(r => r.id === role)); setOpen(true) }
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus() }
  const pick = (r: Role) => { close(); if (r !== role) onChange(r) }

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); openMenu() }
  }
  const onMenuKey = (e: KeyboardEvent) => {
    const n = ROLES.length
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
        <div className="rolemenu" role="menu" id={menuId} aria-label="Switch role (POC)" ref={menu} onKeyDown={onMenuKey}>
          <div className="rolemenu__head">Sign in as (POC role switcher)</div>
          {ROLES.map((r, i) => (
            <div key={r.id} role="menuitemradio" aria-checked={r.id === role} tabIndex={i === active ? 0 : -1}
              className={['rolemenu__opt', r.id === role && 'is-current'].filter(Boolean).join(' ')}
              onClick={() => pick(r.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(r.id) } }}
              onMouseEnter={() => setActive(i)}>
              <span>{r.label}<small>{SHELL_LABEL[r.shell]} · <code>{r.id}</code></small></span>
              <icons.IconCheck className="rolemenu__check" width={15} height={15} />
            </div>
          ))}
        </div>
      )}
      <button ref={btn} type="button" className="usercard__btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : openMenu())} onKeyDown={onButtonKey} data-testid="role-switcher">
        <span className="avatar" aria-hidden="true">{initials(meta.label)}</span>
        <span className="usercard__text"><b>{meta.label}</b><small>{SHELL_LABEL[meta.shell]}</small></span>
        <span className="ds-visually-hidden">, switch role</span>
        <icons.IconChevronUp className="usercard__chev" width={15} height={15} />
      </button>
    </div>
  )
}
