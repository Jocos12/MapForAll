import { NextRequest, NextResponse } from 'next/server'
import { getSession, SESSION_COOKIE, SESSION_COOKIE_OPTS } from '@/lib/session'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { findUserById, type UserRole } from '@/lib/users'
import { isAdminEmail } from '@/lib/places'

export const runtime = 'nodejs'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

function buildRoles(role: UserRole, email: string | null | undefined): UserRole[] {
  const roles: UserRole[] = []
  if (role === 'admin' || isAdminEmail(email)) {
    roles.push('admin')
  } else if (role === 'moderator') {
    roles.push('moderator')
  }
  if (role === 'business_owner') roles.push('business_owner')
  if (role === 'client' || roles.length === 0) {
    if (!roles.includes('client') && role === 'client') roles.push('client')
  }
  // Always expose the stored role if somehow missing from the list
  if (!roles.includes(role) && role !== 'admin') roles.unshift(role)
  // Deduplicate while preserving order
  return [...new Set(roles)]
}

// Returns the signed-in user. Validates signature + token_version + idle.
export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) {
    const res = NextResponse.json({ authed: false }, { status: 401 })
    res.headers.set('Cache-Control', 'no-store')
    return res
  }

  let name: string | null = session.email ? session.email.split('@')[0] : null
  let role: UserRole = 'client'
  let ownedPlaceId: string | null = null
  let avatarUrl: string | null = null
  let language: 'fr' | 'en' | 'rw' = 'fr'
  let createdAt: string | null = null
  let lastActiveAt: string | null = null
  let lastLoginAt: string | null = null
  let emailVerified: boolean | null = null
  let hasPassword = false

  try {
    const user = await findUserById(session.uid)
    if (user?.name) name = user.name
    if (user) {
      role = user.role
      ownedPlaceId = user.owned_place_id
      if (typeof user.avatar_url === 'string' && user.avatar_url) avatarUrl = user.avatar_url
    }

    const sid = await mcpConnected()
    const doc = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'users',
        filter: { user_id: session.uid },
        projection: {
          lang: 1,
          languages: 1,
          created_at: 1,
          last_active_at: 1,
          last_login_at: 1,
          email_verified: 1,
          password_hash: 1,
          avatar_url: 1,
        },
        limit: 1,
      }),
    )[0]

    if (doc) {
      const lang = doc.lang === 'en' || doc.lang === 'rw' || doc.lang === 'fr'
        ? doc.lang
        : Array.isArray(doc.languages) && (doc.languages[0] === 'en' || doc.languages[0] === 'rw' || doc.languages[0] === 'fr')
          ? doc.languages[0]
          : 'fr'
      language = lang
      createdAt = typeof doc.created_at === 'string' ? doc.created_at : null
      lastActiveAt = typeof doc.last_active_at === 'string' ? doc.last_active_at : null
      lastLoginAt = typeof doc.last_login_at === 'string' ? doc.last_login_at : null
      emailVerified = typeof doc.email_verified === 'boolean' ? doc.email_verified : null
      hasPassword = typeof doc.password_hash === 'string' && !!doc.password_hash
      if (!avatarUrl && typeof doc.avatar_url === 'string' && doc.avatar_url) avatarUrl = doc.avatar_url
    }
  } catch (err) {
    if (isMcpUnavailable(err)) {
      /* keep email fallbacks */
    }
  }

  const roles = buildRoles(role, session.email)
  const isStaff = roles.includes('admin') || roles.includes('moderator') || isAdminEmail(session.email)

  const res = NextResponse.json({
    authed: true,
    user: {
      id: session.uid,
      user_id: session.uid,
      email: session.email ?? null,
      name,
      role,
      roles,
      language,
      createdAt,
      lastActiveAt,
      lastLoginAt,
      emailVerified,
      hasPassword,
      avatarUrl,
      owned_place_id: ownedPlaceId,
      admin: isStaff,
    },
  })
  res.headers.set('Cache-Control', 'no-store')
  if (session.refreshedCookie) {
    res.cookies.set(SESSION_COOKIE, session.refreshedCookie, SESSION_COOKIE_OPTS)
  }
  return res
}
