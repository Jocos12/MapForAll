/**
 * Demo seed for MapForAll admin console (Kigali).
 * Usage: npm run seed:demo
 * Reads MONGODB_URI / ADMIN_EMAIL / ADMIN_PASSWORD from client/.env.local
 * (falls back to agents/.env for MONGODB_URI).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoClient } from 'mongodb'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_ROOT = path.resolve(__dirname, '..')
const AGENTS_ENV = path.resolve(CLIENT_ROOT, '../agents/.env')
const DB = process.env.MONGODB_DATABASE || 'hodari'

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvFile(path.join(CLIENT_ROOT, '.env.local'))
loadEnvFile(AGENTS_ENV)

function hashPassword(plain) {
  const N = 16384
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(plain, salt, 64, { N })
  return ['scrypt', String(N), salt.toString('base64url'), derived.toString('base64url')].join('.')
}

function daysAgo(n, hour = 12) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  d.setUTCHours(hour, Math.floor(Math.random() * 50), 0, 0)
  return d.toISOString()
}

function id(prefix, n) {
  return `${prefix}_${String(n).padStart(3, '0')}`
}

/** Kigali sectors with approx centroids */
const SECTORS = [
  { name: 'Nyarugenge', lat: -1.944, lng: 30.061 },
  { name: 'Nyamirambo', lat: -1.978, lng: 30.045 },
  { name: 'Muhima', lat: -1.937, lng: 30.059 },
  { name: 'Kimihurura', lat: -1.949, lng: 30.089 },
  { name: 'Kacyiru', lat: -1.944, lng: 30.092 },
  { name: 'Remera', lat: -1.957, lng: 30.108 },
  { name: 'Gisozi', lat: -1.931, lng: 30.061 },
  { name: 'Kimironko', lat: -1.950, lng: 30.126 },
  { name: 'Kicukiro', lat: -1.978, lng: 30.105 },
  { name: 'Gatenga', lat: -1.990, lng: 30.100 },
  { name: 'Gikondo', lat: -1.970, lng: 30.085 },
  { name: 'Kibagabaga', lat: -1.935, lng: 30.110 },
]

const CATEGORIES = ['market', 'restaurant', 'cafe', 'shop', 'pharmacy', 'hotel', 'clinic', 'attraction']

const PLACE_NAMES = [
  ['Kimironko Market', 'market', true, false],
  ["Nyamirambo Women's Centre", 'cafe', true, true],
  ['Caplaki Craft Village', 'shop', true, false],
  ['Kigali Genocide Memorial', 'attraction', false, true],
  ['Bourbon Coffee Kigali Heights', 'cafe', false, true],
  ['Inema Arts Centre', 'attraction', true, true],
  ['Kigali City Market', 'market', true, false],
  ['Question Coffee Café', 'cafe', true, true],
  ['Heaven Restaurant', 'restaurant', false, true],
  ['Repub Lounge', 'restaurant', false, false],
  ['Nyabugogo Bus Park Stalls', 'market', true, false],
  ['Biryogo Market', 'market', true, false],
  ['Ivuka Arts', 'shop', true, false],
  ['Kigali Public Library', 'attraction', false, true],
  ['Amahoro Stadium Gate', 'attraction', false, true],
  ['La Galette', 'cafe', true, false],
  ['Poivre Noir', 'restaurant', false, false],
  ['Shokola', 'cafe', true, true],
  ['Nyarugenge Market', 'market', true, false],
  ['Ubumwe Grande Hotel', 'hotel', false, true],
  ['Kigali Marriott Hotel', 'hotel', false, true],
  ['Radisson Blu Hotel Kigali', 'hotel', false, true],
  ['Hôtel des Mille Collines', 'hotel', false, true],
  ['Park Inn by Radisson Kigali', 'hotel', false, true],
  ['Legacy Clinics', 'clinic', true, true],
  ['Kimihurura Craft Stalls', 'shop', true, false],
  ['Pharmacie Conseil', 'pharmacy', true, true],
  ['Kigali Convention Centre', 'attraction', false, true],
  ['Muhima Market', 'market', true, false],
  ['Ikaze Cooperative', 'shop', true, true],
  ['Sawa Citi', 'restaurant', false, false],
  ['Remera Fresh Fruits', 'market', true, false],
  ['Gatenga Tailors Hub', 'shop', true, false],
  ['Kibagabaga Health Post', 'clinic', true, true],
  ['Kacyiru Juice Bar', 'cafe', true, true],
  ['Gikondo Metal Works', 'shop', true, false],
]

