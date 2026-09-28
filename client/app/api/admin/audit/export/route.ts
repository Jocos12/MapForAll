import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { isMcpUnavailable, extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'

export const runtime = 'nodejs'

const Query = z.object({
  action: z.string().max(80).optional(),
  actor: z.string().max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'audit-export' })
  if (!gate.ok) return gate.response

  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query.' }, { status: 400 })

  const filter: Record<string, unknown> = {}
  if (parsed.data.action) filter.action = parsed.data.action
  if (parsed.data.actor) {
    filter.$or = [
      { actor_email: { $regex: parsed.data.actor, $options: 'i' } },
      { actor_uid: parsed.data.actor },
    ]
  }
  if (parsed.data.from || parsed.data.to) {
    filter.at = {
      ...(parsed.data.from ? { $gte: parsed.data.from } : {}),
      ...(parsed.data.to ? { $lte: parsed.data.to } : {}),
    }
  }

  try {
    const sid = await mcpConnected()
    const DB = process.env.MONGODB_DATABASE ?? 'hodari'
    const rows = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'admin_audit',
        filter,
        sort: { at: -1 },
        limit: 5000,
      }),
    )
    const header = ['audit_id', 'at', 'action', 'actor_email', 'actor_role', 'target_type', 'target_id']
    const lines = [header.join(',')]
    for (const a of rows) {
      lines.push(
        [
          String(a.audit_id ?? a._id ?? ''),
          typeof a.at === 'string' ? a.at : '',
          String(a.action ?? ''),
          String(a.actor_email ?? ''),
          String(a.actor_role ?? ''),
          String(a.target_type ?? ''),
          String(a.target_id ?? ''),
        ]
          .map((c) => csvEscape(String(c)))
          .join(','),
      )
    }
    const res = new NextResponse(lines.join('\r\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="mapforall-audit.csv"',
      },
    })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Export failed.' }, { status: 500 })
  }
}
