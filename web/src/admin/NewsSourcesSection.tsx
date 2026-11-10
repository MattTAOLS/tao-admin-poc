import { useEffect, useState } from 'react'
import { Button, Dialog, Field, Input, StatusPill, Textarea, formatNumber, useToast } from '@/design/components'
import type { ApiError } from './data'
import { useResource } from './hooks'
import { LoadError, errorText, formatDateTime } from './ui'
import {
  NO_SECRET_KEY, SOURCE_CONFLICT, SOURCE_NAME, TEST_MAX_MS, TEST_POLL_MS, buildUpdate, draftErrors, draftOf, hasStats, kindOf, missingSecrets, secretText,
  sourceStatus, sourcesApi, updateSummary, type LastTest, type NewsSource, type RunStats, type SourceDraft,
} from './newsSources'

/** Plain words for an error from the news source routes. */
export const sourceError = (e: ApiError) => (e.code && SOURCE_CONFLICT[e.code]) || errorText(e)

/** The last test as a dot plus a word, with the provider's message. */
function TestResult({ t }: { t: LastTest }) {
  if (!t.at) return <span className="adm-muted">Never tested</span>
  return (
    <span className="adm-srctest">
      <StatusPill size="sm" tone={t.ok === true ? 'ok' : t.ok === false ? 'bad' : 'neutral'}>{t.ok === true ? 'OK' : t.ok === false ? 'Failed' : 'No result'}</StatusPill>
      <span className="adm-muted adm-nowrap">{formatDateTime(t.at)}</span>
      {t.message && <span className="adm-srcmsg">{t.message}</span>}
    </span>
  )
}

type Watch = { provider: string; prevAt: string | null; until: number }
type TestMsg = { provider: string; tone: 'info' | 'ok' | 'warn'; text: string }

/** System settings, News sources (E1, E8): one row per paid provider from GET /news/sources. Each source saves on its
 * own with a reason (PUT /news/sources/{provider}); Test connection queues one small query and polls every 2 s for the
 * new last_test, for at most 40 s. */
