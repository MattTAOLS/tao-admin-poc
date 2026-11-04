import { Fragment, useEffect, useMemo } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Button, Card, DataTable, Field, Input, StatePanel, type Column } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { ROLES, loadRole, type Role } from '@/shell/roles'
import { ADMIN_HELP, PARTNER_HELP, type GlossaryEntry, type HelpBlock, type HelpContent, type HelpSection } from './content'
import './help.css'

export type HelpShell = 'admin' | 'investor' | 'manager'
const PORTAL: Record<HelpShell, string> = { admin: 'TAO Admin', investor: 'Investor Portal', manager: 'Manager Portal' }
export const GLOSSARY_ID = 'glossary'

export const shellOf = (pathname: string): HelpShell => {
  const seg = pathname.split('/')[1]
  return seg === 'investor' || seg === 'manager' ? seg : 'admin'
}
export const contentFor = (shell: HelpShell): HelpContent => (shell === 'admin' ? ADMIN_HELP : PARTNER_HELP)

const allowed = (roles: Role[] | undefined, role: Role) => !roles || roles.includes(role)

/** The content one role may see: sections, steps, points and glossary entries tagged for other roles are dropped,
 * and a section left with nothing in it is dropped too. */
export function forRole(c: HelpContent, role: Role): HelpContent {
  const keep = (bs?: HelpBlock[]) => bs?.filter(b => allowed(b.roles, role))
  const sections = c.sections
    .filter(s => allowed(s.roles, role))
    .map(s => ({ ...s, steps: keep(s.steps), points: keep(s.points) }))
    .filter(s => s.intro || s.steps?.length || s.points?.length || s.table)
  return { ...c, sections, glossary: c.glossary.filter(g => allowed(g.roles, role)) }
}

// ---- inline markup: **bold**, [text](/path) and [text](#section) --------------------------------------------------

export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'link'; text: string; to: string }
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of src.matchAll(INLINE)) {
    if (m.index! > last) out.push({ kind: 'text', text: src.slice(last, m.index) })
    out.push(m[1] !== undefined ? { kind: 'bold', text: m[1] } : { kind: 'link', text: m[2], to: m[3] })
    last = m.index! + m[0].length
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) })
  return out
}

/** Plain text of a marked-up string, for search. */
export const plain = (src: string) => parseInline(src).map(t => t.text).join('')

/** A link target as a router path: partner paths gain the portal prefix; #anchors stay on this page. */
export function resolveLink(to: string, shell: HelpShell): string {
  if (to.startsWith('#') || shell === 'admin') return to
  return `/${shell}${to}`
}

/** Every link target in a content tree (unresolved), for the link test. */
export function linkTargets(c: HelpContent): string[] {
  const texts = c.sections.flatMap(s => [s.intro ?? '', ...(s.steps ?? []).map(b => b.text), ...(s.points ?? []).map(b => b.text)])
  return texts.flatMap(t => parseInline(t).flatMap(x => (x.kind === 'link' ? [x.to] : [])))
}

// ---- search ---------------------------------------------------------------------------------------------------------

const fill = (s: string, shell: HelpShell) => s.replace(/\{portal\}/g, PORTAL[shell])
const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)

export function sectionText(s: HelpSection): string {
  return [s.title, s.intro ?? '', ...(s.steps ?? []).map(b => b.text), ...(s.points ?? []).map(b => b.text),
    ...(s.table ? [...s.table.head, ...s.table.rows.flat()] : [])].map(plain).join(' ').toLowerCase()
}
/** A section matches when every word of the query appears somewhere in it. */
export const matchesSection = (s: HelpSection, q: string) => { const t = sectionText(s); return words(q).every(w => t.includes(w)) }
export const matchesTerm = (g: GlossaryEntry, q: string) => { const t = `${g.term} ${g.meaning}`.toLowerCase(); return words(q).every(w => t.includes(w)) }

// ---- rendering ------------------------------------------------------------------------------------------------------

function Rich({ text, shell }: { text: string; shell: HelpShell }) {
  return <>{parseInline(fill(text, shell)).map((t, i) =>
    t.kind === 'bold' ? <b key={i}>{t.text}</b>
      : t.kind === 'link' ? <Link key={i} className="help-link" to={resolveLink(t.to, shell)}>{t.text}</Link>
        : <Fragment key={i}>{t.text}</Fragment>)}</>
}

