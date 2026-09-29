import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'
import { asId, asIdOrNull, getSessionUser } from '@/lib/session'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

/** One row per place. Same physical place saved under two ids collapses by name. */
function dedupeSaved(docs: unknown[]): unknown[] {
  const seenId = new Set<string>()
  const seenName = new Set<string>()
  const out: unknown[] = []
  for (const raw of docs) {
    if (!raw || typeof raw !== 'object') continue
    const doc = raw as Record<string, unknown>
    const action = typeof doc.action === 'string' ? doc.action : 'saved'
    const id = String(doc.place_id ?? '').trim().toLowerCase()
    const name = String(doc.place_name ?? '').trim().toLowerCase()
    const idKey = `${action}:${id}`
    const nameKey = `${action}:${name}`
    if (id && seenId.has(idKey)) continue
    if (name && seenName.has(nameKey)) continue
    if (id) seenId.add(idKey)
    if (name) seenName.add(nameKey)
    out.push(doc)
  }
  return out
}

// GET /api/saved — fetch saved interactions for the authenticated user.
// Identity comes from the signed session cookie; the ?userId= param is only a
// fallback for clients that predate the cookie (see SECURITY_HARDENING.md P0.1).
export async function GET(req: NextRequest) {
  const userId = await getSessionUser(req) ?? asIdOrNull(req.nextUrl.searchParams.get('userId'))
  if (!userId) return NextResponse.json({ saved: [] })

  try {
    const sid = await mcpConnected()
    const docs = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'interactions',
      filter: { user_id: userId, action: { $in: ['saved', 'reminder'] } },
      sort: { timestamp: -1 },
      limit: 200,
    }))
    return NextResponse.json({ saved: dedupeSaved(docs) })
  } catch (err) {
    console.error('[api/saved GET]', err)
    return NextResponse.json({ saved: [] })
  }
}

// POST /api/saved — upsert a reminder with a visitDate
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  let userId: string
  let placeId: string
  try {
    userId = await getSessionUser(req) ?? asId(body.userId, 'userId')
    placeId = asId(body.placeId, 'placeId')
  } catch {
    return NextResponse.json({ error: 'Missing or invalid userId/placeId' }, { status: 400 })
  }
  const { placeName, city, visitDate, note } = body

  try {
    const sid = await mcpConnected()
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'interactions',
      filter: { user_id: userId, place_id: placeId, action: 'reminder' },
      update: {
        $set: {
          user_id: userId,
          place_id: placeId,
          place_name: placeName ?? '',
          city: city ?? '',
          action: 'reminder',
          visit_date: visitDate ?? null,
          note: note ?? '',
          updated_at: new Date().toISOString(),
        },
      },
      upsert: true,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/saved POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
