import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { isAdminEmail, toClientPlace } from '@/lib/places'
import { asId, getSession } from '@/lib/session'
import { findUserById, setOwnedPlaces } from '@/lib/users'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

function denied() {
  return NextResponse.json({ error: 'Not an admin.' }, { status: 403 })
}

async function allowAdmin(uid: string, email?: string | null) {
  if (isAdminEmail(email)) return true
  const user = await findUserById(uid).catch(() => null)
  return user?.role === 'admin'
}

export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!(await allowAdmin(session.uid, session.email))) return denied()
  try {
    const sid = await mcpConnected()
    const texts = await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter: {},
      projection: { photos: 0 },
      sort: { created_at: -1 },
      limit: 500,
    })
    const docs = extractDocs(texts)
      .map(toClientPlace)
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => (p.photo_url?.startsWith('data:image/')
        ? { ...p, photo_url: `/api/places/photo?placeId=${encodeURIComponent(p.place_id)}&i=0` }
        : p))
    const pending = docs
      .filter((p) => p.status === 'pending')
      .sort((a, b) => {
        const claim = Number(b.claimed_by_owner) - Number(a.claimed_by_owner)
        if (claim !== 0) return claim
        return (a.created_at ?? '').localeCompare(b.created_at ?? '')
      })
    const validated = docs.filter((p) => p.status === 'validated' || !p.status).length
    const decided = docs.filter((p) => p.status === 'validated' || p.status === 'rejected').length
    return NextResponse.json({
      pending,
      stats: {
        total: docs.length,
        pending: pending.length,
        validated,
        rejected: docs.filter((p) => p.status === 'rejected').length,
        local: docs.filter((p) => p.local_business).length,
        accessible: docs.filter((p) => p.accessible).length,
        approvalRate: decided ? Math.round((validated / decided) * 100) : 0,
      },
    })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load the queue.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!(await allowAdmin(session.uid, session.email))) return denied()
  const body = await req.json().catch(() => ({}))
  let placeId: string
  try {
    placeId = asId(body.place_id, 'place_id')
  } catch {
    return NextResponse.json({ error: 'Missing place.' }, { status: 400 })
  }
  const status = body.status === 'validated' || body.status === 'rejected' ? body.status : null
  if (!status) return NextResponse.json({ error: 'Status must be validated or rejected.' }, { status: 400 })
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 280) : ''
  try {
    const sid = await mcpConnected()
    const existing = extractDocs(
      await mcpCall(sid, 'find', { database: DB, collection: 'places', filter: { place_id: placeId }, limit: 1 }),
    )[0]
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'places',
      filter: { place_id: placeId },
      update: {
        $set: {
          status,
          rejection_reason: status === 'rejected' ? reason : '',
          moderated_at: new Date().toISOString(),
          moderated_by: session.uid,
        },
      },
    })
    if (status === 'validated' && existing?.claimed_by_owner === true && typeof existing.added_by === 'string') {
      const owner = await findUserById(existing.added_by)
      if (owner?.role === 'business_owner' && !owner.owned_place_ids.includes(placeId)) {
        await setOwnedPlaces(owner.user_id, [...owner.owned_place_ids, placeId])
      }
    }
    return NextResponse.json({ ok: true, place_id: placeId, status })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not update this place.' }, { status: 500 })
  }
}
