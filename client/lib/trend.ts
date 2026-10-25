/**
 * Period-over-period change for a KPI.
 * `current` and `previous` must be the same metric (same filters, same meaning).
 */
export type Trend =
  | { kind: 'new' }
  | { kind: 'none' }
  | { kind: 'pct'; pct: number }

export function trend(current: number, previous: number): Trend {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { kind: 'none' }
  if (previous <= 0 && current <= 0) return { kind: 'none' }
  if (previous <= 0 && current > 0) return { kind: 'new' }
  if (current <= 0 && previous > 0) return { kind: 'pct', pct: -100 }
  const pct = Math.round(((current - previous) / previous) * 100)
  // 1 vs 200 rounds to -100 even though the current value is still above zero.
  if (current > 0 && pct <= -100) return { kind: 'pct', pct: -99 }
  return { kind: 'pct', pct }
}

/** Rows with no timestamp count as already existing before the window. */
export function existedBefore(iso: unknown, boundary: Date): boolean {
  if (typeof iso !== 'string' || !iso) return true
  const t = Date.parse(iso)
  return !Number.isFinite(t) || t < boundary.getTime()
}

export function stockTrend<T extends { created_at?: string | null }>(rows: T[], windowStart: Date): Trend {
  const previous = rows.filter((row) => existedBefore(row.created_at, windowStart)).length
  return trend(rows.length, previous)
}
