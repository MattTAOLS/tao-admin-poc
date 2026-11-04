import { tao } from './api'

/** Which partners see a program, from master data: partner_slugs (wave-3 multi-partner contract) or partner_slug. */
export async function programPartners(): Promise<Record<string, string[]>> {
  const programs = (await tao.get('/master/programs')).body as any[]
  return Object.fromEntries(programs.map(p => [p.slug, p.partner_slugs?.length ? p.partner_slugs : [p.partner_slug]]))
}
