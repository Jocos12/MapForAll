#!/usr/bin/env node
/**
 * Simulate an ESP32 RFID scan against the local MapForAll server.
 *
 *   curl -X POST http://localhost:3001/api/business/attendance/scan \
 *     -H "X-RFID-API-KEY: $RFID_API_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"uid":"1258B502","device_id":"TEST"}'
 *
 *   RFID_API_KEY=mfk_... node scripts/simulate-attendance-scan.mjs
 *   RFID_API_KEY=mfk_... node scripts/simulate-attendance-scan.mjs DEADBEEF
 *   RFID_API_KEY=mfk_... node scripts/simulate-attendance-scan.mjs --sequence
 *
 * --sequence: one real toggle, an immediate duplicate, then the opposite
 * toggle after ATTENDANCE_COOLDOWN_SECONDS (default 30).
 */

const base = (process.env.ATTENDANCE_BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
const key = process.env.RFID_API_KEY || ''
const args = process.argv.slice(2)
const sequence = args.includes('--sequence')
const uid = (args.find((a) => !a.startsWith('--')) || '1258B502').toUpperCase()
const cooldownSec = Number(process.env.ATTENDANCE_COOLDOWN_SECONDS || 30)

if (!key) {
  console.error('Set RFID_API_KEY (the per-business key from Team → RFID). Do not commit it.')
  process.exit(1)
}

async function scan(cardUid) {
  const res = await fetch(`${base}/api/business/attendance/scan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RFID-API-KEY': key,
    },
    body: JSON.stringify({ uid: cardUid, device_id: 'TEST' }),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  console.log(JSON.stringify({ status: res.status, body: json ?? text }))
  return { status: res.status, body: json }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

if (!sequence) {
  const result = await scan(uid)
  process.exit(result.status >= 500 ? 1 : 0)
}

let first = await scan(uid)
const waitMs = (Number.isFinite(cooldownSec) ? cooldownSec : 30) * 1000 + 1000
if (first.body?.type === 'duplicate') {
  console.log(`# inside cooldown — waiting ${waitMs}ms`)
  await sleep(waitMs)
  first = await scan(uid)
}
if (first.body?.type !== 'in' && first.body?.type !== 'out') {
  console.error('# expected type in or out')
  process.exit(1)
}
const opposite = first.body.type === 'in' ? 'out' : 'in'
const dup = await scan(uid)
if (dup.status !== 200 || dup.body?.type !== 'duplicate') {
  console.error('# expected duplicate with no toggle')
  process.exit(1)
}
console.log(`# waiting ${waitMs}ms for cooldown`)
await sleep(waitMs)
const third = await scan(uid)
if (third.body?.type !== opposite) {
  console.error(`# expected ${opposite} after cooldown`)
  process.exit(1)
}
console.log(`# ok ${first.body.type} → duplicate → ${opposite}`)
