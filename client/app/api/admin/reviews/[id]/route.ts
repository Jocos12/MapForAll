import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import { DB, reviewRowKey } from '@/lib/adminReviews'

export const runtime = 'nodejs'

const ActionBody = z.object({
  action: z.enum(['hide', 'unhide', 'delete']),
})

type RouteCtx = { params: Promise<{ id: string }> }

function parseReviewKey(raw: string): { placeId: string; userId: string } | null {
  const decoded = decodeURIComponent(raw)
  const idx = decoded.indexOf('::')
  if (idx <= 0) return null
  return { placeId: decoded.slice(0, idx), userId: decoded.slice(idx + 2) }
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'reviews-patch' })
  if (!gate.ok) return gate.response
  const keyRaw = (await ctx.params).id
  const ids = parseReviewKey(keyRaw)
  if (!ids) return NextResponse.json({ error: 'Invalid review id.' }, { status: 400 })
  const body = ActionBody.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

  const filter = { placeId: ids.placeId, userId: ids.userId }
  const targetId = reviewRowKey(ids.placeId, ids.userId)

  try {
    const sid = await mcpConnected()
    if (body.data.action === 'delete') {
      await mcpCall(sid, 'delete-many', { database: DB, collection: 'reviews', filter })
      await writeAudit({
        actor: gate.actor,
        action: 'review.delete',
        targetType: 'review',
        targetId,
        meta: filter,
      })
    } else {
      const hidden = body.data.action === 'hide'
      await mcpCall(sid, 'update-many', {
        database: DB,
        collection: 'reviews',
        filter,
        update: { $set: { hidden, updatedAt: new Date().toISOString() } },
      })
      await writeAudit({
        actor: gate.actor,
        action: 'review.hide',
        targetType: 'review',
        targetId,
        after: { hidden },
      })
    }
    return withSessionRefresh(NextResponse.json({ ok: true }), gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Action failed.' }, { status: 500 })
  }
}
