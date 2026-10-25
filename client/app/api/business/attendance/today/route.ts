import { NextRequest, NextResponse } from 'next/server'
import { isMcpUnavailable } from '@/lib/mcp'
import { requestedPlace, resolveOwnedPlace } from '@/lib/business'
import { getSession } from '@/lib/session'
import { attendanceRoster, dayKey, ensureTeamIndexes } from '@/lib/team'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Today's roster. Polled by the dashboard when the live stream is down. */
export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  void ensureTeamIndexes()
  const date = dayKey()

  try {
    const employees = await attendanceRoster(sid, placeId, date)
    return NextResponse.json({ date, employees }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[attendance/today]', placeId, err)
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load today’s attendance.' }, { status: 500 })
  }
}
