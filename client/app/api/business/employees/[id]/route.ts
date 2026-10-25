import { NextRequest, NextResponse } from 'next/server'
import { isMcpUnavailable, mcpCall } from '@/lib/mcp'
import { DB, requestedPlace, resolveOwnedPlace } from '@/lib/business'
import { cleanText } from '@/lib/places'
import { getSession } from '@/lib/session'
import {
  EMPLOYEES,
  dayKey,
  ensureTeamIndexes,
  findActiveEmployee,
  invalidateEmployeeCache,
  toEmployeePublic,
  type EmployeeStatus,
} from '@/lib/team'

const PHOTO_MAX = 90_000

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  const { id: employeeId } = await ctx.params
  if (!employeeId) return NextResponse.json({ error: 'Missing employee.' }, { status: 400 })
  void ensureTeamIndexes()

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  try {
    const existing = await findActiveEmployee(sid, placeId, employeeId)
    if (!existing) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })

    const set: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('name' in body) {
      const name = cleanText(body.name, 80)
      if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
      set.name = name
    }
    if ('role' in body) {
      const role = cleanText(body.role, 60)
      if (!role) return NextResponse.json({ error: 'Role is required.' }, { status: 400 })
      set.role = role
    }
    if ('phone' in body) set.phone = cleanText(body.phone, 40)
    if ('photo' in body) {
      if (body.photo === null) set.photo = null
      else if (typeof body.photo === 'string' && body.photo.startsWith('data:image/') && body.photo.length <= PHOTO_MAX) {
        set.photo = body.photo
      } else if (body.photo !== undefined) {
        return NextResponse.json({ error: 'Invalid photo.' }, { status: 400 })
      }
    }
    if ('status' in body) {
      const status = body.status
      if (status !== 'active' && status !== 'on_leave') {
        return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
      }
      set.status = status as EmployeeStatus
    }
    if ('card_uid' in body) {
      if (body.card_uid === null || body.card_uid === '') set.card_uid = null
      else set.card_uid = cleanText(body.card_uid, 64).toUpperCase()
    }

    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: EMPLOYEES,
      filter: { place_id: placeId, employee_id: employeeId, status: { $ne: 'removed' } },
      update: { $set: set },
    })
    invalidateEmployeeCache(placeId, typeof existing.card_uid === 'string' ? existing.card_uid : null)
    if (typeof set.card_uid === 'string') invalidateEmployeeCache(placeId, set.card_uid)
    const updated = { ...existing, ...set }
    return NextResponse.json({ employee: toEmployeePublic(updated), date: dayKey() })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not update employee.' }, { status: 500 })
  }
}

/** Soft-delete: status=removed. Attendance history is kept for reports. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  const { id: employeeId } = await ctx.params
  if (!employeeId) return NextResponse.json({ error: 'Missing employee.' }, { status: 400 })

  try {
    const existing = await findActiveEmployee(sid, placeId, employeeId)
    if (!existing) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })
    const now = new Date().toISOString()
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: EMPLOYEES,
      filter: { place_id: placeId, employee_id: employeeId },
      update: { $set: { status: 'removed', removed_at: now, updated_at: now, card_uid: null } },
    })
    invalidateEmployeeCache(placeId, typeof existing.card_uid === 'string' ? existing.card_uid : null)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not remove employee.' }, { status: 500 })
  }
}
