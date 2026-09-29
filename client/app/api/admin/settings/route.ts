import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import { getAppSettings, getScoringSettings, saveAppSettings, saveScoringSettings } from '@/lib/adminSettings'
import { isMcpUnavailable } from '@/lib/mcp'
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'

export const runtime = 'nodejs'

const PutBody = z.object({
  default_lang: z.enum(['fr', 'en', 'rw']).optional(),
  demo_mode: z.boolean().optional(),
  confirmation_threshold: z.number().int().min(1).max(50).optional(),
  email: z
    .object({
      welcome_subject: z.string().max(200).optional(),
      welcome_body: z.string().max(4000).optional(),
      otp_subject: z.string().max(200).optional(),
      otp_body: z.string().max(4000).optional(),
      validate_subject: z.string().max(200).optional(),
      validate_body: z.string().max(4000).optional(),
      reject_subject: z.string().max(200).optional(),
      reject_body: z.string().max(4000).optional(),
    })
    .optional(),
})

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'settings-get' })
  if (!gate.ok) return gate.response

  try {
    const [app, scoring] = await Promise.all([getAppSettings(), getScoringSettings()])
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD)
    const res = NextResponse.json({
      app,
      scoring: {
        confirmation_threshold: scoring.confirmation_threshold,
        local_bonus: scoring.local_bonus,
        accessible_bonus: scoring.accessible_bonus,
      },
      smtpConfigured,
    })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load settings.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'settings-put' })
  if (!gate.ok) return gate.response

  const body = PutBody.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

  try {
    const beforeApp = await getAppSettings()
    const beforeScoring = await getScoringSettings()
    const app = await saveAppSettings({
      default_lang: body.data.default_lang,
      demo_mode: body.data.demo_mode,
      email: body.data.email,
    })
    let scoring = beforeScoring
    if (body.data.confirmation_threshold != null) {
      scoring = await saveScoringSettings({ confirmation_threshold: body.data.confirmation_threshold })
    }
    await writeAudit({
      actor: gate.actor,
      action: 'settings.update',
      targetType: 'admin_settings',
      targetId: 'app',
      before: { app: beforeApp, scoring: beforeScoring },
      after: { app, scoring },
    })
    const res = NextResponse.json({ app, scoring })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not save settings.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'settings-export' })
  if (!gate.ok) return gate.response

  const url = new URL(req.url)
  if (url.searchParams.get('action') !== 'export') {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }

  try {
    const sid = await mcpConnected()
    const DB = process.env.MONGODB_DATABASE ?? 'hodari'
    const [places, users] = await Promise.all([
      extractDocs(await mcpCall(sid, 'find', { database: DB, collection: 'places', filter: {}, limit: 3000 })),
      extractDocs(await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: {}, limit: 3000 })),
    ])
    const payload = {
      exported_at: new Date().toISOString(),
      places_count: places.length,
      users_count: users.length,
      places,
      users: users.map((u) => {
        const { password_hash, ...rest } = u as Record<string, unknown>
        return rest
      }),
    }
    const res = NextResponse.json(payload)
    res.headers.set('Content-Disposition', 'attachment; filename="mapforall-export.json"')
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Export failed.' }, { status: 500 })
  }
}
