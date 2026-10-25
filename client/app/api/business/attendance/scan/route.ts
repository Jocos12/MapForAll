import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/attendanceEvents'
import { isMcpUnavailable, mcpConnected } from '@/lib/mcp'
import { cleanText } from '@/lib/places'
import {
  employeeForCard,
  ensureTeamIndexes,
  formatTime,
  placeIdForApiKey,
  recordAttendancePunch,
} from '@/lib/team'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * RFID device punch — auth via per-place API key.
 * Header X-RFID-API-KEY (also X-Api-Key / Bearer). Body: { uid, device_id? }.
 * Toggle logic lives in recordAttendancePunch, shared with the manual buttons.
 */
export async function POST(req: NextRequest) {
  const started = Date.now()
  let outcome = 'error'
  void ensureTeamIndexes()

  try {
    const rawKey =
      req.headers.get('x-rfid-api-key')?.trim()
      || req.headers.get('x-api-key')?.trim()
      || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
      || ''
    if (!rawKey || rawKey.length < 16) {
      outcome = '401'
      return NextResponse.json({ error: 'API key required.', ok: false }, { status: 401, headers: NO_STORE })
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const uid = cleanText(body.uid ?? body.card_uid ?? body.cardUid, 64).toUpperCase()
    const deviceId = cleanText(body.deviceId ?? body.device_id, 80) || null
    if (!uid) {
      outcome = '400'
      return NextResponse.json({ error: 'Missing card uid.', ok: false }, { status: 400, headers: NO_STORE })
    }

    const sid = await mcpConnected()
    const placeId = await placeIdForApiKey(sid, rawKey)
    if (!placeId) {
      outcome = '401'
      return NextResponse.json({ error: 'Invalid API key.', ok: false }, { status: 401, headers: NO_STORE })
    }

    const emp = await employeeForCard(sid, placeId, uid)
    if (!emp) {
      const at = new Date().toISOString()
      publish(placeId, {
        id: `unk_${uid}_${Date.now()}`,
        type: 'unknown_card',
        employeeId: '',
        name: '',
        badgeCode: '',
        time: formatTime(at),
        at,
        message: `Unknown card ${uid}`,
        uid,
      })
      outcome = '404'
      return NextResponse.json({
        ok: false,
        error: 'Unknown card — associate this UID to an employee in the Team dashboard.',
        uid,
      }, { status: 404, headers: NO_STORE })
    }

    const result = await recordAttendancePunch(sid, placeId, emp, 'rfid', deviceId)
    if (!result.ok) {
      outcome = '403'
      return NextResponse.json({ ok: false, error: result.error }, { status: 403, headers: NO_STORE })
    }
    outcome = result.type
    if (result.type === 'duplicate') {
      return NextResponse.json({
        ok: true,
        type: 'duplicate',
        name: result.name,
        message: result.message,
      }, { status: 200, headers: NO_STORE })
    }
    return NextResponse.json({
      ok: true,
      uid,
      employee_id: result.employeeId,
      name: result.name,
      badge_code: result.badgeCode,
      type: result.type,
      at: result.at,
      time: result.time,
      message: result.message,
      presence: result.presence,
    }, { headers: NO_STORE })
  } catch (err) {
    if (isMcpUnavailable(err)) {
      outcome = '503'
      return NextResponse.json({ error: 'Database unavailable', ok: false }, { status: 503, headers: NO_STORE })
    }
    console.error('[attendance/scan]', err)
    outcome = '500'
    return NextResponse.json({ error: 'Scan failed.', ok: false }, { status: 500, headers: NO_STORE })
  } finally {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[attendance/scan] ${Date.now() - started}ms ${outcome}`)
    }
  }
}
