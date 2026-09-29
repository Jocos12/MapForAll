/**
 * Server-side gate for /api/admin/* routes.
 * Validates the session (signature + token_version + idle) AND the role.
 * Middleware alone is never enough.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminEmail } from '@/lib/places'
import { getSession, SESSION_COOKIE, SESSION_COOKIE_OPTS } from '@/lib/session'
import { findUserById, type UserRole } from '@/lib/users'
import { clientIp, rateLimit } from '@/lib/rateLimit'

export type StaffRole = 'admin' | 'moderator'

export interface AdminActor {
  uid: string
  email?: string
  role: StaffRole
  name: string | null
}

const MODERATOR_PATHS = [
  '/api/admin/places',
  '/api/admin/moderation',
  '/api/admin/businesses',
  '/api/admin/reports',
  '/api/admin/reviews',
  '/api/admin/categories',
  '/api/admin/stats',
  '/api/admin/notifications',
  '/api/admin/users',
  '/api/admin/scoring',
  '/api/admin/impact',
  '/api/admin/insights',
  '/api/admin/activity',
  '/api/admin/translations',
  '/api/admin/audit',
  '/api/admin/events',
  '/api/admin/demo',
]

function pathAllowedForModerator(pathname: string): boolean {
  return MODERATOR_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function resolveStaff(uid: string, email?: string | null): Promise<StaffRole | null> {
  if (isAdminEmail(email)) return 'admin'
  const user = await findUserById(uid).catch(() => null)
  if (!user) return null
  if (user.role === 'admin') return 'admin'
  if (user.role === 'moderator') return 'moderator'
  return null
}

export type RequireAdminResult =
  | { ok: true; actor: AdminActor; refreshedCookie?: string }
  | { ok: false; response: NextResponse }

/**
 * @param minRole - `admin` requires full admin; `moderator` also accepts moderators
 *   on moderation-related paths.
 */
export async function requireAdmin(
  req: NextRequest,
  opts: { minRole?: StaffRole; rateKey?: string } = {},
): Promise<RequireAdminResult> {
  const minRole = opts.minRole ?? 'admin'
  if (opts.rateKey) {
    const limited = rateLimit(`admin:${opts.rateKey}:${clientIp(req)}`, {
      capacity: 30,
      refillPerSec: 1,
    })
    if (!limited.allowed) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Too many requests.' },
          { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
        ),
      }
    }
  }

  const session = await getSession(req)
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Sign in required.' }, { status: 401 }) }
  }

  const staff = await resolveStaff(session.uid, session.email)
  if (!staff) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden.', code: 'admin_denied' }, { status: 403 }) }
  }
  if (minRole === 'admin' && staff !== 'admin') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden.', code: 'admin_denied' }, { status: 403 }) }
  }
  if (staff === 'moderator' && !pathAllowedForModerator(req.nextUrl.pathname)) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden.', code: 'admin_denied' }, { status: 403 }) }
  }

  const user = await findUserById(session.uid).catch(() => null)
  return {
    ok: true,
    actor: {
      uid: session.uid,
      email: session.email,
      role: staff,
      name: user?.name ?? null,
    },
    refreshedCookie: session.refreshedCookie,
  }
}

export function withSessionRefresh(res: NextResponse, cookie?: string) {
  if (cookie) res.cookies.set(SESSION_COOKIE, cookie, SESSION_COOKIE_OPTS)
  // Preserve an explicit Cache-Control (e.g. short private TTL on stats).
  if (!res.headers.has('Cache-Control')) {
    res.headers.set('Cache-Control', 'no-store')
  }
  return res
}

export function isStaffRole(role: UserRole | string | undefined | null): role is StaffRole {
  return role === 'admin' || role === 'moderator'
}
