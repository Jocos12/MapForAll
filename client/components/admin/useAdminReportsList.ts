'use client'

import { useCallback, useEffect, useState } from 'react'

export type ReportListItem = {
  report_id: string
  place_id: string
  place_name: string
  type: string
  priority: string
  status: string
  comment: string
  reporter_email?: string
  created_at: string
}

type Response = { items: ReportListItem[]; total: number; page: number; limit: number }

export type ReportsQuery = {
  status?: string
  priority?: string
  type?: string
  q?: string
  page?: number
  limit?: number
}

function buildSearch(q: ReportsQuery) {
  const sp = new URLSearchParams()
  if (q.status) sp.set('status', q.status)
  if (q.priority) sp.set('priority', q.priority)
  if (q.type) sp.set('type', q.type)
  if (q.q) sp.set('q', q.q)
  sp.set('page', String(q.page ?? 1))
  sp.set('limit', String(q.limit ?? 50))
  return sp.toString()
}

export function useAdminReportsList(initial: ReportsQuery) {
  const [query, setQuery] = useState<ReportsQuery>(initial)
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/reports?${buildSearch(query)}`, { credentials: 'include', cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setData(json as Response)
      else setData(null)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  return { query, setQuery, data, loading, reload: load }
}