export default function NewsSourcesSection() {
  const res = useResource(() => sourcesApi.list(), [])
  const [list, setList] = useState<NewsSource[] | null>(null)
  const [keySet, setKeySet] = useState(true)
  const [editing, setEditing] = useState<NewsSource | null>(null)
  const [watch, setWatch] = useState<Watch | null>(null)
  const [msg, setMsg] = useState<TestMsg | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  useEffect(() => { if (res.data) { setList(res.data.sources); setKeySet(res.data.secret_key_set) } }, [res.data])

  useEffect(() => {
    if (!watch) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const r = await sourcesApi.list()
        if (!live) return
        setList(r.sources); setKeySet(r.secret_key_set)
        const s = r.sources.find(x => x.provider === watch.provider)
        if (s && s.last_test.at && s.last_test.at !== watch.prevAt) {
          setWatch(null)
          const ok = s.last_test.ok === true
          setMsg({ provider: watch.provider, tone: ok ? 'ok' : 'warn', text: `${s.label}: ${ok ? 'OK' : 'Failed'}${s.last_test.message ? `. ${s.last_test.message}` : ''}` })
          return
        }
      } catch { /* a failed refresh is retried on the next tick */ }
      if (!live) return
      if (Date.now() >= watch.until) {
        setWatch(null)
        setMsg({ provider: watch.provider, tone: 'warn', text: 'No test result after 40 seconds. The news worker may be busy or stopped; reload the page later to see the result.' })
        return
      }
      timer = setTimeout(() => void tick(), TEST_POLL_MS)
    }
    timer = setTimeout(() => void tick(), TEST_POLL_MS)
    return () => { live = false; if (timer) clearTimeout(timer) }
  }, [watch])

  const test = async (s: NewsSource) => {
    setStarting(s.provider); setMsg(null)
    try {
      const q = await sourcesApi.test(s.provider)
      setList(l => l?.map(x => (x.provider === q.provider ? q : x)) ?? l)
      setMsg({ provider: s.provider, tone: 'info', text: `Testing ${s.label}: one small query. The result shows here within a few seconds.` })
      setWatch({ provider: s.provider, prevAt: s.last_test.at, until: Date.now() + TEST_MAX_MS })
    } catch (err) {
      setMsg({ provider: s.provider, tone: 'warn', text: `${s.label}: ${sourceError(err as ApiError)}` })
    } finally { setStarting(null) }
  }

  if (res.error && !list) return <LoadError error={res.error} onRetry={res.reload} />
  if (!list) return <p className="adm-muted">Loading news sources…</p>

  return (
    <div className="adm-stack adm-sources">
      {!keySet && <div className="adm-note adm-note--warn" role="alert">{NO_SECRET_KEY}</div>}
      <div className="adm-note">
        Paid sources search with the client’s own account. Keys are encrypted on the server and never shown again: this page only says whether
        a key is set and its last four characters. Each source saves on its own, with a reason, and is recorded on the Platform tab of the
        Audit log; it is not part of Save changes.
      </div>
      {list.length === 0 ? <p className="adm-muted">The API lists no paid news sources.</p> : (
        <div className="adm-scroll">
          <table className="adm-plain">
            <caption className="ds-visually-hidden">News sources</caption>
            <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Keys</th><th scope="col">Last test</th><th scope="col"><span className="ds-visually-hidden">Actions</span></th></tr></thead>
            <tbody>{list.map(s => {
              const st = watch?.provider === s.provider ? { tone: 'blue' as const, label: 'Testing' } : sourceStatus(s)
              const secretFields = s.fields.filter(f => f.secret)
              return (
                <tr key={s.provider} data-provider={s.provider}>
                  <th scope="row">
                    <div>{s.label}</div>
                    {s.note && <div className="adm-muted adm-srcnote">{s.note}</div>}
                  </th>
                  <td><StatusPill size="sm" tone={st.tone}>{st.label}</StatusPill></td>
                  <td>{secretFields.length === 0 ? <span className="adm-muted">No key</span> : (
                    <ul className="adm-srckeys">{secretFields.map(f => <li key={f.name}>{f.label}: <span className={s.secrets[f.name]?.set ? '' : 'adm-muted'}>{secretText(s.secrets[f.name])}</span></li>)}</ul>
                  )}</td>
                  <td><TestResult t={s.last_test} /></td>
                  <td>
                    <div className="adm-actions adm-nowrap">
                      <Button size="sm" onClick={() => setEditing(s)} aria-label={`Edit ${s.label}`}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => void test(s)} loading={starting === s.provider} disabled={!!watch || !s.available}
                        aria-label={`Test connection, ${s.label}`}>Test connection</Button>
                    </div>
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
      {msg && <div className={`adm-note${msg.tone === 'warn' ? ' adm-note--warn' : ''}`} role="status">{msg.text}</div>}
      <p className="adm-hint">Test connection is off for a source that is not available yet. Dow Jones and LexisNexis share their API documentation only with contracted clients, so their connection is built once a client supplies it; their keys can be stored now.</p>
      {editing && (
        <SourceDialog source={editing} keySet={keySet} onClose={() => setEditing(null)}
          onSaved={s => { setList(l => l?.map(x => (x.provider === s.provider ? s : x)) ?? l); setEditing(null) }}
          onNoKey={() => setKeySet(false)} />
      )}
    </div>
  )
}

/** Edit one source: secret fields are write-only (always empty, "Set, ends in ••••1234" or "Not set", Remove), other
 * fields by kind, the switch, and a reason. Sends only what changed. */
function SourceDialog({ source: s, keySet, onClose, onSaved, onNoKey }: {
  source: NewsSource; keySet: boolean; onClose: () => void; onSaved: (s: NewsSource) => void; onNoKey: () => void
}) {
  const { toast } = useToast()
  const [d, setD] = useState<SourceDraft>(() => draftOf(s))
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const errs = draftErrors(s, d)
  const update = buildUpdate(s, d)
  const short = reason.trim().length < 3
  const missing = missingSecrets(s).filter(f => !(d.secrets[f.name] ?? '').trim())
  const go = async () => {
    setTouched(true)
    if (short || !update || Object.keys(errs).length) return
    setBusy(true); setError(undefined)
    try {
      const saved = await sourcesApi.put(s.provider, { ...update, reason: reason.trim() })
      toast({ tone: 'ok', title: `${s.label} saved`, message: 'Recorded on the Platform tab of the Audit log, without any key.' })
      onSaved(saved)
    } catch (err) {
      const e = err as ApiError
      if (e.code === 'no_secret_key') onNoKey()
      setError(sourceError(e))
    } finally { setBusy(false) }
  }
  const setCfg = (name: string, v: string | boolean) => setD(x => ({ ...x, config: { ...x.config, [name]: v } }))
  return (
    <Dialog open onClose={onClose} dismissable={!busy} size="lg" title={`Edit ${s.label}`}
      description={s.note ?? undefined}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" form="adm-source-save" loading={busy} disabled={!update || Object.keys(errs).length > 0}>Save</Button>
      </>}>
      <form id="adm-source-save" className="adm-form" noValidate autoComplete="off" onSubmit={e => { e.preventDefault(); void go() }}>
        {!keySet && <div className="adm-note adm-note--warn" role="alert">{NO_SECRET_KEY}</div>}
        <div className={`adm-switchrow${d.enabled ? ' is-on' : ''}`}>
          <label className="adm-check">
            <input type="checkbox" role="switch" checked={d.enabled} disabled={!s.available} aria-describedby="adm-src-switch-why"
              onChange={e => setD(x => ({ ...x, enabled: e.target.checked }))} />
            <b>Use this source</b>
          </label>
          <StatusPill size="sm" tone={d.enabled ? 'ok' : 'neutral'}>{d.enabled ? 'On' : 'Off'}</StatusPill>
        </div>
        <p id="adm-src-switch-why" className="adm-hint">
          {!s.available ? `${s.label} cannot be switched on yet: its connection is built once the client supplies the provider’s API documentation. Its keys can be stored now.`
            : d.enabled && !s.enabled && missing.length ? `Needs ${missing.map(f => f.label).join(', ')} before it can be switched on.`
            : 'When on, the daily news search also asks this source, within the daily request cap set under Companies and news.'}
        </p>
        {s.fields.map(f => {
          if (f.secret) {
            const st = s.secrets[f.name]
            const removing = d.remove.includes(f.name)
            return (
              <div key={f.name} className="adm-srcsecret">
                <Field label={f.label} required={f.required}
                  hint={<>{removing ? 'Will be removed when you save.' : secretText(st)}{f.help ? ` ${f.help}` : ''} {st?.set ? 'Type a new value to replace it.' : ''}</>}>
                  <Input type="password" autoComplete="new-password" spellCheck={false} disabled={!keySet} value={d.secrets[f.name] ?? ''}
                    onChange={e => { const v = e.target.value; setD(x => ({ ...x, secrets: { ...x.secrets, [f.name]: v }, remove: x.remove.filter(n => n !== f.name) })) }} />
                </Field>
                {st?.set && (removing
                  ? <Button size="sm" variant="ghost" onClick={() => setD(x => ({ ...x, remove: x.remove.filter(n => n !== f.name) }))} aria-label={`Keep ${f.label}`}>Keep</Button>
                  : <Button size="sm" variant="ghost" onClick={() => setD(x => ({ ...x, remove: [...x.remove, f.name], secrets: { ...x.secrets, [f.name]: '' } }))} aria-label={`Remove ${f.label}`}>Remove</Button>)}
              </div>
            )
          }
          const k = kindOf(f)
          if (k === 'boolean') return (
            <div key={f.name}>
              <label className="adm-check">
                <input type="checkbox" role="switch" checked={d.config[f.name] === true} onChange={e => setCfg(f.name, e.target.checked)} />
                {f.label}
              </label>
              {f.help && <p className="adm-hint">{f.help}</p>}
            </div>
          )
          return (
            <Field key={f.name} label={f.label} required={f.required} hint={f.help ?? undefined} error={errs[f.name]}>
              <Input type={k === 'url' ? 'url' : 'text'} numeric={k === 'integer'} className={k === 'integer' ? 'adm-int' : undefined}
                value={String(d.config[f.name] ?? '')} onChange={e => setCfg(f.name, e.target.value)} />
            </Field>
          )
        })}
        {update && (
          <div className="adm-note" aria-label="Changes to save">
            <b>Changes to save</b>
            <ul className="adm-srcchanges">{updateSummary(s, update).map(t => <li key={t}>{t}</li>)}</ul>
          </div>
        )}
        <Field label="Reason" required hint="At least three characters. Shown in the audit entry." error={touched && short ? 'Give a reason of at least three characters.' : undefined}>
          <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        {error && <div className="adm-note adm-note--warn" role="alert">{error}</div>}
      </form>
    </Dialog>
  )
}

/** Confirm, then POST /news/recheck (E9). */
export function RecheckDialog({ onClose, onQueued }: { onClose: () => void; onQueued: (r: Awaited<ReturnType<typeof sourcesApi.recheck>>) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const go = async () => {
    setBusy(true); setError(undefined)
    try { onQueued(await sourcesApi.recheck()) } catch (err) { setError(sourceError(err as ApiError)) } finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} dismissable={!busy} title="Re-check stories?" role="alertdialog"
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => void go()}>Re-check stories</Button>
      </>}>
      <p>{RECHECK_TEXT}</p>
      <p className="adm-hint">Adverse items still Open on an excluded story are dismissed with the reason “Excluded by the news check”. Items a person already reviewed or dismissed stay as they are. It runs as a news run and shows in the list below.</p>
      {error && <div className="adm-note adm-note--warn" role="alert">{error}</div>}
    </Dialog>
  )
}
export const RECHECK_TEXT = 'Runs every stored story through the date and Claude checks. Stories about another company are excluded, with the reason shown to TAO; nothing is deleted.'

/** One run's stats (E10): a one-line summary that opens to the detail. Runs from before wave E show a dash. */
export function RunStatsCell({ stats }: { stats: RunStats | undefined | null }) {
  if (!hasStats(stats)) return <span className="adm-muted">—</span>
  const n = (v: number | undefined) => (v == null ? '—' : formatNumber(v))
  const calls = Object.entries(stats.calls ?? {})
  const tokens = stats.claude_input_tokens != null || stats.claude_output_tokens != null
    ? `${n(stats.claude_input_tokens)} in, ${n(stats.claude_output_tokens)} out` : '—'
  return (
    <details className="adm-runstats">
      <summary>{n(stats.candidates)} candidates · {n(stats.kept)} kept · {n(stats.excluded)} excluded</summary>
      <dl className="adm-dl">
        <dt>Calls per source</dt><dd>{calls.length ? calls.map(([k, v]) => `${SOURCE_NAME[k] ?? k} ${formatNumber(v)}`).join(', ') : 'None'}</dd>
        <dt>Hit the daily cap</dt><dd className={stats.capped?.length ? 'adm-capped' : undefined}>{stats.capped?.length ? stats.capped.map(k => SOURCE_NAME[k] ?? k).join(', ') : 'None'}</dd>
        <dt>Candidates</dt><dd className="adm-num">{n(stats.candidates)}</dd>
        <dt>Kept</dt><dd className="adm-num">{n(stats.kept)}</dd>
        <dt>Excluded</dt><dd className="adm-num">{n(stats.excluded)}</dd>
        <dt>Pending</dt><dd className="adm-num">{n(stats.pending)}</dd>
        <dt>Dates confirmed</dt><dd className="adm-num">{n(stats.date_confirmed)}</dd>
        <dt>Claude tokens</dt><dd className="adm-num">{tokens}</dd>
      </dl>
    </details>
  )
}
