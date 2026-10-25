export type AdminPlaceItem = {
  place_id: string
  name: string
  address: string
  coordinates: { lat: number; lng: number }
  categories: string[]
  city: string
  local_business: boolean
  accessible: boolean
  status?: string
  source?: string
  sector?: string
  created_at?: string
  claimed_by_owner?: boolean
  photo_url?: string
  hours?: string
  paused?: boolean
  archived?: boolean
  views?: number
  rejection_reason?: string
}

export type DuplicateHint = {
  place_id: string
  name: string
  matches: { place_id: string; name: string; distance_m: number }[]
}

export type PlacesListResponse = {
  items: AdminPlaceItem[]
  total: number
  page: number
  duplicatesHints: DuplicateHint[]
  totals?: {
    all: number
    validated: number
    pending: number
    paused: number
    rejected: number
    archived: number
    in_review?: number
    changes_requested?: number
    draft?: number
    deleted?: number
  }
}
