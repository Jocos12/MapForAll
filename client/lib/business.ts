import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { findUserById, setOwnedPlaces, type HodariUser } from '@/lib/users'

export const DB = process.env.MONGODB_DATABASE ?? 'hodari'

export interface OwnedSummary {
  place_id: string
  name: string
  categories: string[]
  status: string
  paused: boolean
}

export type OwnedPlace = {
  sid: string
  user: HodariUser
  doc: Record<string, unknown>
  placeId: string
  places: OwnedSummary[]
}

export type OwnerResult = { ok: true; owned: OwnedPlace } | { ok: false; response: NextResponse }

function fail(error: string, status: number): OwnerResult {
  return { ok: false, response: NextResponse.json({ error }, { status }) }
}

function summary(doc: Record<string, unknown>): OwnedSummary {
  return {
    place_id: String(doc.place_id),
    name: typeof doc.name === 'string' ? doc.name : '',
    categories: Array.isArray(doc.categories) ? doc.categories.filter((c): c is string => typeof c === 'string') : [],
    status: typeof doc.status === 'string' ? doc.status : 'validated',
    paused: doc.paused === true,
  }
}

/** The requested listing, from the request's `place` query param. */
export function requestedPlace(url: URL): string | null {
  const raw = (url.searchParams.get('place') ?? '').trim()
  return raw && raw.length <= 160 ? raw : null
}

/**
 * Resolve the listing an owner may act on. Ownership is proven by
 * `owned_place_ids` on the account; a claim written before that link existed
 * (same author + claimed_by_owner) is accepted once and linked back. A
 * requested id outside that set is refused, never silently swapped.
 */
export async function resolveOwnedPlace(uid: string, requested: string | null = null): Promise<OwnerResult> {
  try {
    const user = await findUserById(uid)
    if (!user || user.role !== 'business_owner') return fail('Business owners only.', 403)
    const sid = await mcpConnected()
    const rows = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter: {
        $or: [
          { place_id: { $in: user.owned_place_ids } },
          { added_by: user.user_id, claimed_by_owner: true },
        ],
      },
      projection: { _id: 0, place_id: 1, name: 1, categories: 1, status: 1, paused: 1, added_by: 1, claimed_by_owner: 1, created_at: 1 },
      limit: 20,
    }))
    const mine = rows.filter((row) =>
      typeof row.place_id === 'string' &&
      (user.owned_place_ids.includes(row.place_id) || (row.added_by === user.user_id && row.claimed_by_owner === true)),
    )
    const order = (id: string) => {
      const index = user.owned_place_ids.indexOf(id)
      return index === -1 ? Number.MAX_SAFE_INTEGER : index
    }
    mine.sort((a, b) => order(a.place_id as string) - order(b.place_id as string))
    const ids = mine.map((row) => row.place_id as string)
    // An empty read for an account that lists listings is a failed lookup, not a
    // deletion (owners close listings through DELETE, which relinks itself).
    if (!ids.length && user.owned_place_ids.length) return fail('Database unavailable', 503)
    if (ids.join('|') !== user.owned_place_ids.join('|')) {
      await setOwnedPlaces(user.user_id, ids)
      user.owned_place_ids = ids
      user.owned_place_id = ids[0] ?? null
    }
    if (!ids.length) return fail('No business listing.', 404)
    if (requested && !ids.includes(requested)) return fail('This listing belongs to another account.', 403)
    const placeId = requested ?? ids[0]
    const doc = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter: { place_id: placeId },
      limit: 1,
    }))[0]
    if (!doc) return fail('No business listing.', 404)
    return { ok: true, owned: { sid, user, doc, placeId, places: mine.map(summary) } }
  } catch (err) {
    if (isMcpUnavailable(err)) return fail('Database unavailable', 503)
    return fail('Could not load your business.', 500)
  }
}

/** Opaque handle for a review so the owner never sees the reviewer's account id. */
export function reviewKey(placeId: string, userId: string): string {
  return createHash('sha256').update(`${placeId}:${userId}`).digest('hex').slice(0, 16)
}
