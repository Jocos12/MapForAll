import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { findUserById } from '@/lib/users'
import { isAdminEmail } from '@/lib/places'

// Returns the signed-in user from the session cookie (used to hydrate the
// client after the OAuth redirect, which can't set localStorage). Best-effort
// name lookup; falls back to the cookie's uid/email if the DB is unreachable.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ authed: false }, { status: 401 })

  let name: string | null = session.email ? session.email.split('@')[0] : null
  let role: 'client' | 'business_owner' | 'admin' = 'client'
  let ownedPlaceId: string | null = null
  try {
    const user = await findUserById(session.uid)
    if (user?.name) name = user.name
    if (user) {
      role = user.role
      ownedPlaceId = user.owned_place_id
    }
  } catch { /* fall back to email local-part */ }

  return NextResponse.json({
    authed: true,
    user: {
      user_id: session.uid,
      email: session.email ?? null,
      name,
      role,
      owned_place_id: ownedPlaceId,
      admin: role === 'admin' || isAdminEmail(session.email),
    },
  })
}
