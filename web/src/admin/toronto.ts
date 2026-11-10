/** Business dates in Toronto (decision A5: everyone sees the same month and the same day, whatever their browser's
 * zone). An instant is read in America/Toronto, never in UTC and never in the viewer's zone. */
export const TZ = 'America/Toronto'
const PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
function parts(at: Date | string) {
  const p = PARTS.formatToParts(typeof at === 'string' ? new Date(at) : at)
  const get = (t: string) => p.find(x => x.type === t)!.value
  return { y: get('year'), m: get('month'), d: get('day') }
}
/** "YYYY-MM" of an instant, in Toronto: 23:30 on 31 October Toronto time stays in October. */
export function torontoMonth(at: Date | string = new Date()): string {
  const { y, m } = parts(at)
  return `${y}-${m}`
}
/** "YYYY-MM-DD" of an instant, in Toronto: 23:30 on 31 October Toronto time is still 31 October (it is 1 November in UTC). */
export function torontoDate(at: Date | string = new Date()): string {
  const { y, m, d } = parts(at)
  return `${y}-${m}-${d}`
}
