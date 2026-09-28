import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { isMcpUnavailable, extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'

export const runtime = 'nodejs'

const Query = z.object({
  action: z.string().max(80).optional(),
  actor: z.string().max(120).optional(),
  target: z.string().max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
})

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'audit' })
  if (!gate.ok) return gate.response

  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query.' }, { status: 400 })

  const { action, actor, target, from, to, page, limit } = parsed.data
  const filter: Record<string, unknown> = {}
  if (action) filter.action = action
  if (actor) {
    filter.$or = [{ actor_email: { $regex: actor, $options: 'i' } }, { actor_uid: actor }]
  }
  if (target) filter.target_id = { $regex: target, $options: 'i' }
  if (from || to) {
    filter.at = {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    }
  }

  try {
    const sid = await mcpConnected()
    const DB = process.env.MONGODB_DATABASE ?? 'hodari'
    const skip = (page - 1) * limit
    const rows = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'admin_audit',
        filter,
        sort: { at: -1 },
        skip,
        limit,
      }),
    )
    const items = rows.map((a) => ({
      id: String(a.audit_id ?? a._id ?? ''),
      at: typeof a.at === 'string' ? a.at : '',
      action: String(a.action ?? ''),
      actor_email: String(a.actor_email ?? ''),
      actor_role: String(a.actor_role ?? ''),
      target_type: String(a.target_type ?? ''),
      target_id: String(a.target_id ?? ''),
      before: a.before ?? null,
      after: a.after ?? null,
      meta: a.meta ?? null,
    }))
    const res = NextResponse.json({ items, page, limit, hasMore: items.length === limit })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load audit log.' }, { status: 500 })
  }
}
