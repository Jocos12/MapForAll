import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'

export const runtime = 'nodejs'

/** Lightweight SSE: new pending places & open reports since connect. */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'events' })
  if (!gate.ok) return gate.response

  const since = req.nextUrl.searchParams.get('since') ?? new Date(Date.now() - 60_000).toISOString()
  const encoder = new TextEncoder()
  const DB = process.env.MONGODB_DATABASE ?? 'hodari'

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      send('ready', { since })

      let alive = true
      req.signal.addEventListener('abort', () => {
        alive = false
        controller.close()
      })

      while (alive) {
        try {
          const sid = await mcpConnected()
          const pending = extractDocs(
            await mcpCall(sid, 'find', {
              database: DB,
              collection: 'places',
              filter: { status: 'pending', created_at: { $gte: since } },
              sort: { created_at: -1 },
              limit: 5,
            }),
          )
          if (pending.length) {
            send('places', {
              count: pending.length,
              items: pending.map((p) => ({
                id: String(p.place_id ?? ''),
                name: String(p.name ?? ''),
                at: p.created_at,
              })),
            })
          }
        } catch {
          send('error', { message: 'poll_failed' })
        }
        await new Promise((r) => setTimeout(r, 12_000))
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
