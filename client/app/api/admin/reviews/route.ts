import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { DB, toAdminReview } from '@/lib/adminReviews'

export const runtime = 'nodejs'

const ListQuery = z.object({
  flag: z.enum(['all', 'url_spam', 'banned_word', 'none']).optional().default('all'),
  hidden: z.enum(['all', '0', '1']).optional().default('all'),
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
})

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'reviews-get' })
  if (!gate.ok) return gate.response
  const parsed = ListQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query.' }, { status: 400 })
  const q = parsed.data
  try {
    const sid = await mcpConnected()
    const raw = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'reviews',
        filter: {},
        sort: { updatedAt: -1 },
        limit: 2000,
      }),
    )
    let rows = raw.map(toAdminReview).filter((r): r is NonNullable<typeof r> => !!r)
    if (q.hidden === '0') rows = rows.filter((r) => !r.hidden)
    if (q.hidden === '1') rows = rows.filter((r) => r.hidden)
    if (q.flag !== 'all') rows = rows.filter((r) => r.flag === q.flag)
    if (q.q) {
      const needle = q.q.trim().toLowerCase()
      rows = rows.filter(
        (r) =>
          r.comment.toLowerCase().includes(needle) ||
          r.placeId.toLowerCase().includes(needle) ||
          r.firstName.toLowerCase().includes(needle),
      )
    }
    const flagged = rows.filter((r) => r.flag !== 'none').length
    const start = (q.page - 1) * q.limit
    const items = rows.slice(start, start + q.limit)
    return withSessionRefresh(
      NextResponse.json({
        items,
        total: rows.length,
        flagged,
        page: q.page,
        limit: q.limit,
        detectors: { active: true },
      }),
      gate.refreshedCookie,
    )
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load reviews.' }, { status: 500 })
  }
}
