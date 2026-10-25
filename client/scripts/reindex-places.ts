/**
 * Rebuild search fields for validated places.
 * Dry-run by default. Pass --apply to write.
 *
 *   node --experimental-strip-types scripts/reindex-places.ts
 *   node --experimental-strip-types scripts/reindex-places.ts --apply
 */
import { readFileSync } from 'node:fs'
import { MongoClient } from 'mongodb'
import { buildSearchDocument } from '../lib/searchIndex.ts'

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    try {
      const text = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
      for (const line of text.split('\n')) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (!match || process.env[match[1]]) continue
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
      }
    } catch { /* optional */ }
  }
}

function validPoint(doc: Record<string, unknown>): boolean {
  const location = doc.location as { type?: string; coordinates?: unknown } | undefined
  if (!location || location.type !== 'Point' || !Array.isArray(location.coordinates)) return false
  const lng = Number(location.coordinates[0])
  const lat = Number(location.coordinates[1])
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

async function main() {
  loadEnv()
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error('MONGODB_URI is not set')
    process.exit(1)
  }
  const apply = process.argv.includes('--apply')
  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db(process.env.MONGODB_DATABASE || 'hodari')
  const rows = await db.collection('places').find({
    $or: [{ status: 'validated' }, { status: { $exists: false } }, { status: null }],
    paused: { $ne: true },
    archived: { $ne: true },
  }).project({ embedding: 0, photos: 0 }).toArray()
  let missingCoordinates = 0
  let updated = 0
  for (const doc of rows) {
    const id = String(doc.place_id || '')
    if (!id) continue
    if (!validPoint(doc as Record<string, unknown>)) {
      missingCoordinates += 1
      console.log(`missing coordinates ${id} ${doc.name || ''}`)
      continue
    }
    const fields = buildSearchDocument(doc as Record<string, unknown>)
    updated += 1
    if (apply) await db.collection('places').updateOne({ place_id: id }, { $set: fields })
  }
  console.log(`${apply ? 'applied' : 'dry-run'} indexed=${updated} missingCoordinates=${missingCoordinates} scanned=${rows.length}`)
  await client.close()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
