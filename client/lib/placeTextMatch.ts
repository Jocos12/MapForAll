/**
 * Text relevance for MapForAll catalog search: name + tags + description,
 * with light synonym expansion so "tranquille / travailler / wifi" can match
 * a local listing whose description says "calme, idéal pour travailler, wifi".
 *
 * Exact name hits stay strongest. Description matching is weighted toward
 * `local_business` listings. A minimum score keeps unrelated queries out.
 */

const STOP = new Set([
  'the', 'a', 'an', 'in', 'at', 'near', 'of', 'for', 'to', 'and', 'or', 'with', 'from',
  'find', 'show', 'me', 'please', 'looking', 'search', 'places', 'place', 'spot', 'endroit',
  'kigali', 'rwanda', 'best', 'good', 'top', 'some', 'any', 'un', 'une', 'des', 'du', 'de',
  'la', 'le', 'les', 'dans', 'pour', 'avec', 'sur', 'cherche', 'montre', 'moi', 'svp',
  'qui', 'que', 'où', 'ou', 'est', 'sont', 'ideal', 'idéal', 'ideale', 'idéale',
])

/** Synonym groups — any term in a group matches any other (FR/EN). */
const SYN_GROUPS: string[][] = [
  ['calme', 'tranquille', 'tranquility', 'quiet', 'peaceful', 'paisible', 'serein', 'serene'],
  ['travailler', 'travail', 'work', 'working', 'laptop', 'cowork', 'coworking', 'bureau', 'etudier', 'étudier', 'study'],
  ['wifi', 'wi-fi', 'internet', 'connexion', 'online'],
  ['cafe', 'café', 'coffee', 'espresso', 'cappuccino'],
  ['accessible', 'fauteuil', 'wheelchair', 'stepfree', 'step-free', 'pmr'],
  ['local', 'locaux', 'informel', 'neighbourhood', 'neighborhood', 'quartier'],
  ['pascher', 'abordable', 'cheap', 'budget', 'affordable', 'inexpensive'],
]

const GROUP_OF = new Map<string, string[]>()
for (const group of SYN_GROUPS) {
  const norm = group.map((w) => w.toLowerCase())
  for (const w of norm) GROUP_OF.set(w, norm)
}

export function expandToken(token: string): string[] {
  const key = token.toLowerCase()
  const group = GROUP_OF.get(key)
  if (group) return [...group]
  return [key]
}

export function queryTokens(q: string): string[] {
  const words = q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9']{3,}/g) ?? []
  const out: string[] = []
  const seen = new Set<string>()
  for (const w of words) {
    if (STOP.has(w) || seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= 8) break
  }
  return out
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Mongo $or clauses: each expanded token against name / description / summary / tags / address. */
export function buildTextMatchOr(q: string): Record<string, unknown>[] {
  const tokens = queryTokens(q)
  const clauses: Record<string, unknown>[] = []
  const phrase = q.trim()
  if (phrase.length >= 2) {
    const escaped = escapeRegex(phrase)
    // Exact / phrase name match — keeps "Coffee Shop" working as before.
    clauses.push({ name: { $regex: escaped, $options: 'i' } })
  }
  const seen = new Set<string>()
  for (const token of tokens) {
    for (const variant of expandToken(token)) {
      if (seen.has(variant)) continue
      seen.add(variant)
      const rx = escapeRegex(variant)
      clauses.push(
        { name: { $regex: rx, $options: 'i' } },
        { description: { $regex: rx, $options: 'i' } },
        { summary: { $regex: rx, $options: 'i' } },
        { tags: { $regex: rx, $options: 'i' } },
        { address: { $regex: rx, $options: 'i' } },
      )
    }
  }
  return clauses
}

function blob(doc: {
  name?: string
  description?: string
  summary?: string
  address?: string
  tags?: string[]
  categories?: string[]
}): string {
  return [
    doc.name ?? '',
    doc.description ?? '',
    doc.summary ?? '',
    doc.address ?? '',
    ...(doc.tags ?? []),
    ...(doc.categories ?? []),
  ]
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Relevance score for a place against the user query.
 * Name hits weigh more; description hits weigh more for local_business.
 */
export function textRelevance(
  doc: {
    name?: string
    description?: string
    summary?: string
    address?: string
    tags?: string[]
    categories?: string[]
    local_business?: boolean
  },
  q: string,
): number {
  const tokens = queryTokens(q)
  if (!tokens.length) {
    const name = (doc.name ?? '').toLowerCase()
    return name && q.trim() && name.includes(q.trim().toLowerCase()) ? 10 : 0
  }

  const name = (doc.name ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const desc = [
    doc.description ?? '',
    doc.summary ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  const rest = blob(doc)
  const local = doc.local_business === true
  const phrase = q.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  let score = 0
  if (phrase.length >= 2 && name.includes(phrase)) score += 12

  let matchedTokens = 0
  for (const token of tokens) {
    const variants = expandToken(token)
    const inName = variants.some((v) => name.includes(v))
    const inDesc = variants.some((v) => desc.includes(v))
    const inRest = variants.some((v) => rest.includes(v))
    if (!inName && !inDesc && !inRest) continue
    matchedTokens += 1
    if (inName) score += 4
    else if (inDesc) score += local ? 3.5 : 1.5
    else score += 1
  }

  // Descriptive queries need enough signal; single-token name lookups stay easy.
  const minMatched = tokens.length >= 3 ? 2 : 1
  if (matchedTokens < minMatched && score < 10) return 0
  return score
}

/** Drop weak matches; keep strong name hits and description-relevant locals. */
export function filterByTextRelevance<T extends {
  name?: string
  description?: string
  summary?: string
  address?: string
  tags?: string[]
  categories?: string[]
  local_business?: boolean
}>(docs: T[], q: string): T[] {
  const phrase = q.trim()
  if (!phrase) return docs
  return docs
    .map((doc) => ({ doc, score: textRelevance(doc, phrase) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.doc)
}
