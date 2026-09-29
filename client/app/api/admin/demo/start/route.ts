import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import { saveAppSettings } from '@/lib/adminSettings'
import { isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'

export const runtime = 'nodejs'

const DEMO_STEPS = [
  'A pending place was inserted (Demo Tailor · Kimisagara).',
  'Open Moderation to approve or reject it.',
  'Watch the dashboard queue refresh (polls every 15 s).',
  'Adjust Scoring weights and re-run the simulation.',
  'Export an impact PDF for stakeholders.',
]

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'demo-start' })
  if (!gate.ok) return gate.response

  const placeId = `demo_${Date.now().toString(36)}`
  const now = new Date().toISOString()
  const doc = {
    place_id: placeId,
    name: 'Demo Tailor · Kimisagara',
    address: 'Kimisagara, Kigali',
    sector: 'Nyamirambo',
    city: 'Kigali',
    status: 'pending',
    source: 'community',
    local_business: true,
    accessible: false,
    categories: ['shop'],
    rating: 4.2,
    description: 'Demo submission for admin walkthrough.',
    location: { type: 'Point', coordinates: [30.045, -1.978] },
    created_at: now,
    demo_seed: true,
    lang_content: {
      fr: { name: 'Couture démo · Kimisagara', summary: 'Atelier local pour la démo admin.' },
      en: { name: 'Demo tailor · Kimisagara', summary: 'Local workshop for admin demo.' },
    },
  }

  try {
    const sid = await mcpConnected()
    const DB = process.env.MONGODB_DATABASE ?? 'hodari'
    await mcpCall(sid, 'insert-many', {
      database: DB,
      collection: 'places',
      documents: [doc],
    })
    await saveAppSettings({ demo_mode: true })
    await writeAudit({
      actor: gate.actor,
      action: 'demo.start',
      targetType: 'place',
      targetId: placeId,
      meta: { steps: DEMO_STEPS.length },
    })

    const res = NextResponse.json({
      ok: true,
      place_id: placeId,
      steps: DEMO_STEPS,
      moderation_url: `/admin/moderation?highlight=${encodeURIComponent(placeId)}`,
    })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    console.error('[admin/demo/start]', err)
    return NextResponse.json({ error: 'Demo could not start.' }, { status: 500 })
  }
}
