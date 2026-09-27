'use client'

/**
 * useCommunityMapLayer — data feed for the map's community layer.
 *
 * Two independent switches:
 *  - `pinsEnabled`   → one fetch of shared pins (GET /api/community/pins) when
 *    the switch turns on. Pins carry the owner's attribution for the
 *    "shared by @handle" marker card. No interval: a slow Mongo call was
 *    logging 500s in a loop during the demo.
 *  - `friendsEnabled` → one lookup of accepted connections, their shared
 *    locations, and presence, plus one heartbeat. The server persists
 *    coordinates ONLY if the caller's share_location toggle is on.
 *
 * Turning a switch off clears its state, so the core map/chat path pays
 * nothing while the layer is unused.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getConnections,
  getPresence,
  getProfileByHandle,
  sendHeartbeat,
} from '@/lib/communityClient'
import type { SharedPin, UserAttribution } from '@/lib/community'

/** A shared pin projected for map rendering (owner attribution inlined). */
export interface CommunityMapPin {
  pin_id: string
  place_id: string
  name: string
  lat: number
  lng: number
  address: string | null
  photo_url: string | null
  rating: number | null
  note: string
  owner: UserAttribution | null
}

/** An accepted connection with share_location on and a fresh position. */
export interface CommunityFriend {
  user_id: string
  handle: string
  name: string | null
  avatar_emoji: string
  lat: number
  lng: number
  online: boolean
  last_seen_at: string | null
}

/** Hide a connection whose location heartbeat is older than this. */
const LOCATION_FRESH_MS = 30 * 60_000
/** Cap per-tick profile lookups (one GET per connection). */
const MAX_FRIENDS = 20

type PinsResponse = { pins?: Array<SharedPin & { owner?: UserAttribution | null }> }

async function fetchSharedPins(): Promise<CommunityMapPin[]> {
  const res = await fetch('/api/community/pins')
  if (!res.ok) return []
  const data = (await res.json().catch(() => ({}))) as PinsResponse
  const out: CommunityMapPin[] = []
  for (const pin of data.pins ?? []) {
    const p = pin.place
    if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') continue
    out.push({
      pin_id: pin.pin_id,
      place_id: p.place_id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      address: p.address ?? null,
      photo_url: p.photo_url ?? null,
      rating: p.rating ?? null,
      note: pin.note ?? '',
      owner: pin.owner ?? null,
    })
  }
  return out
}

async function fetchFriendLocations(): Promise<CommunityFriend[]> {
  const conns = await getConnections()
  const edges = conns.accepted.filter((e) => e.user).slice(0, MAX_FRIENDS)
  if (edges.length === 0) return []
  const ids = edges.map((e) => e.user!.user_id)
  const [presence, profiles] = await Promise.all([
    getPresence(ids).catch(() => ({} as Awaited<ReturnType<typeof getPresence>>)),
    Promise.all(edges.map((e) => getProfileByHandle(e.user!.handle).catch(() => null))),
  ])
  const out: CommunityFriend[] = []
  for (const profile of profiles) {
    if (!profile?.share_location || !profile.location) continue
    const [lng, lat] = profile.location.coordinates
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    const p = presence[profile.user_id]
    const lastSeen = p?.last_seen_at ?? profile.last_seen_at
    if (!lastSeen || Date.now() - Date.parse(lastSeen) > LOCATION_FRESH_MS) continue
    out.push({
      user_id: profile.user_id,
      handle: profile.handle,
      name: profile.name,
      avatar_emoji: profile.avatar_emoji,
      lat,
      lng,
      online: p?.online ?? profile.online,
      last_seen_at: lastSeen,
    })
  }
  return out
}

export interface CommunityMapLayerOptions {
  /** Fetch/refresh shared pins (panel open OR layer toggle on). */
  pinsEnabled: boolean
  /** Poll connection locations + presence (layer toggle on only). */
  friendsEnabled: boolean
  /** Caller's GPS — heartbeated so connections can see them (if sharing). */
  userLocation: { lat: number; lng: number } | null
}

export function useCommunityMapLayer({ pinsEnabled, friendsEnabled, userLocation }: CommunityMapLayerOptions): {
  pins: CommunityMapPin[]
  friends: CommunityFriend[]
  /** Re-fetch pins now (e.g. right after sharing one). */
  refreshPins: () => void
} {
  const [pins, setPins] = useState<CommunityMapPin[]>([])
  const [friends, setFriends] = useState<CommunityFriend[]>([])
  const pinsEnabledRef = useRef(pinsEnabled)
  pinsEnabledRef.current = pinsEnabled
  const locationRef = useRef(userLocation)
  locationRef.current = userLocation

  const refreshPins = useCallback(() => {
    if (!pinsEnabledRef.current) return
    void fetchSharedPins()
      .then((next) => { if (pinsEnabledRef.current) setPins(next) })
      .catch(() => { /* one attempt — do not retry in a loop */ })
  }, [])

  // ── Shared pins ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pinsEnabled) {
      setPins([])
      return
    }
    refreshPins()
  }, [pinsEnabled, refreshPins])

  // ── Connection locations + presence ─────────────────────────────────────────
  useEffect(() => {
    if (!friendsEnabled) {
      setFriends([])
      return
    }
    let cancelled = false
    let inFlight = false
    const tick = () => {
      if (inFlight || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return
      inFlight = true
      void fetchFriendLocations()
        .then((next) => { if (!cancelled) setFriends(next) })
        .catch(() => { /* transient */ })
        .finally(() => { inFlight = false })
    }
    tick()
    return () => {
      cancelled = true
    }
  }, [friendsEnabled])

  // ── Own heartbeat with coordinates (server enforces share_location) ─────────
  useEffect(() => {
    if (!friendsEnabled) return
    const beat = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void sendHeartbeat(locationRef.current ?? undefined).catch(() => { /* best-effort */ })
    }
    beat()
  }, [friendsEnabled])

  return { pins, friends, refreshPins }
}
