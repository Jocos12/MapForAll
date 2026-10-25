/**
 * Reset views on unpublished places and recompute views_total from place_stats_daily.
 * Dry-run by default. Pass --apply to write.
 *
 *   node scripts/reconcile-views.mjs
 *   node scripts/reconcile-views.mjs --apply
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

function published(doc) {
  if (doc.deleted_at || doc.archived === true || doc.paused === true) return false
  const status = typeof doc.status === 'string' && doc.status ? doc.status : 'validated'
  return status === 'validated'
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
  const places = db.collection('places')
  const daily = db.collection('place_stats_daily')
  const rows = await places.find({}, { projection: { place_id: 1, name: 1, status: 1, paused: 1, archived: 1, deleted_at: 1, views: 1, views_total: 1 } }).toArray()
  const sums = await daily.aggregate([
    { $group: { _id: '$placeId', views: { $sum: '$views' } } },
  ]).toArray()
  const byId = new Map(sums.map((row) => [String(row._id), Number(row.views) || 0]))
  let zeroed = 0
  let recomputed = 0
  for (const doc of rows) {
    const id = String(doc.place_id || '')
    if (!id) continue
    const official = byId.get(id) ?? 0
    const stored = Number(doc.views_total ?? doc.views ?? 0) || 0
    if (!published(doc) && stored !== 0) {
      zeroed += 1
      console.log(`zero ${id} ${doc.name || ''} stored=${stored}`)
      if (apply) await places.updateOne({ place_id: id }, { $set: { views: 0, views_total: 0 } })
      continue
    }
    if (published(doc) && stored !== official && byId.has(id)) {
      recomputed += 1
      console.log(`recompute ${id} ${doc.name || ''} stored=${stored} daily=${official}`)
      if (apply) await places.updateOne({ place_id: id }, { $set: { views: official, views_total: official } })
    }
  }
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const stale = await db.collection('place_view_events').countDocuments({ at: { $lt: cutoff } })
  if (apply && stale) await db.collection('place_view_events').deleteMany({ at: { $lt: cutoff } })
  console.log(`${apply ? 'applied' : 'dry-run'} zeroed=${zeroed} recomputed=${recomputed} staleEvents=${stale}`)
  await client.close()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
