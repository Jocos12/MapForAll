import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'

export const runtime = 'nodejs'

/** Recent admin activity for dashboard polling (~15s). */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'activity' })
  if (!gate.ok) return gate.response

  try {
    const sid = await mcpConnected()
    const DB = process.env.MONGODB_DATABASE ?? 'hodari'
    const since = req.nextUrl.searchParams.get('since')

    const filter: Record<string, unknown> = {}
    if (since) filter.at = { $gt: since }

    const docs = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'admin_audit',
        filter,
        sort: { at: -1 },
        limit: 20,
      }),
    )

    const items = docs.map((a, i) => ({
      id: String(a.audit_id ?? a._id ?? `act-${i}-${a.at ?? ''}`),
      action: String(a.action ?? ''),
      at: typeof a.at === 'string' ? a.at : '',
      actor: String(a.actor_email ?? a.actor_uid ?? ''),
      target: String(a.target_id ?? ''),
      targetType: String(a.target_type ?? ''),
    }))

    const res = NextResponse.json({ items, serverTime: new Date().toISOString() })
    res.headers.set('Cache-Control', 'no-store')
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ items: [], serverTime: new Date().toISOString() })
  }
}
