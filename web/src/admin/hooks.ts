import { useCallback, useEffect, useRef, useState } from 'react'
import { loadRole, type Role } from '@/shell/roles'
import type { ApiError } from './data'

export type Resource<T> = { data: T | undefined; error: ApiError | undefined; loading: boolean; reload: () => void }

/** Runs `load` on mount and whenever `deps` change; keeps the last good data while reloading. */
export function useResource<T>(load: () => Promise<T>, deps: unknown[]): Resource<T> {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true })
  const [tick, setTick] = useState(0)
  const loadRef = useRef(load); loadRef.current = load
  useEffect(() => {
    let live = true
    setState(s => ({ ...s, loading: true, error: undefined }))
    loadRef.current().then(
      data => { if (live) setState({ data, loading: false }) },
      (error: ApiError) => { if (live) setState({ error, loading: false }) },
    )
    return () => { live = false }
  }, [tick, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setTick(t => t + 1), [])
  return { data: state.data, error: state.error, loading: state.loading, reload }
}

/** The current role. Pages re-render when the shell switches role (the shell re-renders its children). */
export function useRole(): Role { return loadRole() }
export const canEditMaster = (r: Role) => r === 'tao_admin'
