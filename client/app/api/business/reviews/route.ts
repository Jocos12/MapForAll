import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall } from '@/lib/mcp'
import { DB, requestedPlace, resolveOwnedPlace, reviewKey } from '@/lib/business'
import { cleanText } from '@/lib/places'
import { getSession } from '@/lib/session'

/** Public owner reply under one review of the owner's own listing. Empty text removes it. */
export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const key = cleanText(body.key, 32)
  const text = cleanText(body.text, 400)
  if (!key) return NextResponse.json({ error: 'Missing review.' }, { status: 400 })

  try {
    const rows = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'reviews',
      filter: { placeId },
      projection: { _id: 0, userId: 1 },
      limit: 500,
    }))
    const target = rows.find((row) => typeof row.userId === 'string' && reviewKey(placeId, row.userId) === key)
    if (!target) return NextResponse.json({ error: 'Review not found.' }, { status: 404 })
    const at = new Date().toISOString()
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'reviews',
      filter: { placeId, userId: target.userId },
      update: text
        ? { $set: { ownerReply: text, ownerReplyAt: at } }
        : { $unset: { ownerReply: '', ownerReplyAt: '' } },
    })
    return NextResponse.json({ ok: true, reply: text ? { text, at } : null })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not save your reply.' }, { status: 500 })
  }
}
