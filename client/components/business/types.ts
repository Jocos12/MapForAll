import type { Place } from '@/lib/types'
import type { BusinessFormValues } from '@/components/business/BusinessForm'

export interface OwnerReview {
  key: string
  firstName: string
  rating: number
  comment: string
  createdAt: string
  reply: { text: string; at: string } | null
}

export interface OwnerStats {
  views: number
  views7: number
  viewsPrev7: number
  views30: number
  daily: Array<{ day: string; count: number }>
  /** Last 90 days, split by origin; drives the Statistics filters and CSV export. */
  daily90: Array<{ day: string; count: number; app: number; link: number }>
  confirmations: number
  reviewCount: number
  average: number | null
  histogram: number[]
  /** All-time views by origin: inside MapForAll (map, search, chat) or a shared link / QR code. */
  reach: { app: number; link: number }
}

export const MODERATION_CHECKS = ['duplicate', 'spam', 'consistent', 'position'] as const
export type ModerationCheck = (typeof MODERATION_CHECKS)[number]

export interface ListingTimeline {
  createdAt: string | null
  moderatedAt: string | null
  resubmittedAt: string | null
}

export interface OwnedSummary {
  place_id: string
  name: string
  categories: string[]
  status: string
  paused: boolean
}

export type PlaceLite = { place_id: string; name: string; categories: string[] }

/** The signed-in owner's own account, from /api/account. */
export interface OwnerAccount {
  name: string
  email: string
  phone: string
  avatar: string | null
  role: 'client' | 'business_owner' | 'admin'
  hasPassword: boolean
}

export interface OwnerDashboard {
  owned: boolean
  places: OwnedSummary[]
  place: (Place & { paused?: boolean; recommends?: string[]; views?: number }) | null
  form: BusinessFormValues
  hoursConfirmedAt: string | null
  recommendedBy: number
  /** Automatic pre-moderation checks on the listing as submitted; true = passes. */
  checks: Record<ModerationCheck, boolean>
  timeline: ListingTimeline
  stats: OwnerStats
  reviews: OwnerReview[]
  recommends: PlaceLite[]
}

/** Append the active listing to an owner API path; the server checks it belongs to the account. */
export function withPlace(path: string, placeId: string | null | undefined): string {
  if (!placeId) return path
  return `${path}${path.includes('?') ? '&' : '?'}place=${encodeURIComponent(placeId)}`
}
