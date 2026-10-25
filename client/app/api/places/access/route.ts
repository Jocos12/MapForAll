import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { getSession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'
const PLACES_KEY = process.env.GOOGLE_MAPS_SERVER_KEY ?? ''
const ACCESS_TTL_MS = 10 * 60 * 1000

type AccessibilityOptions = {
  wheelchairAccessibleParking?: boolean
  wheelchairAccessibleEntrance?: boolean
  wheelchairAccessibleRestroom?: boolean
  wheelchairAccessibleSeating?: boolean
}

const accessCache = new Map<string, { at: number; options: AccessibilityOptions | null }>()

/** Places API (New) accessibilityOptions. Cached so opening a place twice does not refetch. */
async function accessibilityFor(placeId: string): Promise<AccessibilityOptions | null> {
  const hit = accessCache.get(placeId)
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.options
  if (!PLACES_KEY) {
    accessCache.set(placeId, { at: Date.now(), options: null })
    return null
  }
  const id = placeId.replace(/^places\//, '')
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
      headers: {
        'X-Goog-Api-Key': PLACES_KEY,
        'X-Goog-FieldMask': 'accessibilityOptions',
      },
    })
    if (!res.ok) {
      accessCache.set(placeId, { at: Date.now(), options: null })
      return null
    }
    const data = await res.json() as { accessibilityOptions?: AccessibilityOptions }
    const options = data.accessibilityOptions ?? null
    accessCache.set(placeId, { at: Date.now(), options })
    return options
  } catch (err) {
    console.warn('[places/access] Places accessibility lookup failed', err instanceof Error ? err.message : '')
    accessCache.set(placeId, { at: Date.now(), options: null })
    return null
  }
}

function asPlaceId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || id.length > 160) throw new Error('placeId')
  return id
}

export async function GET(req: NextRequest) {
  let placeId = ''
  try {
    placeId = asPlaceId(req.nextUrl.searchParams.get('placeId'))
  } catch {
    return NextResponse.json({ status: 'BAD_REQUEST', message: 'placeId required', error: 'placeId required' }, { status: 400 })
  }
  const session = await getSession(req)
  const accessibility = await accessibilityFor(placeId)
  try {
    const sid = await mcpConnected()
    const placeDocs = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter: { place_id: placeId },
      limit: 1,
    }))
    if (!placeDocs.length) {
      return NextResponse.json({ confirmations: 0, disputes: 0, mine: null, accessibility })
    }
    const place = placeDocs[0]
    let mine: 'yes' | 'no' | null = null
    if (session) {
      const votes = extractDocs(await mcpCall(sid, 'find', {
        database: DB,
        collection: 'access_votes',
        filter: { placeId, userId: session.uid },
        limit: 1,
      }))
      const vote = votes[0]?.vote
      if (vote === 'yes' || vote === 'no') mine = vote
    }
    return NextResponse.json({
      confirmations: typeof place.access_confirmations === 'number' ? place.access_confirmations : 0,
      disputes: typeof place.access_disputes === 'number' ? place.access_disputes : 0,
      mine,
      accessibility,
    })
  } catch (err) {
    console.error('[places/access GET]', err)
    return NextResponse.json({ confirmations: 0, disputes: 0, mine: null, accessibility })
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in to confirm accessibility.' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  let placeId = ''
  try {
    placeId = asPlaceId(body.placeId)
  } catch {
    return NextResponse.json({ error: 'placeId required' }, { status: 400 })
  }
  const vote = body.vote === 'yes' || body.vote === 'no' ? body.vote : null
  if (!vote) return NextResponse.json({ error: 'vote must be yes or no' }, { status: 400 })

  try {
    const sid = await mcpConnected()
    const placeDocs = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter: { place_id: placeId },
      limit: 1,
    }))
    if (!placeDocs.length) {
      const accessibility = await accessibilityFor(placeId)
      return NextResponse.json(
        { status: 'NOT_IN_CATALOG', message: 'Place is not in the local catalog yet', error: 'Place is not in the local catalog yet', confirmations: 0, disputes: 0, mine: null, accessibility },
        { status: 422 },
      )
    }
    const existing = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'access_votes',
      filter: { placeId, userId: session.uid },
      limit: 1,
    }))
    const previous = existing[0]?.vote === 'yes' || existing[0]?.vote === 'no' ? existing[0].vote : null
    if (previous === vote) {
      const place = placeDocs[0]
      return NextResponse.json({
        confirmations: typeof place.access_confirmations === 'number' ? place.access_confirmations : 0,
        disputes: typeof place.access_disputes === 'number' ? place.access_disputes : 0,
        mine: vote,
      })
    }

    let confirmations = typeof placeDocs[0].access_confirmations === 'number' ? placeDocs[0].access_confirmations : 0
    let disputes = typeof placeDocs[0].access_disputes === 'number' ? placeDocs[0].access_disputes : 0
    if (previous === 'yes') confirmations = Math.max(0, confirmations - 1)
    if (previous === 'no') disputes = Math.max(0, disputes - 1)
    if (vote === 'yes') confirmations += 1
    else disputes += 1

    if (previous) {
      await mcpCall(sid, 'update-many', {
        database: DB,
        collection: 'access_votes',
        filter: { placeId, userId: session.uid },
        update: { $set: { vote, updatedAt: new Date().toISOString() } },
      })
    } else {
      await mcpCall(sid, 'insert-many', {
        database: DB,
        collection: 'access_votes',
        documents: [{ placeId, userId: session.uid, vote, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      })
    }
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'places',
      filter: { place_id: placeId },
      update: { $set: { access_confirmations: confirmations, access_disputes: disputes } },
    })
    return NextResponse.json({ confirmations, disputes, mine: vote })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not save this vote.' }, { status: 500 })
  }
}
