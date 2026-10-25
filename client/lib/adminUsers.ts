/**
 * Admin user listing, detail, and mutations (MongoDB via MCP).
 */
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'
import { bumpTokenVersion } from '@/lib/users'
import { hashPassword } from '@/lib/password'
import { isAdminEmail } from '@/lib/places'
import type { UserRole } from '@/lib/users'

export const DB = process.env.MONGODB_DATABASE ?? 'hodari'

export type AdminUserStatus = 'active' | 'suspended' | 'deleted'
export type AdminUserSort = 'created_desc' | 'created_asc' | 'name' | 'last_active' | 'email'

export interface AdminUsersListQuery {
  q?: string
  role?: UserRole
  status?: AdminUserStatus | 'all'
  sort?: AdminUserSort
  page?: number
  limit?: number
}

export interface AdminUserListItem {
  user_id: string
  name: string | null
  email: string
  role: UserRole
  status: AdminUserStatus
  avatar_url: string | null
  created_at: string | null
  last_active_at: string | null
  last_login_at: string | null
  places_added: number
  reports_count: number
}

export interface AdminUserDetail extends AdminUserListItem {
  has_password: boolean
  home_country: string | null
  lang: string | null
}

function slugifyId(name: string, email: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return base || email.split('@')[0].replace(/[^a-z0-9_]/g, '') || 'user'
}

function docStatus(doc: Record<string, unknown>): AdminUserStatus {
  if (typeof doc.deleted_at === 'string' && doc.deleted_at) return 'deleted'
  if (doc.status === 'deleted') return 'deleted'
  if (doc.status === 'suspended') return 'suspended'
  return 'active'
}

function docRole(doc: Record<string, unknown>, email: string): UserRole {
  if (isAdminEmail(email)) return 'admin'
  const r = doc.role
  if (r === 'admin' || r === 'moderator' || r === 'business_owner' || r === 'client') return r
  return 'client'
}

function normalizeAvatar(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null
  if (url.startsWith('/uploads/avatars/')) return url
  if (url.startsWith('data:image/')) return null
  return url
}

export function toAdminUserListItem(
  doc: Record<string, unknown>,
  counts: { places: number; reports: number },
): AdminUserListItem {
  const email = String(doc.email ?? '')
  return {
    user_id: String(doc.user_id),
    name: typeof doc.name === 'string' ? doc.name : null,
    email,
    role: docRole(doc, email),
    status: docStatus(doc),
    avatar_url: normalizeAvatar(doc.avatar_url),
    created_at: typeof doc.created_at === 'string' ? doc.created_at : null,
    last_active_at: typeof doc.last_active_at === 'string' ? doc.last_active_at : null,
    last_login_at: typeof doc.last_login_at === 'string' ? doc.last_login_at : null,
    places_added: counts.places,
    reports_count: counts.reports,
  }
}

export function toAdminUserDetail(doc: Record<string, unknown>, counts: { places: number; reports: number }): AdminUserDetail {
  const base = toAdminUserListItem(doc, counts)
  return {
    ...base,
    has_password: typeof doc.password_hash === 'string' && !!doc.password_hash,
    home_country: typeof doc.home_country === 'string' ? doc.home_country : null,
    lang: typeof doc.lang === 'string' ? doc.lang : null,
  }
}

function matchesQuery(doc: Record<string, unknown>, q: AdminUsersListQuery): boolean {
  const status = docStatus(doc)
  if (q.status && q.status !== 'all' && status !== q.status) return false
  const email = String(doc.email ?? '')
  if (q.role && docRole(doc, email) !== q.role) return false
  const needle = q.q?.trim().toLowerCase()
  if (needle) {
    const name = String(doc.name ?? '').toLowerCase()
    if (!email.toLowerCase().includes(needle) && !name.includes(needle) && !String(doc.user_id).toLowerCase().includes(needle)) {
      return false
    }
  }
  return true
}

function sortUsers(a: AdminUserListItem, b: AdminUserListItem, sort: AdminUserSort): number {
  switch (sort) {
    case 'created_asc':
      return (a.created_at ?? '').localeCompare(b.created_at ?? '')
    case 'name':
      return (a.name ?? a.email).localeCompare(b.name ?? b.email, undefined, { sensitivity: 'base' })
    case 'email':
      return a.email.localeCompare(b.email)
    case 'last_active':
      return (b.last_active_at ?? '').localeCompare(a.last_active_at ?? '')
    case 'created_desc':
    default:
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  }
}

const USER_LIST_PROJECTION = {
  _id: 0,
  user_id: 1,
  name: 1,
  email: 1,
  role: 1,
  status: 1,
  deleted_at: 1,
  avatar_url: 1,
  created_at: 1,
  last_active_at: 1,
  last_login_at: 1,
}

