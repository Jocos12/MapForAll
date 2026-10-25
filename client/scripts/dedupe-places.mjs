/**
 * Find duplicate places (same normalized name within 150 m, same phone, or same Google place id).
 * Dry-run by default. Pass --apply to archive the weaker row and copy photos, hours, and phone
 * onto the keeper, then set redirect_place_id on the old id.
 *
 *   node scripts/dedupe-places.mjs
 *   node scripts/dedupe-places.mjs --apply
 */
import { readFileSync } from 'node:fs'
import { MongoClient } from 'mongodb'

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

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

function coords(doc) {
  const c = doc.location?.coordinates
  if (typeof c?.[0] === 'number' && typeof c?.[1] === 'number') return { lng: c[0], lat: c[1] }
  return null
}

function meters(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function googleId(doc) {
  for (const key of ['google_place_id', 'maps_place_id']) {
    if (typeof doc[key] === 'string' && doc[key]) return doc[key]
  }
  return ''
}

function same(a, b) {
  const gidA = googleId(a)
  const gidB = googleId(b)
  if (gidA && gidA === gidB) return 'google_place_id'
  const phoneA = digits(a.phone)
  const phoneB = digits(b.phone)
  if (phoneA.length >= 8 && phoneA === phoneB) return 'phone'
  const nameA = normalize(a.name)
  const nameB = normalize(b.name)
  if (nameA && nameA === nameB) {
    const ca = coords(a)
    const cb = coords(b)
    if (ca && cb && meters(ca, cb) <= 150) return 'name_150m'
  }
  return ''
}

function richness(doc) {
  const photos = Array.isArray(doc.photos) ? doc.photos.length : 0
  let score = photos * 3
  if (doc.photo_url) score += 2
  if (doc.description && doc.description !== doc.name) score += 2
  if (doc.hours_week || doc.hours) score += 2
  if (doc.phone) score += 1
  if (doc.status === 'validated') score += 5
  return score
}

loadEnv()
const apply = process.argv.includes('--apply')
const uri = process.env.MONGODB_URI
const dbName = process.env.MONGODB_DATABASE || 'hodari'
if (!uri) {
  console.error('MONGODB_URI is not set. Add it to client/.env and rerun.')
  process.exit(1)
}

const client = new MongoClient(uri)
await client.connect()
try {
  const places = client.db(dbName).collection('places')
  const rows = await places.find(
    { status: { $ne: 'archived' }, archived: { $ne: true } },
    { projection: { photos: 0 } },
  ).toArray()
  const used = new Set()
  const groups = []
  for (let i = 0; i < rows.length; i += 1) {
    if (used.has(String(rows[i]._id))) continue
    const group = [rows[i]]
    for (let j = i + 1; j < rows.length; j += 1) {
      if (used.has(String(rows[j]._id))) continue
      const why = same(rows[i], rows[j])
      if (!why) continue
      group.push(rows[j])
      used.add(String(rows[j]._id))
    }
    if (group.length < 2) continue
    used.add(String(rows[i]._id))
    groups.push(group)
  }
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${groups.length} duplicate group(s) in ${dbName}.places (${rows.length} active rows)`)
  for (const group of groups) {
    const ranked = [...group].sort((a, b) => richness(b) - richness(a))
    const keeper = ranked[0]
    const losers = ranked.slice(1)
    console.log(`- keep ${keeper.place_id} "${keeper.name}"`)
    for (const loser of losers) {
      console.log(`  archive ${loser.place_id} "${loser.name}" -> redirect ${keeper.place_id}`)
      if (!apply) continue
      const fullLoser = await places.findOne({ place_id: loser.place_id }, { projection: { photos: 1, description: 1, hours: 1, hours_week: 1, phone: 1, summary: 1, photo_url: 1 } })
      const fullKeeper = await places.findOne({ place_id: keeper.place_id }, { projection: { photos: 1, description: 1, hours: 1, hours_week: 1, phone: 1, summary: 1, photo_url: 1, name: 1 } })
      const patch = { merged_from: loser.place_id, updated_at: new Date().toISOString() }
      const photos = [...(Array.isArray(fullKeeper?.photos) ? fullKeeper.photos : [])]
      for (const url of Array.isArray(fullLoser?.photos) ? fullLoser.photos : []) {
        if (typeof url === 'string' && !photos.includes(url)) photos.push(url)
      }
      if (photos.length) {
        patch.photos = photos.slice(0, 4)
        patch.photo_count = patch.photos.length
        if (!fullKeeper?.photo_url) patch.photo_url = patch.photos[0]
      }
      if ((!fullKeeper?.description || fullKeeper.description === fullKeeper.name) && fullLoser?.description) patch.description = fullLoser.description
      if (!fullKeeper?.hours_week && fullLoser?.hours_week) patch.hours_week = fullLoser.hours_week
      if (!fullKeeper?.hours && fullLoser?.hours) patch.hours = fullLoser.hours
      if (!fullKeeper?.phone && fullLoser?.phone) patch.phone = fullLoser.phone
      if (!fullKeeper?.summary && fullLoser?.summary) patch.summary = fullLoser.summary
      await places.updateOne({ place_id: keeper.place_id }, { $set: patch })
      await places.updateOne({ place_id: loser.place_id }, {
        $set: {
          status: 'archived',
          archived: true,
          paused: true,
          redirect_place_id: keeper.place_id,
          updated_at: new Date().toISOString(),
        },
      })
      await client.db(dbName).collection('reviews').updateMany({ placeId: loser.place_id }, { $set: { placeId: keeper.place_id } })
    }
  }
  if (!apply) console.log('No writes. Re-run with --apply to archive duplicates.')
} finally {
  await client.close()
}
