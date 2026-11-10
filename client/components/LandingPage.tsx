'use client'

import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import { X } from 'lucide-react'
import { ChatPanel } from '@/components/ChatPanel'
import type { WorkspaceLink } from '@/components/WorkspaceShortcut'
import { AddPlaceSheet } from '@/components/AddPlaceSheet'
import { useI18n } from '@/components/I18nProvider'
import { type RouteInfo } from '@/components/MapView'
import { MapSheet } from '@/components/MapSheet'
import { detailsExpandedPref, PlaceDetailsPanel, setDetailsExpandedPref } from '@/components/PlaceDetailsPanel'
import { streamChat, fetchSessionState, ChatGateError } from '@/lib/stream'
import { placesForAsk, replyFromPlaces, requestedCategory } from '@/lib/placeCategory'
import { markPrioritized } from '@/lib/priority'
import { fetchCatalogPlaces, mergeCatalogFirst } from '@/lib/catalogPlaces'
import { dedupePlaces } from '@/lib/placeDedupe'
import { getRouteSnapshot, subscribeRoute } from '@/lib/routeProgress'
import { SCORING_DEFAULTS, type ScoringWeights } from '@/lib/scoringSettings'
import Paywall, { type GateState } from '@/components/Paywall'
import { VoiceOrb } from '@/components/VoiceOrb'
import type { SheetSnap } from '@/components/MobileChatSheet'
import { useIsMobile } from '@/hooks/useIsMobile'
import {
  isValidCoord,
  type LatLng,
  distanceKm,
  pinsFarFromUser,
  queryGeoPermission,
  requestUserLocationDetailed,
} from '@/lib/geo'
import {
  applyMapActions,
  placeTargetedByActions,
  toActivePlace,
  type ActivePlace,
  parseMapActions,
  shouldAttachGps,
  EMPTY_ANNOTATIONS,
  type CustomRouteConfig,
  type MapActionEffects,
  type MapAnnotations,
  type PendingRouteRequest,
  type TravelMode,
} from '@/lib/mapActions'
import {
  findPlaceIndexInText,
  isKeepOnlyRequest,
  isNamedKeepOnlyRequest,
  isListPickRequest,
  isNewSearchRequest,
  isZoomFocusRequest,
  resolvePlaceIndex,
} from '@/lib/mapIntents'
import { stripEmDashes } from '@/lib/text'
import { speak, enqueueSpeak, resetSpeakQueue, cancelSpeech, isSpeechOutputSupported, setSpeechLanguage } from '@/lib/voice'
import { useVoice } from '@/hooks/useVoice'
import { type ModelId } from '@/components/ModelSwitcher'
import { useCommunityMapLayer } from '@/components/community/useCommunityMapLayer'
import type { ChatMessage, Place, Itinerary, ItineraryStop, Theme } from '@/lib/types'

// Community UI is lazy-loaded: the chunks (panel, profile sheet, share picker,
// E2EE machinery) only download the first time a community surface opens, so
// the core map/chat path pays ~zero cost when unused.
const CommunityPanel = dynamic(
  () => import('@/components/community/CommunityPanel').then((m) => m.CommunityPanel),
  { ssr: false },
)
const ProfileSheet = dynamic(
  () => import('@/components/community/profile/ProfileSheet').then((m) => m.ProfileSheet),
  { ssr: false },
)
const SharePinDialog = dynamic(
  () => import('@/components/community/SharePinDialog').then((m) => m.SharePinDialog),
  { ssr: false },
)

function uid() { return Math.random().toString(36).slice(2) }

const REPLY_CACHE_TTL_MS = 30 * 60_000

function replyCacheKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function isCacheableReply(content: string): boolean {
  const c = content.trim()
  if (c.length < 12) return false
  return !/n'ai pas pu|couldn't draw|out of generations|réessayer|try again|quota|unavailable/i.test(c)
}

