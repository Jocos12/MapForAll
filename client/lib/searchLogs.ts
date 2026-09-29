/**
 * Anonymous search / chat-query logs for admin insights.
 * No user id or IP stored — only a coarse day bucket + city.
 */
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'
const COLLECTION = 'search_logs'

export async function logSearchQuery(input: {
  query: string
  resultsCount?: number | null
  city?: string
}): Promise<void> {
  const query = input.query.replace(/\s+/g, ' ').trim().slice(0, 280)
  if (query.length < 2) return
  try {
    const sid = await mcpConnected()
    await mcpCall(sid, 'insert-many', {
      database: DB,
      collection: COLLECTION,
      documents: [{
        query,
        at: new Date().toISOString(),
        day: new Date().toISOString().slice(0, 10),
        results_count: typeof input.resultsCount === 'number' ? input.resultsCount : null,
        city: input.city ?? 'Kigali',
      }],
    })
  } catch (err) {
    console.warn('[search_logs] write skipped', err)
  }
}

export async function recentSearchLogs(limit = 40): Promise<{ query: string; at: string; results_count: number | null }[]> {
  try {
    const sid = await mcpConnected()
    const docs = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: COLLECTION,
        filter: {},
        sort: { at: -1 },
        limit,
      }),
    )
    return docs.map((d) => ({
      query: String(d.query ?? ''),
      at: typeof d.at === 'string' ? d.at : '',
      results_count: typeof d.results_count === 'number' ? d.results_count : null,
    }))
  } catch {
    return []
  }
}
