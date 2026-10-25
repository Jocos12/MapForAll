import assert from 'node:assert/strict'
import test from 'node:test'
import { decideBusinessAccess, belongsToOwner } from './ownership.ts'
import { inReviewQueue, isPublished, ownerBadge } from './listingLifecycle.ts'
import { stepFieldErrors } from './businessFormSchema.ts'
import { chooseKeeper, mergedKeeperPatch } from './listingMerge.ts'

const ownerA = { uid: 'user_a', role: 'business_owner' as const }
const ownerB = { uid: 'user_b', role: 'business_owner' as const }
const admin = { uid: 'user_admin', role: 'admin' as const }
const client = { uid: 'user_c', role: 'client' as const }

const listingB = { place_id: 'user_b_shop', owner_id: 'user_b', added_by: 'user_b', claimed_by_owner: true }

test('owner A cannot read, edit, or delete owner B resources by id', () => {
  for (const resource of [
    listingB,
    { ...listingB, kind: 'photos' },
    { ...listingB, kind: 'employees' },
    { ...listingB, kind: 'rfid' },
    { ...listingB, kind: 'stats' },
  ]) {
    assert.equal(decideBusinessAccess(ownerA, resource), 'deny')
  }
  assert.equal(decideBusinessAccess(ownerB, listingB), 'allow')
  assert.equal(decideBusinessAccess(admin, listingB), 'allow')
  assert.equal(decideBusinessAccess(client, listingB), 'deny')
  assert.equal(decideBusinessAccess(null, listingB), 'deny')
})

test('owned id list cannot override a different owner_id', () => {
  assert.equal(belongsToOwner('user_a', listingB, ['user_b_shop']), false)
  assert.equal(belongsToOwner('user_b', { place_id: 'legacy', added_by: 'user_b', claimed_by_owner: true }, []), true)
})

test('unpublished places are not public and the owner badge matches status', () => {
  assert.equal(isPublished({ status: 'in_review' }), false)
  assert.equal(isPublished({ status: 'pending' }), false)
  assert.equal(isPublished({ status: 'validated', paused: true }), false)
  assert.equal(isPublished({ status: 'validated' }), true)
  assert.equal(isPublished({}), true)
  assert.equal(ownerBadge('pending', false), 'in_review')
  assert.equal(ownerBadge('in_review', false), 'in_review')
  assert.equal(ownerBadge('validated', false), 'validated')
  assert.equal(ownerBadge('validated', true), 'paused')
  assert.equal(ownerBadge('changes_requested', false), 'changes_requested')
  assert.equal(inReviewQueue('in_review'), true)
  assert.equal(inReviewQueue('validated'), false)
})

test('onboarding steps report inline field errors and accept a complete step', () => {
  const empty = {
    name: '',
    category: '',
    phone: 'abc',
    description: '',
    address: '',
    latitude: null,
    longitude: null,
    hoursWeek: null,
    photos: [],
  }
  const identity = stepFieldErrors('identity', empty)
  assert.ok(identity.name)
  assert.ok(identity.category)
  assert.ok(identity.phone)
  const address = stepFieldErrors('address', empty)
  assert.ok(address.latitude)
  assert.ok(stepFieldErrors('hours', empty).hoursWeek)
  assert.ok(stepFieldErrors('photos', empty).photos)
  const ok = stepFieldErrors('identity', { ...empty, name: 'Coffee Shop', category: 'cafe', phone: '+250788000000' })
  assert.deepEqual(ok, {})
})

test('merge keeps the richer record and redirects the duplicate', () => {
  const thin = { place_id: 'dup_a', name: 'Demo Tailor · Kimisagara', status: 'pending', photos: [] }
  const rich = {
    place_id: 'dup_b',
    name: 'Demo Tailor · Kimisagara',
    status: 'validated',
    photos: ['data:image/jpeg;base64,aaa'],
    phone: '+250788111111',
    hours: '08:00-18:00',
  }
  const { keeper, loser } = chooseKeeper(thin, rich)
  assert.equal(keeper.place_id, 'dup_b')
  assert.equal(loser.place_id, 'dup_a')
  const patch = mergedKeeperPatch(rich, { ...thin, description: 'Tailor in Kimisagara' })
  assert.equal(patch.description, 'Tailor in Kimisagara')
  assert.equal(patch.merged_from, 'dup_a')
})
