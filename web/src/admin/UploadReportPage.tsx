import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Card, Dialog, Field, FileDrop, Input, Select, SkeletonBlock, UploadStatusPill, formatNumber, formatPeriod, icons, useToast,
} from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { adminApi, IN_FLIGHT, type ApiError, type Upload } from './data'
import { useResource } from './hooks'
import { FindingCountsText, LoadError, TextLink, dealOptions, errorText, formatDateTime, periodHistoryHref, prevMonth, reviewHref, totalFindings } from './ui'

export const POLL_MS = 2000
const DROP_TEXT = 'Drop the settlement report PDF here, or click to choose'
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const STEPS = ['received', 'extracting', 'needs_review'] as const
const STEP_LABEL = { received: 'Received', extracting: 'Extracting', needs_review: 'Needs review' }

/** Upload report: deal and collection period first, then the PDF. After upload, both dates come back and the
 * status moves received → extracting → needs review, polled every 2 s. */
export default function UploadReportPage() {
  const nav = useNavigate()
  usePageHeader({ title: 'Upload report', subtitle: 'Pick the deal and collection period, then drop the settlement report PDF.',
    actions: <Button onClick={() => nav('/admin/uploads/history')}>Upload history</Button> })
  const master = useResource(() => Promise.all([adminApi.deals(), adminApi.programs()]), [])
  const [deal, setDeal] = useState('')
  const [period, setPeriod] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string>()
  const [submitError, setSubmitError] = useState<string>()
  const [periodTouched, setPeriodTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [upload, setUpload] = useState<Upload>()
  /** "This is a corrected re-issue": sends replace=true. */
  const [reissue, setReissue] = useState(false)
  /** Set when the API answered 409 already_published: the confirm dialog is open. */
  const [conflict, setConflict] = useState(false)
  const { toast } = useToast()
  const periodValid = PERIOD.test(period)
  // The published upload for the chosen deal + period, if any (drives the re-issue checkbox and the confirm text).
  // A failure here only hides the hint; the API's 409 still catches a published period.
  const published = useResource(
    () => (deal && periodValid ? adminApi.uploads({ deal_slug: deal, collection_period: period, status: 'published' }) : Promise.resolve([] as Upload[])),
    [deal, periodValid ? period : ''],
  )
  const publishedUpload = (published.data ?? []).find(u => u.deal_slug === deal && u.collection_period === period && u.status === 'published')
  useEffect(() => { setReissue(false); setConflict(false) }, [deal, period])

  if (master.error) return <LoadError error={master.error} onRetry={master.reload} />
  if (master.loading && !master.data) return <Card title="Report details"><SkeletonBlock lines={4} /><span className="ds-visually-hidden">Loading deals</span></Card>
  const [deals, programs] = master.data!
  if (deals.length === 0) return <LoadError error={Object.assign(new Error('No deals are set up yet. Add one under Partners first.'), { status: 404 })} />

  const periodOk = PERIOD.test(period)
  const ready = !!deal && periodOk
  const periodError = periodTouched && period && !periodOk ? 'Use YYYY-MM, e.g. 2026-08.' : undefined
  const dealName = (slug: string) => deals.find(d => d.slug === slug)?.name ?? slug

  const send = async (replace: boolean) => {
    if (!ready || !file) return
    setBusy(true); setSubmitError(undefined)
    try {
      const u = await adminApi.createUpload(deal, period, file, replace)
      setConflict(false)
      setUpload(u)
      toast({ tone: 'ok', title: replace ? 'Corrected re-issue uploaded' : 'Report uploaded', message: `${dealName(deal)} · ${formatPeriod(period)}` })
    } catch (err) {
      const e = err as ApiError
      if (e.code === 'already_published' && !replace) { setConflict(true); published.reload() }
      else { setConflict(false); setSubmitError(errorText(e)) }
    } finally { setBusy(false) }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); send(reissue) }
  const reset = () => { setUpload(undefined); setFile(null); setSubmitError(undefined); setFileError(undefined); setReissue(false); setConflict(false) }
  const publishedOn = publishedUpload?.published_at ? ` (on ${formatDateTime(publishedUpload.published_at)})` : ''

  if (upload) return <UploadProgress initial={upload} dealName={dealName(upload.deal_slug)} onAnother={reset} replaced={publishedUpload} />

  return (
    <form className="adm-stack" onSubmit={submit} noValidate aria-label="Upload a settlement report">
      <Card title="1. Deal and collection period" subtitle="Both are required before you can choose the file.">
        <div className="adm-form__row">
          <Field label="Deal" required hint="Grouped by program.">
            <Select value={deal} onChange={e => setDeal(e.target.value)} placeholder="Choose a deal" options={dealOptions(deals, programs)} />
          </Field>
          <Field label="Collection period" required error={periodError}
            hint="Settlement month on the report cover, e.g. 2026-08 for a report settled 7 Aug 2026.">
            <Input type="text" inputMode="numeric" autoComplete="off" maxLength={7} value={period} placeholder="YYYY-MM" pattern="\d{4}-\d{2}"
              onChange={e => setPeriod(e.target.value)} onBlur={() => setPeriodTouched(true)} />
          </Field>
        </div>
      </Card>
      <Card title="2. Settlement report" subtitle={ready ? `${dealName(deal)} · ${formatPeriod(period)}` : 'Choose the deal and collection period first.'}>
        <div className="adm-stack">
          <FileDrop accept=".pdf,application/pdf" disabled={!ready || busy} value={file} label={DROP_TEXT} title={DROP_TEXT} error={fileError}
            onFiles={fs => { setFile(fs[0]); setFileError(undefined); setSubmitError(undefined) }}
            onReject={reason => { setFile(null); setFileError(reason) }}
            onClear={() => setFile(null)} />
          {ready && publishedUpload && (
            <div className="adm-note" role="status">
              {dealName(deal)} {formatPeriod(period)} is already published{publishedOn}.{' '}
              <label className="adm-check" style={{ marginTop: 6, display: 'flex' }}>
                <input type="checkbox" checked={reissue} onChange={e => setReissue(e.target.checked)} />
                This is a corrected re-issue. It goes through review again and replaces the published report when approved.
              </label>
            </div>
          )}
          {submitError && <div className="adm-note adm-note--warn" role="alert">{submitError}</div>}
          <div className="adm-actions">
            <Button type="submit" variant="primary" icon={<icons.IconUpload width={16} height={16} />} disabled={!ready || !file} loading={busy && !conflict}>
              {reissue ? 'Upload corrected re-issue' : 'Upload report'}
            </Button>
          </div>
        </div>
      </Card>
      <Dialog open={conflict} onClose={() => setConflict(false)} role="alertdialog" dismissable={!busy}
        title="Already published"
        description={`${dealName(deal)} ${formatPeriod(period)} is already published${publishedOn}. Upload this file as a corrected re-issue? It goes through review again and replaces the published report when approved.`}
        footer={<>
          <Button onClick={() => setConflict(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => send(true)} loading={busy}>Upload as corrected re-issue</Button>
        </>} />
    </form>
  )
}

function UploadProgress({ initial, dealName, onAnother, replaced }: { initial: Upload; dealName: string; onAnother: () => void; replaced?: Upload }) {
  const [u, setU] = useState(initial)
  const [pollError, setPollError] = useState<string>()
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    let live = true
    const tick = async () => {
      try {
        const next = await adminApi.upload(initial.id)
        if (!live) return
        setU(next); setPollError(undefined)
        if (IN_FLIGHT.includes(next.status)) timer.current = setTimeout(tick, POLL_MS)
      } catch (e) {
        if (!live) return
        setPollError(errorText(e as ApiError))
        timer.current = setTimeout(tick, POLL_MS)
      }
    }
    if (IN_FLIGHT.includes(initial.status)) timer.current = setTimeout(tick, POLL_MS)
    return () => { live = false; clearTimeout(timer.current) }
  }, [initial.id, initial.status])

  const inFlight = IN_FLIGHT.includes(u.status)
  const stepIndex = STEPS.indexOf(u.status as typeof STEPS[number])
  const findings = totalFindings(u.finding_counts)
  const r04 = u.reporting_period && u.reporting_period !== prevMonth(u.collection_period)
  const canReview = u.status === 'needs_review' || findings > 0

  return (
    <div className="adm-stack">
      <Card title={u.file_name} subtitle={u.page_count ? `${dealName} · ${formatNumber(u.page_count)} pages` : dealName}
        actions={<span className="adm-chip-status" aria-live="polite"><UploadStatusPill status={u.status} /></span>}>
        <div className="adm-stack">
          <ol className="adm-steps" aria-label="Upload progress">
            {STEPS.map((s, i) => (
              <li key={s} aria-current={s === u.status ? 'step' : undefined} data-done={stepIndex > i || undefined}>
                {i > 0 && <span className="adm-steps__sep" aria-hidden="true">›</span>}
                {stepIndex > i && <icons.IconCheck width={14} height={14} aria-hidden="true" />}
                {STEP_LABEL[s]}
              </li>
            ))}
          </ol>
          <dl className="adm-dl">
            <dt>Collection period</dt><dd>{formatPeriod(u.collection_period)} <span className="adm-muted">(settlement month, as entered)</span></dd>
            <dt>Reporting period</dt>
            <dd>{u.reporting_period ? <>{formatPeriod(u.reporting_period)} <span className="adm-muted">(read from the report’s page header)</span></>
              : <span className="adm-muted">{inFlight ? 'Read from the report once extraction finishes' : 'Not found in the report'}</span>}</dd>
            {u.replaces_upload_id && <>
              <dt>Corrected re-issue</dt>
              <dd>Replaces the report{replaced?.id === u.replaces_upload_id && replaced.published_at ? ` published ${formatDateTime(replaced.published_at)}` : ''} once approved.{' '}
                <TextLink to={periodHistoryHref(u.deal_slug, u.collection_period)}>Both uploads</TextLink></dd>
            </>}
            <dt>Findings</dt><dd>{u.status === 'received' || u.status === 'extracting' ? <span className="adm-muted">After extraction</span> : <FindingCountsText counts={u.finding_counts} />}</dd>
          </dl>
          {r04 && (
            <div className="adm-note adm-note--warn" role="status">
              The reporting period should be the month before the collection period ({formatPeriod(prevMonth(u.collection_period))}). Rule R04 checks this.
            </div>
          )}
          {u.status === 'extraction_failed' && <div className="adm-note adm-note--warn" role="alert">Extraction failed. Check the audit log for the reason, then upload the file again.</div>}
          {pollError && <div className="adm-note adm-note--warn" role="alert">Status check failed: {pollError} Retrying every 2 seconds.</div>}
          {inFlight && <p className="adm-muted" style={{ margin: 0, fontSize: 13 }}>Checking status every 2 seconds. Extraction usually takes under a minute.</p>}
          <div className="adm-actions">
            {canReview && (
              <TextLink to={reviewHref(u.id)}>
                {findings > 0 ? `Review ${formatNumber(findings)} finding${findings === 1 ? '' : 's'}` : 'Open in approval queue'} →
              </TextLink>
            )}
            <Button onClick={onAnother} icon={<icons.IconPlus width={16} height={16} />}>Upload another report</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
