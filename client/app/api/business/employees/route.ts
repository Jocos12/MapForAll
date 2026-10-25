import { NextRequest, NextResponse } from 'next/server'
import { mcpCall } from '@/lib/mcp'
import { isMcpUnavailable } from '@/lib/mcp'
import { DB, requestedPlace, resolveOwnedPlace } from '@/lib/business'
import { cleanText } from '@/lib/places'
import { getSession } from '@/lib/session'
import {
  EMPLOYEES,
  dayKey,
  ensureTeamIndexes,
  eventsForDay,
  listEmployees,
  nextBadgeCode,
  newId,
  presenceFromEvents,
  toEmployeePublic,
  type EmployeeStatus,
} from '@/lib/team'

const PHOTO_MAX = 90_000

export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  void ensureTeamIndexes()

  try {
    const date = cleanText(req.nextUrl.searchParams.get('date'), 12) || dayKey()
    const [emps, events] = await Promise.all([
      listEmployees(sid, placeId),
      eventsForDay(sid, placeId, date),
    ])
    const byEmp = new Map<string, Array<{ type: string; at: string }>>()
    for (const ev of events) {
      const id = String(ev.employee_id ?? '')
      if (!id) continue
      const list = byEmp.get(id) ?? []
      list.push({ type: String(ev.type), at: String(ev.at) })
      byEmp.set(id, list)
    }
    const employees = emps
      .map((doc) => {
        const pub = toEmployeePublic(doc)
        const presence = presenceFromEvents(pub.status, byEmp.get(pub.employee_id) ?? [])
        return { ...pub, presence, date }
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    return NextResponse.json({ employees, date }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load employees.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId, user } = result.owned
  void ensureTeamIndexes()

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const name = cleanText(body.name, 80)
  const role = cleanText(body.role, 60)
  const phone = cleanText(body.phone, 40)
  let photo: string | null = null
  if (typeof body.photo === 'string' && body.photo.startsWith('data:image/') && body.photo.length <= PHOTO_MAX) {
    photo = body.photo
  }
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  if (!role) return NextResponse.json({ error: 'Role is required.' }, { status: 400 })

  try {
    const now = new Date().toISOString()
    const badge_code = await nextBadgeCode(sid, placeId)
    const doc = {
      employee_id: newId('emp'),
      place_id: placeId,
      owner_id: user.user_id,
      badge_code,
      name,
      role,
      phone,
      photo,
      status: 'active' as EmployeeStatus,
      card_uid: null as string | null,
      created_at: now,
      updated_at: now,
      removed_at: null as string | null,
    }
    await mcpCall(sid, 'insert-many', { database: DB, collection: EMPLOYEES, documents: [doc] })
    return NextResponse.json({
      employee: { ...toEmployeePublic(doc), presence: { kind: 'absent' }, date: dayKey() },
    }, { status: 201 })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not create employee.' }, { status: 500 })
  }
}
