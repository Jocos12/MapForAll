import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall } from '@/lib/mcp'
import { DB, requestedPlace, resolveOwnedPlace } from '@/lib/business'
import { cleanText } from '@/lib/places'
import { getSession } from '@/lib/session'
import {
  ATTENDANCE,
  dayKey,
  ensureTeamIndexes,
  hoursLabel,
  listEmployees,
  toEmployeePublic,
  workedMs,
} from '@/lib/team'

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Hours worked per employee for week/month reports + CSV-ready rows. */
export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  void ensureTeamIndexes()

  const range = cleanText(req.nextUrl.searchParams.get('range'), 12) || 'week'
  const end = cleanText(req.nextUrl.searchParams.get('end'), 12) || dayKey()
  const start = range === 'month' ? addDays(end, -29) : addDays(end, -6)

  try {
    const [emps, events] = await Promise.all([
      listEmployees(sid, placeId, true),
      extractDocs(await mcpCall(sid, 'find', {
        database: DB,
        collection: ATTENDANCE,
        filter: { place_id: placeId, date: { $gte: start, $lte: end } },
        projection: { _id: 0, employee_id: 1, type: 1, at: 1, date: 1 },
        limit: 10_000,
      })),
    ])

    const active = emps.filter((e) => e.status !== 'removed')
    const byEmp = new Map<string, Array<{ type: string; at: string; date: string }>>()
    for (const ev of events) {
      const id = String(ev.employee_id ?? '')
      if (!id) continue
      const list = byEmp.get(id) ?? []
      list.push({ type: String(ev.type), at: String(ev.at), date: String(ev.date) })
      byEmp.set(id, list)
    }

    const rows = active.map((doc) => {
      const pub = toEmployeePublic(doc)
      const evs = byEmp.get(pub.employee_id) ?? []
      const ms = workedMs(evs)
      const byDay: Record<string, number> = {}
      const days = new Set(evs.map((e) => e.date))
      for (const day of days) {
        byDay[day] = workedMs(evs.filter((e) => e.date === day), `${day}T23:59:59.999Z`)
      }
      return {
        ...pub,
        hours_ms: ms,
        hours: hoursLabel(ms),
        hours_decimal: Math.round((ms / 3_600_000) * 100) / 100,
        days_worked: Object.values(byDay).filter((v) => v > 0).length,
        by_day: byDay,
      }
    }).sort((a, b) => b.hours_ms - a.hours_ms)

    return NextResponse.json({
      start,
      end,
      range,
      employees: rows,
      chart: rows.map((r) => ({ name: r.name, hours: r.hours_decimal, badge: r.badge_code })),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load report.' }, { status: 500 })
  }
}
