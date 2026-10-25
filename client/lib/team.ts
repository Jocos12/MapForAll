import { createHash, randomBytes } from 'node:crypto'
import { publish } from '@/lib/attendanceEvents'
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'
import { DB } from '@/lib/business'

export const EMPLOYEES = 'employees'
export const ATTENDANCE = 'attendance_events'
export const PLACE_KEYS = 'place_attendance_keys'

export type EmployeeStatus = 'active' | 'on_leave' | 'removed'

export interface EmployeeDoc {
  employee_id: string
  place_id: string
  owner_id: string
  badge_code: string
  name: string
  role: string
  phone: string
  photo: string | null
  status: EmployeeStatus
  card_uid: string | null
  created_at: string
  updated_at: string
  removed_at: string | null
}

export type AttendanceSource = 'manual' | 'rfid'
export type PunchType = 'in' | 'out'

export interface AttendanceEvent {
  event_id: string
  place_id: string
  employee_id: string
  type: PunchType
  at: string
  source: AttendanceSource
  device_id: string | null
  date: string
}

export type DayPresence =
  | { kind: 'on_leave' }
  | { kind: 'absent' }
  | { kind: 'present'; since: string }
  | { kind: 'left'; at: string }

const TZ = 'Africa/Kigali'

let indexesOnce: Promise<void> | null = null

/**
 * Best-effort indexes. Opt-in: like places, MCP HTTP create-index can stall the
 * shared session for ~20s and time out the next find (Employees OK, Today fails).
 * Set HODARI_ENSURE_INDEXES=1 to enable; otherwise Mongo works without them.
 */
export function ensureTeamIndexes(): void {
  if (process.env.HODARI_ENSURE_INDEXES !== '1' || indexesOnce) return
  indexesOnce = (async () => {
    const sid = await mcpConnected()
    const specs: Array<{ collection: string; keys: Record<string, unknown>; name: string }> = [
      { collection: EMPLOYEES, keys: { place_id: 1, status: 1 }, name: 'emp_place_status' },
      { collection: EMPLOYEES, keys: { place_id: 1, badge_code: 1 }, name: 'emp_place_badge' },
      { collection: EMPLOYEES, keys: { card_uid: 1 }, name: 'emp_card_uid' },
      { collection: ATTENDANCE, keys: { place_id: 1, date: 1 }, name: 'att_place_date' },
      { collection: ATTENDANCE, keys: { employee_id: 1, date: 1 }, name: 'att_employee_date' },
      { collection: ATTENDANCE, keys: { place_id: 1, employee_id: 1, at: 1 }, name: 'att_place_emp_at' },
      { collection: PLACE_KEYS, keys: { place_id: 1 }, name: 'att_key_place' },
      { collection: PLACE_KEYS, keys: { key_hash: 1 }, name: 'att_key_hash' },
    ]
    for (const spec of specs) {
      try {
        await mcpCall(sid, 'create-index', {
          database: DB,
          collection: spec.collection,
          definition: [{ type: 'classic', keys: spec.keys }],
          name: spec.name,
        })
      } catch (err) {
        console.warn(`[team] create-index ${spec.collection}.${spec.name} failed (non-fatal)`, err)
      }
    }
  })().catch((err) => {
    console.warn('[team] index bootstrap failed', err)
    indexesOnce = null
  })
}

export function dayKey(isoOrDate: string | Date = new Date()): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Wall clock in Africa/Kigali, always HH:MM (server time). */
export function formatTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  let hh = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00'
  if (hh === '24') hh = '00'
  return `${hh}:${mm}`
}

/** Ignore a second tap inside this window. ATTENDANCE_COOLDOWN_SECONDS, default 30. */
export function attendanceCooldownMs(): number {
  const raw = process.env.ATTENDANCE_COOLDOWN_SECONDS
  if (raw === undefined || raw.trim() === '') return 30_000
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 30_000
  return Math.round(n * 1000)
}

