import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { getScoringSettings } from '@/lib/adminSettings'
import { isMcpUnavailable, extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'
import { toClientPlace } from '@/lib/places'
import type { Place } from '@/lib/types'
import { sortPlacesByScore, visibilityShare } from '@/lib/priority'

export const runtime = 'nodejs'

const Query = z.object({
  range: z.enum(['7', '30', '90']).optional().default('30'),
})

const SECTOR_TARGETS = [
  'Nyarugenge',
  'Nyamirambo',
  'Muhima',
  'Kimihurura',
  'Kacyiru',
  'Remera',
  'Gisozi',
  'Kimironko',
  'Kicukiro',
  'Gatenga',
  'Gikondo',
  'Kibagabaga',
]

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

function daysBetween(days: number): string[] {
  const out: string[] = []
  const end = new Date()
  const cur = new Date()
  cur.setUTCDate(cur.getUTCDate() - days + 1)
  while (cur <= end) {
    out.push(dayKey(cur.toISOString()))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

function inclusionScore(localPct: number, accPct: number, sectorPct: number): number {
  const raw = localPct * 0.4 + accPct * 0.35 + sectorPct * 0.25
  return Math.round(Math.min(100, Math.max(0, raw)))
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'impact' })
  if (!gate.ok) return gate.response

  const parsed = Query.safeParse({ range: req.nextUrl.searchParams.get('range') ?? '30' })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query.' }, { status: 400 })

  try {
    const sid = await mcpConnected()
    const DB = process.env.MONGODB_DATABASE ?? 'hodari'
    const raw = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'places',
        filter: {},
        projection: { photos: 0 },
        limit: 2000,
      }),
    )
    const docs = raw.map(toClientPlace).filter((p): p is NonNullable<ReturnType<typeof toClientPlace>> => p !== null)
    const validated = docs.filter((p) => p.status === 'validated' || !p.status)
    const weights = await getScoringSettings()

    const vis = visibilityShare(validated, 10, true, weights)
    const localPct = Math.round(vis.local * 100)
    const accPct = Math.round(vis.accessible * 100)

    const sectorCount: Record<string, number> = {}
    for (const r of raw) {
      const sector =
        (typeof r.sector === 'string' && r.sector) ||
        (typeof r.address === 'string' && r.address.split(',')[0]?.trim()) ||
        'Kigali'
      sectorCount[sector] = (sectorCount[sector] ?? 0) + 1
    }
    const covered = SECTOR_TARGETS.filter((s) => (sectorCount[s] ?? 0) >= 3).length
    const sectorPct = Math.round((covered / SECTOR_TARGETS.length) * 100)
    const score = inclusionScore(localPct, accPct, sectorPct)

    const undercovered = SECTOR_TARGETS.map((sector) => ({
      sector,
      count: sectorCount[sector] ?? 0,
      suggestion:
        (sectorCount[sector] ?? 0) < 3
          ? 'Add community walks or partner with local traders in this sector.'
          : null,
    })).filter((s) => s.count < 5)

    const dayKeys = daysBetween(Number(parsed.data.range))
    const addedByDay: Record<string, { total: number; local: number; accessible: number }> = {}
    for (const k of dayKeys) addedByDay[k] = { total: 0, local: 0, accessible: 0 }
    for (const p of validated) {
      if (!p.created_at) continue
      const k = dayKey(p.created_at)
      if (!(k in addedByDay)) continue
      addedByDay[k].total += 1
      if (p.local_business) addedByDay[k].local += 1
      if (p.accessible) addedByDay[k].accessible += 1
    }

    let runningLocal = 0
    let runningAcc = 0
    let runningTotal = validated.filter((p) => {
      const t = p.created_at ? Date.parse(p.created_at) : NaN
      return Number.isFinite(t) && t < Date.parse(`${dayKeys[0]}T00:00:00.000Z`)
    }).length

    const series = dayKeys.map((date) => {
      const bucket = addedByDay[date] ?? { total: 0, local: 0, accessible: 0 }
      runningTotal += bucket.total
      runningLocal += bucket.local
      runningAcc += bucket.accessible
      const lp = runningTotal ? Math.round((runningLocal / runningTotal) * 100) : localPct
      const ap = runningTotal ? Math.round((runningAcc / runningTotal) * 100) : accPct
      return {
        date,
        inclusionScore: inclusionScore(lp, ap, sectorPct),
        localPct: lp,
        accessiblePct: ap,
        placesAdded: bucket.total,
      }
    })

    const rankedSample = sortPlacesByScore(validated.slice(0, 80), true, weights).slice(0, 12)

    const res = NextResponse.json({
      range: parsed.data.range,
      inclusionScore: score,
      breakdown: { localVisiblePct: localPct, accessiblePct: accPct, sectorCoveragePct: sectorPct },
      sdg: [
        { id: 8, title: 'Decent work & economic growth', link: 'https://sdgs.un.org/goals/goal8', relevance: 'Local business visibility' },
        { id: 10, title: 'Reduced inequalities', link: 'https://sdgs.un.org/goals/goal10', relevance: 'Formal vs informal inclusion' },
        { id: 11, title: 'Sustainable cities', link: 'https://sdgs.un.org/goals/goal11', relevance: 'Sector coverage & accessibility' },
      ],
      timeSeries: series,
      undercovered,
      topBoosted: rankedSample.map((p) => ({
        place_id: p.place_id,
        name: p.name,
        local: !!p.local_business,
        accessible: !!p.accessible,
        lat: p.coordinates.lat,
        lng: p.coordinates.lng,
      })),
      totals: {
        places: validated.length,
        local: validated.filter((p) => p.local_business).length,
        accessible: validated.filter((p) => p.accessible).length,
      },
    })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    console.error('[admin/impact]', err)
    return NextResponse.json({ error: 'Could not load impact.' }, { status: 500 })
  }
}
