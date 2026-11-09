/**
 * Attach Google photo names to validated places that have none.
 * Dry-run by default. Pass --apply to write.
 *
 *   node --experimental-strip-types scripts/attach-google-photos.ts
 *   node --experimental-strip-types scripts/attach-google-photos.ts --apply
 */
import { readFileSync } from 'node:fs'
import { MongoClient } from 'mongodb'
import { googlePhotosNear, photosAreFresh } from '../lib/googlePlacePhotos.ts'

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

function point(doc: Record<string, unknown>): { lat: number; lng: number } | null {
  const location = doc.location as { coordinates?: unknown } | undefined
  const coords = location?.coordinates
  if (!Array.isArray(coords)) return null
  const lng = Number(coords[0])
  const lat = Number(coords[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

async function main() {
  loadEnv()
  const uri = process.env.MONGODB_URI
  const key = process.env.GOOGLE_MAPS_SERVER_KEY ?? ''
  if (!uri) {
    console.error('MONGODB_URI is not set')
    process.exit(1)
  }
  if (!key) {
    console.error('GOOGLE_MAPS_SERVER_KEY is not set')
    process.exit(1)
  }
  const apply = process.argv.includes('--apply')
  const client = new MongoClient(uri)
  await client.connect()
  const places = client.db(process.env.MONGODB_DATABASE ?? 'hodari').collection('places')
  const rows = await places.find({
    status: 'validated',
    $or: [{ photos: { $exists: false } }, { photos: { $size: 0 } }, { photos: null }],
  }).limit(40).toArray()
  let attached = 0
  for (const doc of rows) {
    const name = String(doc.name ?? '')
    if (!name) continue
    if (Array.isArray(doc.google_photo_names) && doc.google_photo_names.length && photosAreFresh(doc.google_photos_at)) {
      console.log(`fresh ${name}`)
      continue
    }
    const where = point(doc)
    if (!where) {
      console.log(`skip ${name}: no coordinates`)
      continue
    }
    const found = await googlePhotosNear(name, where.lat, where.lng, key)
    if (!found?.names.length) {
      console.log(`none ${name}`)
      continue
    }
    console.log(`${apply ? 'write' : 'would write'} ${name} place=${found.placeId} photos=${found.names.length} attribution=Photo: Google`)
    if (apply) {
      await places.updateOne({ _id: doc._id }, {
        $set: {
          google_place_id: found.placeId,
          google_photo_names: found.names,
          google_photos_at: new Date().toISOString(),
        },
      })
      attached += 1
    }
  }
  console.log(apply ? `updated ${attached}` : `dry-run ${rows.length} places, pass --apply to write`)
  await client.close()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
