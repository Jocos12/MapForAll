'use client'

export type TrackKind = 'view' | 'impression' | 'route' | 'call' | 'website' | 'save'
export type TrackSource = 'map' | 'chat' | 'search' | 'link'

const queue: Array<{ placeId: string; kind: TrackKind; source: TrackSource; eventId: string }> = []
let timer = 0

function send(events: typeof queue) {
  if (!events.length) return
  const body = JSON.stringify({ events })
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon('/api/places/view', blob)) return
  }
  void fetch('/api/places/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
}

/** Fire-and-forget. Views go immediately; impressions are batched. */
export function trackPlace(placeId: string, kind: TrackKind, source: TrackSource = 'map') {
  if (!/^[A-Za-z0-9][A-Za-z0-9_:-]{1,120}$/.test(placeId)) return
  const event = { placeId, kind, source, eventId: crypto.randomUUID() }
  if (kind === 'impression') {
    queue.push(event)
    if (!timer) timer = window.setTimeout(() => { const batch = queue.splice(0); timer = 0; send(batch) }, 3000)
    return
  }
  send([event])
}
