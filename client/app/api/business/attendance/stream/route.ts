import { NextRequest } from 'next/server'
import { subscribe } from '@/lib/attendanceEvents'
import { requestedPlace, resolveOwnedPlace } from '@/lib/business'
import { getSession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Live attendance events for the signed-in owner's business. */
export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { placeId } = result.owned

  const encoder = new TextEncoder()
  let cleanup = () => {}

  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }
      const unsub = subscribe(placeId, (event) => {
        send(`data: ${JSON.stringify(event)}\n\n`)
      })
      const heartbeat = setInterval(() => send(': heartbeat\n\n'), 15_000)
      cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unsub()
        try { controller.close() } catch { /* already closed */ }
      }
      send(': heartbeat\n\n')
      req.signal.addEventListener('abort', cleanup)
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
