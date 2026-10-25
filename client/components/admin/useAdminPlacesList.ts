'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PlacesListResponse } from '@/components/admin/adminPlaceTypes'

export type PlacesQueryState = {
  status?: string
  category?: string
  source?: string
  local?: boolean
  accessible?: boolean
  sector?: string
  q?: string
  sort?: string
  page?: number
  limit?: number
}

function buildSearch(params: PlacesQueryState): string {
  const sp = new URLSearchParams()
  if (params.status) sp.set('status', params.status)
  if (params.category) sp.set('category', params.category)
  if (params.source) sp.set('source', params.source)
  if (params.local) sp.set('local', '1')
  if (params.accessible) sp.set('accessible', '1')
  if (params.sector) sp.set('sector', params.sector)
  if (params.q) sp.set('q', params.q)
  if (params.sort) sp.set('sort', params.sort)
  sp.set('page', String(params.page ?? 1))
  sp.set('limit', String(params.limit ?? 50))
  return sp.toString()
}

export function useAdminPlacesList(initial: PlacesQueryState) {
  const [query, setQuery] = useState<PlacesQueryState>({ ...initial, limit: initial.limit ?? 20 })
  const [data, setData] = useState<PlacesListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setSlow(false)
    const slowTimer = window.setTimeout(() => setSlow(true), 8000)
    const ctrl = new AbortController()
    const abortTimer = window.setTimeout(() => ctrl.abort(), 12000)
    try {
      const res = await fetch(`/api/admin/places?${buildSearch(query)}`, { credentials: 'include', cache: 'no-store', signal: ctrl.signal })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'load_failed')
        return
      }
      setData(json as PlacesListResponse)
    } catch {
      setError('timeout')
    } finally {
      window.clearTimeout(slowTimer)
      window.clearTimeout(abortTimer)
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  return { query, setQuery, data, loading, slow, error, reload: load, setData }
}
