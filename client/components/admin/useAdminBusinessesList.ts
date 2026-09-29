'use client'

import { useCallback, useEffect, useState } from 'react'

export type BusinessListItem = {
  place_id: string
  name: string
  status: string
  sector: string
  categories: string[]
  local_business: boolean
  completeness: { done: number; total: number }
  created_at?: string
}

type Response = { items: BusinessListItem[]; total: number; page: number; limit: number }

export type BusinessesQuery = {
  status?: string
  q?: string
  sort?: string
  page?: number
  limit?: number
}

function buildSearch(q: BusinessesQuery) {
  const sp = new URLSearchParams()
  if (q.status) sp.set('status', q.status)
  if (q.q) sp.set('q', q.q)
  if (q.sort) sp.set('sort', q.sort)
  sp.set('page', String(q.page ?? 1))
  sp.set('limit', String(q.limit ?? 50))
  return sp.toString()
}

export function useAdminBusinessesList(initial: BusinessesQuery) {
  const [query, setQuery] = useState<BusinessesQuery>(initial)
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/businesses?${buildSearch(query)}`, { credentials: 'include', cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'load_failed')
        setData(null)
        return
      }
      setData(json as Response)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  return { query, setQuery, data, loading, error, reload: load }
}
