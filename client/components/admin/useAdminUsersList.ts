'use client'

import { useCallback, useEffect, useState } from 'react'
import type { UsersListResponse } from '@/components/admin/adminUserTypes'

export type UsersQueryState = {
  q?: string
  role?: string
  status?: string
  sort?: string
  page?: number
  limit?: number
}

function buildSearch(params: UsersQueryState): string {
  const sp = new URLSearchParams()
  if (params.q) sp.set('q', params.q)
  if (params.role) sp.set('role', params.role)
  if (params.status) sp.set('status', params.status)
  if (params.sort) sp.set('sort', params.sort)
  sp.set('page', String(params.page ?? 1))
  sp.set('limit', String(params.limit ?? 50))
  return sp.toString()
}

export function useAdminUsersList(initial: UsersQueryState) {
  const [query, setQuery] = useState<UsersQueryState>(initial)
  const [data, setData] = useState<UsersListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/users?${buildSearch(query)}`, { credentials: 'include', cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'load_failed')
        setData(null)
        return
      }
      setData(json as UsersListResponse)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  return { query, setQuery, data, loading, error, reload: load }
}
