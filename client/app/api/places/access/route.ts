import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { getSession } from '@/lib/session'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

function asPlaceId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || id.length > 160) throw new Error('placeId')
  return id
}

export async function GET(req: NextRequest) {
  const placeId = asPlaceId(req.nextUrl.searchParams.get('placeId'))
  const session = await getSession(req)
  try {
    const sid = await mcpConnected()
    const placeDocs = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter: { place_id: placeId },
      limit: 1,
    }))
    if (!placeDocs.length) {
      return NextResponse.json({ confirmations: 0, disputes: 0, mine: null })
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
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'placeId') {
      return NextResponse.json({ error: 'placeId required' }, { status: 400 })
    }
    console.error('[places/access GET]', err)
    return NextResponse.json({ confirmations: 0, disputes: 0, mine: null })
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
    if (!placeDocs.length) return NextResponse.json({ error: 'Place not found' }, { status: 404 })
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