const FIRST = ['Aline', 'Jean', 'Uwase', 'Eric', 'Divine', 'Patrick', 'Grace', 'Kevin', 'Claudine', 'Yves', 'Sandrine', 'Bosco', 'Diane', 'Olivier', 'Chantal', 'Fabrice', 'Immaculée', 'Samuel', 'Solange', 'Thierry', 'Ange', 'Roger']
const LAST = ['Uwimana', 'Niyonsenga', 'Mukamana', 'Habimana', 'Ingabire', 'Nkurunziza', 'Uwase', 'Mugisha', 'Iradukunda', 'Bizimana']

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MDB_MCP_CONNECTION_STRING
  if (!uri) {
    console.error('MONGODB_URI missing in .env.local or agents/.env')
    process.exit(1)
  }

  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db(DB)
  console.log(`Connected → ${DB}`)

  // ── Admin from env ────────────────────────────────────────────────────────
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const adminPass = process.env.ADMIN_PASSWORD || ''
  if (adminEmail && adminPass) {
    const existing = await db.collection('users').findOne({ email: adminEmail })
    const now = new Date().toISOString()
    if (!existing) {
      await db.collection('users').insertOne({
        user_id: `admin_${crypto.randomBytes(6).toString('hex')}`,
        email: adminEmail,
        name: 'Admin MapForAll',
        password_hash: hashPassword(adminPass),
        role: 'admin',
        status: 'active',
        token_version: 0,
        email_verified: true,
        languages: ['fr', 'en', 'rw'],
        lang: 'fr',
        budget_tier: 'moderate',
        home_country: 'RW',
        created_at: now,
        last_active_at: now,
        last_login_at: now,
      })
      console.log(`Admin created: ${adminEmail}`)
    } else {
      await db.collection('users').updateOne(
        { email: adminEmail },
        {
          $set: {
            role: 'admin',
            status: 'active',
            password_hash: hashPassword(adminPass),
            email_verified: true,
          },
        },
      )
      console.log(`Admin updated: ${adminEmail}`)
    }
  } else {
    console.warn('ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping bootstrap admin')
  }

  // ── Demo users (20+) ──────────────────────────────────────────────────────
  const users = []
  for (let i = 0; i < 22; i++) {
    const email = `demo.user${String(i + 1).padStart(2, '0')}@mapforall.rw`
    const role = i === 0 ? 'moderator' : i < 5 ? 'business_owner' : 'client'
    const createdDays = 5 + Math.floor(Math.random() * 55)
    users.push({
      user_id: id('demo_user', i + 1),
      email,
      name: `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`,
      password_hash: hashPassword('DemoPass123!'),
      role,
      status: i === 21 ? 'suspended' : 'active',
      token_version: 0,
      email_verified: true,
      languages: ['fr', 'en', 'rw'],
      lang: i % 3 === 0 ? 'rw' : i % 3 === 1 ? 'en' : 'fr',
      budget_tier: 'moderate',
      home_country: 'RW',
      avatar_url: null,
      created_at: daysAgo(createdDays),
      last_active_at: daysAgo(Math.floor(Math.random() * 7)),
      last_login_at: daysAgo(Math.floor(Math.random() * 5)),
      demo_seed: true,
    })
  }
  await db.collection('users').deleteMany({ demo_seed: true })
  await db.collection('users').insertMany(users)
  console.log(`Users: ${users.length}`)

  // ── Places (30+) ──────────────────────────────────────────────────────────
  const places = PLACE_NAMES.map(([name, category, local, accessible], i) => {
    const sector = SECTORS[i % SECTORS.length]
    const jitter = () => (Math.random() - 0.5) * 0.012
    const status =
      i < 5 ? 'pending' : i === 5 ? 'rejected' : i === 6 ? 'rejected' : 'validated'
    const createdDays = status === 'pending' ? Math.floor(Math.random() * 5) : 8 + Math.floor(Math.random() * 52)
    const author = users[i % users.length]
    return {
      place_id: id('kgl_demo', i + 1),
      name,
      city: 'Kigali',
      country: 'Rwanda',
      sector: sector.name,
      address: `${sector.name}, Kigali`,
      categories: [category],
      description: `${name} — neighbourhood spot in ${sector.name}.`,
      summary: `${name} in ${sector.name}, Kigali.`,
      rating: Number((3.8 + Math.random() * 1.2).toFixed(1)),
      price_level: local ? 'PRICE_LEVEL_INEXPENSIVE' : 'PRICE_LEVEL_MODERATE',
      location: {
        type: 'Point',
        coordinates: [sector.lng + jitter(), sector.lat + jitter()],
      },
      local_business: local,
      accessible,
      access: {
        entrance: accessible,
        toilet: accessible && i % 2 === 0,
        parking: accessible && i % 3 === 0,
      },
      access_confirmations: accessible ? 1 + (i % 6) : 0,
      status,
      source: i % 4 === 0 ? 'user_submitted' : i % 7 === 0 ? 'owner_claimed' : 'official',
      added_by: author.user_id,
      claimed_by_owner: i % 7 === 0,
      confirmations_count: Math.floor(Math.random() * 12),
      views: Math.floor(Math.random() * 400) + (status === 'validated' ? 40 : 0),
      photo_url: null,
      photos: [],
      rejection_reason: status === 'rejected' ? 'incomplete_info' : null,
      moderated_at: status !== 'pending' ? daysAgo(createdDays - 1) : null,
      created_at: daysAgo(createdDays),
      lang_content: {
        fr: { name, summary: `Description FR — ${name}` },
        en: { name, summary: `EN summary — ${name}` },
        rw: i % 2 === 0 ? { name, summary: `Incamake RW — ${name}` } : undefined,
      },
      demo_seed: true,
    }
  })
  await db.collection('places').deleteMany({ demo_seed: true })
  await db.collection('places').insertMany(places)
  console.log(`Places: ${places.length}`)

  // ── Reports ───────────────────────────────────────────────────────────────
  const reportTypes = ['closed', 'outdated', 'incorrect', 'inappropriate']
  const reports = []
  for (let i = 0; i < 18; i++) {
    const place = places[10 + (i % 20)]
    const reporter = users[(i + 3) % users.length]
    const priority = i < 4 ? 'urgent' : i < 10 ? 'normal' : 'low'
    const status = i < 8 ? 'open' : i < 12 ? 'resolved' : 'ignored'
    reports.push({
      report_id: id('rpt', i + 1),
      place_id: place.place_id,
      place_name: place.name,
      type: reportTypes[i % reportTypes.length],
      priority,
      status,
      comment: `Demo report ${i + 1} on ${place.name}`,
      reporter_uid: reporter.user_id,
      reporter_email: reporter.email,
      created_at: daysAgo(Math.floor(Math.random() * 40)),
      resolved_at: status !== 'open' ? daysAgo(Math.floor(Math.random() * 10)) : null,
      demo_seed: true,
    })
  }
  await db.collection('place_reports').deleteMany({ demo_seed: true })
  await db.collection('place_reports').insertMany(reports)
  console.log(`Reports: ${reports.length}`)

  // ── Reviews ───────────────────────────────────────────────────────────────
  const reviews = []
  for (let i = 0; i < 40; i++) {
    const place = places.filter((p) => p.status === 'validated')[i % 28]
    const user = users[i % users.length]
    reviews.push({
      placeId: place.place_id,
      userId: user.user_id,
      rating: 1 + Math.floor(Math.random() * 5),
      comment: i % 11 === 0 ? 'Spam promo link http://bad.example' : `Nice place in ${place.sector}.`,
      firstName: user.name.split(' ')[0],
      hidden: i % 15 === 0,
      createdAt: daysAgo(Math.floor(Math.random() * 55)),
      updatedAt: daysAgo(Math.floor(Math.random() * 20)),
      demo_seed: true,
    })
  }
  await db.collection('reviews').deleteMany({ demo_seed: true })
  await db.collection('reviews').insertMany(reviews)
  console.log(`Reviews: ${reviews.length}`)

  // ── Place views — 60 days history ─────────────────────────────────────────
  const views = []
  for (let d = 0; d < 60; d++) {
    const dayPlaces = places.filter((p) => p.status === 'validated')
    const n = 8 + Math.floor(Math.random() * 20)
    for (let j = 0; j < n; j++) {
      const p = dayPlaces[(d + j) % dayPlaces.length]
      views.push({
        place_id: p.place_id,
        at: daysAgo(d, 8 + Math.floor(Math.random() * 12)),
        source: j % 3 === 0 ? 'map' : 'search',
        demo_seed: true,
      })
    }
  }
  await db.collection('place_views').deleteMany({ demo_seed: true })
  // insert in chunks
  for (let i = 0; i < views.length; i += 500) {
    await db.collection('place_views').insertMany(views.slice(i, i + 500))
  }
  console.log(`Views: ${views.length}`)

  // ── Community confirmations ───────────────────────────────────────────────
  const exists = []
  for (let i = 0; i < 35; i++) {
    const p = places[i % places.length]
    exists.push({
      place_id: p.place_id,
      user_id: users[i % users.length].user_id,
      exists: true,
      at: daysAgo(Math.floor(Math.random() * 30)),
      demo_seed: true,
    })
  }
  await db.collection('place_exists').deleteMany({ demo_seed: true })
  await db.collection('place_exists').insertMany(exists)

  // ── Audit samples ─────────────────────────────────────────────────────────
  const audits = []
  for (let i = 0; i < 25; i++) {
    const p = places[i % places.length]
    audits.push({
      audit_id: id('aud', i + 1),
      at: daysAgo(Math.floor(Math.random() * 20)),
      actor_uid: users[0].user_id,
      actor_email: users[0].email,
      actor_role: 'moderator',
      action: i % 2 === 0 ? 'place.validate' : 'place.reject',
      target_type: 'place',
      target_id: p.place_id,
      before: { status: 'pending' },
      after: { status: i % 2 === 0 ? 'validated' : 'rejected' },
      meta: { demo: true },
      demo_seed: true,
    })
  }
  await db.collection('admin_audit').deleteMany({ demo_seed: true })
  await db.collection('admin_audit').insertMany(audits)
  console.log(`Audit rows: ${audits.length}`)

  // ── Scoring settings defaults ─────────────────────────────────────────────
  await db.collection('admin_settings').updateOne(
    { key: 'scoring' },
    {
      $set: {
        key: 'scoring',
        local_bonus: 0.15,
        accessible_bonus: 0.12,
        confirmation_threshold: 3,
        updated_at: new Date().toISOString(),
      },
    },
    { upsert: true },
  )

  await db.collection('admin_settings').updateOne(
    { key: 'app' },
    {
      $set: {
        key: 'app',
        default_lang: 'fr',
        demo_mode: false,
        email: {
          welcome_subject: 'Welcome to MapForAll, {name}!',
          otp_subject: '{code} is your MapForAll sign-in code',
          validate_subject: 'Your place was approved on MapForAll',
          reject_subject: 'Update needed for your MapForAll submission',
        },
        updated_at: new Date().toISOString(),
      },
    },
    { upsert: true },
  )

  await client.close()
  console.log('Seed complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
