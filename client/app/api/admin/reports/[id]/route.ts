import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import { DB, toAdminReport } from '@/lib/adminReports'
import { mailLang, reportResolvedEmail } from '@/lib/emailTemplates'
import { sendMail } from '@/lib/mailer'
import { asId } from '@/lib/session'

export const runtime = 'nodejs'

const ActionBody = z.object({
  action: z.enum(['resolve', 'ignore', 'disable_place']),
  note: z.string().max(280).optional().default(''),
})

type RouteCtx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'reports-patch' })
  if (!gate.ok) return gate.response
  let reportId: string
  try {
    reportId = asId((await ctx.params).id, 'id')
  } catch {
    return NextResponse.json({ error: 'Invalid id.' }, { status: 400 })
  }
  const body = ActionBody.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

  try {
    const sid = await mcpConnected()
    const doc =
      extractDocs(
        await mcpCall(sid, 'find', {
          database: DB,
          collection: 'place_reports',
          filter: { report_id: reportId },
          limit: 1,
        }),
      )[0] ?? null
    if (!doc) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })
    const before = toAdminReport(doc)
    if (!before) return NextResponse.json({ error: 'Invalid report.' }, { status: 500 })

    const now = new Date().toISOString()
    const status = body.data.action === 'ignore' ? 'ignored' : 'resolved'
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'place_reports',
      filter: { report_id: reportId },
      update: {
        $set: {
          status,
          resolved_at: now,
          resolved_by: gate.actor.uid,
          resolution_note: body.data.note.trim() || null,
        },
      },
    })

    if (body.data.action === 'disable_place') {
      await mcpCall(sid, 'update-many', {
        database: DB,
        collection: 'places',
        filter: { place_id: before.place_id },
        update: { $set: { paused: true, status: 'suspended', moderated_at: now, moderated_by: gate.actor.uid } },
      })
    }

    const auditAction =
      body.data.action === 'ignore'
        ? 'report.ignore'
        : body.data.action === 'disable_place'
          ? 'report.disable_place'
          : 'report.resolve'

    await writeAudit({
      actor: gate.actor,
      action: auditAction,
      targetType: 'report',
      targetId: reportId,
      before: { status: before.status },
      after: { status, action: body.data.action },
      meta: body.data.note ? { note: body.data.note } : undefined,
    })

    if (before.reporter_email && body.data.action !== 'ignore') {
      await sendMail(
        before.reporter_email,
        reportResolvedEmail({ placeName: before.place_name, lang: mailLang('fr') }),
      )
    }

    const updated =
      extractDocs(
        await mcpCall(sid, 'find', {
          database: DB,
          collection: 'place_reports',
          filter: { report_id: reportId },
          limit: 1,
        }),
      )[0] ?? doc
    return withSessionRefresh(
      NextResponse.json({ ok: true, report: toAdminReport({ ...updated, status, resolved_at: now }) }),
      gate.refreshedCookie,
    )
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    console.error('[admin/reports/patch]', err)
    return NextResponse.json({ error: 'Action failed.' }, { status: 500 })
  }
}
