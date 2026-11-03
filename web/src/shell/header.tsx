import { useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { Crumb } from '@/design/components'

/** What a page can put in the shell's top bar. Every field is optional; the shell falls back to the page registry
 * title and a breadcrumb built from the route. */
export type PageHeaderMeta = {
  title?: ReactNode
  subtitle?: ReactNode
  /** A StatusPill next to the title. */
  status?: ReactNode
  /** Right-aligned buttons in the top bar; the primary action last. */
  actions?: ReactNode
  /** Replaces the route-derived breadcrumb, e.g. to name the deal instead of ":dealId". */
  crumbs?: Crumb[]
}

// A tiny external store, so a page updating its header re-renders only the top bar, never itself.
let current: PageHeaderMeta = {}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())
export const headerStore = {
  get: () => current,
  set: (m: PageHeaderMeta) => { current = m; emit() },
  clear: () => { if (Object.keys(current).length) { current = {}; emit() } },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
}

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Call from a page component to set the top bar: `usePageHeader({ title: deal.name, status: <UploadStatusPill …/>,
 * actions: <Button variant="primary">Publish</Button> })`. Cleared automatically when the page unmounts. */
export function usePageHeader(meta: PageHeaderMeta) {
  useIso(() => { headerStore.set(meta) })
  useIso(() => () => headerStore.clear(), [])
}

export function usePageHeaderMeta() {
  return useSyncExternalStore(headerStore.subscribe, headerStore.get, headerStore.get)
}
