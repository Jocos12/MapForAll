import { DB } from '@/lib/adminPlaces'

export { DB }

const BANNED = [
  'viagra',
  'casino',
  'forex',
  'crypto scam',
  'click here',
  'free money',
  'bit.ly',
  't.me/',
]

const URL_RE = /https?:\/\/|www\.\S+/i

export type ReviewFlag = 'none' | 'url_spam' | 'banned_word'

export function detectInappropriate(comment: string): ReviewFlag {
  const text = comment.trim().toLowerCase()
  if (!text) return 'none'
  if (URL_RE.test(comment)) return 'url_spam'
  if (BANNED.some((w) => text.includes(w))) return 'banned_word'
  return 'none'
}

export type AdminReviewRow = {
  key: string
  placeId: string
  userId: string
  rating: number
  comment: string
  firstName: string
  hidden: boolean
  flag: ReviewFlag
  createdAt: string
  updatedAt: string
}

export function reviewRowKey(placeId: string, userId: string): string {
  return `${placeId}::${userId}`
}

export function toAdminReview(doc: Record<string, unknown>): AdminReviewRow | null {
  const placeId = typeof doc.placeId === 'string' ? doc.placeId : ''
  const userId = typeof doc.userId === 'string' ? doc.userId : ''
  const rating = typeof doc.rating === 'number' ? doc.rating : NaN
  if (!placeId || !userId || !Number.isFinite(rating)) return null
  const comment = typeof doc.comment === 'string' ? doc.comment : ''
  const createdAt = typeof doc.createdAt === 'string' ? doc.createdAt : ''
  return {
    key: reviewRowKey(placeId, userId),
    placeId,
    userId,
    rating,
    comment,
    firstName: typeof doc.firstName === 'string' && doc.firstName ? doc.firstName : 'Visiteur',
    hidden: doc.hidden === true,
    flag: detectInappropriate(comment),
    createdAt,
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : createdAt,
  }
}

export type ExistsSummaryRow = {
  place_id: string
  place_name: string
  confirmations: number
  meets_threshold: boolean
}

export async function loadConfirmationThreshold(
  sid: string,
  mcpCall: (sid: string, name: string, args: Record<string, unknown>) => Promise<string[]>,
  extractDocs: (chunks: string[]) => Record<string, unknown>[],
): Promise<number> {
  try {
    const doc = extractDocs(
      await mcpCall(sid, 'find', { database: DB, collection: 'admin_settings', filter: { key: 'scoring' }, limit: 1 }),
    )[0]
    const n = doc?.confirmation_threshold
    return typeof n === 'number' && n >= 1 ? Math.floor(n) : 3
  } catch {
    return 3
  }
}
