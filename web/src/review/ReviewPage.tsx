import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Button, Card, FindingCard, SeverityPill, SkeletonBlock, StatePanel, UploadStatusPill, useToast, formatPeriod, type Severity,
} from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { access, errorText, reviewApi } from './lib/api'
import { useLoad } from './lib/useLoad'
import { useMasterNames } from './lib/master'
import { ruleTitle } from './lib/rules'
import { findingBoxes, focusBox, getPointer } from './lib/provenance'
import { formatDateTime, pct, text } from './lib/format'
import type { Finding, OverrideChoice, Upload } from './lib/types'
import { PageCrop, PageViewer, type ViewerTarget } from './components/PageImage'
import { ExtractedValues } from './components/ExtractedValues'
import { CHOICES, NO_TARGET_REASON, OverrideDialog, PublishDialog, ReextractDialog, RejectDialog, WriteEffect } from './components/Dialogs'
import { hasTargets, isValueChoice } from './lib/corrections'
import { isReissueFinding, reissueInfo } from './lib/reissue'
import { ReissueBanner } from './components/Reissue'
import { Activity } from './components/Activity'
import { FindingCountPills } from './QueuePage'
import './review.css'

const SEVERITIES: Severity[] = ['block', 'review', 'note']
const ACTIVE = ['received', 'extracting'] as const
export const POLL_MS = 2000

export default function ReviewPage() {
  const { uploadId = '' } = useParams()
  return access().tao ? <Review uploadId={uploadId} /> : <NoAccess />
}

function NoAccess() {
  usePageHeader({ title: 'Review report' })
  return <StatePanel kind="no-access" />
}

