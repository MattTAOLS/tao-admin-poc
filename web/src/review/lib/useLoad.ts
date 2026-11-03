import { useCallback, useEffect, useRef, useState } from 'react'

export type Load<T> = {
  data: T | undefined
  error: unknown
  loading: boolean
  reload: () => Promise<void>
  setData: (d: T) => void
}

/** Runs `fn` on mount and whenever `deps` change; `reload` re-runs it without clearing the current data. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], enabled = true): Load<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(enabled)
  const seq = useRef(0)
  const fnRef = useRef(fn); fnRef.current = fn

  const run = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    try {
      const d = await fnRef.current()
      if (mine === seq.current) { setData(d); setError(null) }
    } catch (e) {
      if (mine === seq.current) setError(e)
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) { setLoading(false); return }
    run()
    return () => { seq.current++ }
  }, [...deps, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading, reload: run, setData }
}
