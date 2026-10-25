/** Africa/Kigali is UTC+2 all year (no daylight saving). */

export function kigaliYmd(date: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Kigali',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const n = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { y: n('year'), m: n('month'), d: n('day') }
}

/** Start of a Kigali calendar day, as a UTC instant. Day overflow is handled by Date.UTC. */
export function kigaliDayStart(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, -2, 0, 0, 0))
}