function isMapShowRequest(text: string): boolean {
  const t = text.toLowerCase()
  if (/\b(on (the |this )?map|on your map|in the map)\b/.test(t)) return true
  if (/\b(show|see|view|put|pin|display)\b/.test(t) && /\b(map|pins?|them|these|places)\b/.test(t)) return true
  if (/\bwhere (are|is) (they|them|it)\b/.test(t)) return true
  if (/\b(can't you|can you|could you).*\b(map|pins?)\b/.test(t)) return true
  return false
}

function isHideLocationRequest(text: string): boolean {
  const t = text.toLowerCase()
  return /\b(hide|don't show|do not show|remove)\b.{0,30}\b(my )?(location|gps|position)\b/.test(t)
}

function wantsRouteFromUser(text: string): boolean {
  const t = text.toLowerCase()
  if (/\b(do not|don't|not)\b.{0,25}\b(route|from me|from my)\b/.test(t)) return false
  if (/\b(without|ignore)\b.{0,15}\b(my (location|gps)|routing from me)\b/.test(t)) return false
  return (
    /\b(route|directions|how (do|to) (i )?get|how to go|plan my (route|way)|navigate)\b/.test(t)
    || /\b(from my (location|actual location)|using my location|from where i am)\b/.test(t)
    || /\b(go there|get there|show me how)\b/.test(t)
    || /\bdistance\b/.test(t)
    || /\broute from me\b/.test(t)
  )
}

/** Photos, hours, reviews, accessibility — facts the chat should show, not defer to a pin tap. */
function wantsPlaceFacts(text: string): boolean {
  const t = text.toLowerCase()
  return (
    /\b(photos?|pictures?|images?|pics?|galerie|avis|reviews?|horaires?|hours|menu|accessib\w*)\b/.test(t) ||
    /montre.{0,50}(photo|image|avis|horaire)/.test(t)
  )
}

function wantsPhotos(text: string): boolean {
  const t = text.toLowerCase()
  return /\b(photos?|pictures?|images?|pics?|galerie)\b/.test(t) || /montre.{0,40}(photo|image)/.test(t)
}

/** "de Kigali City Tower jusqu'à Java House" → both ends. Needs a named origin and destination. */
function namedRoute(text: string): { origin: string; destination: string } | null {
  const match = text.match(/\b(?:de|from)\s+(.+?)\s+(?:jusqu['’]à|jusqu'a|vers|to)\s+(.+)/i)
  if (!match) return null
  const origin = match[1].replace(/[?!.,]/g, '').trim()
  const destination = match[2]
    .replace(/\b(et\s+trace.*|avec\s+la\s+ligne.*|sur\s+la\s+carte.*|en\s+marchant.*|à\s+pied.*)$/i, '')
    .replace(/[?!.,]/g, '')
    .trim()
  if (origin.length < 3 || destination.length < 3) return null
  return { origin, destination }
}

/** "Montre-moi les photos de Java House" → "Java House". */
function placeQueryFromFactRequest(text: string): string {
  const cleaned = text
    .replace(/montre[-\s]?moi/gi, ' ')
    .replace(/\b(show me|please|s'il te pla[iî]t|stp|the|of|for|pour|les|des|de|du|la|le|un|une|photos?|pictures?|images?|pics?|galerie|avis|reviews?|horaires?|hours|menu|accessibilit\w*|accessible)\b/gi, ' ')
    .replace(/[?!.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || text.replace(/[?!]/g, '').trim()
}

const PLACE_QUERY_STOP = new Set(['kigali', 'city', 'ville', 'road', 'street', 'avenue', 'ave'])

/** Reject a fuzzy hit such as "Blorpville" → Blairsville, Georgia. */
function placeMatchesQuery(query: string, name: string): boolean {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9àâäéèêëïîôùûüç]+/i)
    .filter((w) => w.length >= 4 && !PLACE_QUERY_STOP.has(w))
  const hay = name.toLowerCase()
  if (words.length === 0) return hay.includes(query.trim().toLowerCase().slice(0, 6))
  return words.some((w) => hay.includes(w))
}

function replaceTurnAssistant(prev: ChatMessage[], id: string | null, content: string): ChatMessage[] {
  if (!id || !prev.some((m) => m.id === id)) return prev
  return prev.map((m) => (m.id === id ? { ...m, content } : m))
}

/** Only a request that asks for a line may replace the assistant text with the paint result. */
function isRouteAsk(text: string): boolean {
  return !!namedRoute(text) || /\b(itin[eé]raires?|routes?|chemins?|trac[eé]|directions?|jusqu['’]à|à pied|a pied|how do i get|comment aller)\b/i.test(text)
}

function isBareRouteFollowUp(text: string): boolean {
  return /^\s*(show( me)?( the)? routes?|take me there|directions( there)?|how do i get there|comment y aller|njyana|nzira|inzira)\s*[?.!]?\s*$/i.test(text.trim())
}

/** Itinerary stops omit rating, photos and badges. Keep the copy the chat already has. */
function enrichMapPlace(item: Place | ItineraryStop, memory: Map<string, Place>): Place {
  const known = item.place_id ? memory.get(item.place_id) : undefined
  const fromItem = 'categories' in item && Array.isArray(item.categories) ? item.categories : []
  return {
    ...known,
    ...item,
    categories: known?.categories?.length ? known.categories : fromItem,
    photo_url: ('photo_url' in item && item.photo_url) || known?.photo_url,
    photos: ('photos' in item && item.photos?.length ? item.photos : known?.photos),
    photo_reference: ('photo_reference' in item && item.photo_reference) || known?.photo_reference,
    rating: ('rating' in item && item.rating != null ? item.rating : known?.rating),
    local_business: ('local_business' in item && item.local_business) || known?.local_business,
    accessible: ('accessible' in item && item.accessible) || known?.accessible,
    access: ('access' in item && item.access) || known?.access,
    access_confirmations: ('access_confirmations' in item && item.access_confirmations != null ? item.access_confirmations : known?.access_confirmations),
    access_disputes: ('access_disputes' in item && item.access_disputes != null ? item.access_disputes : known?.access_disputes),
    open_now: ('open_now' in item && item.open_now != null ? item.open_now : known?.open_now),
    price_level: ('price_level' in item && item.price_level) || known?.price_level,
    summary: ('summary' in item && item.summary) || known?.summary,
    website: ('website' in item && item.website) || known?.website,
    hours: ('hours' in item && item.hours) || known?.hours,
    hours_week: ('hours_week' in item && item.hours_week) || known?.hours_week,
    phone: ('phone' in item && item.phone) || known?.phone,
    tags: ('tags' in item && item.tags?.length ? item.tags : known?.tags),
    claimed_by_owner: ('claimed_by_owner' in item && item.claimed_by_owner) || known?.claimed_by_owner,
  } as Place
}

function selectedPlaceNote(place: Place): string {
  const bits = [
    `name: ${place.name}`,
    place.address ? `address: ${place.address}` : '',
    place.categories?.length ? `category: ${place.categories.join(', ')}` : '',
    place.rating != null ? `rating: ${place.rating}` : '',
    `local_business: ${place.local_business ? 'yes' : 'no'}`,
    `accessible: ${place.accessible ? 'yes' : 'no'}`,
    place.open_now == null ? '' : `open_now: ${place.open_now ? 'yes' : 'no'}`,
  ].filter(Boolean)
  return `\n[Selected place on the map — the user just tapped this pin. Pronouns like "it", "ce lieu", "c'est loin", "c'est accessible" refer to this place unless they name a different one. ${bits.join('. ')}.]`
}

function askSharesToken(stored: string, current: string): boolean {
  const stop = new Set(['want', 'find', 'near', 'place', 'places', 'kigali', 'with', 'that', 'this', 'your', 'from', 'have', 'some', 'show', 'please'])
  const tokens = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9àâäéèêëïîôùûüç\s]/gi, ' ').split(/\s+/).filter((word) => word.length > 3 && !stop.has(word))
  const known = new Set(tokens(stored))
  return tokens(current).some((word) => known.has(word))
}

function parseCandidates(raw: unknown): Place[] | null {
  try {
    const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
    const clean = str.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    if (!clean || clean === '[]' || clean === '""') return null
    const parsed = JSON.parse(clean) as Place[]
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const unique = dedupePlaces(parsed)
    return unique.length ? unique : null
  } catch {
    return null
  }
}

function parseItinerary(raw: unknown): Itinerary | null {
  try {
    const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
    const clean = str.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    if (!clean || clean === '""' || clean === '{}' || clean === '{"stops":[]}') return null
    const it = JSON.parse(clean) as Itinerary
    if (Array.isArray(it?.stops)) {
      it.stops = dedupePlaces(it.stops)
    }
    if (it?.voice_summary) it.voice_summary = stripEmDashes(it.voice_summary)
    it?.stops?.forEach((s) => { if (s.rationale) s.rationale = stripEmDashes(s.rationale) })
    return it
  } catch {
    return null
  }
}

const USER_ID = typeof window !== 'undefined'
  ? (localStorage.getItem('hodari_uid') ?? (() => {
      const id = uid(); localStorage.setItem('hodari_uid', id); return id
    })())
  : 'anon'

interface HistoryItem {
  id: string
  title: string
  updatedAt: number
  messages: ChatMessage[]
}

export default function LandingPage() {
  const { t, lang } = useI18n()
  useEffect(() => { setSpeechLanguage(lang) }, [lang])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [gate, setGate] = useState<GateState | null>(null)

  // Acknowledge a return from Stripe Checkout and strip the query param so a
  // refresh doesn't re-trigger it. Credits land via the webhook; they apply on
  // the next generation.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const purchase = new URLSearchParams(window.location.search).get('purchase')
    if (!purchase) return
    if (purchase === 'success') {
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: '✓ Payment received — your credits are ready. Ask away!' },
      ])
    }
    window.history.replaceState({}, '', window.location.pathname)
  }, [])
  const [userName, setUserName] = useState('')
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([])
  const [streamingStarted, setStreamingStarted] = useState(false)
  const streamingStartedRef = useRef(false)
  const [places, setPlaces] = useState<Place[]>([])
  const [itinerary, setItinerary] = useState<Itinerary | null>(null)
  const [activeStop, setActiveStop] = useState<number | null>(null)
  const [activePlace, setActivePlace] = useState<ActivePlace | null>(null)
  const activePlaceRef = useRef<ActivePlace | null>(null)
  const rememberActiveRef = useRef<(place: Place) => void>(() => {})
  const [mapVisible, setMapVisible] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [placesLoading, setPlacesLoading] = useState(false)
  const [draftLat, setDraftLat] = useState('')
  const [draftLng, setDraftLng] = useState('')
  const [preferLocal, setPreferLocal] = useState(false)
  const [requireAccessible, setRequireAccessible] = useState(false)
  const [marketOnly, setMarketOnly] = useState(false)
  const scoringRef = useRef<ScoringWeights>(SCORING_DEFAULTS)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/scoring/weights', { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const w = await res.json()
        if (!cancelled && typeof w.local_bonus === 'number') {
          scoringRef.current = {
            local_bonus: w.local_bonus,
            accessible_bonus: w.accessible_bonus ?? SCORING_DEFAULTS.accessible_bonus,
          }
        }
      } catch { /* keep defaults */ }
    })()
    return () => { cancelled = true }
  }, [])
  const [mapExpanded, setMapExpanded] = useState(false)
  /** iOS-style full-screen map sheet opened from the chat (inline map card, header, "voir sur la carte"). */
  const [mapSheetOpen, setMapSheetOpen] = useState(false)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [uiMode, setUiMode] = useState<'chat' | 'voice'>('chat')
  const [chatWidth, setChatWidth] = useState(380)
  const resizingRef = useRef(false)
  // ── Mobile (<768px): map is the base layer, chat is a draggable bottom sheet
  const isMobile = useIsMobile()
  const [chatSnap, setChatSnap] = useState<SheetSnap>('half')
  const [selectedModel, setSelectedModel] = useState<ModelId>('gemini-3.5')
  const [theme, setTheme] = useState<Theme>('light')
  const [themeReady, setThemeReady] = useState(false)
  const [userLocation, setUserLocation] = useState<LatLng | null>(null)
  // Manual "set my city" fallback when GPS is denied/unavailable (mobile).
  // Piped into the chat context the same way coords are (see handleSend).
  const [manualCity, setManualCity] = useState<string | null>(null)
  const [geoNotice, setGeoNotice] = useState<string | null>(null)
  const geoWatchIdRef = useRef<number | null>(null)
  const [routeFromUser, setRouteFromUser] = useState(false)
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [locationPending, setLocationPending] = useState(false)
  const [mapZoomFocus, setMapZoomFocus] = useState(false)
  const [showUserOnMap, setShowUserOnMap] = useState(true)
  const [suppressGpsContext, setSuppressGpsContext] = useState(false)
  const [customRoute, setCustomRoute] = useState<CustomRouteConfig | null>(null)
  const [routeMode, setRouteMode] = useState<TravelMode>('WALK')
  const [detailsPlace, setDetailsPlace] = useState<Place | null>(null)
  const [speakReplies, setSpeakReplies] = useState(true)
  const [speechOutSupported, setSpeechOutSupported] = useState(false)
  const speakRepliesRef = useRef(true)
  const sessionId = useRef(uid())
  const abortRef = useRef<AbortController | null>(null)
  /** Set only after the map has actually painted a route, or after that paint failed. */
  const routeVerdictRef = useRef<string | null>(null)
  const pendingRouteClaim = useRef(false)
  /** True once paintRoute has put a line on the map for the current claim. */
  const routePaintedRef = useRef(false)
  const routeWatchRef = useRef<number | null>(null)
  /** Last pin the user tapped. Follow-up chat questions use this, not a separate store. */
  const clickedPlaceRef = useRef<Place | null>(null)
  /** Assistant bubble of the in-flight turn. Route text is written only into this id. */
  const turnAssistantIdRef = useRef<string | null>(null)
  /** True when the current user message asked for a line. */
  const routeClaimAllowedRef = useRef(false)
  /** Route the agent asked for before the destination was on the map. */
  const pendingRouteRef = useRef<PendingRouteRequest | null>(null)
  const mapPlacesRef = useRef<Place[]>([])
  const [placeCardOpen, setPlaceCardOpen] = useState(false)
  const soloPlaceModeRef = useRef(false)
  const appliedMapActionsRef = useRef('')
  const placesRef = useRef(places)
  const fullPlacesRef = useRef<Place[]>([])
  const itineraryRef = useRef(itinerary)
  const activeStopRef = useRef(activeStop)
  const fetchedPhotoIdsRef = useRef(new Set<string>())
  // Every place seen this session, so the AI can color/circle a place from an
  // earlier search (e.g. mark the restaurant while showing nearby hotels).
  const placeMemoryRef = useRef<Map<string, Place>>(new Map())
  const [annotations, setAnnotations] = useState<MapAnnotations>(EMPTY_ANNOTATIONS)
  const [savedPlaceIds, setSavedPlaceIds] = useState<Set<string>>(() => new Set())

  // Jury demo keeps Community out of the header and the map. The pitch is the
  // map, local businesses, and accessibility. Flip this to bring the panel back.
  const showCommunity = false

  // ── Community layer (panel, profile sheet, share picker, map overlays) ──────
  // `communityMounted` keeps the lazy chunk mounted after first open so the
  // sheet's close animation still plays; before that nothing is downloaded.
  const [communityMounted, setCommunityMounted] = useState(false)
  const [communityOpen, setCommunityOpen] = useState(false)
  const [communityLayerOn, setCommunityLayerOn] = useState(false)
  const [communityPrefsReady, setCommunityPrefsReady] = useState(false)
  const [profileTarget, setProfileTarget] = useState<string | null>(null)
  const [shareTarget, setShareTarget] = useState<Place | null>(null)
  const [shareConversationId, setShareConversationId] = useState<string | null>(null)
  const [communityFocus, setCommunityFocus] = useState<{ lat: number; lng: number } | null>(null)
  // Invite badge updates when the community panel is opened. A background
  // poll of /api/community/connections was timing out and logging 500s.
  const [communityInviteCount, setCommunityInviteCount] = useState(0)

  useEffect(() => {
    setUserName(localStorage.getItem('hodari_name') || localStorage.getItem('hodari_email') || '')
    const savedTheme = localStorage.getItem('hodari_theme')
    if (savedTheme === 'dark' || savedTheme === 'light') setTheme(savedTheme)
    setThemeReady(true)
    setManualCity(localStorage.getItem('hodari_city') || null)
    try {
      const parsed = JSON.parse(localStorage.getItem('hodari_saved') ?? '[]')
      if (Array.isArray(parsed)) setSavedPlaceIds(new Set(parsed))
    } catch { /* ignore */ }
    // Leave the community map layer off on load. Restoring hodari_community_layer
    // was calling pins, connections, and presence before the panel was opened.
    setCommunityPrefsReady(true)
  }, [])

  // Owners and admins who land on the client app get a way back to their space.
  const [workspaceRole, setWorkspaceRole] = useState<'business_owner' | 'admin' | null>(null)
  const [ownedListings, setOwnedListings] = useState<NonNullable<WorkspaceLink['places']>>([])
  useEffect(() => {
    let alive = true
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (data) => {
        if (!alive) return
        if (data?.user?.name) setUserName(String(data.user.name))
        else if (data?.user?.email) setUserName(String(data.user.email).split('@')[0])
        if (data?.user?.role === 'business_owner') {
          setWorkspaceRole('business_owner')
          const res = await fetch('/api/business?summary=1', { cache: 'no-store' }).catch(() => null)
          const json = res?.ok ? await res.json().catch(() => null) : null
          if (alive && Array.isArray(json?.places)) setOwnedListings(json.places)
        } else if (data?.user?.admin) {
          setWorkspaceRole('admin')
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  const workspace: WorkspaceLink | undefined = workspaceRole === 'business_owner'
    ? {
        href: ownedListings.length === 1
          ? `/business/dashboard?place=${encodeURIComponent(ownedListings[0].place_id)}`
          : '/business/dashboard',
        label: t('header.workspace.short'),
        cta: t('header.workspace.owner'),
        places: ownedListings,
      }
    : workspaceRole === 'admin'
      ? { href: '/admin', label: t('header.workspace.admin'), cta: t('header.workspace.admin') }
      : undefined

  const communityLayerWrite = useRef(false)
  useEffect(() => {
    if (!communityPrefsReady) return
    if (!communityLayerWrite.current) {
      communityLayerWrite.current = true
      return
    }
    try { localStorage.setItem('hodari_community_layer', communityLayerOn ? '1' : '0') } catch { /* ignore */ }
  }, [communityLayerOn, communityPrefsReady])

  // Pins load once while the panel or the map layer is on. Connection
  // positions load once when the layer is turned on. No background polling.
  const { pins: communityPins, friends: communityFriends, refreshPins } = useCommunityMapLayer({
    pinsEnabled: showCommunity && (communityLayerOn || communityOpen),
    friendsEnabled: showCommunity && communityLayerOn,
    userLocation,
  })

  const openCommunity = useCallback(() => {
    setCommunityMounted(true)
    setCommunityOpen(true)
    // One panel at a time: community replaces the place-details overlay.
    setDetailsPlace(null)
  }, [])
  const handleOpenProfile = useCallback((handle: string) => setProfileTarget(handle), [])
  const handleToggleCommunityLayer = useCallback(() => setCommunityLayerOn((v) => !v), [])
  /** Center the map on a community place (shared-pin tap in panel/profile). */
  const handleCommunityFocusPlace = useCallback((lat: number, lng: number) => {
    if (!isValidCoord({ lat, lng })) return
    setCommunityLayerOn(true)
    setMapVisible(true)
    setCommunityFocus({ lat, lng })
  }, [])
  const handlePlaceShare = useCallback((place: Place) => setShareTarget(place), [])

  useEffect(() => {
    placesRef.current = places
    for (const p of places) {
      if (p.place_id && isValidCoord(p.coordinates)) placeMemoryRef.current.set(p.place_id, p)
    }
  }, [places])
  useEffect(() => { itineraryRef.current = itinerary }, [itinerary])

  // The route action often arrives before candidates are in React state.
  // Draw it as soon as the named place shows up, on the same chat turn.
  useEffect(() => {
    const pending = pendingRouteRef.current
    if (!pending || !routeClaimAllowedRef.current || routePaintedRef.current) return
    const list: Place[] = itinerary?.stops?.length
      ? itinerary.stops.map((s) => ({ ...s, personalization_score: 0, categories: [] as string[] }))
      : places
    if (!list.length) return
    let idx: number | null = null
    if (
      typeof pending.to_place_index === 'number' &&
      pending.to_place_index >= 0 &&
      pending.to_place_index < list.length
    ) {
      idx = pending.to_place_index
    } else if (pending.to_place_name) {
      idx = findPlaceIndexInText(pending.to_place_name, list)
    }
    if (idx === null && activeStop != null && activeStop < list.length && !pending.to_place_name) {
      idx = activeStop
    }
    if (idx === null) return
    pendingRouteRef.current = null
    setActiveStop(idx)
    setMapVisible(true)
    setRouteMode(pending.mode)
    if (pending.from === 'user') {
      setRouteFromUser(true)
      setCustomRoute(null)
    } else if (pending.landmark) {
      setRouteFromUser(false)
      setCustomRoute({
        from: 'landmark',
        landmark: pending.landmark,
        destinationIndex: idx,
        mode: pending.mode,
      })
    }
  }, [places, itinerary, activeStop])
  useEffect(() => { activeStopRef.current = activeStop }, [activeStop])
  useEffect(() => { speakRepliesRef.current = speakReplies }, [speakReplies])

  // Auto-fetch photos for places that came back without one. The stream
  // handler re-sets `places` with fresh photo-less objects several times per
  // turn (candidates chunk, final state, open-map-from-message), so fetched
  // URLs are kept in a cache keyed by place_id and re-applied after every
  // overwrite — the key below flips whenever a visible place loses its photo.
  const photoCacheRef = useRef(new Map<string, string[]>())
  // Calendar events already surfaced as chips (keyed place_id:date) — avoids
  // re-showing the same scheduled visit on later turns.
  const shownCalendarKeysRef = useRef(new Set<string>())
  // Signed-in members get server-side (encrypted, cross-device) chat history;
  // guests fall back to localStorage. Set during the initial history load.
  const authedRef = useRef(false)
  const messagesRef = useRef<ChatMessage[]>([])
  messagesRef.current = messages
  const replyCacheRef = useRef(new Map<string, { at: number; content: string; places?: Place[] }>())
  const sendLockRef = useRef(false)
  const recentSendRef = useRef<{ key: string; at: number } | null>(null)
  const retriedRef = useRef(false)
  const lastUserTextRef = useRef('')
  const hasOwnPhoto = (p: Place) => Boolean(p.photo_url || p.photos?.length || p.photo_reference)
  const placePhotoKey = places
    .map((p) => `${p.place_id}:${hasOwnPhoto(p) ? 1 : 0}`)
    .join(',')
  useEffect(() => {
    const applyCached = (list: Place[]) =>
      list.map((p) => {
        if (hasOwnPhoto(p)) return p
        const urls = photoCacheRef.current.get(p.place_id)
        return urls?.length ? { ...p, photo_url: urls[0], photos: urls } : p
      })

    if (places.some((p) => !hasOwnPhoto(p) && photoCacheRef.current.has(p.place_id))) {
      setPlaces((prev) => applyCached(prev))
    }

    // Mirror cached photos onto message places too — `msg.places` are set from
    // the raw parse and never get enriched, so the in-chat gallery would show
    // "No photo" without this. Only writes when something actually changed.
    setMessages((prev) => {
      let anyChanged = false
      const next = prev.map((m) => {
        if (!m.places?.length) return m
        let msgChanged = false
        const patched = m.places.map((p) => {
          if (p.photo_url || p.photos?.length || p.photo_reference) return p
          const urls = photoCacheRef.current.get(p.place_id)
          if (urls?.length) { msgChanged = true; return { ...p, photo_url: urls[0], photos: urls } }
          return p
        })
        if (msgChanged) { anyChanged = true; return { ...m, places: patched } }
        return m
      })
      return anyChanged ? next : prev
    })

    const toFetch = places.filter(
      (p) => p.place_id && !p.place_id.startsWith('__') && !hasOwnPhoto(p) && !fetchedPhotoIdsRef.current.has(p.place_id),
    )
    if (!toFetch.length) return
    toFetch.forEach((place) => {
      fetchedPhotoIdsRef.current.add(place.place_id)
      fetch(`/api/place-photos?placeId=${encodeURIComponent(place.place_id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return
          const patch: Partial<Place> = {}
          if (data.photoUrls?.length) {
            photoCacheRef.current.set(place.place_id, data.photoUrls)
            patch.photo_url = data.photoUrls[0]
            patch.photos = data.photoUrls
          }
          if (typeof data.isOpen === 'boolean') patch.open_now = data.isOpen
          if (Object.keys(patch).length === 0) return
          const applyPatch = (p: Place) => (p.place_id === place.place_id ? { ...p, ...patch } : p)
          setPlaces((prev) => prev.map(applyPatch))
          setMessages((prev) => prev.map((m) => (
            m.places?.some((p) => p.place_id === place.place_id)
              ? { ...m, places: m.places.map(applyPatch) }
              : m
          )))
        })
        .catch(() => {})
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placePhotoKey])

  const handleSavePlace = useCallback(
    (place: Place) => {
      const id = place.place_id
      const isNowSaved = !savedPlaceIds.has(id)
      setSavedPlaceIds((prev) => {
        const next = new Set(prev)
        if (isNowSaved) next.add(id)
        else next.delete(id)
        try { localStorage.setItem('hodari_saved', JSON.stringify([...next])) } catch { /* ok */ }
        return next
      })
      fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, placeId: id, placeName: place.name, city: place.city ?? '', action: isNowSaved ? 'saved' : 'unsaved' }),
      }).catch(() => {})
    },
    [savedPlaceIds],
  )

  /** A chat turn asked for a line. The verdict waits until the map paints it, or the attempt ends. */
  const beginRouteClaim = useCallback(() => {
    if (routePaintedRef.current) return
    pendingRouteClaim.current = true
    routePaintedRef.current = false
    routeVerdictRef.current = null
    setRouteInfo(null)
    setRouteError(null)
    if (routeWatchRef.current != null) window.clearTimeout(routeWatchRef.current)
    routeWatchRef.current = window.setTimeout(() => {
      if (!pendingRouteClaim.current || routePaintedRef.current) return
      pendingRouteClaim.current = false
      const verdict = t('errors.routeFailed')
      routeVerdictRef.current = verdict
      setRouteError(verdict)
      setMessages((prev) => replaceTurnAssistant(prev, turnAssistantIdRef.current, verdict))
    }, 12000)
  }, [t])

  const commitRouteFailure = useCallback(() => {
    if (routePaintedRef.current) return
    pendingRouteClaim.current = false
    if (routeWatchRef.current != null) {
      window.clearTimeout(routeWatchRef.current)
      routeWatchRef.current = null
    }
    const verdict = t('errors.routeFailed')
    routeVerdictRef.current = verdict
    setRouteError(verdict)
    setMessages((prev) => replaceTurnAssistant(prev, turnAssistantIdRef.current, verdict))
  }, [t])

  const reportRouteError = useCallback((message: string | null) => {
    if (!message || routePaintedRef.current || !pendingRouteClaim.current) return
    pendingRouteClaim.current = false
    if (routeWatchRef.current != null) {
      window.clearTimeout(routeWatchRef.current)
      routeWatchRef.current = null
    }
    routeVerdictRef.current = message
    setRouteError(message)
    setMessages((prev) => replaceTurnAssistant(prev, turnAssistantIdRef.current, message))
  }, [])

  const handleSend = useCallback(async (text: string, opts?: { speak?: boolean; display?: string; fromVoice?: boolean; retry?: boolean }) => {
    const displayText = (opts?.display ?? text).trim()
    if (sendLockRef.current) return
    if (!opts?.retry) {
      const key = displayText.toLowerCase()
      const recent = recentSendRef.current
      if (recent && recent.key === key && Date.now() - recent.at < 3000) return
      recentSendRef.current = { key, at: Date.now() }
      retriedRef.current = false
      lastUserTextRef.current = displayText
    }
    routeVerdictRef.current = null
    routePaintedRef.current = false
    pendingRouteClaim.current = false
    if (isBareRouteFollowUp(text) && activePlaceRef.current) {
      const target = activePlaceRef.current
      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        content: opts?.display ?? text,
        fromVoice: opts?.fromVoice,
      }
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: uid(), role: 'assistant', content: t('map.routingTo').replace('{name}', target.name) },
      ])
      setMapVisible(true)
      setCustomRoute(null)
      setRouteInfo(null)
      setRouteError(null)
      setMapZoomFocus(false)
      setRouteFromUser(true)
      return
    }
    routeClaimAllowedRef.current = isRouteAsk(text)
    if (routeClaimAllowedRef.current) {
      setCustomRoute(null)
      setRouteFromUser(false)
    }
    resetSpeakQueue()
    const wantSpeak = !!opts?.speak
    let progressiveSpoken = ''

    if (isNewSearchRequest(text)) soloPlaceModeRef.current = false

    if (isHideLocationRequest(text)) {
      setShowUserOnMap(false)
      setRouteFromUser(false)
      setCustomRoute(null)
      setRouteInfo(null)
    }

    const attachGps = shouldAttachGps(text, userLocation, suppressGpsContext)
    // Manual-city fallback rides the same seam: shouldAttachGps only gates on
    // "a location exists" + text intent, so probe it with a sentinel coord.
    const attachCity =
      !attachGps && !!manualCity && shouldAttachGps(text, { lat: 1, lng: 1 }, suppressGpsContext)
    const located = attachGps && userLocation
      ? `${text}\n[User location: ${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}]`
      : attachCity
        ? `${text}\n[User city: ${manualCity}]`
        : text
    const tapped = clickedPlaceRef.current
    const enriched = tapped ? `${located}${selectedPlaceNote(tapped)}` : located

    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: opts?.display ?? text,
      fromVoice: opts?.fromVoice,
    }
    setMessages((prev) => [...prev, userMsg])
    const assistantId = uid()
    turnAssistantIdRef.current = assistantId
    const knownPlace = findPlaceIndexInText(text, placesRef.current)
    const showingKnown = knownPlace !== null && /\bshow me\b/i.test(text)
    if (showingKnown) rememberActiveRef.current(placesRef.current[knownPlace])
    if (
      !showingKnown &&
      !isBareRouteFollowUp(text) &&
      /\b(find|show|where|near|hotel|tomato|tomate|market|restaurant|cafe|pharmacy|cherche|trouve|inyanya|isoko|supermarket)\b/i.test(text)
    ) {
      placesRef.current = []
      setPlaces([])
      activePlaceRef.current = null
      setActivePlace(null)
      setAnnotations(EMPTY_ANNOTATIONS)
      setActiveStop(null)
      setRouteFromUser(false)
      setRouteInfo(null)
    }
    sendLockRef.current = true
    setLoading(true)
    setThinkingSteps([])
    setStreamingStarted(false)
    streamingStartedRef.current = false

    const photoLookup = wantsPhotos(text)
      ? fetch(`/api/place-photos?q=${encodeURIComponent(placeQueryFromFactRequest(text))}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      : Promise.resolve(null)

    const ends = namedRoute(text)
    if (ends) {
      beginRouteClaim()
      void Promise.all([
        fetch(`/api/place-photos?q=${encodeURIComponent(ends.origin)}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/place-photos?q=${encodeURIComponent(ends.destination)}`).then((r) => (r.ok ? r.json() : null)),
      ]).then(([from, to]) => {
        const dest = to?.place as Place | undefined
        const origin = from?.place as Place | undefined
        const destName = String(to?.name ?? dest?.name ?? '')
        const originName = String(from?.name ?? origin?.name ?? '')
        if (
          !dest?.coordinates ||
          !origin?.coordinates ||
          !placeMatchesQuery(ends.destination, destName) ||
          !placeMatchesQuery(ends.origin, originName)
        ) {
          commitRouteFailure()
          return
        }
        setPlaces([dest])
        setItinerary(null)
        setActiveStop(0)
        setMapVisible(true)
        setRouteFromUser(false)
        setCustomRoute({
          from: 'landmark',
          landmark: String(from?.name ?? ends.origin),
          originPoint: origin.coordinates,
          destinationIndex: 0,
          mode: 'WALK',
        })
      }).catch(() => commitRouteFailure())
    }

    const visiblePlaces: Place[] = itinerary?.stops?.length
      ? itinerary.stops.map((s) => ({ ...s, personalization_score: 0, categories: [] }))
      : places

    let mapOnlyReply: string | null = null

    if (isZoomFocusRequest(text) || isListPickRequest(text)) {
      const idx = resolvePlaceIndex(text, visiblePlaces, activeStop)
      if (idx !== null) {
        setActiveStop(idx)
        setMapZoomFocus(true)
        setMapVisible(true)
        if (isZoomFocusRequest(text)) {
          mapOnlyReply = `Centered the map on ${visiblePlaces[idx].name}. Tap Route from me for directions.`
        }
      }
    }

    if (isKeepOnlyRequest(text) || isNamedKeepOnlyRequest(text, visiblePlaces)) {
      const idx = resolvePlaceIndex(text, visiblePlaces, activeStop)
      if (idx !== null) {
        const solo = visiblePlaces[idx]
        setPlaces([solo])
        setItinerary(null)
        setActiveStop(0)
        setMapZoomFocus(true)
        setMapVisible(true)
        soloPlaceModeRef.current = true
        mapOnlyReply = `Showing only ${solo.name} on your map. Tap its card and Route from me when you're ready to go.`
      }
    }

    if (isMapShowRequest(text)) setMapVisible(true)

    if (mapOnlyReply && !wantsRouteFromUser(text)) {
      setLoading(false)
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: mapOnlyReply },
      ])
      if (wantSpeak && speakRepliesRef.current) speak(mapOnlyReply)
      return
    }

    if (!isRouteAsk(text)) {
      const hit = replyCacheRef.current.get(replyCacheKey(opts?.display ?? text))
      if (hit && Date.now() - hit.at < REPLY_CACHE_TTL_MS) {
        const catalog = await fetchCatalogPlaces(text).catch(() => [] as Place[])
        const mergedPlaces = mergeCatalogFirst(catalog, hit.places ?? [])
        const ranked = mergedPlaces.length
          ? markPrioritized(mergedPlaces, /prefer_local/i.test(text), scoringRef.current)
          : undefined
        setLoading(false)
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: 'assistant', content: hit.content, places: ranked ?? hit.places },
        ])
        if (ranked?.length) {
          setPlaces(ranked)
          setMapVisible(true)
          setActiveStop(0)
        }
        if (wantSpeak && speakRepliesRef.current) speak(hit.content)
        return
      }
    }
    const routeRequest = wantsRouteFromUser(text)
    if (routeRequest) {
      setRouteFromUser(true)
      setMapVisible(true)
      const idx = findPlaceIndexInText(text, places)
      if (idx !== null) setActiveStop(idx)
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    // Parallel: validated Mongo listings so owner-published businesses always surface.
    const catalogPromise = fetchCatalogPlaces(text, ctrl.signal).catch(() => [] as Place[])

    let assistantText = ''
    let rememberReply = false
    let earlyItinerarySet = false
    let pipelineRan = false

    let placeReply = ''
    let keptPlaces: Place[] | null = null
    const noResultsText = (value: string) => /couldn'?t find|could not find|n'ai pas trouv|sinabonye|no places found/i.test(value)
    const publishPlaces = (agentPlaces: Place[], replaceEmpty = false) => {
      if (keptPlaces) return
      if (agentPlaces.length > 0) keptPlaces = agentPlaces
      void catalogPromise.then((catalog) => {
        if (ctrl.signal.aborted || soloPlaceModeRef.current) return
        if (keptPlaces && agentPlaces.length === 0) return
        const merged = dedupePlaces([...agentPlaces, ...catalog]).slice(0, 8)
        const placeAsk = merged.length > 0 || requestedCategory(text) != null
        if (!merged.length && !replaceEmpty && !placeAsk) return
        if (!merged.length && keptPlaces) return
        const ranked = merged
        placesRef.current = ranked
        fullPlacesRef.current = ranked
        setPlaces(ranked)
        setItinerary(null)
        setMapZoomFocus(false)
        setMapVisible(ranked.length > 0)
        setActiveStop(null)
        if (!routeRequest) { setRouteFromUser(false); setRouteInfo(null) }
        if (placeAsk) placeReply = replyFromPlaces(ranked, text)
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === assistantId)
          const content = placeReply || existing?.content || ''
          if (!existing) {
            return [...prev, {
              id: assistantId,
              role: 'assistant' as const,
              content,
              places: ranked,
            }]
          }
          return prev.map((m) => m.id === assistantId ? { ...m, content: placeReply || m.content, places: ranked, itinerary: undefined } : m)
        })
      })
    }

    const processSessionMapActions = (state: Record<string, unknown>) => {
      const raw = state.map_actions
      const payload = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')
      if (!payload || payload === '[]' || payload === '""' || payload === appliedMapActionsRef.current) return
      const actions = parseMapActions(raw)
      if (!actions.length) return
      appliedMapActionsRef.current = payload
      const effects = applyMapActions(actions, {
        places: placesRef.current,
        itinerary: itineraryRef.current,
        activeStop: activeStopRef.current,
        sessionCandidates: state.candidates,
        sessionItinerary: state.itinerary,
        intentType: typeof state.intent_type === 'string' ? state.intent_type : undefined,
      })
      applyMapEffects(effects)
      const targeted = placeTargetedByActions(
        actions,
        placesRef.current,
        [...placeMemoryRef.current.values()],
      )
      if (targeted) rememberActiveRef.current(targeted)

      // Highlight and circle actions select activePlace. The map draws that
      // one circle itself, so a leftover annotation cannot sit on another pin.
      if (actions.some((a) => a.op === 'highlight_place' || a.op === 'circle_place' || a.op === 'clear_annotations')) {
        setAnnotations(EMPTY_ANNOTATIONS)
        setMapVisible(true)
      }
    }

    const applySessionSnapshot = (s: Record<string, unknown>) => {
      if (s.intent_type === 'LIST_DISCOVERY') setItinerary(null)
      if (s.itinerary && s.intent_type !== 'LIST_DISCOVERY' && !earlyItinerarySet) {
        const parsed = parseItinerary(s.itinerary)
        if (parsed) {
          earlyItinerarySet = true
          setItinerary(parsed)
          placesRef.current = []
          setPlaces([])
          setActiveStop(0)
          setMapVisible(true)
          if (!routeRequest) setRouteFromUser(false)
          setMessages((prev) => {
            const ri = [...prev].reverse().findIndex((m) => m.role === 'assistant')
            if (ri === -1) {
              const text = parsed.voice_summary || `Here's your ${parsed.stops.length}-stop plan!`
              return [...prev, { id: assistantId, role: 'assistant' as const, content: text, itinerary: parsed }]
            }
            const ai = prev.length - 1 - ri
            return prev.map((m, i) => i === ai ? { ...m, itinerary: parsed, places: undefined } : m)
          })
        }
      }
      const placesQuery = typeof s.places_query === 'string' ? s.places_query : ''
      if (!earlyItinerarySet && s.candidates && !soloPlaceModeRef.current && placesQuery && askSharesToken(placesQuery, text)) {
        const parsed = parseCandidates(s.candidates) ?? []
        publishPlaces(parsed, true)
      }
      processSessionMapActions(s)
      if (s.suppress_gps_context === '1') setSuppressGpsContext(true)
    }

    try {
      for await (const chunk of streamChat(enriched, USER_ID, sessionId.current, ctrl.signal)) {
        if (chunk.type === 'error') {
          const friendly = t('errors.retry')
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === assistantId)
            if (existing) return prev.map((m) => m.id === assistantId ? { ...m, content: friendly } : m)
            return [...prev, { id: assistantId, role: 'assistant', content: friendly }]
          })
          continue
        }
        if (chunk.type === 'places') {
          pipelineRan = true
          const list = dedupePlaces(chunk.places)
          publishPlaces(list, true)
          continue
        }
        if (chunk.type === 'thinking') {
          pipelineRan = true
          setThinkingSteps((prev) => [...prev, chunk.label])
          if (chunk.agent === 'map_control') {
            fetchSessionState(USER_ID, sessionId.current, ctrl.signal)
              .then((s) => applySessionSnapshot(s))
              .catch(() => {})
          }
        } else if (!placeReply) {
          if (keptPlaces && noResultsText(chunk.text)) continue
          if (!streamingStartedRef.current) {
            streamingStartedRef.current = true
            setStreamingStarted(true)
          }
          assistantText += chunk.text
          const clean = routeVerdictRef.current ?? stripEmDashes(assistantText)
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === assistantId)
            if (existing?.places?.length && noResultsText(clean)) return prev
            if (existing) return prev.map((m) => m.id === assistantId ? { ...m, content: clean } : m)
            return [...prev, { id: assistantId, role: 'assistant', content: clean }]
          })
          // Progressive TTS: speak completed sentences while the rest still streams.
          if (wantSpeak && speakRepliesRef.current) {
            const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? []
            if (sentences.length > 0) {
              const complete = sentences.join(' ').trim()
              if (complete.length > progressiveSpoken.length) {
                const neu = complete.slice(progressiveSpoken.length).trim()
                progressiveSpoken = complete
                if (neu) void enqueueSpeak(neu)
              }
            }
          }
        }
      }

      if (wantSpeak && speakRepliesRef.current && assistantText.trim()) {
        const full = stripEmDashes(assistantText)
        const rest = full.slice(progressiveSpoken.length).trim()
        if (rest) void enqueueSpeak(rest)
        else if (!progressiveSpoken) void speak(full)
      }

      try {
        const state = await fetchSessionState(USER_ID, sessionId.current, ctrl.signal)
        processSessionMapActions(state)
        if (state.suppress_gps_context === '1') setSuppressGpsContext(true)
        else if (state.suppress_gps_context === '') setSuppressGpsContext(false)

        // Scheduled visits (plan_visit) → attach "Add to Google Calendar" chips to
        // the reply. Track shown events by place+date so they don't re-appear.
        const calRaw = Array.isArray(state.calendar_events) ? state.calendar_events as Array<Record<string, unknown>> : []
        const freshCal = calRaw
          .map((e) => ({ title: String(e.title ?? ''), date: String(e.date ?? ''), location: (e.location as string) || undefined, description: (e.note as string) || undefined, placeId: String(e.place_id ?? '') }))
          .filter((e) => e.title && e.date && !shownCalendarKeysRef.current.has(`${e.placeId}:${e.date}`))
        if (freshCal.length) {
          freshCal.forEach((e) => shownCalendarKeysRef.current.add(`${e.placeId}:${e.date}`))
          setMessages((prev) => {
            const ri = [...prev].reverse().findIndex((m) => m.role === 'assistant')
            if (ri === -1) return prev
            const ai = prev.length - 1 - ri
            return prev.map((m, i) => i === ai
              ? { ...m, calendarEvents: freshCal.map(({ title, date, location, description }) => ({ title, date, location, description })) }
              : m)
          })
        }

        if (!earlyItinerarySet) {
          const intent = state.intent_type as string | undefined
          const placesQuery = typeof state.places_query === 'string' ? state.places_query : ''
          const queryMatches = Boolean(placesQuery) && askSharesToken(placesQuery, text)
          const parsedCandidates = state.candidates && queryMatches
            ? (parseCandidates(state.candidates) ?? [])
            : null
          const parsedItinerary = state.itinerary ? parseItinerary(state.itinerary) : null

          if (parsedCandidates && (intent === 'LIST_DISCOVERY' || !parsedItinerary) && !soloPlaceModeRef.current) {
            publishPlaces(parsedCandidates, true)
          } else if (parsedItinerary && intent !== 'LIST_DISCOVERY') {
            setItinerary(parsedItinerary)
            placesRef.current = []
            setPlaces([])
            setMapVisible(true)
            setActiveStop(0)
            if (!routeRequest) setRouteFromUser(false)
            setMessages((prev) => {
              const ri = [...prev].reverse().findIndex((m) => m.role === 'assistant')
              if (ri === -1) {
                const text = parsedItinerary.voice_summary || `Here's your ${parsedItinerary.stops.length}-stop plan!`
                return [...prev, { id: assistantId, role: 'assistant' as const, content: text, itinerary: parsedItinerary }]
              }
              const ai = prev.length - 1 - ri
              return prev.map((m, i) => i === ai ? { ...m, itinerary: parsedItinerary, places: undefined } : m)
            })
          } else if (!soloPlaceModeRef.current) {
            // Always try Mongo catalog (owner-published) even if Maps/agent returned nothing.
            publishPlaces(parsedCandidates ?? [])
          }
        }
      } catch { /* non-critical */ }

      if (routeRequest) {
        let list = places
        try {
          const state = await fetchSessionState(USER_ID, sessionId.current, ctrl.signal)
          const parsed = state.candidates ? parseCandidates(state.candidates) : null
          if (parsed) list = parsed
        } catch { /* use in-memory places */ }
        const idx = findPlaceIndexInText(text, list)
        if (idx !== null) setActiveStop(idx)
      }

      if (wantsPhotos(text)) {
        const data = await photoLookup
        const photos: string[] = Array.isArray(data?.photoUrls) ? data.photoUrls.filter((u: unknown) => typeof u === 'string' && u) : []
        setMessages((prev) => {
          const ri = [...prev].reverse().findIndex((m) => m.role === 'assistant')
          if (ri === -1) return prev
          const ai = prev.length - 1 - ri
          if (photos.length > 0) {
            const place = data.place as Place | undefined
            return prev.map((m, i) => i === ai ? {
              ...m,
              places: place ? [place] : m.places,
              gallery: {
                type: 'photo_gallery' as const,
                place_name: String(data.name ?? place?.name ?? placeQueryFromFactRequest(text)),
                photos: photos.slice(0, 4),
                attribution: typeof data.attribution === 'string' ? data.attribution : undefined,
              },
            } : m)
          }
          return prev.map((m, i) => i === ai ? { ...m, content: t('errors.noPhotos'), gallery: undefined } : m)
        })
      } else if (wantsPlaceFacts(text)) {
        const pool = placesRef.current.length
          ? placesRef.current
          : [...placeMemoryRef.current.values()]
        const factIdx = findPlaceIndexInText(text, pool)
        if (factIdx != null) {
          let shown = pool[factIdx]
          if ((!shown.photos || shown.photos.length === 0) && !shown.photo_url && shown.place_id && !shown.place_id.startsWith('__')) {
            try {
              const photoRes = await fetch(`/api/place-photos?placeId=${encodeURIComponent(shown.place_id)}`)
              if (photoRes.ok) {
                const data = await photoRes.json()
                if (Array.isArray(data.photoUrls) && data.photoUrls.length) {
                  photoCacheRef.current.set(shown.place_id, data.photoUrls)
                  shown = { ...shown, photo_url: data.photoUrls[0], photos: data.photoUrls }
                }
              }
            } catch { /* gallery still shows the place card */ }
          }
          if (shown.photos?.length || shown.photo_url) {
            const urls = (shown.photos?.length ? shown.photos : [shown.photo_url as string]).slice(0, 4)
            setMessages((prev) => {
              const ri = [...prev].reverse().findIndex((m) => m.role === 'assistant')
              if (ri === -1) return prev
              const ai = prev.length - 1 - ri
              return prev.map((m, i) => i === ai ? {
                ...m,
                places: [shown],
                gallery: { type: 'photo_gallery' as const, place_name: shown.name, photos: urls },
              } : m)
            })
          }
        }
      }
      rememberReply = true
    } catch (err) {
      if (err instanceof ChatGateError) {
        // Quota gate (free previews used / out of credits): drop the empty
        // assistant turn and open the login wall or paywall instead of an error.
        setMessages((prev) => prev.filter((m) => m.content !== '' || m.role !== 'assistant'))
        setGate({ type: err.gate, message: err.message })
      } else if (err instanceof Error && err.name === 'AbortError') {
        // User stopped the request — leave whatever partial text is already in messages
      } else {
        console.error(err)
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: 'assistant', content: t('errors.retry') },
        ])
      }
    } finally {
      sendLockRef.current = false
      abortRef.current = null
      setLoading(false)
      setStreamingStarted(false)
      streamingStartedRef.current = false
      if (rememberReply && !isRouteAsk(text) && isCacheableReply(assistantText)) {
        const pins = placesRef.current
        replyCacheRef.current.set(replyCacheKey(opts?.display ?? text), {
          at: Date.now(),
          content: assistantText,
          places: pins.length ? pins : undefined,
        })
      }
    }
  }, [userLocation, manualCity, places, itinerary, activeStop, suppressGpsContext, t, beginRouteClaim, commitRouteFailure]) // eslint-disable-line react-hooks/exhaustive-deps

  const retryLastMessage = useCallback(() => {
    if (retriedRef.current || sendLockRef.current) return
    const again = lastUserTextRef.current
    if (!again) return
    retriedRef.current = true
    void handleSend(again, { retry: true })
  }, [handleSend])

  const applyMapEffects = useCallback((effects: MapActionEffects) => {
    if (effects.showUserOnMap !== undefined) setShowUserOnMap(effects.showUserOnMap)
    if (effects.suppressGpsContext !== undefined) setSuppressGpsContext(effects.suppressGpsContext)
    if (effects.mapOpen !== undefined) setMapVisible(effects.mapOpen)
    if (effects.mapExpanded !== undefined) setMapExpanded(effects.mapExpanded)
    if (effects.mapOpen === false) setMapExpanded(false)
    if (effects.mapZoomFocus !== undefined) setMapZoomFocus(effects.mapZoomFocus)
    if (effects.activeStop !== undefined) {
      setActiveStop(effects.activeStop)
      const focused = effects.activeStop !== null ? placesRef.current[effects.activeStop] : undefined
      const active = focused ? toActivePlace(focused) : null
      if (active) {
        activePlaceRef.current = active
        setActivePlace(active)
      }
    }
    if (effects.places !== undefined) {
      const nextPlaces = dedupePlaces(effects.places)
      placesRef.current = nextPlaces
      setPlaces(nextPlaces)
    }
    if (effects.clearItinerary) setItinerary(null)
    if (effects.soloPlaceMode) soloPlaceModeRef.current = true
    if (effects.routeFromUser !== undefined) setRouteFromUser(effects.routeFromUser)
    if (effects.customRoute !== undefined) setCustomRoute(effects.customRoute)
    if (effects.routeMode !== undefined) setRouteMode(effects.routeMode)
    if (effects.pendingRoute !== undefined) pendingRouteRef.current = effects.pendingRoute
    if (routeClaimAllowedRef.current && (effects.routeFromUser || effects.customRoute || effects.routeUnresolved)) {
      beginRouteClaim()
    }
    if (effects.customRoute === null && effects.routeFromUser === false && !effects.routeUnresolved) {
      setRouteInfo(null)
      setRouteError(null)
    }
  }, [t, beginRouteClaim])

  /** Follow the user once permission exists (no-op if a watch is running). */
  const startGeoWatch = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    if (geoWatchIdRef.current != null) return
    geoWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }
        setUserLocation((prev) => (prev && distanceKm(prev, next) * 1000 < 5 ? prev : next))
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 60_000 },
    )
  }, [])

  const ensureUserLocation = useCallback(async (): Promise<boolean> => {
    if (userLocation) return true
    setLocationPending(true)
    const res = await requestUserLocationDetailed()
    setLocationPending(false)
    if (res.ok) {
      setUserLocation(res.location)
      startGeoWatch()
      return true
    }
    setRouteError(res.message)
    return false
  }, [userLocation, startGeoWatch])

  useEffect(() => {
    if (!routeFromUser) return
    void ensureUserLocation()
  }, [routeFromUser, ensureUserLocation])

  useEffect(() => {
    if (!mapExpanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (detailsPlace || addOpen || communityOpen || profileTarget || shareTarget || shareConversationId) return
      if (placeCardOpen) {
        setPlaceCardOpen(false)
        return
      }
      setMapExpanded(false)
      setChatCollapsed(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mapExpanded, detailsPlace, addOpen, communityOpen, profileTarget, shareTarget, shareConversationId, placeCardOpen])

  useEffect(() => {
    if (!routeInfo) return
    const failed = t('errors.routeFailed')
    const claimed = pendingRouteClaim.current || routeVerdictRef.current === failed
    if (!claimed) return
    routePaintedRef.current = true
    pendingRouteClaim.current = false
    if (routeWatchRef.current != null) {
      window.clearTimeout(routeWatchRef.current)
      routeWatchRef.current = null
    }
    const verdict = t('errors.routeDrawn')
      .replace('{place}', routeInfo.destinationName)
      .replace('{distance}', routeInfo.distance || '—')
      .replace('{duration}', routeInfo.duration || '—')
    if (routeVerdictRef.current === verdict && !routeError) return
    routeVerdictRef.current = verdict
    if (routeError) setRouteError(null)
    setMessages((prev) => replaceTurnAssistant(prev, turnAssistantIdRef.current, verdict))
  }, [routeInfo, routeError, t])

  const handleMarkerClick = useCallback((index: number) => {
    const place = mapPlacesRef.current[index]
    if (place && activePlaceRef.current?.place_id === place.place_id) {
      setMapVisible(true)
      setPlaceCardOpen(true)
      return
    }
    if (!place) {
      setMapVisible(true)
      setPlaceCardOpen(true)
      return
    }
    rememberActiveRef.current(place)
    setMapVisible(true)
    setPlaceCardOpen(true)
    if (place && detailsExpandedPref()) setDetailsPlace(place)
    else setDetailsPlace(null)
    if (isMobile) setChatSnap('collapsed')
  }, [isMobile])

  // Clicking a result card in the in-chat gallery: on the FULL map it just
  // focuses that place's marker (the bubble gives full details); in compact mode
  // it opens the details panel as before.
  const handleGalleryCardClick = useCallback((place: Place) => {
    if (activePlaceRef.current?.place_id === place.place_id) {
      setPlaceCardOpen(true)
      setMapVisible(true)
      if (!mapExpanded) {
        setDetailsExpandedPref(true)
        setDetailsPlace(place)
      }
      return
    }
    rememberActiveRef.current(place)
    clickedPlaceRef.current = place
    if (mapExpanded) {
      const list = (itinerary?.stops ?? places) as Place[]
      const idx = list.findIndex((p) => p.place_id === place.place_id)
      if (idx >= 0) { handleMarkerClick(idx); return }
    }
    setDetailsExpandedPref(true)
    setDetailsPlace(place)
  }, [mapExpanded, itinerary, places, handleMarkerClick])

  const focusPlaceOnMap = useCallback((place: Place) => {
    if (activePlaceRef.current?.place_id === place.place_id) {
      setPlaceCardOpen(true)
      setMapVisible(true)
      return
    }
    rememberActiveRef.current(place)
    clickedPlaceRef.current = place
    setMapVisible(true)
    setMapExpanded(false)
    setChatCollapsed(false)
    setDetailsExpandedPref(true)
    setDetailsPlace(place)
    setPlaceCardOpen(true)
    const list = (itinerary?.stops?.length ? itinerary.stops : places) as Place[]
    let idx = list.findIndex((p) => p.place_id && p.place_id === place.place_id)
    if (idx < 0) idx = list.findIndex((p) => p.name === place.name)
    if (idx < 0) {
      const next = dedupePlaces([place, ...places])
      placesRef.current = next
      setPlaces(next)
      idx = next.findIndex((p) => p.place_id === place.place_id)
      if (idx < 0) idx = 0
    }
    setActiveStop(idx)
    if (isMobile) setChatSnap('collapsed')
  }, [itinerary, places, isMobile])

  rememberActiveRef.current = (place: Place) => {
    const active = toActivePlace(place)
    if (!active) return
    activePlaceRef.current = active
    setActivePlace(active)
    clickedPlaceRef.current = place
    setAnnotations(EMPTY_ANNOTATIONS)
    setCustomRoute(null)
    setRouteInfo(null)
    setRouteError(null)
    setMapZoomFocus(false)
    setRouteFromUser(true)
    setMapVisible(true)
    setPlaceCardOpen(true)
    const list = placesRef.current
    let idx = list.findIndex((p) => p.place_id && p.place_id === place.place_id)
    if (idx < 0) idx = list.findIndex((p) => p.name.toLowerCase() === place.name.toLowerCase())
    if (idx < 0) {
      const next = dedupePlaces([place, ...list])
      placesRef.current = next
      setPlaces(next)
      idx = 0
    }
    setActiveStop(idx)
    setMapZoomFocus(true)
  }

  const navigateToPlace = useCallback((place: Place) => {
    rememberActiveRef.current(place)
    setCustomRoute(null)
    setRouteInfo(null)
    setRouteError(null)
    setMapZoomFocus(false)
    setRouteFromUser(true)
    setMapVisible(true)
  }, [])

  const endRoute = useCallback(() => {
    setRouteFromUser(false)
    setCustomRoute(null)
    setRouteInfo(null)
    setRouteError(null)
  }, [])

  const handleRouteFromMe = useCallback(async (index: number) => {
    const place = mapPlacesRef.current[index]
    if (place) rememberActiveRef.current(place)
    else setActiveStop(index)
    setMapVisible(true)
    await ensureUserLocation()
  }, [ensureUserLocation])

  const handlePlaceAsk = useCallback((index: number, prompt: string) => {
    setActiveStop(index)
    setChatCollapsed(false)
    setChatSnap('half')
    handleSend(prompt)
  }, [handleSend])

  const handleFeedback = useCallback(async (stopIndex: number, action: 'liked' | 'disliked') => {
    if (!itinerary) return
    const stop = itinerary.stops[stopIndex]
    const city = (stop.address ?? '').split(',').slice(-2, -1)[0]?.trim() ?? ''
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_ID, placeId: stop.place_id, placeName: stop.name, city, action }),
    }).catch(() => {})
  }, [itinerary])

  const handleSwap = useCallback((index: number) => {
    if (!itinerary) return
    const stop = itinerary.stops[index]
    handleSend(`Replace stop ${index + 1} (${stop.name}) with a different alternative, keeping the same budget and constraints.`)
  }, [itinerary, handleSend])

  const handleAsk = useCallback((_stopIndex: number, prompt: string) => {
    setChatCollapsed(false)
    setChatSnap('half')
    handleSend(prompt)
  }, [handleSend])

  const handleLogout = useCallback(() => {
    cancelSpeech()
    void import('@/lib/authClient').then(({ logoutAndRedirect }) => logoutAndRedirect('/login'))
  }, [])

  const handleNewChat = useCallback(() => {
    cancelSpeech()
    sessionId.current = uid()
    try { localStorage.setItem('hodari_active_session', sessionId.current) } catch { /* ignore */ }
    placeMemoryRef.current.clear()
    clickedPlaceRef.current = null
    activePlaceRef.current = null
    setActivePlace(null)
    setPlaceCardOpen(false)
    setAnnotations(EMPTY_ANNOTATIONS)
    setMessages([])
    setLoading(false)
    setThinkingSteps([])
    setStreamingStarted(false)
    streamingStartedRef.current = false
    setPlaces([])
    setItinerary(null)
    setActiveStop(null)
    setMapVisible(false)
    setMapExpanded(false)
    setChatCollapsed(false)
    setRouteInfo(null)
    setRouteError(null)
    setRouteFromUser(false)
    setCustomRoute(null)
    setDetailsPlace(null)
    setCommunityFocus(null)
  }, [])

  const handleSelectHistory = useCallback((id: string) => {
    const item = historyItems.find((entry) => entry.id === id)
    if (!item) return
    cancelSpeech()
    sessionId.current = item.id
    try { localStorage.setItem('hodari_active_session', item.id) } catch { /* ignore */ }
    setAnnotations(EMPTY_ANNOTATIONS)
    clickedPlaceRef.current = null
    setPlaceCardOpen(false)
    setMessages(item.messages)
    setLoading(false)
    setThinkingSteps([])
    setStreamingStarted(false)
    streamingStartedRef.current = false
    setPlaces([])
    setItinerary(null)
    setActiveStop(null)
    setMapVisible(false)
    setMapExpanded(false)
    setChatCollapsed(false)
    setRouteInfo(null)
    setRouteError(null)
    setRouteFromUser(false)
    setCustomRoute(null)
    setDetailsPlace(null)
    setCommunityFocus(null)
  }, [historyItems])

  const handleDeleteHistory = useCallback((id: string) => {
    setHistoryItems((prev) => prev.filter((item) => item.id !== id))
    if (authedRef.current) {
      fetch(`/api/chats?sessionId=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    }
  }, [])

  const handleOpenMapFromMessage = useCallback((message: ChatMessage) => {
    if (message.itinerary?.stops?.length) {
      setItinerary(message.itinerary)
      setPlaces([])
      setActiveStop(0)
    } else if (message.places?.length) {
      setPlaces(dedupePlaces(message.places))
      setItinerary(null)
      setActiveStop(0)
    }
    setMapVisible(true)
    setChatCollapsed(false)
  }, [])

  useEffect(() => {
    setSpeechOutSupported(isSpeechOutputSupported())
    const savedVoice = localStorage.getItem('hodari_speak')
    if (savedVoice === '0') setSpeakReplies(false)
    try {
      const raw = localStorage.getItem('hodari_chat_index')
      const parsed = raw ? JSON.parse(raw) as HistoryItem[] : []
      if (Array.isArray(parsed) && parsed.length > 0) {
        setHistoryItems(parsed.filter((item) => item?.id && item.title).map((item) => ({
          id: item.id,
          title: item.title,
          updatedAt: item.updatedAt ?? 0,
          messages: [],
        })))
      }
    } catch { /* ignore */ }
    const resume = (items: HistoryItem[]) => {
      setHistoryItems(items)
      // Resume the conversation we left (e.g. after visiting Saved places) instead
      // of starting a blank one — unless we were already in a fresh, unsent chat.
      const activeId = localStorage.getItem('hodari_active_session')
      const active = activeId ? items.find((it) => it.id === activeId) : undefined
      if (active) {
        sessionId.current = active.id
        setMessages(active.messages)
      } else {
        localStorage.setItem('hodari_active_session', sessionId.current)
      }
    }

    const loadLocal = () => {
      try {
        const savedHistory = localStorage.getItem('hodari_history')
        const parsed = savedHistory ? JSON.parse(savedHistory) as HistoryItem[] : []
        const items = Array.isArray(parsed) ? parsed.slice(0, 20) : []
        if (messagesRef.current.length > 0) mergeHistory(items)
        else resume(items)
      } catch {
        if (messagesRef.current.length === 0) setHistoryItems([])
      }
    }

    const mergeHistory = (incoming: HistoryItem[]) => {
      setHistoryItems((prev) => {
        const byId = new Map<string, HistoryItem>()
        for (const item of incoming) byId.set(item.id, item)
        for (const item of prev) {
          const existing = byId.get(item.id)
          if (!existing) {
            byId.set(item.id, item)
            continue
          }
          const incomingHasText = (existing.messages?.length ?? 0) > 0
          const localHasText = (item.messages?.length ?? 0) > 0
          if (localHasText && !incomingHasText) byId.set(item.id, item)
          else if (!localHasText && incomingHasText) byId.set(item.id, existing)
          else if (item.updatedAt >= existing.updatedAt) byId.set(item.id, item)
        }
        return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20)
      })
    }

    // Members → server history (encrypted, cross-device). Guests → localStorage.
    // A late response must not wipe a conversation that started while this request was in flight.
    fetch('/api/chats')
      .then((r) => r.json())
      .then((d) => {
        if (d?.authed) {
          authedRef.current = true
          const serverChats = (d.chats ?? []).map((c: HistoryItem) => ({
            id: c.id,
            title: c.title,
            updatedAt: c.updatedAt,
            messages: c.messages ?? [],
          }))
          mergeHistory(serverChats)
          const activeId = localStorage.getItem('hodari_active_session')
          const active = activeId ? serverChats.find((it: HistoryItem) => it.id === activeId) : undefined
          if (active && messagesRef.current.length === 0) {
            sessionId.current = active.id
            setMessages(active.messages)
          }
          if (messagesRef.current.length > 0) {
            const firstUser = messagesRef.current.find((m) => m.role === 'user') ?? messagesRef.current[0]
            const title = firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 56) || 'Untitled chat'
            fetch('/api/chats', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: sessionId.current, title, messages: messagesRef.current }),
            }).catch(() => {})
          }
        } else {
          loadLocal()
        }
      })
      .catch(() => loadLocal())
      .finally(() => setHistoryLoaded(true))
  }, [])

  // Persist the history list. Members sync to the server (encrypted, debounced
  // below); guests keep it in localStorage. We never write transcripts to
  // localStorage for members, so logout / a shared browser can't leak them.
  useEffect(() => {
    if (!historyLoaded || authedRef.current) return
    localStorage.setItem('hodari_history', JSON.stringify(historyItems.slice(0, 20)))
  }, [historyItems, historyLoaded])

  // Titles only (no transcript) so Recent is not blank while Mongo answers.
  useEffect(() => {
    if (!historyLoaded) return
    const index = historyItems.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    try { localStorage.setItem('hodari_chat_index', JSON.stringify(index)) } catch { /* ignore */ }
  }, [historyItems, historyLoaded])

  // Members: the first user message is written immediately so Recent survives a
  // reload. Later token updates are debounced into one write per turn.
  const savedSessionsRef = useRef(new Set<string>())
  useEffect(() => {
    if (!historyLoaded || !authedRef.current || !messages.some((m) => m.role === 'user')) return
    const session = sessionId.current
    const firstUser = messages.find((m) => m.role === 'user') ?? messages[0]
    const title = firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 56) || 'Untitled chat'
    const post = (snapshot: ChatMessage[]) => {
      fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session, title, messages: snapshot }),
      }).then((r) => {
        if (!r.ok) savedSessionsRef.current.delete(session)
      }).catch(() => {
        savedSessionsRef.current.delete(session)
      })
    }
    if (!savedSessionsRef.current.has(session)) {
      savedSessionsRef.current.add(session)
      post(messages)
    }
    const handle = setTimeout(() => post(messages), 1500)
    return () => clearTimeout(handle)
  }, [messages, historyLoaded])

  useEffect(() => {
    if (!messages.length) return
    // Remember which conversation is active so a round-trip to /saved resumes it.
    try { localStorage.setItem('hodari_active_session', sessionId.current) } catch { /* ignore */ }
    const firstUserMessage = messages.find((m) => m.role === 'user') ?? messages[0]
    const title = firstUserMessage.content.replace(/\s+/g, ' ').trim().slice(0, 56) || 'Untitled chat'
    const id = sessionId.current
    setHistoryItems((prev) => {
      const nextItem: HistoryItem = { id, title, updatedAt: Date.now(), messages }
      return [nextItem, ...prev.filter((item) => item.id !== id)].slice(0, 20)
    })
  }, [messages])

  useEffect(() => {
    localStorage.setItem('hodari_speak', speakReplies ? '1' : '0')
  }, [speakReplies])

  useEffect(() => {
    const saved = Number(localStorage.getItem('hodari_chatw'))
    if (saved >= 300 && saved <= 760) setChatWidth(saved)
  }, [])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    let latest = 380
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const max = Math.min(760, window.innerWidth - 260)
      latest = Math.max(320, Math.min(ev.clientX, max))
      setChatWidth(latest)
    }
    const onUp = () => {
      resizingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      localStorage.setItem('hodari_chatw', String(latest))
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    if (!themeReady) return
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('hodari_theme', theme)
  }, [theme, themeReady])

  // Geolocation: never prompt on page load — mobile browsers auto-deny or
  // silently swallow un-gestured prompts (the old "AI can't get my location"
  // bug). We only start watching automatically when the browser reports the
  // permission is ALREADY granted; otherwise the user taps "Use my location"
  // in the composer (see handleUseMyLocation), which is a real gesture.
  useEffect(() => {
    let cancelled = false
    queryGeoPermission().then((state) => {
      if (cancelled || state !== 'granted') return
      navigator.geolocation?.getCurrentPosition(
        (pos) => {
          if (!cancelled) {
            setUserLocation({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            })
          }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 120_000 },
      )
      startGeoWatch()
    })
    return () => {
      cancelled = true
      if (geoWatchIdRef.current != null) {
        navigator.geolocation?.clearWatch(geoWatchIdRef.current)
        geoWatchIdRef.current = null
      }
    }
  }, [startGeoWatch])

  /** Explicit "Use my location" gesture — the only place that may prompt. */
  const handleUseMyLocation = useCallback(async () => {
    setGeoNotice(null)
    setLocationPending(true)
    const res = await requestUserLocationDetailed()
    setLocationPending(false)
    if (res.ok) {
      setUserLocation(res.location)
      startGeoWatch()
    } else {
      setGeoNotice(res.message)
    }
  }, [startGeoWatch])

  /** Manual fallback: a typed city feeds the same location context seam. */
  const handleSetCity = useCallback((city: string) => {
    const clean = city.trim().slice(0, 80)
    setManualCity(clean || null)
    setGeoNotice(null)
    try {
      if (clean) localStorage.setItem('hodari_city', clean)
      else localStorage.removeItem('hodari_city')
    } catch { /* ignore */ }
  }, [])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    cancelSpeech()
  }, [])

  const voiceTranscriptCb = useCallback((t: string) => handleSend(t, { speak: true, fromVoice: true }), [handleSend])
  // The ONLY useVoice instance in the app. Multiple instances each spin up their
  // own recorder on auto-resume, which double-sends every transcript.
  const voice = useVoice({
    onTranscript: voiceTranscriptCb,
    disabled: loading,
    autoResumeAfterSpeak: uiMode === 'voice',
    // Browser STT follows the active app language and streams words into the
    // field. Kinyarwanda skips this path inside useVoice (Chrome has no model).
    preferBrowserStt: true,
  })

  const stopEverything = useCallback(() => {
    voice.stopAll()
    cancelSpeech()
    abortRef.current?.abort()
  }, [voice])

  const retryLastVoice = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setThinkingSteps([])
    setStreamingStarted(false)
    streamingStartedRef.current = false
    setMessages((prev) => {
      let lastUser = -1
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === 'user') { lastUser = i; break }
      }
      if (lastUser < 0 || !prev[lastUser].fromVoice) return prev
      return prev.slice(0, lastUser)
    })
    voice.allowNextListen()
    void voice.startListening()
  }, [voice])

  const enterChatMode = useCallback(() => {
    setUiMode('chat')
    voice.stopAll()
    cancelSpeech()
  }, [voice])

  const enterVoiceMode = useCallback(() => {
    setUiMode('voice')
    if (voice.voiceState === 'idle') voice.startListening()
  }, [voice])

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant') ?? null
  const itineraryStops = itinerary?.stops ?? null
  const mapPlaces = (itineraryStops ?? places).map((item) => enrichMapPlace(item, placeMemoryRef.current))
  const chatResultPlaces = [...messages].reverse().find((message) => message.role === 'assistant' && message.places?.length)?.places ?? []
  mapPlacesRef.current = mapPlaces
  const mapItinerary: ItineraryStop[] | null = itineraryStops
    ? itineraryStops.map((stop, i) => ({ ...mapPlaces[i], ...stop }))
    : null

  const pinsMismatch =
    showUserOnMap &&
    !suppressGpsContext &&
    !!userLocation &&
    places.length > 0 &&
    !itineraryStops &&
    pinsFarFromUser(userLocation, places.map((p) => p.coordinates))

  const routeActive = routeFromUser || !!customRoute
  useEffect(() => { if (mapExpanded) setMapSheetOpen(true) }, [mapExpanded])
  const closeMapSheet = useCallback(() => {
    setMapSheetOpen(false)
    setMapExpanded(false)
    setChatCollapsed(false)
  }, [])
  const communityLayerHasData =
    communityLayerOn && (communityPins.length > 0 || communityFriends.length > 0)
  const heldRouteId = useSyncExternalStore(subscribeRoute, () => getRouteSnapshot().route?.id ?? 0, () => 0)
  const hasMapData = mapPlaces.length > 0 || communityLayerHasData || heldRouteId > 0

  // ── Mobile sheet discipline ─────────────────────────────────────────────────
  // When the map (base layer) first appears, drop the chat to its peek so the
  // user actually sees the map they asked for; the reply shows in the peek.
  const showMobileMap = isMobile && mapVisible && (hasMapData || placesLoading)
  const prevShowMobileMapRef = useRef(false)
  useEffect(() => {
    if (showMobileMap && !prevShowMobileMapRef.current) setChatSnap('collapsed')
    prevShowMobileMapRef.current = showMobileMap
  }, [showMobileMap])

  // One surface at a time on phones: any overlay (details, community, profile,
  // share picker) minimizes the chat sheet underneath it.
  const overlayOpen =
    !!detailsPlace || communityOpen || !!profileTarget || !!shareTarget || !!shareConversationId
  useEffect(() => {
    if (isMobile && overlayOpen && showMobileMap) setChatSnap('collapsed')
  }, [isMobile, overlayOpen, showMobileMap])

  // Edit a sent message + re-send it: drop that turn and everything after, then
  // resend the edited text so the AI answers it fresh.
  const handleEditMessage = useCallback((id: string, newText: string) => {
    if (loading) return
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id)
      return idx < 0 ? prev : prev.slice(0, idx)
    })
    handleSend(newText)
  }, [loading, handleSend])

  const locateDraft = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition((pos) => {
      setDraftLat(pos.coords.latitude.toFixed(5))
      setDraftLng(pos.coords.longitude.toFixed(5))
    })
  }, [])

  const openAddPlace = useCallback(async () => {
    setAddOpen(true)
    locateDraft()
    setMapVisible(true)
    if (places.length > 0) return
    setPlacesLoading(true)
    try {
      const res = await fetch('/api/places')
      const data = await res.json()
      if (Array.isArray(data.places) && data.places.length) setPlaces(dedupePlaces(data.places))
    } catch { /* form still works with GPS */ }
    finally { setPlacesLoading(false) }
  }, [locateDraft, places.length])

  const applyInclusion = useCallback(async (mode: 'local' | 'accessible') => {
    const nextLocal = mode === 'local' ? !preferLocal : preferLocal
    const nextAccess = mode === 'accessible' ? !requireAccessible : requireAccessible
    setPreferLocal(nextLocal)
    setRequireAccessible(nextAccess)
    setMarketOnly(false)
    setMapVisible(true)
    const source = fullPlacesRef.current.length ? fullPlacesRef.current : placesRef.current
    const filtered = source.filter((place) => {
      if (nextLocal && !place.local_business) return false
      if (nextAccess && !place.accessible) return false
      return true
    })
    setPlaces(filtered)
    setMessages((prev) => prev.map((m) => (
      m.places?.length ? { ...m, places: m.places.filter((place) => filtered.some((item) => item.place_id === place.place_id)) } : m
    )))
    if (!source.length) {
      setPlacesLoading(true)
      const params = new URLSearchParams()
      if (nextLocal) params.set('local_business', '1')
      if (nextAccess) params.set('accessible', '1')
      try {
        const res = await fetch(`/api/places?${params.toString()}`)
        const data = await res.json()
        if (Array.isArray(data.places)) {
          const ranked = placesForAsk(dedupePlaces(data.places), '')
          setPlaces(ranked)
          if (ranked.length) setMapVisible(true)
        }
      } catch { /* the chip still shows the current list */ }
      finally { setPlacesLoading(false) }
    }
  }, [preferLocal, requireAccessible])

  const applyMarkets = useCallback(async () => {
    const next = !marketOnly
    setMarketOnly(next)
    setPreferLocal(false)
    setRequireAccessible(false)
    setMapVisible(true)
    setPlacesLoading(true)
    try {
      let data = await (await fetch('/api/places', { cache: 'no-store' })).json()
      let all = Array.isArray(data.places) ? data.places as Place[] : []
      if (all.length === 0) {
        data = await (await fetch('/api/places', { cache: 'no-store' })).json()
        all = Array.isArray(data.places) ? data.places as Place[] : []
      }
      const list = next
        ? all.filter((place) => (place.categories ?? []).includes('market'))
        : all
      const ranked = dedupePlaces(markPrioritized(list, false, scoringRef.current))
      setPlaces(ranked)
      if (next) {
        setMessages((prev) => [...prev, {
          id: uid(),
          role: 'assistant',
          content: ranked.length ? t('filters.marketsHint') : t('filters.marketsHint'),
          places: ranked,
        }])
      }
    } catch { /* the button stays usable */ }
    finally { setPlacesLoading(false) }
  }, [marketOnly, t])

  const chatPanel = (
    <ChatPanel
      messages={messages}
      loading={loading}
      thinkingSteps={thinkingSteps}
      streamingStarted={streamingStarted}
      onSend={handleSend}
      onRetry={retryLastMessage}
      onInclusionFilter={applyInclusion}
      onMarketFilter={() => { void applyMarkets() }}
      onAddPlace={() => { void openAddPlace() }}
      inclusionLocal={preferLocal}
      inclusionAccessible={requireAccessible}
      inclusionMarkets={marketOnly}
      voiceState={voice.voiceState}
      voiceSupported={voice.supported}
      voiceWarning={voice.warning}
      voiceLiveText={voice.liveText}
      voiceRecognitionLang={voice.recognitionLang}
      onRetryVoice={retryLastVoice}
      onVoiceToggle={voice.toggleVoice}
      onVoiceStop={stopEverything}
      historyItems={historyItems}
      onNewChat={handleNewChat}
      onSelectHistory={handleSelectHistory}
      onDeleteHistory={handleDeleteHistory}
      mapVisible={mapVisible && !mapExpanded}
      mapExpanded={mapExpanded}
      hasMapData={hasMapData}
      onOpenMapPanel={() => { setMapVisible(true); setMapExpanded(false); setChatCollapsed(false) }}
      onExpandMap={() => { setMapVisible(true); setMapSheetOpen(true) }}
      onCollapseMap={() => { setMapExpanded(false); setMapVisible(true); setChatCollapsed(false) }}
      onOpenMapFromMessage={(message) => { handleOpenMapFromMessage(message); setMapSheetOpen(true) }}
      onEditMessage={handleEditMessage}
      onPlaceDetails={(place) => {
        if (activePlaceRef.current?.place_id !== place.place_id) rememberActiveRef.current(place)
        setDetailsExpandedPref(true)
        setDetailsPlace({ ...place })
      }}
      onFocusPlace={(place) => { focusPlaceOnMap(place); setMapSheetOpen(true) }}
      activePlaceId={activePlace?.place_id}
      onToggleMapPanel={() => {
        setMapVisible((v) => {
          const next = !v
          if (!next) setMapExpanded(false)
          return next
        })
      }}
      selectedModel={selectedModel}
      onModelChange={setSelectedModel}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      hasLocation={!!userLocation}
      manualCity={manualCity}
      onUseMyLocation={handleUseMyLocation}
      onSetCity={handleSetCity}
      locationNotice={geoNotice}
      onDismissLocationNotice={() => setGeoNotice(null)}
      locationPending={locationPending}
      speakReplies={speakReplies}
      speechOutSupported={speechOutSupported}
      onToggleSpeakReplies={() => setSpeakReplies((v) => { const nv = !v; if (!nv) cancelSpeech(); return nv })}
      onStop={handleStop}
      uiMode={uiMode}
      onEnterChatMode={enterChatMode}
      onEnterVoiceMode={enterVoiceMode}
      userName={userName}
      onLogout={handleLogout}
      onUserNameChange={(name) => {
        setUserName(name)
        try { localStorage.setItem('hodari_name', name) } catch { /* ignore */ }
      }}
      workspace={workspace}
      onOpenCommunity={showCommunity ? openCommunity : undefined}
      communityInviteCount={communityInviteCount}
    />
  )

  const selectedPlace = activeStop != null && mapPlaces[activeStop]
    ? (mapPlaces[activeStop] as Place)
    : null

  return (
    <div className="app-shell relative w-screen overflow-hidden">
      <AddPlaceSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        lat={draftLat}
        lng={draftLng}
        onUseLocation={locateDraft}
        onSubmitted={() => { /* confirmation stays in the sheet */ }}
      />

      {/* ── iOS chat layout: the conversation is the whole screen ─────────── */}
      <div className="absolute inset-0 flex animate-fade-up">
        <div className="relative flex h-full w-full flex-col">
          {chatPanel}
        </div>
      </div>

      {/* ── Full-screen map sheet (opened from the chat) ────────────────── */}
      {mapSheetOpen && (
        <div className="ios-chat fixed inset-0 z-[150] ![background:transparent]" role="dialog" aria-modal="true" aria-label="Carte">
          <button
            type="button"
            aria-label="Fermer la carte"
            onClick={closeMapSheet}
            className="ios-fade-in absolute inset-0 bg-black/40 backdrop-blur-[6px]"
          />
          <div className="ios-sheet-in absolute inset-0 isolate overflow-hidden bg-[var(--ios-bg)] md:inset-4 md:rounded-[32px] md:border md:border-[var(--ios-glass-border)] md:shadow-[0_30px_90px_-20px_rgba(0,0,0,0.55)] lg:inset-6">
            <MapSheet
              title={
                itineraryStops?.length
                  ? `${itineraryStops.length} étapes`
                  : mapPlaces.length
                    ? `${mapPlaces.length} lieu${mapPlaces.length > 1 ? 'x' : ''}`
                    : 'Carte'
              }
              places={mapPlaces as Place[]}
              activeIndex={activeStop}
              activePlaceId={activePlace?.place_id}
              userLocation={userLocation}
              routeTo={routeFromUser && activePlace ? { lat: activePlace.lat, lng: activePlace.lng, name: activePlace.name } : null}
              routeMode={routeMode}
              onRouteModeChange={setRouteMode}
              onEndRoute={endRoute}
              onRouteInfo={setRouteInfo}
              onSelect={handleMarkerClick}
              onDetails={(place) => {
                if (activePlaceRef.current?.place_id !== place.place_id) rememberActiveRef.current(place)
                setDetailsExpandedPref(true)
                setDetailsPlace(place)
              }}
              onRoute={(index) => { void handleRouteFromMe(index) }}
              onRequestLocation={handleUseMyLocation}
              locationPending={locationPending}
              onClose={closeMapSheet}
              notices={
                <>
                  {pinsMismatch && (
                    <div className="ios-glass-strong pointer-events-auto max-w-md rounded-2xl px-4 py-2 text-[13px] text-[var(--ios-label)]">
                      Les repères semblent loin de ta position. Demande à MapForAll de chercher dans ta ville.
                    </div>
                  )}
                  {routeActive && routeError && (
                    <div className="ios-glass-strong pointer-events-auto max-w-md rounded-2xl px-4 py-2 text-[13px] text-[var(--ios-red)]">{routeError}</div>
                  )}
                </>
              }
            />
          </div>
        </div>
      )}

      {/* In-app place details */}
      {detailsPlace?.place_id && (
        <PlaceDetailsPanel
          placeId={detailsPlace.place_id}
          fallbackName={detailsPlace.name}
          fallbackMapsUrl={`https://www.google.com/maps/search/?api=1&query=${detailsPlace.coordinates.lat},${detailsPlace.coordinates.lng}&query_place_id=${encodeURIComponent(detailsPlace.place_id)}`}
          fallbackPlace={detailsPlace}
          userLocation={userLocation}
          onClose={() => setDetailsPlace(null)}
          onViewInApp={(place) => { focusPlaceOnMap(place); setMapSheetOpen(true) }}
          onShare={() => setShareTarget(detailsPlace)}
          onWalk={() => { setRouteMode('WALK'); rememberActiveRef.current(detailsPlace); setMapSheetOpen(true) }}
          onDrive={() => { setRouteMode('DRIVE'); rememberActiveRef.current(detailsPlace); setMapSheetOpen(true) }}
          onSave={() => handleSavePlace(detailsPlace)}
          saved={savedPlaceIds.has(detailsPlace.place_id)}
          distance={routeInfo?.destinationName === detailsPlace.name ? routeInfo.distance : undefined}
          duration={routeInfo?.destinationName === detailsPlace.name ? routeInfo.duration : undefined}
        />
      )}

      {/* Community: people, encrypted chats, shared pins */}
      {communityMounted && (
        <CommunityPanel
          open={communityOpen}
          onClose={() => setCommunityOpen(false)}
          currentUserId={USER_ID}
          onFocusPlace={handleCommunityFocusPlace}
          onSharePin={(conversationId) => setShareConversationId(conversationId)}
          onOpenProfile={handleOpenProfile}
          onInviteCountChange={setCommunityInviteCount}
        />
      )}
      {profileTarget && (
        <ProfileSheet
          userIdOrHandle={profileTarget}
          onClose={() => setProfileTarget(null)}
          onFocusPlace={(p) => handleCommunityFocusPlace(p.lat, p.lng)}
        />
      )}
      {(shareTarget || shareConversationId) && (
        <SharePinDialog
          place={shareTarget}
          conversationId={shareConversationId}
          candidatePlaces={mapPlaces as Place[]}
          onClose={() => { setShareTarget(null); setShareConversationId(null) }}
          onShared={refreshPins}
        />
      )}

      <Paywall gate={gate} onClose={() => setGate(null)} />

      {/* Dedicated voice UI: a floating orb with the LIVE transcript of what the
          user is saying (browser STT streams interim words) + speak controls.
          At the full sheet snap the sheet covers nearly the whole viewport
          (only a 10px map sliver remains) — the floating orb would land on
          top of the sheet's own content instead of beside it, so it hides
          there. The composer's mic/Stop controls inside the sheet still work;
          dragging the sheet back down to half restores the orb. */}
      {uiMode === 'voice' && !(isMobile && chatSnap === 'full') && (
        <div className="fixed right-4 z-[130] bottom-[calc(env(safe-area-inset-bottom,0px)+10rem)] md:bottom-6 md:right-6">
          <VoiceOrb
            compact
            state={voice.voiceState}
            liveText={voice.liveText}
            onToggle={voice.toggleVoice}
            onPause={voice.pauseSpeaking}
            onResume={voice.resumeSpeaking}
            onStopSpeaking={voice.stopSpeakingAndListen}
          />
        </div>
      )}
    </div>
  )
}
