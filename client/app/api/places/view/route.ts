import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'
import { isPublished } from '@/lib/listingLifecycle'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import {
  decideView,
  kigaliDay,
  normalizeKind,
  normalizeSource,
  visitorHash,
  isBot,
  VIEW_WINDOW_MS,
  type ViewKind,
  type ViewSource,
} from '@/lib/viewRules'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'
const COOKIE = 'hodari_vid'

type EventIn = { placeId: string; kind: ViewKind; source: ViewSource; eventId: string }

function readEvents(body: Record<string, unknown>): EventIn[] {
  const list = Array.isArray(body.events) ? body.events : [body]
  const out: EventIn[] = []
  for (const raw of list.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const placeId = typeof row.placeId === 'string' ? row.placeId.trim() : ''
    if (!/^[A-Za-z0-9][A-Za-z0-9_:-]{1,120}$/.test(placeId)) continue
    const eventId = typeof row.eventId === 'string' && row.eventId.length <= 80 ? row.eventId : ''
    out.push({ placeId, kind: normalizeKind(row.kind), source: normalizeSource(row.source), eventId })
  }
  return out
}

async function bumpDaily(sid: string, placeId: string, day: string, inc: Record<string, number>) {
  const existing = extractDocs(await mcpCall(sid, 'find', {
    database: DB,
    collection: 'place_stats_daily',
    filter: { placeId, day },
    limit: 1,
  }))[0]
  if (existing) {
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'place_stats_daily',
      filter: { placeId, day },
      update: { $inc: inc },
    })
    return
  }
  await mcpCall(sid, 'insert-many', {
    database: DB,
    collection: 'place_stats_daily',
    documents: [{ placeId, day, views: 0, uniqueVisitors: 0, impressions: 0, routeClicks: 0, calls: 0, websiteClicks: 0, saves: 0, sourceMap: 0, sourceChat: 0, sourceSearch: 0, sourceLink: 0, ...inc }],
  })
}

function dailyInc(kind: ViewKind, source: ViewSource, unique: boolean): Record<string, number> {
  const inc: Record<string, number> = {}
  if (kind === 'view') inc.views = 1
  if (kind === 'impression') inc.impressions = 1
  if (kind === 'route') inc.routeClicks = 1
  if (kind === 'call') inc.calls = 1
  if (kind === 'website') inc.websiteClicks = 1
  if (kind === 'save') inc.saves = 1
  if (unique && kind === 'view') inc.uniqueVisitors = 1
  const sourceKey = source === 'chat' ? 'sourceChat' : source === 'search' ? 'sourceSearch' : source === 'link' ? 'sourceLink' : 'sourceMap'
  if (kind === 'view') inc[sourceKey] = 1
  return inc
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const events = readEvents(body)
  if (!events.length) return new NextResponse(null, { status: 204 })

  const ua = req.headers.get('user-agent')
  const bot = isBot(ua)
  let session: Awaited<ReturnType<typeof getSession>> = null
  try { session = await getSession(req) } catch { session = null }
  const staff = session?.role === 'admin' || session?.role === 'moderator'
  let vid = req.cookies.get(COOKIE)?.value
  const freshVid = !vid
  if (!vid) vid = crypto.randomUUID()
  const day = kigaliDay()
  const salt = process.env.HODARI_SESSION_SECRET || 'hodari'
  const hash = visitorHash(session?.uid || vid, day, salt)
  const key = session?.uid || hash
  if (!rateLimit(`view:${key}`, { capacity: 30, refillPerSec: 30 / 60 }).allowed) {
    return new NextResponse(null, { status: 204 })
  }

  const res = new NextResponse(null, { status: 204 })
  if (freshVid) {
    res.cookies.set(COOKIE, vid, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 400 })
  }

  void recordViews({ events, bot, staff, sessionUid: session?.uid, hash, day }).catch((err) => {
    console.warn('[places/view]', err instanceof Error ? err.message : err)
  })
  return res
}

async function recordViews(input: {
  events: EventIn[]
  bot: boolean
  staff: boolean
  sessionUid?: string
  hash: string
  day: string
}) {
  const { events, bot, staff, sessionUid, hash, day } = input
  try {
    const sid = await mcpConnected()
    for (const event of events) {
      const doc = extractDocs(await mcpCall(sid, 'find', {
        database: DB,
        collection: 'places',
        filter: { place_id: event.placeId },
        projection: { _id: 0, added_by: 1, owner_id: 1, status: 1, paused: 1, archived: 1, deleted_at: 1 },
        limit: 1,
      }))[0]
      if (!doc) continue
      const ownerId = typeof doc.owner_id === 'string' && doc.owner_id ? doc.owner_id : typeof doc.added_by === 'string' ? doc.added_by : ''
      let duplicateEvent = false
      let seenWithinWindow = false
      if (event.eventId) {
        const prior = extractDocs(await mcpCall(sid, 'find', {
          database: DB, collection: 'place_view_events', filter: { event_id: event.eventId }, limit: 1,
        }))[0]
        duplicateEvent = !!prior
      }
      if (!duplicateEvent && event.kind === 'view') {
        const since = new Date(Date.now() - VIEW_WINDOW_MS).toISOString()
        const recent = extractDocs(await mcpCall(sid, 'find', {
          database: DB,
          collection: 'place_view_events',
          filter: { placeId: event.placeId, visitorHash: hash, kind: 'view', at: { $gte: since } },
          limit: 1,
        }))[0]
        seenWithinWindow = !!recent
      }
      const decision = decideView({
        kind: event.kind,
        published: isPublished(doc),
        isOwner: !!sessionUid && ownerId === sessionUid,
        isStaff: staff,
        bot,
        duplicateEvent,
        seenWithinWindow,
      })
      if (event.kind !== 'view' && (!doc || !isPublished(doc) || bot || staff || (!!sessionUid && ownerId === sessionUid))) continue
      if (event.kind === 'view' && !decision.count) continue
      const now = new Date().toISOString()
      await mcpCall(sid, 'insert-many', {
        database: DB,
        collection: 'place_view_events',
        documents: [{
          event_id: event.eventId || `ev_${now}_${hash.slice(0, 6)}`,
          placeId: event.placeId,
          visitorHash: hash,
          source: event.source,
          kind: event.kind,
          at: now,
          day,
          ...(sessionUid ? { userId: sessionUid } : {}),
        }],
      })
      const unique = event.kind === 'view' && decision.count && !seenWithinWindow
      await bumpDaily(sid, event.placeId, day, dailyInc(event.kind, event.source, unique))
      if (decision.count) {
        await mcpCall(sid, 'update-many', {
          database: DB,
          collection: 'places',
          filter: { place_id: event.placeId },
          update: { $inc: { views: 1, views_total: 1 } },
        })
        await mcpCall(sid, 'insert-many', {
          database: DB,
          collection: 'place_views',
          documents: [{ placeId: event.placeId, day, at: now, source: event.source === 'link' ? 'link' : 'app' }],
        }).catch(() => undefined)
      }
    }
  } catch (err) {
    console.warn('[places/view]', err instanceof Error ? err.message : err)
  }
}
