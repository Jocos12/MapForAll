import { NextRequest, NextResponse } from 'next/server'
import { isMcpUnavailable } from '@/lib/mcp'
import { cleanPhone, cleanText } from '@/lib/places'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { getSession } from '@/lib/session'
import { changePassword, getAccountProfile, updateAccountProfile } from '@/lib/users'

const MIN_PASSWORD = 8
const AVATAR_LIMIT = 90_000

function failure(err: unknown, fallback: string) {
  if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
  console.error('[account]', err)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  try {
    const profile = await getAccountProfile(session.uid)
    if (!profile) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    return NextResponse.json({ profile })
  } catch (err) {
    return failure(err, 'Could not load your profile.')
  }
}

export async function PATCH(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const patch: { name?: string; phone?: string | null; avatar_url?: string | null } = {}

  if ('name' in body) {
    const name = cleanText(body.name, 120)
    if (!name) return NextResponse.json({ error: 'Name is required.', code: 'name_required' }, { status: 400 })
    patch.name = name
  }
  if ('phone' in body) {
    const raw = cleanText(body.phone, 30)
    const phone = cleanPhone(raw)
    if (raw && !phone) return NextResponse.json({ error: 'Invalid phone number.', code: 'invalid_phone' }, { status: 400 })
    patch.phone = phone || null
  }
  if ('avatar' in body) {
    const avatar = body.avatar
    if (avatar === null) patch.avatar_url = null
    else if (typeof avatar === 'string' && avatar.startsWith('data:image/') && avatar.length <= AVATAR_LIMIT) patch.avatar_url = avatar
    else return NextResponse.json({ error: 'The photo must be a small image.', code: 'invalid_avatar' }, { status: 400 })
  }

  try {
    const profile = await updateAccountProfile(session.uid, patch)
    if (!profile) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    return NextResponse.json({ profile })
  } catch (err) {
    return failure(err, 'Could not save your profile.')
  }
}

/** Password change: the current password is always required. */
export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  if (!rateLimit(`password:${session.uid}:${clientIp(req)}`, { capacity: 5, refillPerSec: 5 / 300 }).allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a moment.', code: 'rate_limited' }, { status: 429 })
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const next = typeof body.newPassword === 'string' ? body.newPassword : ''
  if (next.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters.`, code: 'weak_password' }, { status: 400 })
  }
  if (next === current) {
    return NextResponse.json({ error: 'Choose a different password.', code: 'same_password' }, { status: 400 })
  }
  try {
    const result = await changePassword(session.uid, current, next)
    if (result === 'no_password') return NextResponse.json({ error: 'This account signs in with Google.', code: 'no_password' }, { status: 400 })
    if (result === 'wrong_password') return NextResponse.json({ error: 'Current password is incorrect.', code: 'wrong_password' }, { status: 403 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failure(err, 'Could not change your password.')
  }
}
