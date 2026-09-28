/**
 * One-shot: promote pending owner-claimed listings to validated so they are
 * immediately visible on the public map (cahier §4.2). Safe to re-run.
 *
 * Usage (from client/):
 *   node scripts/promote-owner-claimed.mjs
 */
import { MongoClient } from 'mongodb'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const file of ['.env.local', '.env']) {
  const path = resolve(root, file)
  if (!existsSync(path)) continue
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (!m || process.env[m[1].trim()]) continue
    process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const uri = process.env.MONGODB_URI || process.env.MDB_MCP_CONNECTION_STRING
const dbName = process.env.MONGODB_DATABASE || 'hodari'
if (!uri) {
  console.error('Missing MONGODB_URI')
  process.exit(1)
}

const client = new MongoClient(uri)
await client.connect()
const col = client.db(dbName).collection('places')

const filter = {
  $or: [{ claimed_by_owner: true }, { source: 'owner_claimed' }],
  status: 'pending',
  paused: { $ne: true },
}
const found = await col.find(filter, { projection: { place_id: 1, name: 1, status: 1 } }).toArray()
console.log(`Pending owner-claimed listings: ${found.length}`)
for (const doc of found) console.log(`  - ${doc.name} (${doc.place_id})`)

const result = await col.updateMany(filter, {
  $set: {
    status: 'validated',
    updated_at: new Date().toISOString(),
    auto_validated_at: new Date().toISOString(),
  },
})
console.log(`Promoted to validated: ${result.modifiedCount}`)

const published = await col.find(
  { status: 'validated', paused: { $ne: true }, claimed_by_owner: true },
  { projection: { place_id: 1, name: 1, categories: 1, local_business: 1, accessible: 1, address: 1 } },
).limit(20).toArray()
console.log(`\nPublished owner listings (sample ${published.length}):`)
for (const doc of published) {
  console.log(`  ✓ ${doc.name} · ${doc.categories?.[0] ?? '?'} · local=${!!doc.local_business} · access=${!!doc.accessible}`)
}

await client.close()
