import { NextRequest, NextResponse } from 'next/server'
import { isMcpUnavailable } from '@/lib/mcp'
import { requestedPlace, resolveOwnedPlace } from '@/lib/business'
import { cleanText } from '@/lib/places'
import { getSession } from '@/lib/session'
import {
  attendanceRoster,
  dayKey,
  ensureTeamIndexes,
  eventsForEmployeeDay,
  findEmployeeRecord,
  recordAttendancePunch,
  toAttendanceRef,
  toEmployeePublic,
} from '@/lib/team'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** Today's roster with live presence + punch actions. */
export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  void ensureTeamIndexes()
  const date = cleanText(req.nextUrl.searchParams.get('date'), 12) || dayKey()

  try {
    const employees = await attendanceRoster(sid, placeId, date)
    return NextResponse.json({ date, employees }, { headers: NO_STORE })
  } catch (err) {
    console.error('[attendance GET]', placeId, date, err)
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({
      error: 'Could not load today’s attendance. Check MongoDB MCP and try again.',
    }, { status: 500 })
  }
}

/** Manual clock in / out — same toggle and cooldown as an RFID scan. */
export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const employeeId = cleanText(body.employeeId ?? body.employee_id, 80)
  if (!employeeId) return NextResponse.json({ error: 'Missing employee.' }, { status: 400 })

  try {
    const today = dayKey()
    const [row, prior] = await Promise.all([
      findEmployeeRecord(sid, placeId, employeeId),
      eventsForEmployeeDay(sid, placeId, employeeId, today),
    ])
    if (!row) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })
    const punch = await recordAttendancePunch(
      sid,
      placeId,
      toAttendanceRef(row),
      'manual',
      null,
      prior.map((e) => ({ type: String(e.type), at: String(e.at) })),
    )
    if (!punch.ok) {
      return NextResponse.json({ ok: false, error: punch.error }, { status: punch.httpStatus, headers: NO_STORE })
    }
    if (punch.type === 'duplicate') {
      return NextResponse.json({
        ok: true,
        type: 'duplicate',
        name: punch.name,
        message: punch.message,
        presence: punch.presence,
        employee: toEmployeePublic(row),
      }, { headers: NO_STORE })
    }
    return NextResponse.json({
      ok: true,
      type: punch.type,
      message: punch.message,
      event: { ...punch.event, time: punch.time },
      presence: punch.presence,
      employee: toEmployeePublic(row),
    }, { headers: NO_STORE })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    console.error('[attendance POST]', err)
    return NextResponse.json({ error: 'Could not record attendance.' }, { status: 500 })
  }
}
