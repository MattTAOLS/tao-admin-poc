/** Loads /published/* through the shell's api() (which adds X-Role / X-Partner). A 404 or 403 means the caller's
 * partner does not own the resource (the API makes another partner's program look missing), shown as no access. */
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/shell/api'

export type Load<T> =
  | { state: 'loading' }
  | { state: 'ok'; data: T }
  | { state: 'no-access' }
  | { state: 'error'; message: string; retry: () => void }

export function usePublished<T>(path: string | null): Load<T> {
  const [tick, setTick] = useState(0)
  const retry = useCallback(() => setTick(t => t + 1), [])
  const [res, setRes] = useState<{ path: string | null; load: Load<T> }>({ path, load: { state: 'loading' } })
  useEffect(() => {
    if (!path) return
    let live = true
    setRes({ path, load: { state: 'loading' } })
    api<T>(path).then(
      data => { if (live) setRes({ path, load: { state: 'ok', data } }) },
      (e: { status?: number; message?: string }) => {
        if (!live) return
        if (e.status === 404 || e.status === 403) setRes({ path, load: { state: 'no-access' } })
        else setRes({ path, load: { state: 'error', message: e.message || 'Request failed', retry } })
      },
    )
    return () => { live = false }
  }, [path, tick, retry])
  // A stale result for a previous path reads as loading, so a page never shows one program's numbers under another's URL.
  return res.path === path ? res.load : { state: 'loading' }
}

export const paths = {
  portfolio: () => '/published/portfolio',
  program: (p: string, period?: string) => `/published/programs/${encodeURIComponent(p)}${period ? `?period=${period}` : ''}`,
  deal: (p: string, d: string, period?: string, version?: number) => {
    const q = new URLSearchParams()
    if (period) q.set('period', period)
    if (version !== undefined) q.set('version', String(version))
    const s = q.toString()
    return `/published/programs/${encodeURIComponent(p)}/deals/${encodeURIComponent(d)}${s ? `?${s}` : ''}`
  },
  /** TAO-only upload list for one deal (admin strip; never called from a partner shell). */
  uploads: (d: string) => `/uploads?deal_slug=${encodeURIComponent(d)}`,
}
