import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { MAX_RECOMMENDS, isPublicPlace, toClientPlace } from '@/lib/places'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

/** A shareable listing plus the places its owner recommends. Hidden unless published. */
export async function GET(req: NextRequest) {
  const placeId = (req.nextUrl.searchParams.get('placeId') ?? '').trim()
  if (!placeId || placeId.length > 160) return NextResponse.json({ error: 'placeId required' }, { status: 400 })
  try {
    const sid = await mcpConnected()
    const doc = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter: { place_id: placeId },
      limit: 1,
    }))[0]
    if (!doc || !isPublicPlace(doc)) return NextResponse.json({ place: null, recommends: [] }, { status: 404 })
    const ids = Array.isArray(doc.recommends)
      ? doc.recommends.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECOMMENDS)
      : []
    const [rows, backers] = await Promise.all([
      ids.length
        ? mcpCall(sid, 'find', {
            database: DB,
            collection: 'places',
            filter: { place_id: { $in: ids } },
            projection: { _id: 0, photos: 0 },
            limit: MAX_RECOMMENDS,
          }).then(extractDocs)
        : Promise.resolve([]),
      mcpCall(sid, 'find', {
        database: DB,
        collection: 'places',
        filter: { recommends: placeId, place_id: { $ne: placeId } },
        projection: { _id: 0, place_id: 1, status: 1, paused: 1 },
        limit: 200,
      }).then(extractDocs).catch(() => []),
    ])
    const byId = new Map(rows.filter(isPublicPlace).map((row) => [row.place_id, row]))
    const recommends = ids
      .map((id) => byId.get(id))
      .filter((row): row is Record<string, unknown> => !!row)
      .map(toClientPlace)
      .filter((row): row is NonNullable<typeof row> => !!row)
    return NextResponse.json({ place: toClientPlace(doc), recommends, recommendedBy: backers.filter(isPublicPlace).length })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable', place: null, recommends: [] }, { status: 503 })
    return NextResponse.json({ error: 'Could not load this place.', place: null, recommends: [] }, { status: 500 })
  }
}
