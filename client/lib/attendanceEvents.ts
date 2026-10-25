/**
 * In-process attendance bus. Stored on globalThis so Next.js dev reloads
 * keep publishers (scan route) and subscribers (SSE route) on the same object.
 * One Cloud Run instance delivers events to browsers connected to that instance;
 * other instances fall back to the dashboard's short poll.
 */

export interface AttendanceLiveEvent {
  id: string
  type: 'in' | 'out' | 'unknown_card'
  employeeId: string
  name: string
  badgeCode: string
  time: string
  at: string
  message: string
  /** Set for unknown_card so the dashboard can prefill the link form. */
  uid?: string
  /** Shift length label for an "out" event, e.g. "2h48". */
  worked?: string
}

type Listener = (event: AttendanceLiveEvent) => void

interface AttendanceBus {
  subs: Map<string, Set<Listener>>
}

const BUS_KEY = '__hodariAttendanceBus'

function bus(): AttendanceBus {
  const g = globalThis as typeof globalThis & { [BUS_KEY]?: AttendanceBus }
  if (!g[BUS_KEY]) g[BUS_KEY] = { subs: new Map() }
  return g[BUS_KEY]
}

export function publish(businessId: string, event: AttendanceLiveEvent): void {
  const set = bus().subs.get(businessId)
  if (!set || set.size === 0) return
  for (const cb of set) {
    try {
      cb(event)
    } catch (err) {
      console.error('[attendance] subscriber failed', err)
    }
  }
}

/** Returns an unsubscribe function. Safe to call more than once. */
export function subscribe(businessId: string, cb: Listener): () => void {
  const subs = bus().subs
  let set = subs.get(businessId)
  if (!set) {
    set = new Set()
    subs.set(businessId, set)
  }
  set.add(cb)
  let active = true
  return () => {
    if (!active) return
    active = false
    set.delete(cb)
    if (set.size === 0) subs.delete(businessId)
  }
}
