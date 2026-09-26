import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { PHOTO_LIMIT, PLACE_CATEGORIES, toClientPlace } from '@/lib/places'
import { getSession } from '@/lib/session'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

export async function GET(req: NextRequest) {
  const local = req.nextUrl.searchParams.get('local_business') === '1'
  const accessible = req.nextUrl.searchParams.get('accessible') === '1'
  const filter: Record<string, unknown> = {
    $or: [{ status: 'validated' }, { status: { $exists: false } }],
  }
  if (local) filter.local_business = true
  if (accessible) filter.accessible = true
  try {
    const sid = await mcpConnected()
    const texts = await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter,
      limit: 80,
    })
    const places = extractDocs(texts)
      .map(toClientPlace)
      .filter((place): place is NonNullable<typeof place> => place !== null)
    return NextResponse.json({ places })
  } catch (err) {
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'Database unavailable', places: [] }, { status: 503 })
    }
    return NextResponse.json({ error: 'Could not load places', places: [] }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in to add a place.' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const latitude = Number(body.latitude)
  const longitude = Number(body.longitude)
  if (!name || name.length > 120) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  if (!PLACE_CATEGORIES.includes(category as (typeof PLACE_CATEGORIES)[number])) {
    return NextResponse.json({ error: 'Unknown category.' }, { status: 400 })
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return NextResponse.json({ error: 'A map position is required.' }, { status: 400 })
  }
  const photo = typeof body.photo_url === 'string' ? body.photo_url : ''
  if (photo && (photo.length > PHOTO_LIMIT || !photo.startsWith('data:image/'))) {
    return NextResponse.json({ error: 'Photo must be a small image.' }, { status: 400 })
  }

  const placeId = `user_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
  const doc = {
    place_id: placeId,
    name,
    city: 'Kigali',
    country: 'Rwanda',
    categories: [category],
    description: name,
    location: { type: 'Point', coordinates: [longitude, latitude] },
    local_business: body.local_business === true,
    accessible: body.accessible === true,
    status: 'pending',
    source: 'user_submitted',
    photo_url: photo || null,
    added_by: session.uid,
    confirmations_count: 0,
    created_at: new Date().toISOString(),
  }
  try {
    const sid = await mcpConnected()
    await mcpCall(sid, 'insert-many', { database: DB, collection: 'places', documents: [doc] })
    return NextResponse.json({ ok: true, place_id: placeId, status: 'pending' })
  } catch (err) {
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Could not save this place.' }, { status: 500 })
  }
}
