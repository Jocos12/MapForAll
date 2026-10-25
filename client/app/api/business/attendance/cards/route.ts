import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall } from '@/lib/mcp'
import { DB, requestedPlace, resolveOwnedPlace } from '@/lib/business'
import { cleanText } from '@/lib/places'
import { getSession } from '@/lib/session'
import { EMPLOYEES, ensureTeamIndexes, findActiveEmployee, invalidateEmployeeCache, toEmployeePublic } from '@/lib/team'

/** List card associations for the active place. */
export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  void ensureTeamIndexes()

  try {
    const rows = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: EMPLOYEES,
      filter: { place_id: placeId, status: { $ne: 'removed' }, card_uid: { $ne: null } },
      projection: { _id: 0, employee_id: 1, name: 1, badge_code: 1, card_uid: 1, role: 1 },
      limit: 200,
    }))
    return NextResponse.json({
      cards: rows.map((r) => ({
        employee_id: String(r.employee_id),
        name: String(r.name ?? ''),
        badge_code: String(r.badge_code ?? ''),
        role: String(r.role ?? ''),
        card_uid: String(r.card_uid ?? ''),
      })),
    })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load cards.' }, { status: 500 })
  }
}

/** Associate a scanned RFID UID with an employee (one card per employee). */
export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const employeeId = cleanText(body.employeeId ?? body.employee_id, 80)
  const uid = cleanText(body.uid ?? body.card_uid, 64).toUpperCase()
  if (!employeeId || !uid) return NextResponse.json({ error: 'employeeId and uid required.' }, { status: 400 })

  try {
    const emp = await findActiveEmployee(sid, placeId, employeeId)
    if (!emp) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })

    const taken = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: EMPLOYEES,
      filter: { place_id: placeId, card_uid: uid, employee_id: { $ne: employeeId }, status: { $ne: 'removed' } },
      limit: 1,
    }))[0]
    if (taken) {
      return NextResponse.json({ error: 'This card is already linked to another employee.' }, { status: 409 })
    }

    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: EMPLOYEES,
      filter: { place_id: placeId, employee_id: employeeId },
      update: { $set: { card_uid: uid, updated_at: new Date().toISOString() } },
    })
    invalidateEmployeeCache(placeId, typeof emp.card_uid === 'string' ? emp.card_uid : null)
    invalidateEmployeeCache(placeId, uid)
    return NextResponse.json({
      ok: true,
      employee: toEmployeePublic({ ...emp, card_uid: uid }),
    })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not link card.' }, { status: 500 })
  }
}

/** Unlink RFID card from an employee. */
export async function DELETE(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  const employeeId = cleanText(req.nextUrl.searchParams.get('employeeId'), 80)
  if (!employeeId) return NextResponse.json({ error: 'employeeId required.' }, { status: 400 })

  try {
    const emp = await findActiveEmployee(sid, placeId, employeeId)
    if (!emp) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: EMPLOYEES,
      filter: { place_id: placeId, employee_id: employeeId },
      update: { $set: { card_uid: null, updated_at: new Date().toISOString() } },
    })
    invalidateEmployeeCache(placeId, typeof emp.card_uid === 'string' ? emp.card_uid : null)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not unlink card.' }, { status: 500 })
  }
}
