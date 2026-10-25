import assert from 'node:assert/strict'
import test from 'node:test'
import { decideView, isBot, viewsInPeriod } from './viewRules.ts'

const open = { kind: 'view' as const, published: true, isOwner: false, isStaff: false, bot: false, duplicateEvent: false, seenWithinWindow: false }

test('a published place counts one customer view', () => {
  assert.deepEqual(decideView(open), { count: true })
})

test('pending, owner, staff, bots, repeats and impressions do not count', () => {
  assert.equal(decideView({ ...open, published: false }).count, false)
  assert.equal(decideView({ ...open, isOwner: true }).count, false)
  assert.equal(decideView({ ...open, isStaff: true }).count, false)
  assert.equal(decideView({ ...open, bot: true }).count, false)
  assert.equal(decideView({ ...open, seenWithinWindow: true }).count, false)
  assert.equal(decideView({ ...open, duplicateEvent: true }).count, false)
  assert.equal(decideView({ ...open, kind: 'impression' }).count, false)
  assert.equal(isBot(''), true)
  assert.equal(isBot('Mozilla/5.0'), false)
})

test('admin and owner totals use the same daily aggregate', () => {
  const rows = [
    { placeId: 'cafe', day: '2026-10-20', views: 2 },
    { placeId: 'cafe', day: '2026-10-21', views: 3 },
    { placeId: 'other', day: '2026-10-21', views: 9 },
  ]
  const admin = viewsInPeriod(rows, 'cafe', '2026-10-20', '2026-10-21')
  const owner = viewsInPeriod(rows, 'cafe', '2026-10-20', '2026-10-21')
  assert.equal(admin, 5)
  assert.equal(owner, admin)
  assert.equal(viewsInPeriod(rows, 'cafe', '2026-10-21', '2026-10-21'), 3)
})
