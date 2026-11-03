/** Which shell the page is in and how to link between portfolio pages in it. The partner shells have real routes
 * (/investor/portfolio/:programId/...). The TAO Admin shell registers only /admin/portfolio today, so there the
 * program, dashboard and deal views ride on query parameters of that one route until the nested admin routes exist
 * (requested in docs/requests.md, UI-Partner). If they are added to ADMIN_PAGES, links switch to them automatically. */
import { useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ADMIN_PAGES } from '@/shell/pages'

export type ShellId = 'admin' | 'investor' | 'manager'

export function shellOf(pathname: string): ShellId {
  const seg = pathname.split('/')[1]
  return seg === 'investor' || seg === 'manager' ? seg : 'admin'
}
export function useShell(): ShellId { return shellOf(useLocation().pathname) }

const adminNested = () => ADMIN_PAGES.some(p => p.path === '/admin/portfolio/:programId/deals/:dealId')

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v)
  const str = s.toString()
  return str ? '?' + str : ''
}

export function links(shell: ShellId) {
  const base = shell === 'admin' ? '/admin/portfolio' : `/${shell}/portfolio`
  const nested = shell !== 'admin' || adminNested()
  const enc = encodeURIComponent
  return {
    portfolio: () => base,
    program: (p: string, period?: string) => nested ? `${base}/${enc(p)}${q({ period })}` : base + q({ program: p, period }),
    dashboard: (p: string, period?: string) => nested ? `${base}/${enc(p)}/dashboard${q({ period })}` : base + q({ program: p, view: 'dashboard', period }),
    deal: (p: string, d: string, period?: string) =>
      nested ? `${base}/${enc(p)}/deals/${enc(d)}${q({ period })}` : base + q({ program: p, deal: d, period }),
  }
}
export function useLinks() { return links(useShell()) }

/** Route params, falling back to the admin query parameters. */
export function usePortfolioParams() {
  const params = useParams()
  const [search] = useSearchParams()
  return {
    programId: params.programId ?? search.get('program') ?? undefined,
    dealId: params.dealId ?? search.get('deal') ?? undefined,
    view: search.get('view') ?? undefined,
    period: search.get('period') ?? undefined,
  }
}

/** Review page for an upload (TAO Admin shell, owned by UI-Review). */
export const reviewHref = (uploadId: string) => `/admin/uploads/queue/${encodeURIComponent(uploadId)}`
