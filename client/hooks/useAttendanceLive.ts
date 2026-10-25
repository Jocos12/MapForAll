'use client'

import { useEffect, useRef } from 'react'
import type { AttendanceLiveEvent } from '@/lib/attendanceEvents'
import { withPlace } from '@/components/business/types'

export type { AttendanceLiveEvent }

interface PunchRow {
  type: string
  at: string
}

interface Presence {
  kind: string
  since?: string
  at?: string
}

/** Roster row from GET /api/business/attendance/today. Extra fields are preserved by the caller. */
export interface LiveRosterRow {
  employee_id: string
  name: string
  badge_code: string
  status: string
  presence?: Presence
  punches?: PunchRow[]
  nextAction?: 'in' | 'out'
  canPunch?: boolean
}

interface Handlers {
  onEvent: (event: AttendanceLiveEvent) => void
  onRoster: (rows: LiveRosterRow[]) => void
}

function kigaliTime(iso: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Kigali',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(iso))
    let hh = parts.find((p) => p.type === 'hour')?.value ?? '00'
    const mm = parts.find((p) => p.type === 'minute')?.value ?? '00'
    if (hh === '24') hh = '00'
    return `${hh}:${mm}`
  } catch {
    return iso.slice(11, 16)
  }
}

function presenceSig(row: LiveRosterRow): string {
  const p = row.presence
  if (!p || p.kind === 'absent') return 'absent'
  if (p.kind === 'present') return `present:${p.since ?? ''}`
  if (p.kind === 'left') return `left:${p.at ?? ''}`
  return p.kind
}

function hoursBetween(fromIso: string, toIso: string): string | undefined {
  const ms = Date.parse(toIso) - Date.parse(fromIso)
  if (!Number.isFinite(ms) || ms < 0) return undefined
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h${String(m).padStart(2, '0')}`
}

function eventFromChange(row: LiveRosterRow, sig: string): AttendanceLiveEvent | null {
  const p = row.presence
  if (!p) return null
  if (sig.startsWith('present:') && p.since) {
    return {
      id: `poll_in_${row.employee_id}_${p.since}`,
      type: 'in',
      employeeId: row.employee_id,
      name: row.name,
      badgeCode: row.badge_code,
      time: kigaliTime(p.since),
      at: p.since,
      message: `${row.name} arrived at ${kigaliTime(p.since)}`,
    }
  }
  if (sig.startsWith('left:') && p.at) {
    const open = [...(row.punches ?? [])]
      .filter((punch) => punch.type === 'in' && punch.at <= p.at!)
      .sort((a, b) => a.at.localeCompare(b.at))
      .pop()
    const worked = open ? hoursBetween(open.at, p.at) : undefined
    return {
      id: `poll_out_${row.employee_id}_${p.at}`,
      type: 'out',
      employeeId: row.employee_id,
      name: row.name,
      badgeCode: row.badge_code,
      time: kigaliTime(p.at),
      at: p.at,
      message: worked
        ? `${row.name} left at ${kigaliTime(p.at)} (worked ${worked})`
        : `${row.name} left at ${kigaliTime(p.at)}`,
      ...(worked ? { worked } : {}),
    }
  }
  return null
}

/**
 * Live attendance for one business.
 * Prefers the SSE stream and reconnects with backoff. While the stream is down,
 * polls today's roster every 2s and emits a diff so the page still updates.
 */
export function useAttendanceLive(placeId: string, handlers: Handlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!placeId) return
    let closed = false
    let es: EventSource | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let sseOpen = false
    let haveBaseline = false
    const snap = new Map<string, string>()

    const stopPoll = () => {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }

    const pollOnce = async () => {
      if (closed || sseOpen) return
      try {
        const res = await fetch(withPlace('/api/business/attendance/today', placeId), { cache: 'no-store' })
        if (!res.ok || closed || sseOpen) return
        const json = await res.json() as { employees?: LiveRosterRow[] }
        const rows = json.employees ?? []
        const changes: AttendanceLiveEvent[] = []
        for (const row of rows) {
          const sig = presenceSig(row)
          const prev = snap.get(row.employee_id)
          snap.set(row.employee_id, sig)
          if (!haveBaseline || prev === sig) continue
          if (prev === undefined && !sig.startsWith('present:') && !sig.startsWith('left:')) continue
          const ev = eventFromChange(row, sig)
          if (ev) changes.push(ev)
        }
        haveBaseline = true
        handlersRef.current.onRoster(rows)
        if (!sseOpen) {
          for (const ev of changes) handlersRef.current.onEvent(ev)
        }
      } catch {
        /* next tick retries */
      }
    }

    const startPoll = () => {
      if (pollTimer || closed) return
      void pollOnce()
      pollTimer = setInterval(() => { void pollOnce() }, 2000)
    }

    const connect = () => {
      if (closed) return
      es?.close()
      const source = new EventSource(withPlace('/api/business/attendance/stream', placeId))
      es = source
      let handledError = false
      source.onopen = () => {
        sseOpen = true
        attempt = 0
        stopPoll()
      }
      source.onmessage = (msg) => {
        let ev: AttendanceLiveEvent
        try {
          ev = JSON.parse(msg.data) as AttendanceLiveEvent
        } catch {
          return
        }
        if (!ev || (ev.type !== 'in' && ev.type !== 'out' && ev.type !== 'unknown_card')) return
        if (ev.type === 'in') snap.set(ev.employeeId, `present:${ev.at}`)
        else if (ev.type === 'out') snap.set(ev.employeeId, `left:${ev.at}`)
        handlersRef.current.onEvent(ev)
      }
      source.onerror = () => {
        if (handledError) return
        handledError = true
        sseOpen = false
        source.close()
        if (es === source) es = null
        if (closed) return
        startPoll()
        const wait = Math.min(10_000, 400 * 2 ** attempt)
        attempt = Math.min(attempt + 1, 6)
        if (retryTimer) clearTimeout(retryTimer)
        retryTimer = setTimeout(connect, wait)
      }
    }

    connect()
    return () => {
      closed = true
      sseOpen = false
      stopPoll()
      if (retryTimer) clearTimeout(retryTimer)
      es?.close()
    }
  }, [placeId])
}
