import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { DB, isClaimedBusiness } from '@/lib/adminBusinesses'
import { businessReportHtml, type BusinessReportStats } from '@/lib/businessReportHtml'
import { asId } from '@/lib/session'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

function viewFilter(placeId: string) {
  return { $or: [{ place_id: placeId }, { placeId }] }
}

async function aggregateCount(sid: string, collection: string, filter: Record<string, unknown>): Promise<number> {
  try {
    const rows = extractDocs(
      await mcpCall(sid, 'aggregate', {
        database: DB,
        collection,
        pipeline: [{ $match: filter }, { $count: 'n' }],
      }),
    )
    const n = rows[0]?.n
    return typeof n === 'number' ? n : 0
  } catch {
    const docs = extractDocs(
      await mcpCall(sid, 'find', { database: DB, collection, filter, limit: 5000 }),
    )
    return docs.length
  }
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'businesses-report' })
  if (!gate.ok) return gate.response
  let placeId: string
  try {
    placeId = asId((await ctx.params).id, 'id')
  } catch {
    return NextResponse.json({ error: 'Invalid id.' }, { status: 400 })
  }
  const format = req.nextUrl.searchParams.get('format') ?? 'json'
  try {
    const sid = await mcpConnected()
    const doc =
      extractDocs(
        await mcpCall(sid, 'find', { database: DB, collection: 'places', filter: { place_id: placeId }, limit: 1 }),
      )[0] ?? null
    if (!doc || !isClaimedBusiness(doc)) {
      return NextResponse.json({ error: 'Business not found.' }, { status: 404 })
    }
    const place_name = typeof doc.name === 'string' ? doc.name : placeId
    const views_total = await aggregateCount(sid, 'place_views', viewFilter(placeId))
    const exists_confirmations = await aggregateCount(sid, 'place_exists', viewFilter(placeId))

    let reviews_total = 0
    let reviews_avg: number | null = null
    const reviewDocs = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'reviews',
        filter: { placeId },
        limit: 500,
      }),
    )
    reviews_total = reviewDocs.length
    const ratings = reviewDocs.map((r) => r.rating).filter((n): n is number => typeof n === 'number')
    if (ratings.length) reviews_avg = ratings.reduce((a, b) => a + b, 0) / ratings.length

    const sourceRows = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'place_views',
        filter: viewFilter(placeId),
        projection: { source: 1 },
        limit: 5000,
      }),
    )
    const views_by_source: Record<string, number> = {}
    for (const row of sourceRows) {
      const src = typeof row.source === 'string' ? row.source : 'unknown'
      views_by_source[src] = (views_by_source[src] ?? 0) + 1
    }
    if (!Object.keys(views_by_source).length && views_total > 0) {
      views_by_source.all = views_total
    }

    const stats: BusinessReportStats = {
      place_id: placeId,
      place_name,
      generated_at: new Date().toISOString(),
      views_total,
      views_by_source,
      reviews_total,
      reviews_avg,
      exists_confirmations,
      status: typeof doc.status === 'string' ? doc.status : 'pending',
    }

    if (format === 'html' || format === 'pdf') {
      const html = businessReportHtml(stats)
      const filename = `mapforall-report-${placeId}.html`
      return withSessionRefresh(
        new NextResponse(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
          },
        }),
        gate.refreshedCookie,
      )
    }

    return withSessionRefresh(
      NextResponse.json({
        stats,
        download_url: `/api/admin/businesses/${encodeURIComponent(placeId)}/report?format=html`,
      }),
      gate.refreshedCookie,
    )
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    console.error('[admin/businesses/report]', err)
    return NextResponse.json({ error: 'Could not build report.' }, { status: 500 })
  }
}
