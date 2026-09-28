import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { isMcpUnavailable } from '@/lib/mcp'
import { listAdminUsers } from '@/lib/adminUsers'

export const runtime = 'nodejs'

const Query = z.object({
  q: z.string().max(120).optional(),
  role: z.enum(['client', 'business_owner', 'admin', 'moderator']).optional(),
  status: z.enum(['active', 'suspended', 'deleted', 'all']).optional().default('active'),
})

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'users-export' })
  if (!gate.ok) return gate.response
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query.' }, { status: 400 })
  }
  try {
    const { items } = await listAdminUsers({
      ...parsed.data,
      sort: 'created_desc',
      page: 1,
      limit: 5000,
    })
    const header = [
      'user_id',
      'name',
      'email',
      'role',
      'status',
      'created_at',
      'last_active_at',
      'last_login_at',
      'places_added',
      'reports_count',
    ]
    const lines = [header.join(',')]
    for (const u of items) {
      const row = [
        u.user_id,
        u.name ?? '',
        u.email,
        u.role,
        u.status,
        u.created_at ?? '',
        u.last_active_at ?? '',
        u.last_login_at ?? '',
        String(u.places_added),
        String(u.reports_count),
      ].map((cell) => csvEscape(String(cell)))
      lines.push(row.join(','))
    }
    const csv = lines.join('\r\n')
    const res = new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="mapforall-users.csv"',
      },
    })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Export failed.' }, { status: 500 })
  }
}
