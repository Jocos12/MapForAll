import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { ensureAdminIndexes } from '@/lib/adminIndexes'
import { toClientPlace } from '@/lib/places'

export const runtime = 'nodejs'

const Query = z.object({
  range: z.enum(['7', '30', '90', 'custom']).optional().default('30'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

const SECTOR_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  Nyarugenge: { lat: -1.944, lng: 30.061 },
  Nyamirambo: { lat: -1.978, lng: 30.045 },
  Muhima: { lat: -1.937, lng: 30.059 },
  Kimihurura: { lat: -1.949, lng: 30.089 },
  Kacyiru: { lat: -1.944, lng: 30.092 },
  Remera: { lat: -1.957, lng: 30.108 },
  Gisozi: { lat: -1.931, lng: 30.061 },
  Kimironko: { lat: -1.95, lng: 30.126 },
  Kicukiro: { lat: -1.978, lng: 30.105 },
  Gatenga: { lat: -1.99, lng: 30.1 },
  Gikondo: { lat: -1.97, lng: 30.085 },
  Kibagabaga: { lat: -1.935, lng: 30.11 },
}

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

function daysBetween(from: Date, to: Date): string[] {
  const out: string[] = []
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

function trendPct(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}

function resolveWindow(range: string, fromStr?: string, toStr?: string) {
  const to = toStr ? new Date(toStr) : new Date()
  let from: Date
  if (range === 'custom' && fromStr) {
    from = new Date(fromStr)
  } else {
    const days = range === '7' ? 7 : range === '90' ? 90 : 30
    from = new Date(to)
    from.setUTCDate(from.getUTCDate() - days)
  }
  const ms = to.getTime() - from.getTime()
  const prevTo = new Date(from.getTime())
  const prevFrom = new Date(from.getTime() - ms)
  return { from, to, prevFrom, prevTo }
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'stats' })
  if (!gate.ok) return gate.response
  ensureAdminIndexes()

  const parsed = Query.safeParse({
    range: req.nextUrl.searchParams.get('range') ?? '30',
    from: req.nextUrl.searchParams.get('from') ?? undefined,
    to: req.nextUrl.searchParams.get('to') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query.' }, { status: 400 })
  }

  const { from, to, prevFrom, prevTo } = resolveWindow(
    parsed.data.range,
    parsed.data.from,
    parsed.data.to,
  )

  try {
    const sid = await mcpConnected()
    const DB = process.env.MONGODB_DATABASE ?? 'hodari'

    const placeTexts = await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter: {},
      projection: { photos: 0 },
      limit: 2000,
    })
    const rawPlaces = extractDocs(placeTexts)
    const docs = rawPlaces.map(toClientPlace).filter((p): p is NonNullable<typeof p> => p !== null)

    const inRange = (iso: string | undefined, a: Date, b: Date) => {
      if (!iso) return false
      const t = Date.parse(iso)
      return Number.isFinite(t) && t >= a.getTime() && t <= b.getTime()
    }

    const pending = docs.filter((p) => p.status === 'pending')
    const validated = docs.filter((p) => p.status === 'validated' || !p.status)
    const rejected = docs.filter((p) => p.status === 'rejected')
    const decided = validated.length + rejected.length

    const validatedIn = validated.filter((p) => inRange(p.created_at, from, to)).length
    const validatedPrev = validated.filter((p) => inRange(p.created_at, prevFrom, prevTo)).length
    const pendingNow = pending.length
    const pendingPrev = rawPlaces.filter((d) => {
      const st = d.status ?? 'validated'
      return st === 'pending' && inRange(typeof d.created_at === 'string' ? d.created_at : undefined, prevFrom, prevTo)
    }).length
    const local = docs.filter((p) => p.local_business).length
    const accessible = docs.filter((p) => p.accessible).length
    const localPrev = docs.filter((p) => p.local_business && inRange(p.created_at, prevFrom, prevTo)).length
    const accPrev = docs.filter((p) => p.accessible && inRange(p.created_at, prevFrom, prevTo)).length

    let users: Record<string, unknown>[] = []
    try {
      users = extractDocs(
        await mcpCall(sid, 'find', {
          database: DB,
          collection: 'users',
          filter: {},
          projection: { user_id: 1, status: 1, created_at: 1, last_active_at: 1 },
          limit: 5000,
        }),
      )
    } catch { /* optional */ }

    const activeUsers = users.filter((u) => u.status !== 'suspended').length
    const usersIn = users.filter((u) => inRange(typeof u.created_at === 'string' ? u.created_at : undefined, from, to)).length
    const usersPrev = users.filter((u) => inRange(typeof u.created_at === 'string' ? u.created_at : undefined, prevFrom, prevTo)).length

    let reports: Record<string, unknown>[] = []
    try {
      reports = extractDocs(
        await mcpCall(sid, 'find', {
          database: DB,
          collection: 'place_reports',
          filter: {},
          limit: 1000,
        }),
      )
    } catch { /* may not exist */ }

    const openReports = reports.filter((r) => {
      const s = r.status
      return s === 'open' || s === 'pending' || s == null
    })
    const openIn = openReports.filter((r) => inRange(typeof r.created_at === 'string' ? r.created_at : undefined, from, to)).length
    const openPrev = reports.filter((r) => {
      const s = r.status
      const open = s === 'open' || s === 'pending' || s == null
      return open && inRange(typeof r.created_at === 'string' ? r.created_at : undefined, prevFrom, prevTo)
    }).length

    // Charts — places added over time
    const dayKeys = daysBetween(from, to)
    const addedByDay: Record<string, number> = Object.fromEntries(dayKeys.map((k) => [k, 0]))
    for (const p of docs) {
      if (!p.created_at) continue
      const k = dayKey(p.created_at)
      if (k in addedByDay) addedByDay[k] += 1
    }
    const placesOverTime = dayKeys.map((date) => ({ date, count: addedByDay[date] ?? 0 }))

    // Category donut
    const catCount: Record<string, number> = {}
    for (const p of docs) {
      const c = p.categories?.[0] || 'other'
      catCount[c] = (catCount[c] ?? 0) + 1
    }
    const byCategory = Object.entries(catCount)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    // Stacked local / formal / accessible by category top 6
    const topCats = byCategory.slice(0, 6).map((c) => c.name)
    const localFormalAccessible = topCats.map((name) => {
      const subset = docs.filter((p) => (p.categories?.[0] || 'other') === name)
      return {
        name,
        local: subset.filter((p) => p.local_business).length,
        formal: subset.filter((p) => !p.local_business).length,
        accessible: subset.filter((p) => p.accessible).length,
      }
    })

    // Users growth
    const usersByDay: Record<string, number> = Object.fromEntries(dayKeys.map((k) => [k, 0]))
    for (const u of users) {
      const created = typeof u.created_at === 'string' ? u.created_at : ''
      if (!created) continue
      const k = dayKey(created)
      if (k in usersByDay) usersByDay[k] += 1
    }
    let running = users.filter((u) => {
      const created = typeof u.created_at === 'string' ? Date.parse(u.created_at) : NaN
      return Number.isFinite(created) && created < from.getTime()
    }).length
    const usersGrowth = dayKeys.map((date) => {
      running += usersByDay[date] ?? 0
      return { date, count: running }
    })

    // Top viewed
    const topViewed = [...docs]
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
      .slice(0, 8)
      .map((p) => ({ name: p.name, views: p.views ?? 0, place_id: p.place_id }))

    // By sector
    const sectorCount: Record<string, number> = {}
    for (const raw of rawPlaces) {
      const sector =
        (typeof raw.sector === 'string' && raw.sector) ||
        (typeof raw.address === 'string' && raw.address.split(',')[0]?.trim()) ||
        'Kigali'
      sectorCount[sector] = (sectorCount[sector] ?? 0) + 1
    }
    const bySector = Object.entries(sectorCount)
      .map(([sector, count]) => {
        const c = SECTOR_CENTROIDS[sector] ?? { lat: -1.953, lng: 30.09 }
        return { sector, count, lat: c.lat, lng: c.lng }
      })
      .sort((a, b) => b.count - a.count)

    // Queue
    const pendingPlaces = pending.slice(0, 6).map((p) => ({
      id: p.place_id,
      name: p.name,
      created_at: p.created_at ?? '',
      local: !!p.local_business,
    }))
    const urgentReports = openReports
      .filter((r) => r.priority === 'urgent' || r.priority === 'high')
      .slice(0, 5)
      .map((r) => ({
        id: String(r.report_id ?? r._id ?? ''),
        place_name: String(r.place_name ?? r.place_id ?? '—'),
        type: String(r.type ?? 'other'),
        created_at: typeof r.created_at === 'string' ? r.created_at : '',
      }))
    const businessesToVerify = docs
      .filter((p) => p.source === 'owner_claimed' && p.status === 'pending')
      .slice(0, 5)
      .map((p) => ({ id: p.place_id, name: p.name }))

    // Activity from audit
    let activity: { id: string; action: string; at: string; actor: string; target: string }[] = []
    try {
      const auditDocs = extractDocs(
        await mcpCall(sid, 'find', {
          database: DB,
          collection: 'admin_audit',
          filter: {},
          sort: { at: -1 },
          limit: 15,
        }),
      )
      activity = auditDocs.map((a, i) => ({
        id: String(a.audit_id ?? a._id ?? `act-${i}-${typeof a.at === 'string' ? a.at : ''}`),
        action: String(a.action ?? ''),
        at: typeof a.at === 'string' ? a.at : '',
        actor: String(a.actor_email ?? a.actor_uid ?? ''),
        target: String(a.target_id ?? ''),
        targetType: String(a.target_type ?? ''),
      }))
    } catch { /* optional */ }

    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD)

    const res = NextResponse.json({
      range: parsed.data.range,
      from: from.toISOString(),
      to: to.toISOString(),
      stats: {
        total: docs.length,
        pending: pendingNow,
        validated: validated.length,
        rejected: rejected.length,
        local,
        accessible,
        approvalRate: decided ? Math.round((validated.length / decided) * 100) : 0,
        activeUsers,
        openReports: openReports.length,
        trends: {
          validated: { value: validatedIn, prev: validatedPrev, deltaPct: trendPct(validatedIn, validatedPrev) },
          pending: { value: pendingNow, prev: pendingPrev, deltaPct: trendPct(pendingNow, pendingPrev) },
          local: { value: local, prev: localPrev, deltaPct: trendPct(local, Math.max(localPrev, 1)) },
          accessible: { value: accessible, prev: accPrev, deltaPct: trendPct(accessible, Math.max(accPrev, 1)) },
          users: { value: usersIn, prev: usersPrev, deltaPct: trendPct(usersIn, usersPrev) },
          reports: { value: openIn, prev: openPrev, deltaPct: trendPct(openIn, openPrev) },
        },
      },
      charts: {
        placesOverTime,
        approvalGauge: decided ? Math.round((validated.length / decided) * 100) : 0,
        byCategory,
        localFormalAccessible,
        usersGrowth,
        topViewed,
        bySector,
      },
      queue: {
        pendingPlaces,
        urgentReports,
        businessesToVerify,
      },
      activity,
      health: {
        db: 'ok' as const,
        smtp: smtpConfigured ? ('ok' as const) : ('check' as const),
        lastBackup: null as string | null,
      },
    })
    res.headers.set('Cache-Control', 'private, max-age=15')
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    console.error('[admin/stats]', err)
    return NextResponse.json({ error: 'Could not load stats.' }, { status: 500 })
  }
}
