import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { getSession } from '@/lib/session'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

function asPlaceId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || id.length > 160) throw new Error('placeId')
  return id
}

async function tally(sid: string, placeId: string, userId?: string) {
  const votes = extractDocs(await mcpCall(sid, 'find', {
    database: DB,
    collection: 'place_exists',
    filter: { placeId },
    limit: 500,
  }))
  let lastAt: string | null = null
  let mine = false
  for (const vote of votes) {
    const at = typeof vote.at === 'string' ? vote.at : ''
    if (at && (!lastAt || at > lastAt)) lastAt = at
    if (userId && vote.userId === userId) mine = true
  }
  return { count: votes.length, lastAt, mine }
}

export async function GET(req: NextRequest) {
  let placeId = ''
  try {
    placeId = asPlaceId(req.nextUrl.searchParams.get('placeId'))
  } catch {
    return NextResponse.json({ error: 'placeId required' }, { status: 400 })
  }
  const session = getSession(req)
  try {
    const sid = await mcpConnected()
    const summary = await tally(sid, placeId, session?.uid)
    return NextResponse.json(summary)
  } catch (err) {
    console.error('[places/exists GET]', err)
    if (isMcpUnavailable(err)) return NextResponse.json({ count: 0, lastAt: null, mine: false })
    return NextResponse.json({ count: 0, lastAt: null, mine: false })
  }
}

export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in to confirm this place.' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  let placeId = ''
  try {
    placeId = asPlaceId(body.placeId)
  } catch {
    return NextResponse.json({ error: 'placeId required' }, { status: 400 })
  }
  try {
    const sid = await mcpConnected()
    const existing = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'place_exists',
      filter: { placeId, userId: session.uid },
      limit: 1,
    }))
    if (!existing.length) {
      await mcpCall(sid, 'insert-many', {
        database: DB,
        collection: 'place_exists',
        documents: [{ placeId, userId: session.uid, at: new Date().toISOString() }],
      })
    }
    const summary = await tally(sid, placeId, session.uid)
    return NextResponse.json(summary)
  } catch (err) {
    console.error('[places/exists POST]', err)
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not save this confirmation.' }, { status: 500 })
  }
}