async function loadAllUsers(sid: string): Promise<Record<string, unknown>[]> {
  return extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'users',
      filter: {},
      projection: USER_LIST_PROJECTION,
      sort: { created_at: -1 },
      limit: 1000,
    }),
  )
}

async function countPlacesByUser(sid: string): Promise<Map<string, number>> {
  const places = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter: {},
      projection: { added_by: 1 },
      limit: 5000,
    }),
  )
  const map = new Map<string, number>()
  for (const p of places) {
    const uid = typeof p.added_by === 'string' ? p.added_by : null
    if (!uid) continue
    map.set(uid, (map.get(uid) ?? 0) + 1)
  }
  return map
}

async function countReportsByUser(sid: string): Promise<Map<string, number>> {
  try {
    const reports = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'place_reports',
        filter: {},
        projection: { reporter_uid: 1 },
        limit: 5000,
      }),
    )
    const map = new Map<string, number>()
    for (const r of reports) {
      const uid = typeof r.reporter_uid === 'string' ? r.reporter_uid : null
      if (!uid) continue
      map.set(uid, (map.get(uid) ?? 0) + 1)
    }
    return map
  } catch {
    return new Map()
  }
}

async function activityMaps(sid: string): Promise<{ places: Map<string, number>; reports: Map<string, number> }> {
  const [places, reports] = await Promise.all([countPlacesByUser(sid), countReportsByUser(sid)])
  return { places, reports }
}

function countsFor(
  userId: string,
  maps: { places: Map<string, number>; reports: Map<string, number> },
): { places: number; reports: number } {
  return { places: maps.places.get(userId) ?? 0, reports: maps.reports.get(userId) ?? 0 }
}

export async function listAdminUsers(query: AdminUsersListQuery): Promise<{ items: AdminUserListItem[]; total: number; page: number; limit: number }> {
  const sid = await mcpConnected()
  const raw = await loadAllUsers(sid)
  const sort = query.sort ?? 'created_desc'
  const page = query.page ?? 1
  const limit = query.limit ?? 50

  // Dedupe by user_id then email (keep newest) so React keys stay unique
  // even if legacy data had collisions before the unique indexes.
  const byUserId = new Map<string, Record<string, unknown>>()
  for (const doc of raw) {
    const uid = String(doc.user_id ?? '')
    if (!uid) continue
    const prev = byUserId.get(uid)
    if (!prev) {
      byUserId.set(uid, doc)
      continue
    }
    const prevAt = String(prev.created_at ?? '')
    const nextAt = String(doc.created_at ?? '')
    if (nextAt >= prevAt) byUserId.set(uid, doc)
  }
  const byEmail = new Map<string, Record<string, unknown>>()
  for (const doc of byUserId.values()) {
    const email = String(doc.email ?? '').toLowerCase()
    if (!email) continue
    const prev = byEmail.get(email)
    if (!prev) {
      byEmail.set(email, doc)
      continue
    }
    const prevAt = String(prev.created_at ?? '')
    const nextAt = String(doc.created_at ?? '')
    if (nextAt >= prevAt) byEmail.set(email, doc)
  }

  const filtered = [...byEmail.values()]
    .filter((doc) => matchesQuery(doc, query))
    .map((doc) => toAdminUserListItem(doc, { places: 0, reports: 0 }))
    .sort((a, b) => sortUsers(a, b, sort))

  const total = filtered.length
  const start = (page - 1) * limit
  const pageItems = filtered.slice(start, start + limit)
  const ids = pageItems.map((row) => row.user_id)
  let maps = { places: new Map<string, number>(), reports: new Map<string, number>() }
  if (ids.length) {
    try {
      const [placeRows, reportRows] = await Promise.all([
        extractDocs(await mcpCall(sid, 'find', {
          database: DB,
          collection: 'places',
          filter: { $or: [{ added_by: { $in: ids } }, { owner_id: { $in: ids } }] },
          projection: { _id: 0, added_by: 1, owner_id: 1 },
          limit: 500,
        })),
        extractDocs(await mcpCall(sid, 'find', {
          database: DB,
          collection: 'place_reports',
          filter: { reporter_uid: { $in: ids } },
          projection: { _id: 0, reporter_uid: 1 },
          limit: 500,
        }).catch(() => [])),
      ])
      for (const row of placeRows) {
        const uid = typeof row.owner_id === 'string' ? row.owner_id : typeof row.added_by === 'string' ? row.added_by : ''
        if (uid) maps.places.set(uid, (maps.places.get(uid) ?? 0) + 1)
      }
      for (const row of reportRows) {
        const uid = typeof row.reporter_uid === 'string' ? row.reporter_uid : ''
        if (uid) maps.reports.set(uid, (maps.reports.get(uid) ?? 0) + 1)
      }
    } catch {
      maps = { places: new Map(), reports: new Map() }
    }
  }
  const items = pageItems.map((row) => ({ ...row, ...countsFor(row.user_id, maps), places_added: maps.places.get(row.user_id) ?? 0, reports_count: maps.reports.get(row.user_id) ?? 0 }))
  return { items, total, page, limit }
}

