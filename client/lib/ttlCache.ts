/** Process-local TTL cache. Mutations call invalidatePrefix so writes are not served stale. */

interface Entry {
  at: number
  ttl: number
  value: unknown
}

const store = new Map<string, Entry>()

export function ttlGet<T>(key: string): T | null {
  const hit = store.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > hit.ttl) {
    store.delete(key)
    return null
  }
  return hit.value as T
}

export function ttlSet(key: string, value: unknown, ttlMs: number): void {
  store.set(key, { at: Date.now(), ttl: ttlMs, value })
}

export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}
