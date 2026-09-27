/**
 * Create-or-load a Hodari user by email, via the MongoDB MCP. Shared by the
 * OAuth callback. Matches the existing `users` collection schema.
 */
import { mcpConnected, mcpCall, extractDocs } from '@/lib/mcp'
import { encryptSecret, decryptSecret } from '@/lib/crypto'
import { hashPassword, verifyPassword } from '@/lib/password'
import { isAdminEmail } from '@/lib/places'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

export type UserRole = 'client' | 'business_owner' | 'admin'
export type PublicRole = 'client' | 'business_owner'

export interface HodariUser {
  user_id: string
  name: string | null
  email: string
  home_country: string | null
  languages: string[]
  budget_tier: string
  role: UserRole
  owned_place_id: string | null
  owned_place_ids: string[]
}

export const MAX_OWNED_PLACES = 5

function ownedIds(doc: Record<string, unknown>): string[] {
  const list = Array.isArray(doc.owned_place_ids)
    ? doc.owned_place_ids.filter((id): id is string => typeof id === 'string' && !!id)
    : []
  if (typeof doc.owned_place_id === 'string' && doc.owned_place_id && !list.includes(doc.owned_place_id)) {
    list.unshift(doc.owned_place_id)
  }
  return list
}

function storedRole(doc: Record<string, unknown>, email: string): UserRole {
  if (isAdminEmail(email)) return 'admin'
  if (doc.role === 'admin' || doc.role === 'business_owner' || doc.role === 'client') return doc.role
  return 'client'
}

function publicUser(doc: Record<string, unknown>): HodariUser {
  const email = String(doc.email)
  return {
    user_id: String(doc.user_id),
    name: (doc.name as string) ?? null,
    email,
    home_country: (doc.home_country as string) ?? null,
    languages: (doc.languages as string[]) ?? ['en'],
    budget_tier: (doc.budget_tier as string) ?? 'moderate',
    role: storedRole(doc, email),
    owned_place_id: typeof doc.owned_place_id === 'string' ? doc.owned_place_id : null,
    owned_place_ids: ownedIds(doc),
  }
}

export function isPublicRole(value: unknown): value is PublicRole {
  return value === 'client' || value === 'business_owner'
}

function slugifyId(name: string, email: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return base || email.split('@')[0].replace(/[^a-z0-9_]/g, '') || 'fan'
}

/** Look up the user by email; create the profile on first sign-in. */
export async function findOrCreateUser(email: string, name: string): Promise<HodariUser> {
  const cleanEmail = email.trim().toLowerCase()
  const cleanName = name.trim() || cleanEmail.split('@')[0]

  const sid = await mcpConnected()

  const existing = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { email: cleanEmail }, limit: 1 }),
  )
  if (existing.length > 0) {
    const doc = existing[0]
    if (doc.name !== cleanName) {
      await mcpCall(sid, 'update-many', {
        database: DB, collection: 'users', filter: { email: cleanEmail }, update: { $set: { name: cleanName } },
      })
      doc.name = cleanName
    }
    return publicUser(doc)
  }

  let userId = slugifyId(cleanName, cleanEmail)
  const clash = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  if (clash.length > 0) userId = `${userId}_${Math.random().toString(36).slice(2, 6)}`

  const doc = {
    user_id: userId, name: cleanName, email: cleanEmail,
    role: isAdminEmail(cleanEmail) ? 'admin' : 'client',
    owned_place_id: null,
    home_country: null, languages: ['en'], dietary: [], budget_tier: 'moderate', accessibility: [],
    created_at: new Date().toISOString(),
  }
  await mcpCall(sid, 'insert-many', { database: DB, collection: 'users', documents: [doc] })
  return publicUser(doc)
}

export async function findUserById(userId: string): Promise<HodariUser | null> {
  const sid = await mcpConnected()
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  return docs[0] ? publicUser(docs[0]) : null
}

/** Where a signed-in account should land. Owners with no fiche yet start onboarding. */
export async function destinationFor(user: HodariUser): Promise<string> {
  if (user.role === 'admin') return '/admin'
  if (user.role === 'business_owner') {
    if (user.owned_place_ids.length) return '/business/dashboard'
    try {
      const sid = await mcpConnected()
      const claims = extractDocs(
        await mcpCall(sid, 'find', {
          database: DB,
          collection: 'places',
          filter: { added_by: user.user_id, claimed_by_owner: true },
          limit: 1,
        }),
      )
      return claims.length > 0 ? '/business/dashboard' : '/business/onboarding'
    } catch {
      return '/business/dashboard' // it sends listing-less owners on to onboarding itself
    }
  }
  return '/chat'
}

/** Distinguishes the outcome of a password sign-up attempt for the API layer. */
export type SignupResult =
  | { ok: true; user: HodariUser }
  | { ok: false; reason: 'email_taken' }

/**
 * Register a new email/password user. Fails if the email is already registered
 * (whether via Google or a prior password sign-up) so we never silently attach a
 * password to someone else's account. Stores only a scrypt hash — never the
 * plaintext. Mirrors the `findOrCreateUser` doc shape + `created_at` marker so a
 * "new user" query works the same regardless of sign-in method.
 */
