import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import { getScoringSettings, saveScoringSettings } from '@/lib/adminSettings'
import { isMcpUnavailable } from '@/lib/mcp'
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'
import { toClientPlace } from '@/lib/places'
import type { Place } from '@/lib/types'
import {
  DEFAULT_SCORING_WEIGHTS,
  markPrioritized,
  sortPlacesByScore,
  visibilityShare,
} from '@/lib/priority'

export const runtime = 'nodejs'

const PutBody = z.object({
  local_bonus: z.number().min(0).max(1).optional(),
  accessible_bonus: z.number().min(0).max(1).optional(),
  confirmation_threshold: z.number().int().min(1).max(50).optional(),
})

function buildSampleSets(places: Place[], count = 10): Place[][] {
  if (places.length < 4) return []
  const sets: Place[][] = []
  const cats = [...new Set(places.map((p) => p.categories?.[0] || 'other'))]
  for (let i = 0; i < count; i++) {
    const cat = cats[i % cats.length] ?? 'other'
    const pool = places.filter((p) => (p.categories?.[0] || 'other') === cat)
    const source = pool.length >= 6 ? pool : places
    const start = (i * 7) % Math.max(1, source.length - 6)
    const slice = source.slice(start, start + 8 + (i % 3))
    if (slice.length >= 4) sets.push(slice)
  }
  while (sets.length < count && places.length >= 6) {
    const start = sets.length * 5
    sets.push(places.slice(start % places.length, (start % places.length) + 8))
  }
  return sets.slice(0, count)
}

function simulate(places: Place[], weights: { local_bonus: number; accessible_bonus: number }) {
  const sets = buildSampleSets(places)
  const topK = 3
  let localBefore = 0
  let localAfter = 0
  let accBefore = 0
  let accAfter = 0
  const rows = sets.map((set, idx) => {
    const before = visibilityShare(set, topK, true, { local_bonus: 0, accessible_bonus: 0 })
    const after = visibilityShare(set, topK, true, weights)
    localBefore += before.local
    localAfter += after.local
    accBefore += before.accessible
    accAfter += after.accessible
    const rankedBefore = sortPlacesByScore(set, true, { local_bonus: 0, accessible_bonus: 0 }).slice(0, topK)
    const rankedAfter = markPrioritized(set, true, weights).slice(0, topK)
    return {
      id: `set_${idx + 1}`,
      size: set.length,
      category: set[0]?.categories?.[0] ?? 'other',
      beforeTop: rankedBefore.map((p) => ({ id: p.place_id, name: p.name, local: !!p.local_business })),
      afterTop: rankedAfter.map((p) => ({
        id: p.place_id,
        name: p.name,
        local: !!p.local_business,
        prioritized: !!p.prioritized,
      })),
      visibilityBefore: before,
      visibilityAfter: after,
    }
  })
  const n = Math.max(1, rows.length)
  return {
    sampleCount: rows.length,
    topK,
    avgVisibility: {
      localBefore: Math.round((localBefore / n) * 100),
      localAfter: Math.round((localAfter / n) * 100),
      accessibleBefore: Math.round((accBefore / n) * 100),
      accessibleAfter: Math.round((accAfter / n) * 100),
    },
    sets: rows,
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'scoring-get' })
  if (!gate.ok) return gate.response

  try {
    const weights = await getScoringSettings()
    const sid = await mcpConnected()
    const DB = process.env.MONGODB_DATABASE ?? 'hodari'
    const raw = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'places',
        filter: { status: { $in: ['validated', null] } },
        projection: { photos: 0 },
        limit: 500,
      }),
    )
    const places = raw.map(toClientPlace).filter((p): p is NonNullable<ReturnType<typeof toClientPlace>> => p !== null)
    const simulation = simulate(places, weights)

    const res = NextResponse.json({
      weights,
      defaults: DEFAULT_SCORING_WEIGHTS,
      simulation,
    })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    console.error('[admin/scoring]', err)
    return NextResponse.json({ error: 'Could not load scoring.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'scoring-put' })
  if (!gate.ok) return gate.response

  const body = PutBody.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  }

  try {
    const before = await getScoringSettings()
    const after = await saveScoringSettings(body.data)
    await writeAudit({
      actor: gate.actor,
      action: 'scoring.update',
      targetType: 'admin_settings',
      targetId: 'scoring',
      before,
      after,
    })
    const res = NextResponse.json({ weights: after })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not save scoring.' }, { status: 500 })
  }
}
