import { createHash } from 'node:crypto'

export const VIEW_WINDOW_MS = 30 * 60 * 1000
export const VIEW_SOURCES = ['map', 'chat', 'search', 'link'] as const
export const VIEW_KINDS = ['view', 'impression', 'route', 'call', 'website', 'save'] as const

export type ViewSource = (typeof VIEW_SOURCES)[number]
export type ViewKind = (typeof VIEW_KINDS)[number]

const BOT = /bot|crawl|spider|slurp|headless|preview|facebookexternalhit|whatsapp|telegram/i

export function normalizeSource(value: unknown): ViewSource {
  if (value === 'app') return 'map'
  if (typeof value === 'string' && (VIEW_SOURCES as readonly string[]).includes(value)) return value as ViewSource
  return 'map'
}

export function normalizeKind(value: unknown): ViewKind {
  if (typeof value === 'string' && (VIEW_KINDS as readonly string[]).includes(value)) return value as ViewKind
  return 'view'
}

export function isBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim()
  if (!ua) return true
  return BOT.test(ua)
}

/** Africa/Kigali calendar day, YYYY-MM-DD. */
export function kigaliDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Kigali',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const n = (type: string) => parts.find((part) => part.type === type)?.value ?? '01'
  return `${n('year')}-${n('month')}-${n('day')}`
}

export function visitorHash(visitorKey: string, day: string, salt: string): string {
  return createHash('sha256').update(`${salt}|${day}|${visitorKey}`).digest('hex').slice(0, 32)
}

export type ViewDecision =
  | { count: true }
  | { count: false; reason: 'unpublished' | 'owner' | 'staff' | 'bot' | 'duplicate' | 'window' | 'impression' }

/**
 * A view is one customer opening a published place.
 * Impressions, owner visits, staff visits, bots, and a repeat inside 30 minutes do not count.
 */
export function decideView(input: {
  kind: ViewKind
  published: boolean
  isOwner: boolean
  isStaff: boolean
  bot: boolean
  duplicateEvent: boolean
  seenWithinWindow: boolean
}): ViewDecision {
  if (input.kind !== 'view') return { count: false, reason: 'impression' }
  if (!input.published) return { count: false, reason: 'unpublished' }
  if (input.isOwner) return { count: false, reason: 'owner' }
  if (input.isStaff) return { count: false, reason: 'staff' }
  if (input.bot) return { count: false, reason: 'bot' }
  if (input.duplicateEvent) return { count: false, reason: 'duplicate' }
  if (input.seenWithinWindow) return { count: false, reason: 'window' }
  return { count: true }
}

export type DailyStat = {
  placeId: string
  day: string
  views: number
  uniqueVisitors: number
  impressions: number
  routeClicks: number
  calls: number
  websiteClicks: number
  saves: number
}

/** The number both the admin list and the owner dashboard must show for one place and period. */
export function viewsInPeriod(rows: Array<{ placeId: string; day: string; views: number }>, placeId: string, fromDay: string, toDay: string): number {
  return rows
    .filter((row) => row.placeId === placeId && row.day >= fromDay && row.day <= toDay)
    .reduce((sum, row) => sum + row.views, 0)
}
