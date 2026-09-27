import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'
import { getSession } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

/** Where the visitor opened the listing: inside MapForAll (map, search, chat) or from a shared link / QR code. */
const SOURCES = new Set(['app', 'link'])

/** One view per visitor per listing every 30 minutes; the owner's own opens don't count. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const placeId = typeof body.placeId === 'string' ? body.placeId.trim() : ''
  const source = typeof body.source === 'string' && SOURCES.has(body.source) ? body.source : null
  if (!/^user_[a-z0-9]{6,32}$/i.test(placeId)) return NextResponse.json({ ok: false }, { status: 400 })
  const session = getSession(req)
  const viewer = session?.uid ?? clientIp(req)
  if (!rateLimit(`view:${viewer}:${placeId}`, { capacity: 1, refillPerSec: 1 / 1800 }).allowed) {
    return NextResponse.json({ ok: true, counted: false })
  }
  try {
    const sid = await mcpConnected()
    const doc = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter: { place_id: placeId },
      projection: { _id: 0, added_by: 1 },
      limit: 1,
    }))[0]
    if (!doc || (session && doc.added_by === session.uid)) return NextResponse.json({ ok: true, counted: false })
    const now = new Date()
    await mcpCall(sid, 'insert-many', {
      database: DB,
      collection: 'place_views',
      documents: [{ placeId, day: now.toISOString().slice(0, 10), at: now.toISOString(), ...(source ? { source } : {}) }],
    })
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'places',
      filter: { place_id: placeId },
      update: { $inc: { views: 1 } },
    })
    return NextResponse.json({ ok: true, counted: true })
  } catch (err) {
    console.warn('[places/view]', err)
    return NextResponse.json({ ok: false })
  }
}
