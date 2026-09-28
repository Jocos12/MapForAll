import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { getScoringSettings } from '@/lib/adminSettings'
import { isMcpUnavailable, extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'
import { toClientPlace } from '@/lib/places'
import { visibilityShare } from '@/lib/priority'

export const runtime = 'nodejs'

const BRAND = rgb(0.91, 0.4, 0.16)

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'impact-pdf' })
  if (!gate.ok) return gate.response

  try {
    const sid = await mcpConnected()
    const DB = process.env.MONGODB_DATABASE ?? 'hodari'
    const raw = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'places',
        filter: {},
        projection: { photos: 0 },
        limit: 1500,
      }),
    )
    const places = raw.map(toClientPlace).filter((p): p is NonNullable<ReturnType<typeof toClientPlace>> => p !== null)
    const validated = places.filter((p) => p.status === 'validated' || !p.status)
    const weights = await getScoringSettings()
    const vis = visibilityShare(validated, 10, true, weights)
    const localPct = Math.round(vis.local * 100)
    const accPct = Math.round(vis.accessible * 100)
    const score = Math.round(localPct * 0.4 + accPct * 0.35 + 50 * 0.25)

    const pdf = await PDFDocument.create()
    const page = pdf.addPage([595, 842])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    let y = 800

    page.drawText('MapForAll — Inclusion impact report', { x: 48, y, size: 18, font: bold, color: BRAND })
    y -= 28
    page.drawText(`Generated ${new Date().toISOString().slice(0, 10)}`, { x: 48, y, size: 10, font, color: rgb(0.4, 0.35, 0.32) })
    y -= 36

    page.drawText(`Inclusion score: ${score} / 100`, { x: 48, y, size: 14, font: bold })
    y -= 22
    page.drawText(`Local visibility (top 10): ${localPct}%`, { x: 48, y, size: 11, font })
    y -= 16
    page.drawText(`Accessible visibility (top 10): ${accPct}%`, { x: 48, y, size: 11, font })
    y -= 16
    page.drawText(`Validated places: ${validated.length}`, { x: 48, y, size: 11, font })
    y -= 28

    page.drawText('SDG alignment', { x: 48, y, size: 12, font: bold, color: BRAND })
    y -= 18
    for (const line of [
      'SDG 8 — Decent work: boosting local traders in search results',
      'SDG 10 — Reduced inequalities: formal vs informal visibility balance',
      'SDG 11 — Sustainable cities: accessible places & sector coverage',
    ]) {
      page.drawText(line, { x: 56, y, size: 10, font, maxWidth: 500 })
      y -= 14
    }

    y -= 10
    page.drawText('Scoring weights in effect', { x: 48, y, size: 12, font: bold, color: BRAND })
    y -= 18
    page.drawText(`Local bonus: ${weights.local_bonus} · Accessible bonus: ${weights.accessible_bonus}`, {
      x: 56,
      y,
      size: 10,
      font,
    })

    const bytes = await pdf.save()
    const res = new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="mapforall-impact.pdf"',
      },
    })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    console.error('[admin/impact/pdf]', err)
    return NextResponse.json({ error: 'PDF export failed.' }, { status: 500 })
  }
}
