import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { DB, loadConfirmationThreshold, type ExistsSummaryRow } from '@/lib/adminReviews'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'reviews-exists' })
  if (!gate.ok) return gate.response
  try {
    const sid = await mcpConnected()
    const threshold = await loadConfirmationThreshold(sid, mcpCall, extractDocs)
    let counts: ExistsSummaryRow[] = []
    try {
      const grouped = extractDocs(
        await mcpCall(sid, 'aggregate', {
          database: DB,
          collection: 'place_exists',
          pipeline: [
            { $match: { exists: { $ne: false } } },
            { $group: { _id: '$place_id', confirmations: { $sum: 1 } } },
            { $sort: { confirmations: -1 } },
            { $limit: 200 },
          ],
        }),
      )
      const placeIds = grouped.map((g) => (typeof g._id === 'string' ? g._id : '')).filter(Boolean)
      const places = placeIds.length
        ? extractDocs(
            await mcpCall(sid, 'find', {
              database: DB,
              collection: 'places',
              filter: { place_id: { $in: placeIds } },
              projection: { place_id: 1, name: 1 },
              limit: 200,
            }),
          )
        : []
      const names = new Map(
        places.map((p) => [typeof p.place_id === 'string' ? p.place_id : '', typeof p.name === 'string' ? p.name : '']),
      )
      counts = grouped
        .map((g) => {
          const place_id = typeof g._id === 'string' ? g._id : ''
          const confirmations = typeof g.confirmations === 'number' ? g.confirmations : 0
          if (!place_id) return null
          return {
            place_id,
            place_name: names.get(place_id) || place_id,
            confirmations,
            meets_threshold: confirmations >= threshold,
          }
        })
        .filter((r): r is ExistsSummaryRow => !!r)
    } catch {
      const docs = extractDocs(
        await mcpCall(sid, 'find', { database: DB, collection: 'place_exists', limit: 2000 }),
      )
      const map = new Map<string, number>()
      for (const d of docs) {
        if (d.exists === false) continue
        const pid = typeof d.place_id === 'string' ? d.place_id : typeof d.placeId === 'string' ? d.placeId : ''
        if (!pid) continue
        map.set(pid, (map.get(pid) ?? 0) + 1)
      }
      counts = [...map.entries()]
        .map(([place_id, confirmations]) => ({
          place_id,
          place_name: place_id,
          confirmations,
          meets_threshold: confirmations >= threshold,
        }))
        .sort((a, b) => b.confirmations - a.confirmations)
        .slice(0, 200)
    }
    return withSessionRefresh(
      NextResponse.json({ threshold, items: counts }),
      gate.refreshedCookie,
    )
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load confirmations.' }, { status: 500 })
  }
}
