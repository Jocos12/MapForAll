import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyCookie, idleWindowMs, sessionExpired, signSession, type SessionPayload } from './sessionRules.ts'

process.env.HODARI_SESSION_SECRET = process.env.HODARI_SESSION_SECRET || 'test-secret'

test('owner sessions last 7 days and admin sessions last 12 hours', () => {
  assert.equal(idleWindowMs('business_owner'), 7 * 24 * 60 * 60 * 1000)
  assert.equal(idleWindowMs('admin'), 12 * 60 * 60 * 1000)
  assert.equal(idleWindowMs('moderator'), 12 * 60 * 60 * 1000)
  assert.equal(idleWindowMs('client'), 7 * 24 * 60 * 60 * 1000)
})

test('each sign-in gets its own session id', () => {
  const a = classifyCookie(signSession('owner_a', 'a@example.com', 1, 'business_owner'))
  const b = classifyCookie(signSession('owner_b', 'b@example.com', 1, 'business_owner'))
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  if (!a.ok || !b.ok) return
  assert.notEqual(a.payload.sid, b.payload.sid)
  assert.equal(a.payload.uid, 'owner_a')
  assert.equal(b.payload.uid, 'owner_b')
})

test('a token is expired only after its own deadline', () => {
  const now = Date.now()
  const owner: SessionPayload = {
    uid: 'owner_a',
    tv: 1,
    scope: 'session',
    iat: now - 13 * 60 * 60 * 1000,
    last: now - 13 * 60 * 60 * 1000,
    role: 'business_owner',
  }
  const admin: SessionPayload = { ...owner, uid: 'admin', role: 'admin' }
  assert.equal(sessionExpired(owner, now), false)
  assert.equal(sessionExpired(admin, now), true)
  assert.equal(sessionExpired({ ...owner, exp: now - 1 }, now), true)
})

test('a bad signature is not an expiry', () => {
  assert.deepEqual(classifyCookie(undefined), { ok: false, reason: 'missing' })
  assert.equal(classifyCookie('not-a-token').ok, false)
  if (classifyCookie('not-a-token').ok) return
  assert.equal(classifyCookie('not-a-token').reason, 'bad_signature')
})