export function blockedEmployeeMessage(status: string): string | null {
  const s = status.trim().toLowerCase()
  if (s === 'on_leave' || s === 'on leave') return 'Employee is on leave.'
  if (s === 'removed' || s === 'deleted') return 'Employee was removed.'
  return null
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** Mint a per-place RFID device key — shown once to the owner. */
export function mintApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `mfk_${randomBytes(24).toString('hex')}`
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 10) }
}

export async function nextBadgeCode(sid: string, placeId: string): Promise<string> {
  const rows = extractDocs(await mcpCall(sid, 'find', {
    database: DB,
    collection: EMPLOYEES,
    filter: { place_id: placeId },
    projection: { _id: 0, badge_code: 1 },
    limit: 500,
  }))
  let max = 0
  for (const row of rows) {
    const m = typeof row.badge_code === 'string' ? row.badge_code.match(/^EMP-(\d+)$/i) : null
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `EMP-${String(max + 1).padStart(4, '0')}`
}

export function toEmployeePublic(doc: Record<string, unknown>) {
  return {
    employee_id: String(doc.employee_id ?? ''),
    place_id: String(doc.place_id ?? ''),
    badge_code: String(doc.badge_code ?? ''),
    name: String(doc.name ?? ''),
    role: String(doc.role ?? ''),
    phone: typeof doc.phone === 'string' ? doc.phone : '',
    photo: typeof doc.photo === 'string' ? doc.photo : null,
    status: (doc.status === 'on_leave' || doc.status === 'removed' ? doc.status : 'active') as EmployeeStatus,
    card_uid: typeof doc.card_uid === 'string' ? doc.card_uid : null,
    created_at: String(doc.created_at ?? ''),
    updated_at: String(doc.updated_at ?? ''),
  }
}

/** Derive today's presence label from ordered punch events. */
export function presenceFromEvents(
  status: EmployeeStatus,
  events: Array<{ type: string; at: string }>,
): DayPresence {
  if (status === 'on_leave') return { kind: 'on_leave' }
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at))
  let openIn: string | null = null
  let lastOut: string | null = null
  for (const ev of ordered) {
    if (ev.type === 'in') openIn = ev.at
    else if (ev.type === 'out') {
      lastOut = ev.at
      openIn = null
    }
  }
  if (openIn) return { kind: 'present' as const, since: openIn }
  if (lastOut) return { kind: 'left' as const, at: lastOut }
  return { kind: 'absent' as const }
}

/** Sum worked milliseconds from in/out pairs (open shift counts until `untilIso`). */
export function workedMs(
  events: Array<{ type: string; at: string }>,
  untilIso = new Date().toISOString(),
): number {
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at))
  let total = 0
  let open: string | null = null
  for (const ev of ordered) {
    if (ev.type === 'in') open = ev.at
    else if (ev.type === 'out' && open) {
      total += Math.max(0, Date.parse(ev.at) - Date.parse(open))
      open = null
    }
  }
  if (open) total += Math.max(0, Date.parse(untilIso) - Date.parse(open))
  return total
}

