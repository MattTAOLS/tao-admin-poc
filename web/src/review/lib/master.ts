import { useLoad } from './useLoad'
import { reviewApi } from './api'

/** Deal and program names by slug from the master routes. A failure leaves the maps empty (slugs show instead). */
export function useMasterNames(enabled = true) {
  const deals = useLoad(() => reviewApi.deals().catch(() => []), [], enabled)
  const programs = useLoad(() => reviewApi.programs().catch(() => []), [], enabled)
  const dealName = (slug: string) => deals.data?.find(d => d.slug === slug)?.name ?? slug
  const programName = (slug: string) => programs.data?.find(p => p.slug === slug)?.name ?? slug
  return { dealName, programName, deals: deals.data ?? [], programs: programs.data ?? [] }
}