function Section({ s, shell }: { s: HelpSection; shell: HelpShell }) {
  const titleId = `${s.id}-title`
  return (
    <Card as="section" id={s.id} tabIndex={-1} className="help-section" aria-labelledby={titleId}
      title={<span id={titleId}>{s.title}</span>}
      actions={<Link className="help-anchor" to={{ hash: s.id }} aria-label={`Link to this section: ${s.title}`}>Link</Link>}>
      {s.intro && <p className="help-intro"><Rich text={s.intro} shell={shell} /></p>}
      {s.steps && s.steps.length > 0 && <ol className="help-steps">{s.steps.map((b, i) => <li key={i}><Rich text={b.text} shell={shell} /></li>)}</ol>}
      {s.points && s.points.length > 0 && <ul className="help-points">{s.points.map((b, i) => <li key={i}><Rich text={b.text} shell={shell} /></li>)}</ul>}
      {s.table && <HelpTableView t={s.table} />}
    </Card>
  )
}

function HelpTableView({ t }: { t: NonNullable<HelpSection['table']> }) {
  const columns: Column<string[]>[] = t.head.map((h, i) => ({ key: String(i), header: h, render: r => r[i], emphasis: i === 0 }))
  return <div className="help-table"><DataTable columns={columns} rows={t.rows} rowKey={r => r[0]} caption={t.caption} density="compact" /></div>
}

/** Help & support for the current shell and role: task sections, a glossary, a search box and anchor links. */
export default function HelpPage() {
  const shell = shellOf(useLocation().pathname)
  return <HelpView shell={shell} role={loadRole()} />
}

export function HelpView({ shell, role }: { shell: HelpShell; role: Role }) {
  const loc = useLocation()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const content = useMemo(() => forRole(contentFor(shell), role), [shell, role])
  const sections = content.sections.filter(s => matchesSection(s, q))
  const glossary = content.glossary.filter(g => matchesTerm(g, q))
  const roleLabel = ROLES.find(r => r.id === role)?.label ?? role
  usePageHeader({ title: 'Help & support', subtitle: fill(content.intro, shell) })

  const setQ = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('q', v); else next.delete('q')
    setParams(next, { replace: true })
  }

  // Scroll to #section on load and whenever the hash changes; focus it so keyboard users land there too.
  useEffect(() => {
    if (!loc.hash) return
    const el = document.getElementById(decodeURIComponent(loc.hash.slice(1)))
    if (!el) return
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' })
    el.focus({ preventScroll: true })
  }, [loc.hash])

  const showGlossary = glossary.length > 0
  const nothing = sections.length === 0 && !showGlossary
  return (
    <div className="help">
      <Card>
        <form className="help-search" role="search" aria-label="Search help" onSubmit={e => e.preventDefault()}>
          <Field label="Search help" hint="Type a task or a word, e.g. publish, re-issue, WATCH.">
            <Input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search" autoComplete="off" />
          </Field>
          {q && <Button onClick={() => setQ('')}>Clear search</Button>}
        </form>
        <p className="help-role" aria-live="polite">
          {q ? `${sections.length} of ${content.sections.length} sections${showGlossary ? ` and ${glossary.length} glossary ${glossary.length === 1 ? 'entry' : 'entries'}` : ''} match “${q}”. `
            : `Showing help for ${roleLabel}. `}
          Switch role in the sidebar to see what another role can do.
        </p>
      </Card>

      {nothing ? (
        <StatePanel kind="empty" title="Nothing matches" message={`No section or glossary entry contains “${q}”. Try a shorter word.`}
          actions={<Button onClick={() => setQ('')}>Clear search</Button>} />
      ) : (
        <>
          <Card title="On this page">
            <ul className="help-toc">
              {sections.map(s => <li key={s.id}><Link className="help-link" to={{ search: loc.search, hash: s.id }}>{s.title}</Link></li>)}
              {showGlossary && <li><Link className="help-link" to={{ search: loc.search, hash: GLOSSARY_ID }}>What the words mean</Link></li>}
            </ul>
          </Card>
          {sections.map(s => <Section key={s.id} s={s} shell={shell} />)}
          {showGlossary && (
            <Card as="section" id={GLOSSARY_ID} tabIndex={-1} className="help-section" aria-labelledby={`${GLOSSARY_ID}-title`}
              title={<span id={`${GLOSSARY_ID}-title`}>What the words mean</span>}
              actions={<Link className="help-anchor" to={{ hash: GLOSSARY_ID }} aria-label="Link to this section: What the words mean">Link</Link>}>
              <dl className="help-glossary">
                {glossary.map(g => <div key={g.term}><dt>{g.term}</dt><dd><Rich text={g.meaning} shell={shell} /></dd></div>)}
              </dl>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

