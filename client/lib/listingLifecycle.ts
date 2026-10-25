/**
 * One listing status for the owner dashboard, the admin console, and the public map.
 * Only the server writes `status`. `paused` stays a boolean on top of `validated`.
 */

export const REVIEW_QUEUE_STATUSES = ['pending', 'submitted', 'in_review'] as const

export type OwnerBadge =
  | 'draft'
  | 'in_review'
  | 'validated'
  | 'changes_requested'
  | 'rejected'
  | 'paused'
  | 'archived'

type StatusDoc = {
  status?: unknown
  paused?: unknown
  archived?: unknown
  deleted_at?: unknown
}

/** Legacy rows with no status were imported as public catalog places. */
export function storedStatus(doc: StatusDoc): string {
  if (typeof doc.deleted_at === 'string' && doc.deleted_at) return 'deleted'
  if (doc.archived === true) return 'archived'
  if (typeof doc.status === 'string' && doc.status.trim()) return doc.status.trim()
  return 'validated'
}

/** On the public map and in chat search. */
export function isPublished(doc: StatusDoc): boolean {
  if (doc.paused === true || doc.archived === true) return false
  return storedStatus(doc) === 'validated'
}

export function inReviewQueue(status: string): boolean {
  return (REVIEW_QUEUE_STATUSES as readonly string[]).includes(status)
}

/** Badge the owner sees. Pending, submitted, and in_review are all "In review". */
export function ownerBadge(status: string, paused?: boolean): OwnerBadge {
  if (paused || status === 'paused') return 'paused'
  if (status === 'validated') return 'validated'
  if (status === 'changes_requested') return 'changes_requested'
  if (status === 'rejected') return 'rejected'
  if (status === 'archived') return 'archived'
  if (status === 'draft') return 'draft'
  return 'in_review'
}

/** What the owner should expect after the current badge. */
export function ownerNextKey(badge: OwnerBadge): string | null {
  if (badge === 'in_review' || badge === 'draft') return 'biz.status.in_reviewNext'
  if (badge === 'changes_requested') return 'biz.status.changes_requestedHint'
  return null
}
