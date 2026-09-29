import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'notifications' })
  if (!gate.ok) return gate.response

  try {
    const sid = await mcpConnected()
    const DB = process.env.MONGODB_DATABASE ?? 'hodari'
    const pending = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'places',
        filter: { status: 'pending' },
        projection: { place_id: 1, name: 1, created_at: 1, claimed_by_owner: 1 },
        sort: { created_at: -1 },
        limit: 8,
      }),
    )

    const items = pending.map((doc) => ({
      id: String(doc.place_id),
      title: doc.claimed_by_owner
        ? `Commerce · ${String(doc.name ?? '—')}`
        : `Lieu · ${String(doc.name ?? '—')}`,
      href: '/admin/moderation',
      at: typeof doc.created_at === 'string' ? doc.created_at : '',
    }))

    const res = NextResponse.json({ items })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ items: [] })
  }
}
