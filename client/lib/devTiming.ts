/**
 * Dev-only timings for API work, MCP calls, and page gates.
 * Production stays quiet. The slowest 10 stay in memory for /api/dev/timings.
 */

export interface TimingSpan {
  name: string
  ms: number
  at: string
}

const slowest: TimingSpan[] = []

export function logSpan(kind: string, name: string, ms: number): void {
  if (process.env.NODE_ENV === 'production') return
  const rounded = Math.round(ms)
  const label = `${kind} ${name}`
  console.info(`[hodari] ${label} ${rounded}ms`)
  slowest.push({ name: label, ms: rounded, at: new Date().toISOString() })
  slowest.sort((a, b) => b.ms - a.ms)
  if (slowest.length > 10) slowest.length = 10
}

export function slowestSpans(): TimingSpan[] {
  return slowest.map((row) => ({ ...row }))
}

export async function timeSpan<T>(kind: string, name: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now()
  try {
    return await run()
  } finally {
    logSpan(kind, name, Date.now() - started)
  }
}
