import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'
import { storedPhotos } from '@/lib/places'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

/** Serves one stored listing photo as an image so list payloads stay small. */
export async function GET(req: NextRequest) {
  const placeId = (req.nextUrl.searchParams.get('placeId') ?? '').trim()
  const index = Number(req.nextUrl.searchParams.get('i') ?? '0')
  if (!/^user_[a-z0-9]{6,32}$/i.test(placeId) || !Number.isInteger(index) || index < 0 || index > 7) {
    return new NextResponse(null, { status: 400 })
  }
  try {
    const sid = await mcpConnected()
    const doc = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter: { place_id: placeId },
      projection: { _id: 0, photos: 1, photo_url: 1 },
      limit: 1,
    }))[0]
    const url = doc ? storedPhotos(doc)[index] : undefined
    const match = url?.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i)
    if (!match) return new NextResponse(null, { status: 404 })
    return new NextResponse(Buffer.from(match[2], 'base64'), {
      headers: { 'Content-Type': match[1], 'Cache-Control': 'public, max-age=300' },
    })
  } catch {
    return new NextResponse(null, { status: 503 })
  }
}