export function hoursLabel(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h${String(m).padStart(2, '0')}`
}

export async function findActiveEmployee(
  sid: string,
  placeId: string,
  employeeId: string,
): Promise<Record<string, unknown> | null> {
  const row = extractDocs(await mcpCall(sid, 'find', {
    database: DB,
    collection: EMPLOYEES,
    filter: { place_id: placeId, employee_id: employeeId, status: { $ne: 'removed' } },
    limit: 1,
  }))[0]
  return row ?? null
}

export async function listEmployees(sid: string, placeId: string, includeRemoved = false) {
  const filter: Record<string, unknown> = { place_id: placeId }
  if (!includeRemoved) filter.status = { $ne: 'removed' }
  return extractDocs(await mcpCall(sid, 'find', {
    database: DB,
    collection: EMPLOYEES,
    filter,
    projection: {
      _id: 0,
      employee_id: 1,
      place_id: 1,
      badge_code: 1,
      name: 1,
      role: 1,
      phone: 1,
      photo: 1,
      status: 1,
      card_uid: 1,
      created_at: 1,
      updated_at: 1,
    },
    limit: 200,
  }))
}

export async function eventsForDay(sid: string, placeId: string, date: string) {
  return extractDocs(await mcpCall(sid, 'find', {
    database: DB,
    collection: ATTENDANCE,
    filter: { place_id: placeId, date },
    projection: { _id: 0, event_id: 1, employee_id: 1, type: 1, at: 1, source: 1, device_id: 1, date: 1 },
    sort: { at: 1 },
    limit: 2000,
  }))
}

/** Today's punches for one employee — the single read used by a clock toggle. */
export async function eventsForEmployeeDay(sid: string, placeId: string, employeeId: string, date: string) {
  return extractDocs(await mcpCall(sid, 'find', {
    database: DB,
    collection: ATTENDANCE,
    filter: { place_id: placeId, employee_id: employeeId, date },
    projection: { _id: 0, event_id: 1, employee_id: 1, type: 1, at: 1, source: 1, device_id: 1, date: 1 },
    sort: { at: 1 },
    limit: 50,
  }))
}

export async function findEmployeeRecord(
  sid: string,
  placeId: string,
  employeeId: string,
): Promise<Record<string, unknown> | null> {
  const row = extractDocs(await mcpCall(sid, 'find', {
    database: DB,
    collection: EMPLOYEES,
    filter: { place_id: placeId, employee_id: employeeId },
    limit: 1,
  }))[0]
  return row ?? null
}

export interface AttendanceEmployeeRef {
  employee_id: string
  name: string
  badge_code: string
  status: string
}

export function toAttendanceRef(doc: Record<string, unknown>): AttendanceEmployeeRef {
  return {
    employee_id: String(doc.employee_id ?? ''),
    name: String(doc.name ?? ''),
    badge_code: String(doc.badge_code ?? ''),
    status: String(doc.status ?? 'active'),
  }
}

const LOOKUP_TTL_MS = 60_000
const LOOKUP_KEY = '__hodariAttendanceLookup'
const RECENT_KEY = '__hodariAttendanceRecent'

interface LookupSlot<T> { at: number; value: T }
interface LookupCache {
  keys: Map<string, LookupSlot<string>>
  uids: Map<string, LookupSlot<AttendanceEmployeeRef>>
}

function lookupCache(): LookupCache {
  const g = globalThis as typeof globalThis & { [LOOKUP_KEY]?: LookupCache }
  if (!g[LOOKUP_KEY]) g[LOOKUP_KEY] = { keys: new Map(), uids: new Map() }
  return g[LOOKUP_KEY]
}

function recentPunches(): Map<string, number> {
  const g = globalThis as typeof globalThis & { [RECENT_KEY]?: Map<string, number> }
  if (!g[RECENT_KEY]) g[RECENT_KEY] = new Map()
  return g[RECENT_KEY]
}

function cacheGet<T>(map: Map<string, LookupSlot<T>>, key: string): T | undefined {
  const slot = map.get(key)
  if (!slot) return undefined
  if (Date.now() - slot.at > LOOKUP_TTL_MS) {
    map.delete(key)
    return undefined
  }
  return slot.value
}

/** Drop apiKey → business cache entries for this place (call after key rotation). */
export function invalidateApiKeyCache(placeId: string): void {
  const cache = lookupCache()
  for (const [key, slot] of cache.keys) {
    if (slot.value === placeId) cache.keys.delete(key)
  }
}

/** Drop uid → employee cache. Omit uid to clear every card for the place. */
export function invalidateEmployeeCache(placeId: string, uid?: string | null): void {
  const cache = lookupCache()
  if (uid) {
    cache.uids.delete(`${placeId}:${uid.trim().toUpperCase()}`)
    return
  }
  const prefix = `${placeId}:`
  for (const key of cache.uids.keys()) {
    if (key.startsWith(prefix)) cache.uids.delete(key)
  }
}

export async function placeIdForApiKey(sid: string, rawKey: string): Promise<string | null> {
  const keyHash = hashApiKey(rawKey)
  const cache = lookupCache()
  const hit = cacheGet(cache.keys, keyHash)
  if (hit) return hit
  const keyDoc = extractDocs(await mcpCall(sid, 'find', {
    database: DB,
    collection: PLACE_KEYS,
    filter: { key_hash: keyHash },
    projection: { _id: 0, place_id: 1 },
    limit: 1,
  }))[0]
  if (!keyDoc || typeof keyDoc.place_id !== 'string') return null
  cache.keys.set(keyHash, { at: Date.now(), value: keyDoc.place_id })
  return keyDoc.place_id
}

export async function employeeForCard(
  sid: string,
  placeId: string,
  uid: string,
): Promise<AttendanceEmployeeRef | null> {
  const cacheKey = `${placeId}:${uid}`
  const cache = lookupCache()
  const hit = cacheGet(cache.uids, cacheKey)
  if (hit) return hit
  const rows = extractDocs(await mcpCall(sid, 'find', {
    database: DB,
    collection: EMPLOYEES,
    filter: { place_id: placeId, card_uid: uid },
    projection: { _id: 0, employee_id: 1, name: 1, badge_code: 1, status: 1 },
    limit: 5,
  }))
  if (!rows.length) return null
  const row = rows.find((r) => {
    const status = String(r.status ?? '')
    return status !== 'removed' && status !== 'deleted'
  }) ?? rows[0]
  const emp = toAttendanceRef(row)
  // Only cache active staff. Leave and removed must be read each scan so a
  // status change rejects immediately, and a restored employee is not stuck.
  if (!blockedEmployeeMessage(emp.status)) {
    cache.uids.set(cacheKey, { at: Date.now(), value: emp })
  }
  return emp
}

export interface RosterRow {
  employee_id: string
  place_id: string
  badge_code: string
  name: string
  role: string
  phone: string
  photo: string | null
  status: EmployeeStatus
  card_uid: string | null
  created_at: string
  updated_at: string
  presence: DayPresence
  punches: Array<{ type: string; at: string; time: string; source: string }>
  canPunch: boolean
  nextAction: 'in' | 'out'
}

/** Employees plus today's presence. The two reads are independent. */
export async function attendanceRoster(sid: string, placeId: string, date: string): Promise<RosterRow[]> {
  const [emps, events] = await Promise.all([
    listEmployees(sid, placeId),
    eventsForDay(sid, placeId, date),
  ])
  const byEmp = new Map<string, Array<{ type: string; at: string; source: string }>>()
  for (const ev of events) {
    const id = String(ev.employee_id ?? '')
    if (!id) continue
    const list = byEmp.get(id) ?? []
    list.push({ type: String(ev.type), at: String(ev.at), source: String(ev.source ?? 'manual') })
    byEmp.set(id, list)
  }
  return emps.map((doc) => {
    const pub = toEmployeePublic(doc)
    const evs = byEmp.get(pub.employee_id) ?? []
    const presence = presenceFromEvents(pub.status, evs)
    return {
      ...pub,
      presence,
      punches: evs.map((e) => ({ type: e.type, at: e.at, time: formatTime(e.at), source: e.source })),
      canPunch: pub.status === 'active',
      nextAction: presence.kind === 'present' ? 'out' as const : 'in' as const,
    }
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function recordPunch(
  sid: string,
  args: {
    placeId: string
    employeeId: string
    type: PunchType
    source: AttendanceSource
    deviceId?: string | null
    at?: string
  },
): Promise<AttendanceEvent> {
  const at = args.at ?? new Date().toISOString()
  const event: AttendanceEvent = {
    event_id: newId('att'),
    place_id: args.placeId,
    employee_id: args.employeeId,
    type: args.type,
    at,
    source: args.source,
    device_id: args.deviceId ?? null,
    date: dayKey(at),
  }
  await mcpCall(sid, 'insert-many', {
    database: DB,
    collection: ATTENDANCE,
    documents: [event],
  })
  return event
}

export type AttendancePunchResult =
  | {
      ok: false
      httpStatus: 403
      error: string
      name: string
    }
  | {
      ok: true
      type: 'duplicate'
      name: string
      message: string
      employeeId: string
      badgeCode: string
      presence: DayPresence
      at: string
      time: string
    }
  | {
      ok: true
      type: PunchType
      name: string
      message: string
      employeeId: string
      badgeCode: string
      event: AttendanceEvent
      presence: DayPresence
      worked: string | null
      at: string
      time: string
    }

/**
 * Shared clock in/out for RFID and the manual buttons.
 * Open shift today → clock out and attach that shift's duration; otherwise clock in.
 * A second punch inside the cooldown does not write. Server time, Africa/Kigali.
 * `preloaded` skips the events read when the caller already fetched them.
 * Publishes the live event after the write, before returning.
 */
export async function recordAttendancePunch(
  sid: string,
  placeId: string,
  employee: AttendanceEmployeeRef,
  source: AttendanceSource,
  deviceId?: string | null,
  preloaded?: Array<{ type: string; at: string }>,
): Promise<AttendancePunchResult> {
  const name = employee.name.trim() || 'Employee'
  const blocked = blockedEmployeeMessage(employee.status)
  if (blocked) return { ok: false, httpStatus: 403, error: blocked, name }

  const today = dayKey()
  const loaded = preloaded
    ?? (await eventsForEmployeeDay(sid, placeId, employee.employee_id, today))
      .map((e) => ({ type: String(e.type), at: String(e.at) }))
  const normalized = loaded.map((e) => ({ type: String(e.type), at: String(e.at) }))

  let latestAt = 0
  for (const ev of normalized) {
    const t = Date.parse(ev.at)
    if (Number.isFinite(t) && t > latestAt) latestAt = t
  }
  const cooldown = attendanceCooldownMs()
  const presenceNow = presenceFromEvents('active', normalized)
  if (latestAt && Date.now() - latestAt < cooldown) {
    const at = new Date(latestAt).toISOString()
    return {
      ok: true,
      type: 'duplicate',
      name,
      message: `${name} already scanned`,
      employeeId: employee.employee_id,
      badgeCode: employee.badge_code,
      presence: presenceNow,
      at,
      time: formatTime(at),
    }
  }

  // Claim this employee before the insert so a second in-flight tap cannot toggle.
  const recent = recentPunches()
  const claimKey = `${placeId}:${employee.employee_id}`
  const claimedAt = recent.get(claimKey)
  if (claimedAt !== undefined && Date.now() - claimedAt < cooldown) {
    const at = new Date(claimedAt).toISOString()
    return {
      ok: true,
      type: 'duplicate',
      name,
      message: `${name} already scanned`,
      employeeId: employee.employee_id,
      badgeCode: employee.badge_code,
      presence: presenceNow,
      at,
      time: formatTime(at),
    }
  }
  recent.set(claimKey, Date.now())

  const type: PunchType = presenceNow.kind === 'present' ? 'out' : 'in'
  let event: AttendanceEvent
  try {
    event = await recordPunch(sid, {
      placeId,
      employeeId: employee.employee_id,
      type,
      source,
      deviceId,
    })
  } catch (err) {
    recent.delete(claimKey)
    throw err
  }
  recent.set(claimKey, Date.parse(event.at))

  let worked: string | null = null
  if (type === 'out' && presenceNow.kind === 'present') {
    worked = hoursLabel(Math.max(0, Date.parse(event.at) - Date.parse(presenceNow.since)))
  }
  const time = formatTime(event.at)
  const message = type === 'in'
    ? `${name} arrived at ${time}`
    : `${name} left at ${time} (worked ${worked ?? '0h00'})`
  const presence = presenceFromEvents('active', [...normalized, { type: event.type, at: event.at }])

  publish(placeId, {
    id: event.event_id,
    type: event.type,
    employeeId: employee.employee_id,
    name,
    badgeCode: employee.badge_code,
    time,
    at: event.at,
    message,
    ...(worked ? { worked } : {}),
  })

  return {
    ok: true,
    type: event.type,
    name,
    message,
    employeeId: employee.employee_id,
    badgeCode: employee.badge_code,
    event,
    presence,
    worked,
    at: event.at,
    time,
  }
}
