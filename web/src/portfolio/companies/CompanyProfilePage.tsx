/** /admin/companies/:companySlug and the partner equivalents: the Company profile (docs/phase2/designs/company-profile.html,
 * D6). One page for TAO and partners. `?deal=` picks the deal of a multi-deal company (TLFC has three; the first is the
 * default). Sections follow D6 order; TAO-only parts (Edit record, owner, adverse items not yet reviewed and their actions,
 * analyst notes, contact edits) disappear for partners and under "View as partner". A partner gets Not found on a 404. */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button, Card, DataTable, Field, Select, StatePanel, StatusPill, formatPeriod, useToast, type Column } from '@/design/components'
import { api } from '@/shell/api'
import { usePageHeader } from '@/shell/header'
import { paths, usePublished, type Load } from '../data'
import { links, useShell } from '../nav'
import { PageSkeleton, SHELL_TITLE } from '../shared'
import { Top10Panel } from '../Top10'
import type { Deal, Portfolio } from '../types'
import { FollowStar, StatusWord } from './cells'
import { AdverseDialog, ContactDialog, EditRecordDialog, RemoveContactDialog, type DealOption } from './dialogs'
import { NotesSection } from './notes'
import {
  AdverseSection, BalanceChartSection, BalanceSection, CovenantFocus, CovenantHistorySection, DocumentsSection, KpiSection, LossSection, NewsSection,
  PerformanceSection, RestatementsSection, Section, SignalsSection, featuredSeries, type Compare,
} from './sections'
import type { AdverseItem, Company, CompanyContact, CompanyDealRef, CompanyInsights, CompanyNewsSearch, CompanyNote, CompanyRow, NewsItem, TaoUser } from './types'
import { LANGUAGE_WORD, companyLinks, fmtDay, useCaller, useCompaniesEnabled } from './util'
import './companies.css'

export default function CompanyProfilePage() {
  const shell = useShell()
  const { companySlug = '' } = useParams()
  const enabled = useCompaniesEnabled()
  const load = usePublished<Company>(enabled ? `/companies/${encodeURIComponent(companySlug)}` : null)
  const name = load.state === 'ok' ? load.data.name : undefined
  usePageHeader({
    title: name ?? 'Company',
    crumbs: [{ label: SHELL_TITLE[shell] }, { label: 'Companies', href: companyLinks(shell).list() }, { label: name ?? companySlug }],
  })
  if (enabled === false || load.state === 'no-access') {
    return <StatePanel kind="not-found" title="Company not found" message="This company is not in a program shared with you, or the address is wrong."
      actions={enabled ? <Button as="link" to={companyLinks(shell).list()}>All companies</Button> : undefined} />
  }
  if (load.state === 'error') return <StatePanel kind="error" message={load.message} actions={<Button variant="primary" onClick={load.retry}>Retry</Button>} />
  if (enabled === null || load.state === 'loading') return <PageSkeleton />
  return <Profile key={load.data.slug} initial={load.data} />
}

/** TAO only: the company's news search settings (decision E7), read-only in the record panel. */
function NewsSearchSummary({ s }: { s: CompanyNewsSearch }) {
  const none = <span className="co-notset">None</span>
  return (
    <span className="co-name" data-testid="news-search">
      <span>Context words: {s.context_terms.length ? s.context_terms.join(', ') : none}</span>
      <span>Exclusions: {s.exclusions.length ? s.exclusions.join('; ') : none}</span>
      <span>Languages: {s.languages.map(l => LANGUAGE_WORD[l] ?? l).join(', ')}</span>
    </span>
  )
}

/** A GET that a section can show on its own: null while loading, 'error' on failure. */
function useGet<T>(path: string | null): [T | null | 'error', (fn: (v: T) => T) => void] {
  const [v, setV] = useState<{ path: string | null; data: T | null | 'error' }>({ path, data: null })
  useEffect(() => {
    if (!path) return
    let live = true
    setV({ path, data: null })
    api<T>(path).then(d => { if (live) setV({ path, data: d }) }, () => { if (live) setV({ path, data: 'error' }) })
    return () => { live = false }
  }, [path])
  const update = (fn: (x: T) => T) => setV(s => (s.data === null || s.data === 'error' ? s : { ...s, data: fn(s.data as T) }))
  return [v.path === path ? v.data : null, update]
}

