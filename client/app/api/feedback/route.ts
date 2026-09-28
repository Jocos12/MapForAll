import { NextRequest, NextResponse } from 'next/server'
import { mcpCall, mcpConnected } from '@/lib/mcp'
import { asId, getSessionUser } from '@/lib/session'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

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
  const { placeName, city, action } = body
  if (!action || typeof action !== 'string') {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 })
  }

  try {
    const sid = await mcpConnected()
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'interactions',
      filter: { user_id: userId, place_id: placeId },
      update: {
        $set: { user_id: userId, place_id: placeId, place_name: placeName ?? '', city: city ?? '', action },
      },
      upsert: true,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