export async function createUserWithPassword(
  email: string,
  name: string,
  plainPassword: string,
  role: PublicRole = 'client',
): Promise<SignupResult> {
  const cleanEmail = email.trim().toLowerCase()
  const cleanName = name.trim() || cleanEmail.split('@')[0]

  const sid = await mcpConnected()

  const existing = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { email: cleanEmail }, limit: 1 }),
  )
  if (existing.length > 0) return { ok: false, reason: 'email_taken' }

  let userId = slugifyId(cleanName, cleanEmail)
  const clash = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  if (clash.length > 0) userId = `${userId}_${Math.random().toString(36).slice(2, 6)}`

  const doc = {
    user_id: userId, name: cleanName, email: cleanEmail,
    password_hash: hashPassword(plainPassword),
    role: isAdminEmail(cleanEmail) ? 'admin' : role,
    owned_place_id: null,
    home_country: null, languages: ['en'], dietary: [], budget_tier: 'moderate', accessibility: [],
    created_at: new Date().toISOString(),
  }
  await mcpCall(sid, 'insert-many', { database: DB, collection: 'users', documents: [doc] })
  return { ok: true, user: publicUser(doc) }
}

/** `owned_place_ids` is the ownership proof; `owned_place_id` stays as the first entry for older readers. */
export async function setOwnedPlaces(userId: string, placeIds: string[]): Promise<void> {
  const ids = [...new Set(placeIds.filter(Boolean))].slice(0, MAX_OWNED_PLACES)
  const sid = await mcpConnected()
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'users',
    filter: { user_id: userId },
    update: { $set: { owned_place_ids: ids, owned_place_id: ids[0] ?? null } },
  })
}

/**
 * Verify an email/password login. Returns the user on success, or null on a bad
 * email/password OR an account with no password set (e.g. a Google-only user) —
 * the caller shows one generic "wrong email or password" either way so we never
 * reveal which emails exist or how they signed up.
 */
export async function verifyUserPassword(email: string, plainPassword: string): Promise<HodariUser | null> {
  const cleanEmail = email.trim().toLowerCase()
  const sid = await mcpConnected()

  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { email: cleanEmail }, limit: 1 }),
  )
  const doc = docs[0]
  if (!doc) return null
  if (!verifyPassword(plainPassword, doc.password_hash as string | undefined)) return null
  return publicUser(doc)
}

export interface AccountProfile {
  name: string
  email: string
  phone: string
  avatar: string | null
  role: UserRole
  hasPassword: boolean
}

async function readUserDoc(sid: string, userId: string): Promise<Record<string, unknown> | null> {
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  return docs[0] ?? null
}

function toProfile(doc: Record<string, unknown>): AccountProfile {
  const user = publicUser(doc)
  return {
    name: user.name ?? '',
    email: user.email,
    phone: typeof doc.phone === 'string' ? doc.phone : '',
    avatar: typeof doc.avatar_url === 'string' && doc.avatar_url.startsWith('data:image/') ? doc.avatar_url : null,
    role: user.role,
    hasPassword: typeof doc.password_hash === 'string' && !!doc.password_hash,
  }
}

export async function getAccountProfile(userId: string): Promise<AccountProfile | null> {
  const doc = await readUserDoc(await mcpConnected(), userId)
  return doc ? toProfile(doc) : null
}

/** Name, phone and avatar only — role and email are never writable from the profile page. */
export async function updateAccountProfile(
  userId: string,
  patch: { name?: string; phone?: string | null; avatar_url?: string | null },
): Promise<AccountProfile | null> {
  const sid = await mcpConnected()
  if (Object.keys(patch).length) {
    await mcpCall(sid, 'update-many', { database: DB, collection: 'users', filter: { user_id: userId }, update: { $set: patch } })
  }
  const doc = await readUserDoc(sid, userId)
  return doc ? toProfile(doc) : null
}

export type PasswordChange = 'ok' | 'wrong_password' | 'no_password'

export async function changePassword(userId: string, current: string, next: string): Promise<PasswordChange> {
  const sid = await mcpConnected()
  const doc = await readUserDoc(sid, userId)
  const stored = typeof doc?.password_hash === 'string' ? doc.password_hash : ''
  if (!stored) return 'no_password'
  if (!verifyPassword(current, stored)) return 'wrong_password'
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'users',
    filter: { user_id: userId },
    update: { $set: { password_hash: hashPassword(next), password_changed_at: new Date().toISOString() } },
  })
  return 'ok'
}

/** Store the user's Google refresh token (encrypted) + mark calendar connected. */
export async function setGoogleRefreshToken(userId: string, refreshToken: string): Promise<void> {
  const sid = await mcpConnected()
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'users',
    filter: { user_id: userId },
    update: { $set: { google_refresh_token: encryptSecret(refreshToken), google_calendar_connected: true } },
  })
}

/** The decrypted Google refresh token for a user, or null if not connected. */
export async function getGoogleRefreshToken(userId: string): Promise<string | null> {
  const sid = await mcpConnected()
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  return decryptSecret(docs[0]?.google_refresh_token as string | undefined)
}

/** Whether the user has connected Google Calendar. */
export async function isCalendarConnected(userId: string): Promise<boolean> {
  const sid = await mcpConnected()
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  return Boolean(docs[0]?.google_calendar_connected)
}
