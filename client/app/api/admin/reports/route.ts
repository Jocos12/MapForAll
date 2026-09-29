import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { DB, matchesReportFilters, sortReports, toAdminReport } from '@/lib/adminReports'

export const runtime = 'nodejs'

const ListQuery = z.object({
  status: z.enum(['all', 'open', 'resolved', 'ignored']).optional().default('open'),
  priority: z.enum(['all', 'urgent', 'normal', 'low']).optional().default('all'),
  type: z.string().max(40).optional().default('all'),
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
})

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'reports-get' })
  if (!gate.ok) return gate.response
  const parsed = ListQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query.' }, { status: 400 })
  const q = parsed.data
  try {
    const sid = await mcpConnected()
    const raw = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'place_reports',
        filter: {},
        sort: { created_at: -1 },
        limit: 2000,
      }),
    )
    const rows = raw.map(toAdminReport).filter((r): r is NonNullable<typeof r> => !!r)
    const filtered = rows.filter((row) =>
      matchesReportFilters(row, {
        status: q.status,
        priority: q.priority,
        type: q.type,
        q: q.q?.trim().toLowerCase(),
      }),
    )
    const sorted = sortReports(filtered)
    const start = (q.page - 1) * q.limit
    const items = sorted.slice(start, start + q.limit)
    return withSessionRefresh(
      NextResponse.json({ items, total: sorted.length, page: q.page, limit: q.limit }),
      gate.refreshedCookie,
    )
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load reports.' }, { status: 500 })
  }
}
