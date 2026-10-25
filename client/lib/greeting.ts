/**
 * Kinyarwanda greetings for native-speaker review (locale `rw`):
 * 05:00–11:59 morning  → Mwaramutse
 * 12:00–17:59 afternoon → Mwiriwe
 * 18:00–04:59 evening → Mwiriwe
 * Afternoon and evening share "Mwiriwe" in the requested copy.
 */

export type GreetingBucket = 'morning' | 'afternoon' | 'evening'

/** Browser-local hour. 05:00–11:59 morning, 12:00–17:59 afternoon, otherwise evening. */
export function greetingBucket(date: Date): GreetingBucket {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

/** First name, then the mailbox prefix. Never the string "undefined". */
export function firstName(name: string | null | undefined, email: string | null | undefined): string {
  const cleaned = (name ?? '').trim()
  if (cleaned && cleaned.toLowerCase() !== 'undefined') {
    const word = cleaned.split(/\s+/)[0] ?? ''
    if (word && word.toLowerCase() !== 'undefined') return word
  }
  const prefix = (email ?? '').split('@')[0]?.trim() ?? ''
  if (!prefix || prefix.toLowerCase() === 'undefined') return ''
  return prefix
}
