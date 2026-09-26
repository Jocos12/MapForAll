import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { isAdminEmail, toClientPlace } from '@/lib/places'
import { asId, getSession } from '@/lib/session'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

function denied() {
  return NextResponse.json({ error: 'Not an admin.' }, { status: 403 })
}

export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!isAdminEmail(session.email)) return denied()
  try {
    const sid = await mcpConnected()
    const texts = await mcpCall(sid, 'find', { database: DB, collection: 'places', filter: {}, limit: 500 })
    const docs = extractDocs(texts).map(toClientPlace).filter((p): p is NonNullable<typeof p> => p !== null)
    const pending = docs
      .filter((p) => p.status === 'pending')
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
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
  if (!isAdminEmail(session.email)) return denied()
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
    return NextResponse.json({ ok: true, place_id: placeId, status })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not update this place.' }, { status: 500 })
  }
}
