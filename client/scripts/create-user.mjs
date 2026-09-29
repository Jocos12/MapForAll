/**
 * Create (or update) one user with any role, for local setup.
 *
 *   USER_PASSWORD='…' npm run user:create -- --email you@example.com --role admin --name "Your Name"
 *
 * Roles: client | business_owner | moderator | admin. The password comes from
 * the USER_PASSWORD environment variable so it never sits in a file. An
 * existing account keeps its id and history; its role, status and password
 * are updated. Hashing matches lib/password.ts ("scrypt.N.salt.hash"), so the
 * account signs in through the normal password + OTP flow.
 * Reads MONGODB_URI / MONGODB_DATABASE from client/.env.local.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoClient } from 'mongodb'

const ROLES = ['client', 'business_owner', 'moderator', 'admin']
const CLIENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvLocal() {
  const file = path.join(CLIENT_ROOT, '.env.local')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

function hashPassword(plain) {
  const N = 16384
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(plain, salt, 64, { N })
  return ['scrypt', String(N), salt.toString('base64url'), derived.toString('base64url')].join('.')
}

loadEnvLocal()
const email = (arg('email') || '').trim().toLowerCase()
const role = arg('role') || 'client'
const name = arg('name') || email.split('@')[0]
const password = process.env.USER_PASSWORD || ''

if (!email.includes('@')) throw new Error('--email is required')
if (!ROLES.includes(role)) throw new Error(`--role must be one of: ${ROLES.join(', ')}`)
if (password.length < 8) throw new Error('USER_PASSWORD must be at least 8 characters')
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing from client/.env.local')

const client = new MongoClient(process.env.MONGODB_URI)
await client.connect()
try {
  const users = client.db(process.env.MONGODB_DATABASE || 'hodari').collection('users')
  const now = new Date().toISOString()
  const existing = await users.findOne({ email })
  if (existing) {
    await users.updateOne(
      { email },
      { $set: { role, name, status: 'active', password_hash: hashPassword(password), email_verified: true } },
    )
    console.log(`Updated ${email} → ${role}`)
  } else {
    await users.insertOne({
      user_id: `u_${crypto.randomBytes(8).toString('hex')}`,
      email,
      name,
      password_hash: hashPassword(password),
      role,
      status: 'active',
      owned_place_id: null,
      token_version: 0,
      email_verified: true,
      languages: ['fr', 'en', 'rw'],
      lang: 'fr',
      dietary: [],
      budget_tier: 'moderate',
      accessibility: [],
      home_country: 'RW',
      created_at: now,
      last_active_at: null,
    })
    console.log(`Created ${email} → ${role}`)
  }
} finally {
  await client.close()
}
