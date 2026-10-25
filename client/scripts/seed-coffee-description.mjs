/**
 * Seed a realistic description on Coffee Shop + ensure text index.
 * Usage: node scripts/seed-coffee-description.mjs
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

const DESC =
  'Café calme avec wifi gratuit, idéal pour travailler en sirotant un café. Accessible en fauteuil roulant.'

const client = new MongoClient(uri)
await client.connect()
const col = client.db(dbName).collection('places')

const result = await col.updateOne(
  { name: 'Coffee Shop' },
  { $set: { description: DESC, summary: DESC, updated_at: new Date().toISOString() } },
)
console.log('Coffee Shop matched:', result.matchedCount, 'modified:', result.modifiedCount)

try {
  await col.createIndex(
    { name: 'text', description: 'text', summary: 'text', tags: 'text', categories: 'text' },
    {
      name: 'places_text_name_desc',
      default_language: 'none',
      weights: { name: 10, description: 5, summary: 5, tags: 3, categories: 2 },
    },
  )
  console.log('text index places_text_name_desc ready')
} catch (err) {
  console.log('text index note:', err instanceof Error ? err.message.slice(0, 160) : err)
}

const doc = await col.findOne(
  { name: 'Coffee Shop' },
  { projection: { name: 1, description: 1, local_business: 1, status: 1, paused: 1 } },
)
console.log(JSON.stringify(doc, null, 2))
await client.close()
