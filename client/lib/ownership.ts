/**
 * Pure ownership gate shared by listing, photos, employees, RFID keys, and stats.
 * A business owner may touch a row only when owner_id is their user id.
 * Legacy rows without owner_id fall back to added_by + claimed, or an owned id list
 * that has not been contradicted by a different owner_id.
 */

export type AccountRole = 'admin' | 'moderator' | 'business_owner' | 'client' | string

export interface Actor {
  uid: string
  role: AccountRole
}

export interface OwnedRecord {
  owner_id?: string | null
  added_by?: string | null
  claimed_by_owner?: boolean | null
  place_id?: string | null
}

export type AccessDecision = 'allow' | 'deny'

export function recordOwnerId(record: OwnedRecord, ownedPlaceIds: readonly string[] = []): string | null {
  if (typeof record.owner_id === 'string' && record.owner_id) return record.owner_id
  if (record.claimed_by_owner === true && typeof record.added_by === 'string' && record.added_by) {
    return record.added_by
  }
  if (record.place_id && ownedPlaceIds.includes(record.place_id) && typeof record.added_by === 'string') {
    return record.added_by
  }
  return null
}

/**
 * Admin and moderator may read any business record through the admin API.
 * A business owner may read only their own. Everyone else is denied.
 * Id guessing returns deny (the route maps that to 403 or 404).
 */
export function decideBusinessAccess(
  actor: Actor | null,
  record: OwnedRecord,
  ownedPlaceIds: readonly string[] = [],
): AccessDecision {
  if (!actor?.uid) return 'deny'
  if (actor.role === 'admin' || actor.role === 'moderator') return 'allow'
  if (actor.role !== 'business_owner') return 'deny'
  if (typeof record.owner_id === 'string' && record.owner_id) {
    return record.owner_id === actor.uid ? 'allow' : 'deny'
  }
  if (record.place_id && ownedPlaceIds.includes(record.place_id)) return 'allow'
  if (record.claimed_by_owner === true && record.added_by === actor.uid) return 'allow'
  return 'deny'
}

/** True when this user may list the place in "You manage". */
export function belongsToOwner(userId: string, record: OwnedRecord, ownedPlaceIds: readonly string[] = []): boolean {
  return decideBusinessAccess({ uid: userId, role: 'business_owner' }, record, ownedPlaceIds) === 'allow'
}