export async function getAdminUserById(userId: string): Promise<AdminUserDetail | null> {
  const sid = await mcpConnected()
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  const doc = docs[0]
  if (!doc) return null
  const maps = await activityMaps(sid)
  return toAdminUserDetail(doc, countsFor(userId, maps))
}

export async function readUserDocRaw(userId: string): Promise<Record<string, unknown> | null> {
  const sid = await mcpConnected()
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  return docs[0] ?? null
}

export async function emailTaken(email: string, exceptUserId?: string): Promise<boolean> {
  const clean = email.trim().toLowerCase()
  const sid = await mcpConnected()
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { email: clean }, limit: 1 }),
  )
  const doc = docs[0]
  if (!doc) return false
  if (exceptUserId && String(doc.user_id) === exceptUserId) return false
  return true
}

const STAFF_ROLES = new Set<UserRole>(['admin', 'moderator'])

export async function createAdminUser(input: {
  name: string
  email: string
  password: string
  role: UserRole
  avatar_url?: string | null
  lang?: 'fr' | 'en' | 'rw'
}): Promise<{ ok: true; user: AdminUserDetail } | { ok: false; reason: 'email_taken' }> {
  const cleanEmail = input.email.trim().toLowerCase()
  if (await emailTaken(cleanEmail)) return { ok: false, reason: 'email_taken' }

  const sid = await mcpConnected()
  const cleanName = input.name.trim() || cleanEmail.split('@')[0]
  let userId = slugifyId(cleanName, cleanEmail)
  const clash = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  if (clash.length > 0) userId = `${userId}_${Math.random().toString(36).slice(2, 6)}`

  const role = isAdminEmail(cleanEmail) ? 'admin' : input.role
  const lang = input.lang ?? 'fr'
  const doc: Record<string, unknown> = {
    user_id: userId,
    name: cleanName,
    email: cleanEmail,
    password_hash: hashPassword(input.password),
    role,
    owned_place_id: null,
    owned_place_ids: [],
    token_version: 0,
    last_active_at: null,
    status: 'active',
    home_country: null,
    languages: [lang],
    lang,
    dietary: [],
    budget_tier: 'moderate',
    accessibility: [],
    created_at: new Date().toISOString(),
  }
  if (input.avatar_url) doc.avatar_url = input.avatar_url

  await mcpCall(sid, 'insert-many', { database: DB, collection: 'users', documents: [doc] })
  return { ok: true, user: toAdminUserDetail(doc, { places: 0, reports: 0 }) }
}

export async function updateAdminUser(
  userId: string,
  patch: {
    name?: string
    role?: UserRole
    status?: 'active' | 'suspended'
    avatar_url?: string | null
  },
): Promise<AdminUserDetail | null> {
  const sid = await mcpConnected()
  const existing = await readUserDocRaw(userId)
  if (!existing || docStatus(existing) === 'deleted') return null

  const email = String(existing.email ?? '')
  const $set: Record<string, unknown> = {}
  if (patch.name !== undefined) $set.name = patch.name.trim() || email.split('@')[0]
  if (patch.avatar_url !== undefined) $set.avatar_url = patch.avatar_url
  if (patch.role !== undefined) {
    $set.role = isAdminEmail(email) ? 'admin' : patch.role
  }
  if (patch.status !== undefined) {
    $set.status = patch.status
    if (patch.status === 'active') $set.suspended_at = null
    if (patch.status === 'suspended') $set.suspended_at = new Date().toISOString()
  }

  if (Object.keys($set).length) {
    await mcpCall(sid, 'update-many', { database: DB, collection: 'users', filter: { user_id: userId }, update: { $set } })
  }
  if (patch.role !== undefined || patch.status === 'suspended') await bumpTokenVersion(userId)
  return getAdminUserById(userId)
}

export async function softDeleteAdminUser(userId: string): Promise<boolean> {
  const sid = await mcpConnected()
  const existing = await readUserDocRaw(userId)
  if (!existing) return false
  const email = String(existing.email ?? '')
  if (isAdminEmail(email) || docRole(existing, email) === 'admin') {
    return false
  }
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'users',
    filter: { user_id: userId },
    update: {
      $set: {
        status: 'deleted',
        deleted_at: new Date().toISOString(),
      },
    },
  })
  await bumpTokenVersion(userId)
  return true
}

export async function setUserPasswordHash(userId: string, plainPassword: string): Promise<void> {
  const sid = await mcpConnected()
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'users',
    filter: { user_id: userId },
    update: { $set: { password_hash: hashPassword(plainPassword), password_changed_at: new Date().toISOString() } },
  })
}

export function isStaffRole(role: UserRole): boolean {
  return STAFF_ROLES.has(role)
}
