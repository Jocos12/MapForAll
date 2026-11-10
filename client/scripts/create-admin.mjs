/**
 * Local helper: create or update ONLY the admin account from client/.env.local
 * (ADMIN_EMAIL / ADMIN_PASSWORD). No demo data. Run from client/:
 *   npm run create-admin
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoClient } from 'mongodb'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
const pass = process.env.ADMIN_PASSWORD || ''
if (!email || !pass) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in client/.env.local')

const hash = (plain) => {
  const salt = crypto.randomBytes(16)
  const d = crypto.scryptSync(plain, salt, 64, { N: 16384 })
  return ['scrypt', '16384', salt.toString('base64url'), d.toString('base64url')].join('.')
}

const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017')
await client.connect()
const users = client.db(process.env.MONGODB_DATABASE || 'hodari').collection('users')
const now = new Date().toISOString()
const res = await users.updateOne(
  { email },
  {
    $set: { role: 'admin', status: 'active', password_hash: hash(pass), email_verified: true },
    $setOnInsert: {
      user_id: `admin_${crypto.randomBytes(6).toString('hex')}`,
      email, name: 'Admin MapForAll', token_version: 0,
      languages: ['fr', 'en', 'rw'], lang: 'fr', budget_tier: 'moderate', home_country: 'RW',
      created_at: now, last_active_at: now,
    },
  },
  { upsert: true },
)
console.log(res.upsertedCount ? `Admin created: ${email}` : `Admin updated: ${email}`)
await client.close()
