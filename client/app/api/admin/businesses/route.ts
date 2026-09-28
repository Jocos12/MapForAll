import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import {
  DB,
  matchesBusinessQuery,
  sortBusinesses,
  toAdminBusinessRow,
} from '@/lib/adminBusinesses'

export const runtime = 'nodejs'

const ListQuery = z.object({
  status: z.enum(['all', 'pending', 'validated', 'rejected', 'suspended']).optional().default('all'),
  q: z.string().max(120).optional(),
  sort: z.enum(['created_desc', 'created_asc', 'name', 'completeness']).optional().default('created_desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
})

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'businesses-get' })
  if (!gate.ok) return gate.response
  const parsed = ListQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query.' }, { status: 400 })
  }
  const q = parsed.data
  try {
    const sid = await mcpConnected()
    const raw = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'places',
        filter: {},
        projection: { photos: 0 },
        sort: { created_at: -1 },
        limit: 2000,
      }),
    )
    const filtered = raw.filter((doc) =>
      matchesBusinessQuery(doc, { status: q.status, q: q.q?.trim().toLowerCase() }),
    )
    const rows = filtered.map(toAdminBusinessRow).filter((r): r is NonNullable<typeof r> => !!r)
    const sorted = sortBusinesses(rows, q.sort)
    const start = (q.page - 1) * q.limit
    const items = sorted.slice(start, start + q.limit)
    return withSessionRefresh(
      NextResponse.json({
        items,
        total: sorted.length,
        page: q.page,
        limit: q.limit,
      }),
      gate.refreshedCookie,
    )
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    console.error('[admin/businesses]', err)
    return NextResponse.json({ error: 'Could not load businesses.' }, { status: 500 })
  }
}