function Profile({ initial }: { initial: Company }) {
  const shell = useShell()
  const L = links(shell)
  const CL = companyLinks(shell)
  const { toast } = useToast()
  const { tao, admin, user, signedIn } = useCaller()
  const [company, setCompany] = useState(initial)
  const [search, setSearch] = useSearchParams()
  const [asPartner, setAsPartner] = useState(false)
  const partnerView = !tao || asPartner
  const [compare, setCompare] = useState<Compare>('median')
  const [editing, setEditing] = useState(false)
  const [contact, setContact] = useState<CompanyContact | null | 'new'>(null)
  const [removing, setRemoving] = useState<CompanyContact | null>(null)
  const [acting, setActing] = useState<{ item: AdverseItem; action: 'review' | 'dismiss' } | null>(null)
  const [showExcluded, setShowExcluded] = useState(false)

  const slug = company.slug
  const enc = encodeURIComponent(slug)
  const deals = company.deals
  const wanted = search.get('deal')
  const ref: CompanyDealRef | undefined = deals.find(d => d.deal_slug === wanted) ?? deals[0]
  const published = !!ref?.latest_period

  const dealLoad: Load<Deal> = usePublished<Deal>(ref && published ? paths.deal(ref.program_slug, ref.deal_slug) : null)
  const [ins] = useGet<CompanyInsights>(ref && published ? `/companies/${enc}/deals/${encodeURIComponent(ref.deal_slug)}/insights` : null)
  // TAO only: "Show excluded" adds the stories the check excluded and those awaiting it (include=all). Never sent for
  // partners or under "View as partner".
  const [news] = useGet<NewsItem[]>(`/companies/${enc}/news?days=30${!partnerView && showExcluded ? '&include=all' : ''}`)
  const [adverse, setAdverse] = useGet<AdverseItem[]>(`/companies/${enc}/adverse`)
  const [rows] = useGet<CompanyRow[]>('/companies')
  const [notes, setNotes] = useGet<CompanyNote[]>(tao ? `/companies/${enc}/notes` : null)
  const [users] = useGet<TaoUser[]>(tao ? '/users?partner_slug=tao&status=active' : null)
  const [portfolio] = useGet<Portfolio>(admin && editing ? '/published/portfolio' : null)
  const row = Array.isArray(rows) ? rows.find(r => r.slug === slug) ?? null : null
  const d = dealLoad.state === 'ok' ? dealLoad.data : null
  const insights = ins && ins !== 'error' ? ins : null
  const taoUsers = Array.isArray(users) ? users.filter(u => u.status === 'active' && (u.role === 'tao_admin' || u.role === 'tao_analyst')) : []
  const focusNote = search.get('note')

  useEffect(() => {
    if (!focusNote || !Array.isArray(notes)) return
    const el = document.getElementById(`note-${focusNote}`)
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
  }, [focusNote, notes])

  const programs = [...new Set(deals.map(x => x.program_name))]
  const dealOptions: DealOption[] = useMemo(() => {
    if (!portfolio || portfolio === 'error') return deals.map(x => ({ deal_slug: x.deal_slug, deal_name: x.deal_name, program_name: x.program_name }))
    return portfolio.programs.flatMap(p => p.deals.map(x => ({ deal_slug: x.deal_slug, deal_name: x.deal_name, program_name: p.program?.name ?? '' })))
      .sort((a, b) => a.program_name.localeCompare(b.program_name) || a.deal_name.localeCompare(b.deal_name))
  }, [portfolio, deals])

  const shortDeal = (name: string) => name.replace(/^.*?\s-\s/, '')
  const dealLabel = ref ? (deals.length > 1 ? shortDeal(ref.deal_name) : company.name) : company.name
  const cs = d?.covenant_summary
  const months = (d?.period_history ?? []).map(p => p.period).reverse()
  const notSet = <span className="co-notset">Not set</span>
  const val = (v: string | null | undefined) => (v ? v : notSet)
  const nr = ref?.next_report ?? null
  const focus = insights ? featuredSeries(insights, d) : null

  const contactCols: Column<CompanyContact>[] = [
    { key: 'name', header: 'Name', emphasis: true, render: c => c.name },
    { key: 'role', header: 'Role', render: c => c.role ?? <span className="pf-muted">—</span> },
    { key: 'email', header: 'Email', render: c => (c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span className="pf-muted">—</span>) },
    { key: 'receives', header: 'Receives', render: c => c.receives ?? <span className="pf-muted">—</span> },
    ...(admin && !partnerView ? [{ key: 'acts', header: '', ariaLabel: 'Actions', align: 'right' as const, render: (c: CompanyContact) => (
      <span className="pf-actions">
        <Button size="sm" onClick={() => setContact(c)} aria-label={`Edit ${c.name}`}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={() => setRemoving(c)} aria-label={`Remove ${c.name}`}>Remove</Button>
      </span>
    ) }] : []),
  ]

  return (
    <div className="pf-stack">
      {/* Header and record (D6 note 1) */}
      <Card id="record" className="co-anchor">
        <div className="co-head">
          <div className="co-head__top">
            <div className="co-head__title">
              <h2>{company.name}{ref && <StatusWord status={ref.worst_status} size="md" />}</h2>
              <span className="co-sub">
                {programs.join(', ')}
                {ref?.latest_period && <> · latest report {formatPeriod(ref.latest_period)}{d?.settlement_date ? ` (settlement ${d.settlement_date})` : ''}</>}
                {cs && <> · {cs.WATCH} covenant{cs.WATCH === 1 ? '' : 's'} at watch, {cs.BREACH} in breach</>}
              </span>
            </div>
            <div className="pf-actions">
              {tao && (
                <div className="co-toggle" role="group" aria-label="View as">
                  <button type="button" aria-pressed={!asPartner} onClick={() => setAsPartner(false)}>TAO view</button>
                  <button type="button" aria-pressed={asPartner} onClick={() => setAsPartner(true)}>View as partner</button>
                </div>
              )}
              <FollowStar variant="button" slug={slug} name={company.name} following={company.following} signedIn={signedIn}
                onChange={following => setCompany(c => ({ ...c, following }))} />
              {ref && published && <Button as="link" size="sm" to={L.deal(ref.program_slug, ref.deal_slug, ref.latest_period ?? undefined)}>Open deal dashboard</Button>}
              {admin && !partnerView && <Button size="sm" variant="primary" onClick={() => setEditing(true)}>Edit record</Button>}
            </div>
          </div>
          {asPartner && <p className="co-partnerbanner" role="status">Partner view: TAO-only sections are hidden. This is what a partner with this program shared sees.</p>}
          {deals.length > 1 && (
            <div className="pf-toolbar">
              <Field label="Deal">
                <Select value={ref?.deal_slug ?? ''} onChange={e => { const s = new URLSearchParams(search); s.set('deal', e.target.value); s.delete('note'); setSearch(s, { replace: true }) }}
                  options={deals.map(x => ({ value: x.deal_slug, label: `${shortDeal(x.deal_name)} · ${x.program_name}` }))} />
              </Field>
              <span className="pf-muted pf-small">{company.name} has {deals.length} deals. Figures below are for the deal chosen.</span>
            </div>
          )}
          <div className="co-record">
            <dl className="pf-dl pf-dl--wide">
              <dt>Industry</dt><dd>{val(company.industry)}{company.naics && <span className="pf-muted"> · NAICS {company.naics}</span>}</dd>
              <dt>Headquarters</dt><dd>{val(company.headquarters)}</dd>
              <dt>Website</dt><dd>{company.website ? <a href={/^https?:\/\//.test(company.website) ? company.website : `https://${company.website}`} target="_blank" rel="noopener noreferrer">{company.website}</a> : notSet}</dd>
              <dt>Program and deal</dt><dd>{ref ? `${ref.program_name} · ${ref.deal_name}` : notSet}</dd>
              <dt>Relationship since</dt>
              <dd>{company.relationship_since ? <>{formatPeriod(company.relationship_since)}{company.relationship_since_source === 'first_vintage' && <span className="pf-muted"> · first vintage in the report's CNL table</span>}</> : notSet}</dd>
            </dl>
            <dl className="pf-dl pf-dl--wide">
              <dt>Latest report</dt>
              <dd>{ref?.latest_period ? <>{formatPeriod(ref.latest_period)} collection period{d?.settlement_date && ` · settlement ${d.settlement_date}`}{d?.source_file && <span className="pf-muted"> · {d.source_file}</span>}</> : 'Not published yet'}</dd>
              <dt>Next report due</dt>
              <dd>{nr ? <>{formatPeriod(nr.period)} report, expected by {fmtDay(nr.due_on)}{nr.late && <> · <StatusWord status="BREACH" /> <span className="pf-strong">Late, {nr.business_days_late} business day{nr.business_days_late === 1 ? '' : 's'}</span></>}</> : <span className="co-notset">No expected day set</span>}</dd>
              {!partnerView && <><dt>TAO relationship owner</dt><dd>{company.owner ? company.owner.name : notSet}</dd></>}
              {company.aliases.length > 0 && <><dt>Also known as</dt><dd>{company.aliases.join(', ')}</dd></>}
              {!partnerView && company.news_search && <><dt>News search <StatusPill tone="dpv" size="sm">TAO only</StatusPill></dt><dd><NewsSearchSummary s={company.news_search} /></dd></>}
            </dl>
          </div>
        </div>
      </Card>

      {!ref ? <StatePanel kind="empty" title="No deals" message="No deal of this company is visible to you." />
        : !published ? <StatePanel kind="empty" title="Not published yet" message={`${ref.deal_name} has no published report yet. Figures appear here after TAO publishes one.`} />
        : dealLoad.state === 'loading' ? <PageSkeleton />
        : dealLoad.state !== 'ok' ? <StatePanel kind="error" message={dealLoad.state === 'error' ? dealLoad.message : 'The published deal could not be read.'} />
        : d && (
          <>
            <KpiSection d={d} />
            {ins === null ? <PageSkeleton />
              : ins === 'error' ? <StatePanel kind="error" title="Insights not available" message="The computed sections (signals, charts, covenant history) could not be loaded." />
              : insights && (
                <>
                  <SignalsSection signals={insights.signals} period={ref.latest_period!} />
                  <PerformanceSection ins={insights} dealLabel={dealLabel} compare={compare} setCompare={setCompare} exclude={focus?.s.metric} />
                  <div className="co-sectiongrid">
                    <LossSection ins={insights} dealLabel={dealLabel} />
                    {focus && <CovenantFocus f={focus} ins={insights} dealLabel={dealLabel} buffer={d.watch_buffer_pct} />}
                    <BalanceChartSection d={d} ins={insights} />
                  </div>
                  <BalanceSection d={d} ins={insights} />
                  <CovenantHistorySection ins={insights} />
                </>
              )}
            <div id="obligors" className="co-anchor">
              {(d.top10_obligors ?? []).length ? <Top10Panel d={d} /> : (
                <Section id="obligors-none" title="Top obligor concentration"><p className="pf-muted">This deal's report has no top obligor table.</p></Section>
              )}
            </div>
            {insights && <RestatementsSection ins={insights} />}
          </>
        )}

      <NewsSection items={news} screened={row ? row.adverse.state !== 'not_screened' : null}
        taoView={!partnerView} showExcluded={showExcluded} onShowExcluded={setShowExcluded} />
      <AdverseSection items={adverse} row={row} partnerView={partnerView} admin={admin} onAct={(item, action) => setActing({ item, action })} />

      <Section id="alerts" title="Watchlist and alerts" subtitle="Per person. Following adds this company to your watchlist and turns on its alerts.">
        <div className="co-alerts">
          <FollowStar variant="button" slug={slug} name={company.name} following={company.following} signedIn={signedIn}
            onChange={following => setCompany(c => ({ ...c, following }))} />
          <span>{company.following ? 'You get adverse media and negative news alerts for this company in Notifications.' : 'Follow to get adverse media and negative news alerts in Notifications.'}</span>
          <Link to={CL.profileSettings()}>Profile › Notification preferences</Link>
          <span className="co-later">Email: coming later</span>
        </div>
        {!signedIn && <p className="co-hint">Following needs a signed-in user. Use “Sign in as (POC)” in the sidebar.</p>}
      </Section>

      {tao && !partnerView && (
        <Section id="notes" title="Analyst notes" tao subtitle="Internal. Never shown to partners and never sent through the partner API.">
          <NotesSection slug={slug} notes={notes} setNotes={fn => setNotes(fn)} users={taoUsers} user={user} admin={admin} months={months} focusId={focusNote} />
        </Section>
      )}

      <Section id="contacts" title="Key contacts"
        actions={admin && !partnerView ? <Button size="sm" onClick={() => setContact('new')}>Add contact</Button> : undefined}>
        <DataTable caption="Key contacts" captionHidden density="compact" columns={contactCols} rows={company.contacts} rowKey={c => c.id}
          empty={{ title: 'No contacts yet', message: admin && !partnerView ? 'Add the people TAO deals with at this company.' : 'TAO has not listed contacts for this company.' }} />
      </Section>

      {d && <DocumentsSection d={d} tao={tao} href={tao ? CL.reports() : CL.dataRoom()} linkLabel={tao ? 'Reports library' : 'Data room'} />}

      {editing && <EditRecordDialog company={company} users={users === 'error' ? null : taoUsers} deals={dealOptions}
        onClose={() => setEditing(false)}
        onSaved={c => { setCompany(c); setEditing(false); toast({ tone: 'ok', title: 'Record saved', message: 'The change is in the audit log.' }) }} />}
      {contact && <ContactDialog slug={slug} contact={contact === 'new' ? null : contact} onClose={() => setContact(null)}
        onSaved={c => {
          setCompany(x => ({ ...x, contacts: contact === 'new' ? [...x.contacts, c] : x.contacts.map(y => (y.id === c.id ? c : y)) }))
          setContact(null); toast({ tone: 'ok', title: contact === 'new' ? 'Contact added' : 'Contact saved' })
        }} />}
      {removing && <RemoveContactDialog contact={removing} onClose={() => setRemoving(null)}
        onRemoved={() => { setCompany(x => ({ ...x, contacts: x.contacts.filter(y => y.id !== removing.id) })); setRemoving(null); toast({ tone: 'ok', title: 'Contact removed' }) }} />}
      {acting && <AdverseDialog item={acting.item} action={acting.action} onClose={() => setActing(null)}
        onDone={a => { setAdverse(list => list.map(x => (x.id === a.id ? a : x))); setActing(null); toast({ tone: 'ok', title: acting.action === 'review' ? 'Marked reviewed' : 'Dismissed' }) }} />}
    </div>
  )
}
