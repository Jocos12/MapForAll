export const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type WeekDay = (typeof WEEK_DAYS)[number]

export interface DayHours {
  closed: boolean
  open: string
  close: string
}

export type WeekHours = Record<WeekDay, DayHours>

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function defaultWeek(): WeekHours {
  return Object.fromEntries(
    WEEK_DAYS.map((day) => [day, { closed: day === 'sun', open: '08:00', close: '18:00' }]),
  ) as WeekHours
}

/** A stored or submitted week, or null when any day is malformed. */
export function cleanWeek(value: unknown): WeekHours | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const out = {} as WeekHours
  for (const day of WEEK_DAYS) {
    const row = raw[day] as Record<string, unknown> | undefined
    if (!row || typeof row !== 'object') return null
    const closed = row.closed === true
    const open = typeof row.open === 'string' ? row.open : ''
    const close = typeof row.close === 'string' ? row.close : ''
    if (!closed && (!TIME.test(open) || !TIME.test(close))) return null
    out[day] = { closed, open: TIME.test(open) ? open : '08:00', close: TIME.test(close) ? close : '18:00' }
  }
  return out
}

export function sameWeek(a: WeekHours | null, b: WeekHours | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Compact one-line summary shown to visitors, grouping consecutive days with
 * the same slot: "Lun–Ven 08:00–18:00 · Sam 09:00–14:00 · Dim fermé".
 */
export function summarizeWeek(week: WeekHours, dayLabel: (day: WeekDay) => string, closedLabel: string): string {
  const slot = (day: WeekDay) => (week[day].closed ? closedLabel : `${week[day].open}–${week[day].close}`)
  const groups: Array<{ from: WeekDay; to: WeekDay; slot: string }> = []
  for (const day of WEEK_DAYS) {
    const last = groups[groups.length - 1]
    if (last && last.slot === slot(day)) last.to = day
    else groups.push({ from: day, to: day, slot: slot(day) })
  }
  return groups
    .map(({ from, to, slot: text }) => `${from === to ? dayLabel(from) : `${dayLabel(from)}–${dayLabel(to)}`} ${text}`)
    .join(' · ')
}

export const HOURS_FRESH_DAYS = 90

export function hoursAreFresh(confirmedAt: string | null | undefined): boolean {
  if (!confirmedAt) return false
  const at = Date.parse(confirmedAt)
  return Number.isFinite(at) && Date.now() - at < HOURS_FRESH_DAYS * 86_400_000
}
