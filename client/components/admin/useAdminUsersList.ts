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

const SLOW_MS = 8_000

function buildSearch(params: UsersQueryState): string {
  const sp = new URLSearchParams()
  if (params.q) sp.set('q', params.q)
  if (params.role) sp.set('role', params.role)
  if (params.status) sp.set('status', params.status)
  if (params.sort) sp.set('sort', params.sort)
  sp.set('page', String(params.page ?? 1))
  sp.set('limit', String(params.limit ?? 20))
  return sp.toString()
}

export function useAdminUsersList(initial: UsersQueryState) {
  const [query, setQuery] = useState<UsersQueryState>({ ...initial, limit: initial.limit ?? 20 })
  const [debounced, setDebounced] = useState(query)
  const [data, setData] = useState<UsersListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const wait = query.q ? 300 : 0
    const timer = window.setTimeout(() => setDebounced(query), wait)
    return () => window.clearTimeout(timer)
  }, [query])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), SLOW_MS)
    try {
      const res = await fetch(`/api/admin/users?${buildSearch(debounced)}`, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'load_failed')
        setData(null)
        return
      }
      setData(json as UsersListResponse)
    } catch (err) {
      const timedOut = err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')
      setError(timedOut ? 'timeout' : 'load_failed')
      setData(null)
    } finally {
      window.clearTimeout(timer)
      setLoading(false)
      if (process.env.NODE_ENV !== 'production') {
        const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started)
        console.info(`[hodari] page /admin/users fetch ${ms}ms`)
      }
    }
  }, [debounced])

  useEffect(() => {
    void load()
  }, [load])

  return { query, setQuery, data, loading, error, reload: load }
}
