import { DB } from '@/lib/adminPlaces'

export { DB }

export type ReportStatus = 'open' | 'resolved' | 'ignored'
export type ReportPriority = 'urgent' | 'normal' | 'low'

export type AdminReportRow = {
  report_id: string
  place_id: string
  place_name: string
  type: string
  priority: ReportPriority
  status: ReportStatus
  comment: string
  reporter_uid?: string
  reporter_email?: string
  created_at: string
  resolved_at?: string | null
}

export function toAdminReport(doc: Record<string, unknown>): AdminReportRow | null {
  const report_id = typeof doc.report_id === 'string' ? doc.report_id : ''
  const place_id = typeof doc.place_id === 'string' ? doc.place_id : ''
  if (!report_id || !place_id) return null
  const priority = doc.priority === 'urgent' || doc.priority === 'low' ? doc.priority : 'normal'
  const status =
    doc.status === 'resolved' || doc.status === 'ignored' ? doc.status : 'open'
  return {
    report_id,
    place_id,
    place_name: typeof doc.place_name === 'string' ? doc.place_name : place_id,
    type: typeof doc.type === 'string' ? doc.type : 'other',
    priority,
    status,
    comment: typeof doc.comment === 'string' ? doc.comment : '',
    reporter_uid: typeof doc.reporter_uid === 'string' ? doc.reporter_uid : undefined,
    reporter_email: typeof doc.reporter_email === 'string' ? doc.reporter_email : undefined,
    created_at: typeof doc.created_at === 'string' ? doc.created_at : new Date().toISOString(),
    resolved_at: typeof doc.resolved_at === 'string' ? doc.resolved_at : null,
  }
}

export function matchesReportFilters(
  row: AdminReportRow,
  q: { status?: string; priority?: string; type?: string; q?: string },
): boolean {
  if (q.status && q.status !== 'all' && row.status !== q.status) return false
  if (q.priority && q.priority !== 'all' && row.priority !== q.priority) return false
  if (q.type && q.type !== 'all' && row.type !== q.type) return false
  if (q.q) {
    const hay = `${row.place_name} ${row.comment} ${row.place_id}`.toLowerCase()
    if (!hay.includes(q.q)) return false
  }
  return true
}

export function priorityWeight(p: ReportPriority): number {
  return p === 'urgent' ? 0 : p === 'normal' ? 1 : 2
}

export function sortReports(rows: AdminReportRow[]): AdminReportRow[] {
  return [...rows].sort((a, b) => {
    const pw = priorityWeight(a.priority) - priorityWeight(b.priority)
    if (pw !== 0) return pw
    if (a.status !== b.status) {
      if (a.status === 'open') return -1
      if (b.status === 'open') return 1
    }
    return b.created_at.localeCompare(a.created_at)
  })
}
