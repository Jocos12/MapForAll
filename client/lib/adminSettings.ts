/**
 * MapForAll admin_settings documents (MongoDB via MCP), with ~30s process cache.
 */
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'
const COLLECTION = 'admin_settings'

const DEFAULT_SCORING = {
  local_bonus: 0.15,
  accessible_bonus: 0.12,
  confirmation_threshold: 3,
}

const DEFAULT_APP = {
  default_lang: 'fr' as const,
  demo_mode: false,
}

export type ScoringSettings = {
  local_bonus: number
  accessible_bonus: number
  confirmation_threshold: number
  updated_at?: string
}

export type EmailTemplateOverrides = {
  welcome_subject?: string
  welcome_body?: string
  otp_subject?: string
  otp_body?: string
  validate_subject?: string
  validate_body?: string
  reject_subject?: string
  reject_body?: string
}

export type AppSettings = {
  default_lang: 'fr' | 'en' | 'rw'
  demo_mode?: boolean
  email?: EmailTemplateOverrides
  updated_at?: string
}

type CacheEntry<T> = { at: number; value: T }
const CACHE_MS = 30_000
const cache = new Map<string, CacheEntry<unknown>>()

function fromCache<T>(key: string): T | null {
  const hit = cache.get(key) as CacheEntry<T> | undefined
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(key)
    return null
  }
  return hit.value
}

function toCache<T>(key: string, value: T): T {
  cache.set(key, { at: Date.now(), value })
  return value
}

export function invalidateAdminSettingsCache(key?: string) {
  if (key) cache.delete(key)
  else cache.clear()
}

async function readDoc(key: string): Promise<Record<string, unknown> | null> {
  const sid = await mcpConnected()
  const rows = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: COLLECTION,
      filter: { key },
      limit: 1,
    }),
  )
  return (rows[0] as Record<string, unknown> | undefined) ?? null
}

export async function getScoringSettings(): Promise<ScoringSettings> {
  const cached = fromCache<ScoringSettings>('scoring')
  if (cached) return cached
  try {
    const doc = await readDoc('scoring')
    const value: ScoringSettings = {
      local_bonus: clamp01(doc?.local_bonus, DEFAULT_SCORING.local_bonus),
      accessible_bonus: clamp01(doc?.accessible_bonus, DEFAULT_SCORING.accessible_bonus),
      confirmation_threshold:
        typeof doc?.confirmation_threshold === 'number' && doc.confirmation_threshold >= 1
          ? Math.round(doc.confirmation_threshold)
          : DEFAULT_SCORING.confirmation_threshold,
      updated_at: typeof doc?.updated_at === 'string' ? doc.updated_at : undefined,
    }
    return toCache('scoring', value)
  } catch {
    return DEFAULT_SCORING
  }
}

export async function saveScoringSettings(
  patch: Partial<ScoringSettings>,
): Promise<ScoringSettings> {
  const current = await getScoringSettings()
  const next: ScoringSettings = {
    local_bonus: patch.local_bonus != null ? clamp01(patch.local_bonus, current.local_bonus) : current.local_bonus,
    accessible_bonus:
      patch.accessible_bonus != null ? clamp01(patch.accessible_bonus, current.accessible_bonus) : current.accessible_bonus,
    confirmation_threshold:
      patch.confirmation_threshold != null && patch.confirmation_threshold >= 1
        ? Math.round(patch.confirmation_threshold)
        : current.confirmation_threshold,
    updated_at: new Date().toISOString(),
  }
  const sid = await mcpConnected()
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: COLLECTION,
    filter: { key: 'scoring' },
    update: { $set: { key: 'scoring', ...next } },
    upsert: true,
  })
  invalidateAdminSettingsCache('scoring')
  try {
    const { invalidateScoringCache } = await import('@/lib/scoringSettings')
    invalidateScoringCache()
  } catch { /* client bundle guard */ }
  return next
}

export async function getAppSettings(): Promise<AppSettings> {
  const cached = fromCache<AppSettings>('app')
  if (cached) return cached
  try {
    const doc = await readDoc('app')
    const lang = doc?.default_lang
    const value: AppSettings = {
      default_lang: lang === 'en' || lang === 'rw' ? lang : DEFAULT_APP.default_lang,
      demo_mode: doc?.demo_mode === true,
      email: readEmailOverrides(doc?.email),
      updated_at: typeof doc?.updated_at === 'string' ? doc.updated_at : undefined,
    }
    return toCache('app', value)
  } catch {
    return { ...DEFAULT_APP }
  }
}

export async function saveAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getAppSettings()
  const next: AppSettings = {
    default_lang: patch.default_lang ?? current.default_lang,
    demo_mode: patch.demo_mode ?? current.demo_mode,
    email: patch.email !== undefined ? { ...current.email, ...patch.email } : current.email,
    updated_at: new Date().toISOString(),
  }
  const sid = await mcpConnected()
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: COLLECTION,
    filter: { key: 'app' },
    update: { $set: { key: 'app', ...next } },
    upsert: true,
  })
  invalidateAdminSettingsCache('app')
  return next
}

function readEmailOverrides(raw: unknown): EmailTemplateOverrides | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const out: EmailTemplateOverrides = {}
  for (const k of [
    'welcome_subject',
    'welcome_body',
    'otp_subject',
    'otp_body',
    'validate_subject',
    'validate_body',
    'reject_subject',
    'reject_body',
  ] as const) {
    if (typeof o[k] === 'string') out[k] = o[k]
  }
  return Object.keys(out).length ? out : undefined
}

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}