function Review({ uploadId }: { uploadId: string }) {
  const { admin } = access()
  const { toast } = useToast()
  const upload = useLoad(() => reviewApi.upload(uploadId), [uploadId])
  const findings = useLoad(() => reviewApi.findings(uploadId), [uploadId])
  const extraction = useLoad(() => reviewApi.extraction(uploadId), [uploadId])
  const audit = useLoad(() => reviewApi.audit(uploadId), [uploadId], admin)
  const { dealName, programName } = useMasterNames()
  const replacesId = upload.data?.replaces_upload_id ?? null
  const replaced = useLoad(() => (replacesId ? reviewApi.upload(replacesId) : Promise.resolve(undefined)), [replacesId])

  const [viewer, setViewer] = useState<ViewerTarget | null>(null)
  const [override, setOverride] = useState<{ finding: Finding; choice: OverrideChoice } | null>(null)
  const [dialog, setDialog] = useState<'reject' | 'publish' | 'reextract' | null>(null)

  const u = upload.data
  const list = findings.data ?? []
  const reissue = upload.data ? reissueInfo(upload.data, findings.data) : null
  const openBlocks = list.filter(f => f.severity === 'block' && f.status === 'open')
  const status = u?.status
  const reviewable = status === 'needs_review' || status === 'approved'
  const title = u ? `${dealName(u.deal_slug)} · ${formatPeriod(u.collection_period)}` : 'Review report'

  const refresh = () => Promise.all([upload.reload(), findings.reload(), extraction.reload(), admin ? audit.reload() : Promise.resolve()])

  // While a (re-)extraction runs, poll the upload every 2 s; when it settles, reload everything else.
  const active = !!status && (ACTIVE as readonly string[]).includes(status)
  useEffect(() => {
    if (!active) return
    const h = setInterval(() => { upload.reload() }, POLL_MS)
    return () => clearInterval(h)
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps
  const [wasActive, setWasActive] = useState(false)
  useEffect(() => {
    if (active) setWasActive(true)
    else if (wasActive) { setWasActive(false); findings.reload(); extraction.reload(); if (admin) audit.reload() }
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  usePageHeader({
    title: u ? dealName(u.deal_slug) : 'Review report',
    status: u ? <UploadStatusPill status={u.status} /> : undefined,
    subtitle: u ? `${programName(u.program_slug)} · ${u.file_name}` : undefined,
    crumbs: [{ label: 'TAO Admin' }, { label: 'Uploads', href: '/admin/uploads' }, { label: 'Approval queue', href: '/admin/uploads/queue' }, { label: title }],
  })

  if (upload.error && !u) {
    const nf = (upload.error as { status?: number }).status === 404
    return nf
      ? <StatePanel kind="not-found" title="Upload not found" message="No upload has this id. It may have been removed." actions={<Button as="link" to="/admin/uploads/queue">Back to the queue</Button>} />
      : <StatePanel kind="error" message={errorText(upload.error)} actions={<Button onClick={() => refresh()}>Retry</Button>} />
  }
  if (!u) return <div className="rv-page" aria-busy="true"><Card><SkeletonBlock lines={3} /></Card><Card><SkeletonBlock lines={6} /></Card><span className="ds-visually-hidden">Loading</span></div>

  const ex = extraction.data
  const settlement = ex ? getPointer(ex.deal, '/settlement_date') : undefined
  const pass = ex?.pass ?? ex?.meta?.pass
  const confidence = ex?.confidence ?? ex?.meta?.confidence
  const reread = ex?.meta?.pages_reread

  const onOverrideDone = (next: Finding[], choice: OverrideChoice) => {
    const f = override!.finding
    findings.setData(next)
    setOverride(null)
    const stillBlocked = next.filter(x => x.severity === 'block' && x.status === 'open').length
    toast({ tone: 'ok', title: `${f.rule_id} resolved: ${CHOICES.find(c => c.id === choice)?.label}`,
      message: stillBlocked ? `Rules re-ran. ${stillBlocked} block finding${stillBlocked === 1 ? '' : 's'} still open.` : 'Rules re-ran. No block findings open.' })
    upload.reload(); extraction.reload(); if (admin) audit.reload()
  }
  const onDecision = (verb: 'published' | 'rejected' | 'reextract') => (next: Upload) => {
    upload.setData(next); setDialog(null)
    if (verb === 'published') toast({ tone: 'ok', title: 'Published to partner', message: title })
    if (verb === 'rejected') toast({ tone: 'warn', title: 'Report rejected', message: title })
    if (verb === 'reextract') toast({ tone: 'blue', title: 'Re-extraction queued', message: 'Findings refresh when the second pass finishes.' })
    refresh()
  }
  const openCrop = (f: Finding) => () => setViewer({ page: f.source_page!, boxes: findingBoxes(ex, f.fields, f.source_page), tone: 'finding', caption: `${f.rule_id} · ${ruleTitle(f.rule_id)}` })

  // Open findings: the four choices (use ours / use report disabled when the finding has no targets).
  // Resolved use ours / use report: what publishing writes (or wrote).
  const cardActions = (f: Finding) => {
    const choice = f.resolution?.choice
    if (f.status === 'overridden' && isValueChoice(choice) && hasTargets(f)) {
      return <p className="rv-pending" data-testid="pending-correction"><b>{u.status === 'published' ? 'Published.' : 'Pending on publish.'}</b>{' '}
        <WriteEffect ex={ex} finding={f} choice={choice} done={u.status === 'published'} /></p>
    }
    if (!(admin && reviewable && f.status === 'open')) return undefined
    // R12 on a corrected re-issue: accepting it as the replacement is the expected decision (Acknowledge + reason).
    if (reissue && isReissueFinding(f)) {
      return <>
        <Button size="sm" variant="primary" onClick={() => setOverride({ finding: f, choice: 'acknowledge' })} aria-label={`Accept as replacement for ${f.rule_id}`}>Accept as replacement</Button>
        <span className="rv-hint">Acknowledges the re-issue with a reason. To refuse it, use Reject below.</span>
      </>
    }
    const noTarget = !hasTargets(f)
    return <>{CHOICES.map(c => {
      const off = noTarget && isValueChoice(c.id)
      return <Button key={c.id} size="sm" disabled={off} title={off ? NO_TARGET_REASON : undefined} onClick={() => setOverride({ finding: f, choice: c.id })}
        aria-label={`${c.label} for ${f.rule_id}`}>{c.label}</Button>
    })}{noTarget && <span className="rv-hint">{NO_TARGET_REASON}</span>}</>
  }
  const goToFinding = (id: string) => {
    setDialog(null)
    requestAnimationFrame(() => {
      const card = document.getElementById(`finding-${id}-title`)?.closest('article') as HTMLElement | null
      if (!card) return
      card.setAttribute('tabindex', '-1')
      if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'center' })
      card.focus()
    })
  }

  const suggestedPages = [...new Set(list.filter(f => f.status === 'open' && f.source_page != null).map(f => f.source_page!))].sort((a, b) => a - b)

  return (
    <div className="rv-page">
      <ReissueBanner upload={u} dealName={dealName(u.deal_slug)} info={reissue} replacedPublishedAt={replaced.data?.published_at} />
      <Card aria-label="Report" title="Report" subtitle={`${u.file_name}${u.page_count ? ` · ${u.page_count} pages` : ''}`}>
        <dl className="rv-facts">
          <div><dt>Deal</dt><dd>{dealName(u.deal_slug)}<small>{programName(u.program_slug)}</small></dd></div>
          <div><dt>Collection period</dt><dd>{formatPeriod(u.collection_period)}{typeof settlement === 'string' && <small>settlement {settlement}</small>}</dd></div>
          <div><dt>Reporting period</dt><dd>{formatPeriod(u.reporting_period ?? ex?.meta?.reporting_period ?? null)}<small>page-header month</small></dd></div>
          <div><dt>Uploaded</dt><dd>{formatDateTime(u.uploaded_at)}<small>by {u.uploaded_by}</small></dd></div>
          <div><dt>Extraction</dt><dd>{pass ? `Pass ${pass}` : '—'}<small>{reread && reread.length ? `re-read page${reread.length === 1 ? '' : 's'} ${reread.join(', ')}` : ex?.meta?.template_id ?? ''}</small></dd></div>
          <div><dt>Confidence</dt><dd>{typeof confidence === 'number' ? pct(confidence) : '—'}<small>extraction</small></dd></div>
          <div><dt>Findings</dt><dd><FindingsFact findings={findings.data} counts={u.finding_counts} /></dd></div>
          {u.published_at && <div><dt>Published</dt><dd>{formatDateTime(u.published_at)}</dd></div>}
          {u.reject_reason && <div><dt>Reject reason</dt><dd>{text(u.reject_reason)}</dd></div>}
        </dl>
      </Card>

      <Card title="Findings" subtitle={findings.data ? `${list.filter(f => f.status === 'open').length} open · ${list.filter(f => f.status !== 'open').length} resolved` : undefined}>
        {findings.error && !findings.data ? (
          <StatePanel kind="error" message={errorText(findings.error)} actions={<Button onClick={() => findings.reload()}>Retry</Button>} />
        ) : !findings.data ? (
          <div aria-busy="true"><SkeletonBlock lines={4} /><span className="ds-visually-hidden">Loading findings</span></div>
        ) : list.length === 0 ? (
          <p className="rv-allclear">No findings. Every rule passed for this extraction.</p>
        ) : SEVERITIES.map(sev => {
          const group = list.filter(f => f.severity === sev).sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open') || a.rule_id.localeCompare(b.rule_id))
          if (group.length === 0) return null
          const openN = group.filter(f => f.status === 'open').length
          return (
            <section key={sev} className="rv-group" aria-label={`${sev} findings`}>
              <div className="rv-group__head"><SeverityPill severity={sev} count={group.length} size="sm" /><span className="rv-muted">{openN} open</span></div>
              {group.map(f => (
                <FindingCard key={f.id} finding={f} ruleTitle={ruleTitle(f.rule_id)} actions={cardActions(f)}
                  crop={f.source_page != null ? <PageCrop uploadId={uploadId} page={f.source_page} boxes={findingBoxes(ex, f.fields, f.source_page)} focus={focusBox(ex, f.fields, f.source_page, f.report_value)} onZoom={openCrop(f)} /> : undefined} />
              ))}
            </section>
          )
        })}
      </Card>

      {extraction.error && !ex ? (
        <Card title="Extracted values"><StatePanel kind="empty" title="No extraction yet" message={errorText(extraction.error)} /></Card>
      ) : ex ? (
        <ExtractedValues ex={ex} onOpen={setViewer} />
      ) : (
        <Card title="Extracted values"><div aria-busy="true"><SkeletonBlock lines={6} /></div></Card>
      )}

      {admin && <Activity entries={audit.data ?? []} findings={list} loading={audit.loading} />}

      <Footer upload={u} admin={admin} openBlocks={openBlocks.length} onReextract={() => setDialog('reextract')} onReject={() => setDialog('reject')} onPublish={() => setDialog('publish')} />

      <PageViewer uploadId={uploadId} target={viewer} pageCount={u.page_count} onClose={() => setViewer(null)} />
      {admin && <>
        <OverrideDialog uploadId={uploadId} finding={override?.finding ?? null} ex={ex} initialChoice={override?.choice ?? 'use_ours'} onClose={() => setOverride(null)} onDone={onOverrideDone} />
        <RejectDialog upload={u} open={dialog === 'reject'} title={title} onClose={() => setDialog(null)} onDone={onDecision('rejected')} />
        <PublishDialog upload={u} open={dialog === 'publish'} title={title} partner={partnersLabel(u)} findings={list} ex={ex} reissue={reissue} replacedPublishedAt={replaced.data?.published_at} onClose={() => setDialog(null)} onDone={onDecision('published')} onGoTo={goToFinding} />
        <ReextractDialog upload={u} open={dialog === 'reextract'} suggested={suggestedPages} onClose={() => setDialog(null)} onDone={onDecision('reextract')} />
      </>}
    </div>
  )
}

/** Open findings by severity plus the resolved count, from the findings list once loaded (finding_counts before). */
function FindingsFact({ findings, counts }: { findings?: Finding[]; counts: Upload['finding_counts'] }) {
  if (!findings) return <FindingCountPills counts={counts} />
  const open = (s: Severity) => findings.filter(f => f.severity === s && f.status === 'open').length
  const resolved = findings.filter(f => f.status !== 'open').length
  if (findings.length === 0) return <span className="rv-muted">None</span>
  return (
    <span className="rv-pills">
      {SEVERITIES.map(s => open(s) > 0 && <SeverityPill key={s} severity={s} count={open(s)} size="sm" />)}
      {resolved > 0 && <small>{resolved} resolved</small>}
      {resolved === 0 && SEVERITIES.every(s => open(s) === 0) && <span className="rv-muted">None open</span>}
    </span>
  )
}

const PARTNER_NAME: Record<string, string> = { investor: 'Investor', manager: 'Manager' }
/** "the Investor and Manager portals": every partner on the program's visibility list (partner_slugs). */
export function partnersLabel(u: Pick<Upload, 'partner_slug' | 'partner_slugs'>) {
  const names = (u.partner_slugs?.length ? u.partner_slugs : [u.partner_slug]).map(s => PARTNER_NAME[s] ?? s)
  if (names.length === 1) return `the ${names[0]} portal`
  return `the ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} portals`
}

function Footer({ upload: u, admin, openBlocks, onReextract, onReject, onPublish }: {
  upload: Upload; admin: boolean; openBlocks: number; onReextract: () => void; onReject: () => void; onPublish: () => void
}) {
  const reason = useMemo(() => openBlocks > 0 ? `${openBlocks} block finding${openBlocks === 1 ? ' is' : 's are'} open. Resolve ${openBlocks === 1 ? 'it' : 'them'} before publishing.` : null, [openBlocks])
  let note: ReactNode
  if (u.status === 'received' || u.status === 'extracting') note = 'Extraction is running. This page refreshes every 2 seconds.'
  else if (u.replaced_by_upload_id) note = <>Replaced by a corrected re-issue; partners no longer see this report. <Link to={`/admin/uploads/queue/${u.replaced_by_upload_id}`}>Open the re-issue</Link></>
  else if (u.status === 'published') note = <>Published {formatDateTime(u.published_at)}. Partners can see it. <Link to="/admin/reports">Reports library</Link></>
  else if (u.status === 'rejected') note = `Rejected${u.reject_reason ? `: ${u.reject_reason}` : ''}.`
  // failure_reason is on the upload for every TAO role; without it (older API) the usual cause stands in.
  else if (u.status === 'extraction_failed') {
    const why = u.failure_reason ? `Extraction failed: ${u.failure_reason}.` : 'Extraction failed: the report could not be read. A scanned or blank PDF is the usual cause.'
    note = `${why} Upload a readable PDF for the same deal and period${admin ? ', or reject this upload with a reason' : ''}.`
  }
  else if (!admin) note = 'Read only. Only a TAO admin can resolve findings, re-extract, reject or publish.'
  else note = reason ?? 'All block findings are resolved. Ready to publish.'

  const actionable = admin && (u.status === 'needs_review' || u.status === 'approved')
  return (
    <div className="rv-footer" role="region" aria-label="Decision">
      <span id="rv-publish-reason" className={'rv-footer__note' + (actionable && reason ? ' rv-footer__note--bad' : '')}>{note}</span>
      {actionable && <>
        <Button onClick={onReextract}>Re-extract pages…</Button>
        <Button variant="danger" onClick={onReject}>Reject…</Button>
        <Button variant="primary" onClick={onPublish} disabled={openBlocks > 0} aria-describedby="rv-publish-reason">Publish to partner…</Button>
      </>}
      {admin && u.status === 'extraction_failed' && <Button variant="danger" onClick={onReject}>Reject…</Button>}
    </div>
  )
}
