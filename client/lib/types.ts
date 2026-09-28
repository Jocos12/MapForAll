import type { WeekHours } from '@/lib/hours'

export interface Coordinates {
  lat: number
  lng: number
}

export interface Place {
  place_id: string
  name: string
  address: string
  coordinates: Coordinates
  categories: string[]
  city?: string
  rating?: number
  price_level?: string
  summary?: string
  maps_url?: string
  /** The place's own website (restaurant/hotel site), when known. */
  website?: string
  /** Whether the place is open right now, when known. */
  open_now?: boolean
  /** Opening hours as entered for a community place, or a short hours line. */
  hours?: string
  /** Day-by-day opening hours set by the owner in the dashboard. */
  hours_week?: WeekHours
  /** Direct image URL when available from search/backend */
  photo_url?: string
  /** Legacy photo references or absolute URLs */
  photos?: string[]
  photo_reference?: string
  /** Informal / neighbourhood business (MapForAll). */
  local_business?: boolean
  /** True only when the inclusion bonus moved this place up in the current result list. */
  prioritized?: boolean
  /** Physically accessible: true only when the step-free entrance is confirmed. */
  accessible?: boolean
  /** Sub-criteria. The Accessible badge requires `entrance`. */
  access?: {
    entrance?: boolean
    toilet?: boolean
    parking?: boolean
  }
  access_confirmations?: number
  access_disputes?: number
  status?: string
  source?: string
  added_by?: string
  confirmations_count?: number
  created_at?: string
  rejection_reason?: string
  phone?: string
  tags?: string[]
  /** Temporarily withdrawn by its owner; hidden from the public map. */
  paused?: boolean
  /** Owner-claimed listing awaiting or past verification. */
  claimed_by_owner?: boolean
  /** Place ids the owner recommends. */
  recommends?: string[]
  views?: number
}

export interface TravelLeg {
  distance: string
  duration: string
  encoded_polyline?: string
}

export interface ItineraryStop {
  place_id: string
  name: string
  address: string
  coordinates: Coordinates
  arrival_time?: string
  duration_at_stop?: string
  travel_from_prev?: TravelLeg
  rationale: string
}

export interface Itinerary {
  stops: ItineraryStop[]
  total_duration?: string
  total_distance?: string
  voice_summary: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  places?: Place[]
  itinerary?: Itinerary | null
  /** Photo grid attached by the client after a real Places lookup. */
  gallery?: {
    type: 'photo_gallery'
    place_name: string
    photos: string[]
    attribution?: string
  }
  /** Scheduled visits from plan_visit → "Add to Google Calendar" chips in chat. */
  calendarEvents?: import('./calendar').CalendarEvent[]
  /** Spoken by the user. Shows a Retry control next to the transcript. */
  fromVoice?: boolean
}

export type StreamChunk =
  | { type: 'thinking'; agent: string; label: string }
  | { type: 'text'; text: string }
  | { type: 'error' }

export type Theme = 'dark' | 'light'
