import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, type RateLimitRule } from './lib/rateLimit'
import { SESSION_COOKIE, verifySession } from './lib/session'

/**
 * Per-route rate limits, keyed by client IP. Tighter buckets guard the
 * expensive AI routes (each /api/chat run fans out to Gemini + Maps); cheap
 * proxy routes get a loose default. `capacity` is the burst allowance,
 * `refillPerSec` the sustained rate.
 *
 * Session cookie refresh (sliding idle) happens in `/api/auth/me` and other
 * routes after a full DB token_version check — not here — so a logged-out
 * token cannot be silently prolonged.
 */
const RULES: Array<{ prefix: string; name: string; rule: RateLimitRule }> = [
  { prefix: '/api/chat', name: 'chat', rule: { capacity: 5, refillPerSec: 5 / 60 } },
  { prefix: '/api/voice', name: 'voice', rule: { capacity: 20, refillPerSec: 20 / 60 } },
  { prefix: '/api/auth/login', name: 'login', rule: { capacity: 8, refillPerSec: 6 / 60 } },
  { prefix: '/api/auth/otp', name: 'otp', rule: { capacity: 12, refillPerSec: 12 / 60 } },
  { prefix: '/api/admin/insights', name: 'insights', rule: { capacity: 10, refillPerSec: 10 / 60 } },
  { prefix: '/api/feedback', name: 'feedback', rule: { capacity: 30, refillPerSec: 30 / 60 } },
  { prefix: '/api/saved', name: 'saved', rule: { capacity: 40, refillPerSec: 40 / 60 } },
]

const DEFAULT_RULE: RateLimitRule = { capacity: 60, refillPerSec: 1 }

const PROTECTED_PAGES = ['/chat', '/business', '/admin', '/saved', '/billing']

function matchRule(pathname: string): { name: string; rule: RateLimitRule } {
  const hit = RULES
    .filter((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]
  return hit ? { name: hit.name, rule: hit.rule } : { name: 'api', rule: DEFAULT_RULE }
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function middleware(req: NextRequest) {
  if (req.method === 'OPTIONS') return NextResponse.next()

  const path = req.nextUrl.pathname

  // Page loads: Cache-Control + soft gate (signature only; /api/auth/me does the DB check).
  if (!path.startsWith('/api/')) {
    if (!isProtectedPage(path)) return NextResponse.next()
    const res = NextResponse.next()
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    res.headers.set('Pragma', 'no-cache')
    const token = req.cookies.get(SESSION_COOKIE)?.value
    if (!verifySession(token)) {
      const login = new URL('/login', req.url)
      login.searchParams.set('expired', '1')
      return NextResponse.redirect(login)
    }
    return res
  }

  const { name, rule } = matchRule(path)
  const key = `${clientIp(req)}:${name}`
  const result = rateLimit(key, rule)

  const headers = new Headers()
  headers.set('RateLimit-Limit', String(result.limitPerMin))
  headers.set('RateLimit-Remaining', String(result.remaining))
  // Let short-lived private caching on admin aggregates (set in the route)
  // survive; everything else stays uncached.
  const allowShortPrivateCache =
    path === '/api/admin/stats'
    || path === '/api/admin/places'
    || path === '/api/admin/users'
  if (!allowShortPrivateCache) {
    headers.set('Cache-Control', 'no-store')
  }

  if (!result.allowed) {
    headers.set('Retry-After', String(result.retryAfterSec))
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers },
    )
  }

  const res = NextResponse.next()
  headers.forEach((value, k) => res.headers.set(k, value))
  return res
}

export const config = {
  matcher: [
    '/api/:path*',
    '/chat',
    '/chat/:path*',
    '/business/:path*',
    '/admin',
    '/admin/:path*',
    '/saved',
    '/saved/:path*',
    '/billing',
    '/billing/:path*',
  ],
  runtime: 'nodejs',
}
