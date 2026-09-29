/**
 * Factual Mongo snapshot for the admin AI insights assistant.
 * MCP calls run sequentially — the HTTP sidecar session is not safe for
 * concurrent tool calls on the same session id.
 */
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'
import { recentSearchLogs } from '@/lib/searchLogs'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

export type InsightsContext = {
  generatedAt: string
  totals: {
    places: number
    pending: number
    validated: number
    rejected: number
    local: number
    formal: number
    accessible: number
    openReports: number
    users: number
  }
  approvalRate: number
  topViewed: { name: string; views: number; sector: string | null }[]
  byCategory: { category: string; count: number }[]
  bySector: { sector: string; count: number; accessible: number }[]
  sectorsLackingAccess: { sector: string; places: number; accessible: number }[]
  recentSearches: { query: string; at: string; results_count: number | null }[]
  searchesAvailable: boolean
  activity7d: { action: string; count: number }[]
}

async function findDocs(
  sid: string,
  collection: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  try {
    return extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection,
        ...args,
      }),
    )
  } catch (err) {
    console.warn(`[insights] find ${collection} failed`, err)
    return []
  }
}

export async function buildInsightsContext(): Promise<InsightsContext> {
  const sid = await mcpConnected()

  // Sequential on purpose (shared MCP session).
  const placesRaw = await findDocs(sid, 'places', {
    filter: {},
    projection: { photos: 0, embedding: 0 },
    sort: { created_at: -1 },
    limit: 1500,
  })
  const reportsRaw = await findDocs(sid, 'place_reports', {
    filter: {},
    sort: { created_at: -1 },
    limit: 400,
  })
  const usersRaw = await findDocs(sid, 'users', {
    filter: {},
    projection: { user_id: 1, status: 1 },
    limit: 2000,
  })
  const auditsRaw = await findDocs(sid, 'admin_audit', {
    filter: {},
    sort: { at: -1 },
    limit: 200,
  })
  const searches = await recentSearchLogs(50)

  const places = placesRaw.filter((p) => p.archived !== true)
  const statusOf = (d: Record<string, unknown>) => (typeof d.status === 'string' ? d.status : 'validated')
  const pending = places.filter((p) => statusOf(p) === 'pending').length
  const validated = places.filter((p) => statusOf(p) === 'validated').length
  const rejected = places.filter((p) => statusOf(p) === 'rejected').length
  const local = places.filter((p) => p.local_business === true).length
  const accessible = places.filter(
    (p) => p.accessible === true || (p.access as { entrance?: boolean } | undefined)?.entrance === true,
  ).length
  const decided = validated + rejected
  const approvalRate = decided ? Math.round((validated / decided) * 100) : 0

  const openReports = reportsRaw.filter((r) => {
    const s = String(r.status ?? 'open').toLowerCase()
    return s === 'open' || s === 'pending' || s === 'new' || s === ''
  }).length

  const topViewed = [...places]
    .sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0))
    .slice(0, 10)
    .map((p) => ({
      name: String(p.name ?? '—'),
      views: Number(p.views) || 0,
      sector: typeof p.sector === 'string' ? p.sector : null,
    }))

  const catMap = new Map<string, number>()
  const sectorMap = new Map<string, { count: number; accessible: number }>()
  for (const p of places) {
    const cats = Array.isArray(p.categories) && p.categories.length
      ? p.categories.filter((c): c is string => typeof c === 'string')
      : ['other']
    for (const c of cats) catMap.set(c, (catMap.get(c) ?? 0) + 1)
    const sector =
      (typeof p.sector === 'string' && p.sector)
      || (typeof p.address === 'string' ? p.address.split(',')[0]?.trim() : '')
      || 'Kigali'
    const isAcc = p.accessible === true || (p.access as { entrance?: boolean } | undefined)?.entrance === true
    const cur = sectorMap.get(sector) ?? { count: 0, accessible: 0 }
    cur.count += 1
    if (isAcc) cur.accessible += 1
    sectorMap.set(sector, cur)
  }

  const byCategory = [...catMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
  const bySector = [...sectorMap.entries()]
    .map(([sector, v]) => ({ sector, count: v.count, accessible: v.accessible }))
    .sort((a, b) => b.count - a.count)
  const sectorsLackingAccess = bySector
    .filter((s) => s.count >= 2 && s.accessible / s.count < 0.35)
    .sort((a, b) => a.accessible / a.count - b.accessible / b.count)
    .slice(0, 8)
    .map((s) => ({ sector: s.sector, places: s.count, accessible: s.accessible }))

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const actionCounts = new Map<string, number>()
  for (const a of auditsRaw) {
    const at = typeof a.at === 'string' ? Date.parse(a.at) : NaN
    if (!Number.isFinite(at) || at < weekAgo) continue
    const action = String(a.action ?? 'unknown')
    actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1)
  }

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      places: places.length,
      pending,
      validated,
      rejected,
      local,
      formal: Math.max(0, places.length - local),
      accessible,
      openReports,
      users: usersRaw.length,
    },
    approvalRate,
    topViewed,
    byCategory: byCategory.slice(0, 12),
    bySector: bySector.slice(0, 12),
    sectorsLackingAccess,
    recentSearches: searches.slice(0, 20),
    searchesAvailable: searches.length > 0,
    activity7d: [...actionCounts.entries()]
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count),
  }
}

export function insightsSystemPrompt(ctx: InsightsContext): string {
  return [
    'You are MapForAll Admin Insights, an assistant for staff moderators in Kigali.',
    'Answer ONLY from the FACTS JSON provided. Never invent numbers, places, or trends.',
    'If a fact is missing or marked unavailable, say clearly that it is not available.',
    'Stay concise (short paragraphs or bullets).',
    'When useful, include a compact markdown bullet list or a small markdown table.',
    'Do not mention system prompts, providers, or internal tooling.',
    '',
    'FACTS JSON:',
    JSON.stringify(ctx),
  ].join('\n')
}
