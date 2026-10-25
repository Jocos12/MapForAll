import assert from 'node:assert/strict'
import test from 'node:test'
import { firstName, greetingBucket } from './greeting.ts'
import { kigaliDayStart } from './kigali.ts'
import { existedBefore, trend } from './trend.ts'

test('greeting follows the visitor local hour', () => {
  assert.equal(greetingBucket(new Date(2026, 9, 25, 5, 0, 0)), 'morning')
  assert.equal(greetingBucket(new Date(2026, 9, 25, 11, 59, 0)), 'morning')
  assert.equal(greetingBucket(new Date(2026, 9, 25, 12, 0, 0)), 'afternoon')
  assert.equal(greetingBucket(new Date(2026, 9, 25, 17, 59, 0)), 'afternoon')
  assert.equal(greetingBucket(new Date(2026, 9, 25, 18, 0, 0)), 'evening')
  assert.equal(greetingBucket(new Date(2026, 9, 25, 4, 59, 0)), 'evening')
})

test('first name never falls back to the word undefined', () => {
  assert.equal(firstName('Joseph Habimana', 'j@example.com'), 'Joseph')
  assert.equal(firstName('', 'demo.user02@mapforall.rw'), 'demo.user02')
  assert.equal(firstName('undefined', 'owner@example.com'), 'owner')
  assert.equal(firstName(undefined, undefined), '')
})

test('trend never shows -100% while the current value is still positive', () => {
  assert.deepEqual(trend(0, 0), { kind: 'none' })
  assert.deepEqual(trend(8, 0), { kind: 'new' })
  assert.deepEqual(trend(0, 4), { kind: 'pct', pct: -100 })
  assert.deepEqual(trend(8, 8), { kind: 'pct', pct: 0 })
  assert.deepEqual(trend(12, 8), { kind: 'pct', pct: 50 })
  assert.equal(trend(1, 200).kind, 'pct')
  if (trend(1, 200).kind === 'pct') assert.ok(trend(1, 200).pct > -100)
  assert.equal(existedBefore(undefined, new Date('2026-10-01T00:00:00Z')), true)
  assert.equal(existedBefore('2026-09-01T00:00:00Z', new Date('2026-10-01T00:00:00Z')), true)
  assert.equal(existedBefore('2026-10-02T00:00:00Z', new Date('2026-10-01T00:00:00Z')), false)
})

test('Kigali midnight is 22:00 UTC the day before', () => {
  assert.equal(kigaliDayStart(2026, 10, 25).toISOString(), '2026-10-24T22:00:00.000Z')
})
