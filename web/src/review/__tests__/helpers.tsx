/** Test helpers: a fetch router over recorded real API responses (fixtures/, captured from the review stack on
 * 2026-11-03), a role setter, and a renderer with the router, toasts and the shell's top bar. */
import '@/design/test-utils'
import { afterEach, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactElement } from 'react'
import { ToastProvider } from '@/design/components'
import { headerStore, usePageHeaderMeta } from '@/shell/header'
import { KEY } from '@/shell/roles'
import { clearPageCache } from '../lib/api'

export type Call = { method: string; path: string; body: unknown; headers: Record<string, string> }
export type Handler = (call: Call) => { status?: number; body?: unknown } | undefined

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

/** Installs a fetch mock. Handlers are tried in order; the first that returns a response wins; unmatched = 404. */
export function mockApi(handlers: Handler[]) {
  const calls: Call[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname.replace(/^.*\/api\/v1/, '') + url.search
    const call: Call = {
      method: (init.method ?? 'GET').toUpperCase(), path,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: (init.headers as Record<string, string>) ?? {},
    }
    calls.push(call)
    if (/\/pages\/\d+\.png$/.test(url.pathname)) return new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 })
    for (const h of handlers) {
      const r = h(call)
      if (r) return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ code: 'not_found', message: 'no mock for ' + call.method + ' ' + path }), { status: 404 })
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

export const on = (method: string, pattern: RegExp, respond: (c: Call) => { status?: number; body?: unknown }): Handler =>
  c => (c.method === method && pattern.test(c.path) ? respond(c) : undefined)

export function setRole(role: string) { localStorage.setItem(KEY, role) }

function TopBar() {
  const m = usePageHeaderMeta()
  return <header data-testid="topbar"><h1>{m.title}</h1>{m.subtitle && <div>{m.subtitle}</div>}{m.status}{m.actions}</header>
}

export function renderPage(el: ReactElement, { path = '/', route = '*' }: { path?: string; route?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <TopBar />
        <Routes><Route path={route} element={el} /></Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear(); headerStore.clear(); clearPageCache()
  if (!('createObjectURL' in URL)) Object.assign(URL, { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} })
})
afterEach(() => { vi.unstubAllGlobals() })
