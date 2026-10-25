'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAttendanceLive, type AttendanceLiveEvent, type LiveRosterRow } from '@/hooks/useAttendanceLive'
import {
  Clock,
  CreditCard,
  Download,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { withPlace } from '@/components/business/types'
import { Avatar as UserAvatar } from '@/components/ui/Avatar'
import { BIZ, GREEN, ORANGE } from '@/components/business/ui'
import { compressImage } from '@/lib/imageCompress'

type Tab = 'employees' | 'today' | 'reports' | 'rfid'

type Presence =
  | { kind: 'on_leave' }
  | { kind: 'absent' }
  | { kind: 'present'; since: string }
  | { kind: 'left'; at: string }

interface Employee {
  employee_id: string
  place_id: string
  badge_code: string
  name: string
  role: string
  phone: string
  photo: string | null
  status: 'active' | 'on_leave' | 'removed'
  card_uid: string | null
  presence?: Presence
  canPunch?: boolean
  nextAction?: 'in' | 'out'
  punches?: Array<{ type: string; at: string; time: string; source: string }>
}

interface ReportRow extends Employee {
  hours: string
  hours_decimal: number
  days_worked: number
}

interface Props {
  placeId: string
  placeName: string
}

const PHOTO_CHARS = 60_000

function presenceLabel(p: Presence | undefined, t: (k: string) => string, fmt: (iso: string) => string): string {
  if (!p || p.kind === 'absent') return t('biz.team.absent')
  if (p.kind === 'on_leave') return t('biz.team.onLeave')
  if (p.kind === 'present') return t('biz.team.presentSince').replace('{time}', fmt(p.since))
  return t('biz.team.leftAt').replace('{time}', fmt(p.at))
}

function presenceTone(p: Presence | undefined): string {
  if (!p || p.kind === 'absent') return 'bg-[#F4F4F5] text-[#52525B]'
  if (p.kind === 'on_leave') return 'bg-amber-50 text-amber-800'
  if (p.kind === 'present') return 'bg-emerald-50 text-emerald-800'
  return 'bg-sky-50 text-sky-800'
}

export function TeamSection({ placeId, placeName }: Props) {
  const { t, lang } = useI18n()
  const [tab, setTab] = useState<Tab>('employees')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [phone, setPhone] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [punching, setPunching] = useState<string | null>(null)
  const [reportRange, setReportRange] = useState<'week' | 'month'>('week')
  const [report, setReport] = useState<{ employees: ReportRow[]; chart: Array<{ name: string; hours: number }> } | null>(null)
  const [apiKeyMeta, setApiKeyMeta] = useState<{ configured: boolean; prefix: string | null } | null>(null)
  const [freshKey, setFreshKey] = useState<string | null>(null)
  const [scanUid, setScanUid] = useState('')
  const [linkEmp, setLinkEmp] = useState('')
  const [cards, setCards] = useState<Array<{ employee_id: string; name: string; badge_code: string; card_uid: string }>>([])
  const [toasts, setToasts] = useState<Array<{ id: string; tone: 'in' | 'out' | 'unknown'; text: string; uid?: string }>>([])
  const [lastUid, setLastUid] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const toastSeen = useRef(new Set<string>())
  const rosterGen = useRef(0)
  const locale = lang === 'rw' ? 'en' : lang

  const fmtTime = useCallback((iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Africa/Kigali',
      }).format(new Date(iso))
    } catch {
      return iso.slice(11, 16)
    }
  }, [locale])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((row) => row.id !== id))
  }, [])

  const pushToast = useCallback((ev: AttendanceLiveEvent) => {
    const key = ev.type === 'unknown_card' ? ev.id : `${ev.type}:${ev.employeeId}:${ev.at}`
    if (toastSeen.current.has(key)) return
    toastSeen.current.add(key)
    const time = ev.time || fmtTime(ev.at)
    let tone: 'in' | 'out' | 'unknown' = 'in'
    let text = ev.message
    if (ev.type === 'in') {
      text = t('biz.team.toastIn').replace('{name}', ev.name).replace('{time}', time)
    } else if (ev.type === 'out') {
      tone = 'out'
      text = ev.worked
        ? t('biz.team.toastOut').replace('{name}', ev.name).replace('{time}', time).replace('{hours}', ev.worked)
        : t('biz.team.toastOutShort').replace('{name}', ev.name).replace('{time}', time)
    } else {
      tone = 'unknown'
      text = t('biz.team.toastUnknown').replace('{uid}', ev.uid ?? '')
    }
    setToasts((prev) => [{ id: key, tone, text, uid: ev.uid }, ...prev].slice(0, 3))
    window.setTimeout(() => dismissToast(key), 4000)
  }, [dismissToast, fmtTime, t])

  const applyPunch = useCallback((ev: AttendanceLiveEvent) => {
    if (ev.type !== 'in' && ev.type !== 'out') return
    setEmployees((prev) => prev.map((row) => {
      if (row.employee_id !== ev.employeeId) return row
      const presence: Presence = ev.type === 'in'
        ? { kind: 'present', since: ev.at }
        : { kind: 'left', at: ev.at }
      return { ...row, presence, nextAction: ev.type === 'in' ? 'out' : 'in' }
    }))
  }, [])

  const mergeRoster = useCallback((rows: Employee[]) => {
    setEmployees((prev) => {
      if (prev.length === 0) return rows
      const byId = new Map(rows.map((r) => [r.employee_id, r]))
      const seen = new Set(prev.map((r) => r.employee_id))
      const merged = prev.map((row) => {
        const next = byId.get(row.employee_id)
        return next ? { ...row, ...next, photo: next.photo ?? row.photo } : row
      })
      for (const row of rows) {
        if (!seen.has(row.employee_id)) merged.push(row)
      }
      return merged
    })
  }, [])

  const refreshRoster = useCallback(async () => {
    const gen = ++rosterGen.current
    try {
      const res = await fetch(withPlace('/api/business/attendance/today', placeId), { cache: 'no-store' })
      if (!res.ok || gen !== rosterGen.current) return
      const json = await res.json() as { employees?: Employee[] }
      if (gen !== rosterGen.current) return
      mergeRoster(json.employees ?? [])
    } catch {
      /* background refresh — the optimistic row stays */
    }
  }, [mergeRoster, placeId])

  const onLiveEvent = useCallback((ev: AttendanceLiveEvent) => {
    pushToast(ev)
    if (ev.type === 'unknown_card') {
      if (ev.uid) setLastUid(ev.uid.toUpperCase())
      return
    }
    applyPunch(ev)
    if (!ev.id.startsWith('poll_')) void refreshRoster()
  }, [applyPunch, pushToast, refreshRoster])

  const onLiveRoster = useCallback((rows: LiveRosterRow[]) => {
    rosterGen.current += 1
    mergeRoster(rows as Employee[])
  }, [mergeRoster])

  useAttendanceLive(placeId, { onEvent: onLiveEvent, onRoster: onLiveRoster })

  const openRfidForUid = useCallback((uid: string) => {
    const next = uid.toUpperCase()
    setLastUid(next)
    setScanUid(next)
    setTab('rfid')
  }, [])

  const loadEmployees = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    const url = withPlace('/api/business/employees', placeId)
    try {
      const res = await fetch(url, { cache: 'no-store', signal: signal ?? AbortSignal.timeout(20_000) })
      const raw = await res.text()
      let json: { error?: string; employees?: Employee[] } = {}
      try { json = JSON.parse(raw) as typeof json } catch { /* non-JSON */ }
      if (!res.ok) {
        console.warn('[team] employees HTTP', res.status, raw.slice(0, 500))
        setError(json.error || t('biz.team.loadEmployeesFailed').replace('{status}', String(res.status)))
        return
      }
      setEmployees(json.employees ?? [])
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
      console.warn('[team] employees fetch failed', {
        url,
        placeId,
        name: err instanceof Error ? err.name : typeof err,
        message: err instanceof Error ? err.message : String(err),
      })
      const timedOut = err instanceof DOMException && err.name === 'TimeoutError'
      setError(timedOut ? t('biz.team.loadTimeout') : t('biz.team.loadNetwork'))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [placeId, t])

  const loadToday = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    const url = withPlace('/api/business/attendance', placeId)
    try {
      const res = await fetch(url, { cache: 'no-store', signal: signal ?? AbortSignal.timeout(20_000) })
      const raw = await res.text()
      let json: { error?: string; employees?: Employee[] } = {}
      try { json = JSON.parse(raw) as typeof json } catch { /* non-JSON body (HTML 404/500) */ }
      if (!res.ok) {
        console.warn('[team] attendance HTTP', {
          status: res.status,
          url,
          placeId,
          body: raw.slice(0, 800),
        })
        setError(json.error || t('biz.team.loadTodayFailed').replace('{status}', String(res.status)))
        return
      }
      setEmployees(json.employees ?? [])
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
      console.warn('[team] attendance fetch failed', {
        url,
        placeId,
        name: err instanceof Error ? err.name : typeof err,
        message: err instanceof Error ? err.message : String(err),
      })
      const timedOut = err instanceof DOMException && err.name === 'TimeoutError'
      setError(timedOut ? t('biz.team.loadTimeout') : t('biz.team.loadNetwork'))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [placeId, t])

  const loadReport = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    const url = withPlace(`/api/business/attendance/report?range=${reportRange}`, placeId)
    try {
      const res = await fetch(url, { cache: 'no-store', signal: signal ?? AbortSignal.timeout(20_000) })
      const raw = await res.text()
      let json: { error?: string; employees?: ReportRow[]; chart?: Array<{ name: string; hours: number }> } = {}
      try { json = JSON.parse(raw) as typeof json } catch { /* non-JSON */ }
      if (!res.ok) {
        console.warn('[team] report HTTP', res.status, raw.slice(0, 500))
        setError(json.error || t('biz.team.loadReportFailed').replace('{status}', String(res.status)))
        return
      }
      setReport({ employees: json.employees ?? [], chart: json.chart ?? [] })
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
      console.warn('[team] report fetch failed', err)
      const timedOut = err instanceof DOMException && err.name === 'TimeoutError'
      setError(timedOut ? t('biz.team.loadTimeout') : t('biz.team.loadNetwork'))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [placeId, reportRange, t])

  const loadRfid = useCallback(async (signal?: AbortSignal) => {
    setError('')
    try {
      const [keyRes, cardRes, empRes] = await Promise.all([
        fetch(withPlace('/api/business/attendance/api-key', placeId), { cache: 'no-store', signal }),
        fetch(withPlace('/api/business/attendance/cards', placeId), { cache: 'no-store', signal }),
        fetch(withPlace('/api/business/employees', placeId), { cache: 'no-store', signal }),
      ])
      const keyJson = await keyRes.json().catch(() => ({}))
      const cardJson = await cardRes.json().catch(() => ({}))
      const empJson = await empRes.json().catch(() => ({}))
      if (keyRes.ok) setApiKeyMeta({ configured: !!keyJson.configured, prefix: keyJson.prefix ?? null })
      if (cardRes.ok) setCards(cardJson.cards ?? [])
      if (empRes.ok) setEmployees(empJson.employees ?? [])
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
      console.warn('[team] rfid fetch failed', err)
      setError(t('biz.team.loadNetwork'))
    }
  }, [placeId, t])

  const retryLoad = useCallback(() => {
    if (tab === 'employees') void loadEmployees()
    else if (tab === 'today') void loadToday()
    else if (tab === 'reports') void loadReport()
    else void loadRfid()
  }, [tab, loadEmployees, loadToday, loadReport, loadRfid])

  useEffect(() => {
    const ctrl = new AbortController()
    if (tab === 'employees') void loadEmployees(ctrl.signal)
    else if (tab === 'today') void loadToday(ctrl.signal)
    else if (tab === 'reports') void loadReport(ctrl.signal)
    else void loadRfid(ctrl.signal)
    return () => ctrl.abort()
  }, [tab, placeId, loadEmployees, loadToday, loadReport, loadRfid])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return employees
    return employees.filter((e) =>
      e.name.toLowerCase().includes(needle)
      || e.role.toLowerCase().includes(needle)
      || e.badge_code.toLowerCase().includes(needle),
    )
  }, [employees, q])

  function openCreate() {
    setEditing(null)
    setName('')
    setRole('')
    setPhone('')
    setPhoto(null)
    setFormOpen(true)
  }

  function openEdit(emp: Employee) {
    setEditing(emp)
    setName(emp.name)
    setRole(emp.role)
    setPhone(emp.phone)
    setPhoto(emp.photo)
    setFormOpen(true)
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return
    const url = await compressImage(file, PHOTO_CHARS)
    if (url) setPhoto(url)
  }

  async function saveEmployee(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = { name: name.trim(), role: role.trim(), phone: phone.trim(), photo }
      const url = editing
        ? withPlace(`/api/business/employees/${editing.employee_id}`, placeId)
        : withPlace('/api/business/employees', placeId)
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? t('auth.errors.generic'))
        return
      }
      setFormOpen(false)
      void loadEmployees()
    } catch {
      setError(t('auth.errors.network'))
    } finally {
      setSaving(false)
    }
  }

  async function toggleLeave(emp: Employee) {
    const next = emp.status === 'on_leave' ? 'active' : 'on_leave'
    setEmployees((prev) => prev.map((row) => (row.employee_id === emp.employee_id
      ? { ...row, status: next, presence: next === 'on_leave' ? { kind: 'on_leave' } : { kind: 'absent' } }
      : row)))
    try {
      const res = await fetch(withPlace(`/api/business/employees/${emp.employee_id}`, placeId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) void loadEmployees()
    } catch {
      void loadEmployees()
    }
  }

  async function removeEmployee(emp: Employee) {
    if (!window.confirm(t('biz.team.confirmDelete').replace('{name}', emp.name))) return
    setEmployees((prev) => prev.filter((row) => row.employee_id !== emp.employee_id))
    try {
      const res = await fetch(withPlace(`/api/business/employees/${emp.employee_id}`, placeId), { method: 'DELETE' })
      if (!res.ok) void loadEmployees()
    } catch {
      void loadEmployees()
    }
  }

  async function punch(emp: Employee) {
    if (!emp.canPunch && emp.status !== 'active') return
    const optimistic: Presence = emp.nextAction === 'out' || emp.presence?.kind === 'present'
      ? { kind: 'left', at: new Date().toISOString() }
      : { kind: 'present', since: new Date().toISOString() }
    const prev = employees
    setPunching(emp.employee_id)
    setEmployees((list) => list.map((row) => (row.employee_id === emp.employee_id
      ? {
          ...row,
          presence: optimistic,
          nextAction: optimistic.kind === 'present' ? 'out' : 'in',
        }
      : row)))
    try {
      const res = await fetch(withPlace('/api/business/attendance', placeId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: emp.employee_id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setEmployees(prev)
        setError(json.error ?? t('auth.errors.generic'))
        return
      }
      if (json.type === 'duplicate') {
        setEmployees((list) => list.map((row) => (row.employee_id === emp.employee_id
          ? {
              ...row,
              presence: json.presence ?? emp.presence,
              nextAction: json.presence?.kind === 'present' ? 'out' : 'in',
            }
          : row)))
        setError(t('biz.team.duplicatePunch').replace('{name}', emp.name))
        return
      }
      setEmployees((list) => list.map((row) => (row.employee_id === emp.employee_id
        ? { ...row, presence: json.presence, nextAction: json.presence?.kind === 'present' ? 'out' : 'in' }
        : row)))
    } catch {
      setEmployees(prev)
      setError(t('auth.errors.network'))
    } finally {
      setPunching(null)
    }
  }

  function exportCsv() {
    if (!report) return
    const lines = [
      'badge,name,role,hours,hours_decimal,days_worked',
      ...report.employees.map((r) =>
        [r.badge_code, JSON.stringify(r.name), JSON.stringify(r.role), r.hours, r.hours_decimal, r.days_worked].join(','),
      ),
    ]
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `mapforall-attendance-${placeName.replace(/\s+/g, '-').toLowerCase()}-${reportRange}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function rotateKey() {
    if (apiKeyMeta?.configured && !window.confirm(t('biz.team.confirmRotateKey'))) return
    const res = await fetch(withPlace('/api/business/attendance/api-key', placeId), { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(json.error ?? t('auth.errors.generic'))
      return
    }
    setFreshKey(json.apiKey ?? null)
    setApiKeyMeta({ configured: true, prefix: json.prefix ?? null })
  }

  async function linkCard() {
    if (!scanUid.trim() || !linkEmp) return
    const res = await fetch(withPlace('/api/business/attendance/cards', placeId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: linkEmp, uid: scanUid.trim() }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(json.error ?? t('auth.errors.generic'))
      return
    }
    setScanUid('')
    void loadRfid()
  }

  async function unlinkCard(employeeId: string) {
    await fetch(withPlace(`/api/business/attendance/cards?employeeId=${encodeURIComponent(employeeId)}`, placeId), {
      method: 'DELETE',
    })
    void loadRfid()
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'employees', label: t('biz.team.tabEmployees') },
    { id: 'today', label: t('biz.team.tabToday') },
    { id: 'reports', label: t('biz.team.tabReports') },
    { id: 'rfid', label: t('biz.team.tabRfid') },
  ]

  const maxHours = Math.max(1, ...(report?.chart.map((c) => c.hours) ?? [1]))

  const toastNode = toasts.length > 0 && typeof document !== 'undefined'
    ? createPortal(
        <div className="fixed right-4 top-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2" role="region" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              className={`rounded-xl px-3.5 py-3 text-[13px] font-medium shadow-lg ${
                toast.tone === 'in'
                  ? 'bg-emerald-600 text-white'
                  : toast.tone === 'out'
                    ? 'border-l-4 border-orange-400 bg-[#1D4ED8] text-white'
                    : 'bg-amber-300 text-amber-950'
              }`}
            >
              <p>{toast.text}</p>
              {toast.tone === 'unknown' && toast.uid && (
                <button
                  type="button"
                  onClick={() => openRfidForUid(toast.uid!)}
                  className="mt-2 rounded-md bg-white/90 px-2.5 py-1 text-[12px] font-semibold text-amber-950"
                >
                  {t('biz.team.toastLink')}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )
    : null

  return (
    <div className="flex flex-col gap-5">
      {toastNode}
      <p className="text-[13px] leading-relaxed text-[#52525B]">{t('biz.team.mission')}</p>

      <div className="flex flex-wrap gap-1 rounded-xl border border-[#E4E4E7] bg-white p-1">
        {tabs.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => setTab(row.id)}
            className={`rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${BIZ.focus} ${
              tab === row.id ? 'bg-[#1A1614] text-white' : 'text-[#3F3F46] hover:bg-[#F4F4F5]'
            }`}
          >
            {row.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2" role="alert">
          <p className="min-w-0 flex-1 text-[13px] text-[#B91C1C]">{error}</p>
          <button type="button" onClick={retryLoad} className={`${BIZ.secondary} h-8 shrink-0 border-red-200`}>
            <RefreshCw size={13} aria-hidden />
            {t('biz.retry')}
          </button>
        </div>
      )}

      {(tab === 'employees' || tab === 'today') && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('biz.team.search')}
              className={`${BIZ.field} pl-9`}
            />
          </div>
          {tab === 'employees' && (
            <button type="button" onClick={openCreate} className={`${BIZ.primary} h-10`}>
              <Plus size={15} aria-hidden />
              {t('biz.team.add')}
            </button>
          )}
        </div>
      )}

      {tab === 'employees' && (
        <section className={`${BIZ.card} overflow-hidden`}>
          {loading ? (
            <div className="space-y-3 p-5" aria-busy>
              {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-[#F4F4F5]" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FDE8DC] text-[#C2410C]"><Users size={22} /></span>
              <p className="text-[14px] font-semibold text-[#18181B]">{t('biz.team.emptyTitle')}</p>
              <p className="max-w-sm text-[13px] text-[#52525B]">{t('biz.team.emptyBody')}</p>
              <button type="button" onClick={openCreate} className={`${BIZ.primary} h-10`}>
                <UserPlus size={15} />{t('biz.team.add')}
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-[#F4F4F5]">
              {filtered.map((emp) => (
                <li key={emp.employee_id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <Avatar emp={emp} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-[#18181B]">{emp.name}</p>
                    <p className="truncate text-[12.5px] text-[#52525B]">
                      {emp.role} · {emp.badge_code}
                      {emp.card_uid ? ` · RFID ${emp.card_uid}` : ''}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ${presenceTone(emp.presence)}`}>
                    {presenceLabel(emp.presence, t, fmtTime)}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => openEdit(emp)} className={`${BIZ.secondary} h-8 px-2.5`} title={t('biz.team.edit')}>
                      <Pencil size={13} />
                    </button>
                    <button type="button" onClick={() => void toggleLeave(emp)} className={`${BIZ.secondary} h-8 px-2.5`} title={t('biz.team.toggleLeave')}>
                      <UserMinus size={13} />
                      <span className="hidden sm:inline">{emp.status === 'on_leave' ? t('biz.team.backActive') : t('biz.team.markLeave')}</span>
                    </button>
                    <button type="button" onClick={() => void removeEmployee(emp)} className={`${BIZ.secondary} h-8 px-2.5 text-[#B91C1C]`} title={t('biz.team.delete')}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'today' && (
        <section className={`${BIZ.card} overflow-hidden`}>
          <div className="flex items-center gap-2 border-b border-[#F4F4F5] px-4 py-3 sm:px-5">
            <Clock size={16} className="text-[#E8672A]" aria-hidden />
            <h2 className="text-[14px] font-semibold text-[#18181B]">{t('biz.team.todayTitle')}</h2>
          </div>
          {loading ? (
            <div className="space-y-3 p-5" aria-busy>
              {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-[#F4F4F5]" />)}
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-[#52525B]">{t('biz.team.noStaffToday')}</p>
          ) : (
            <ul className="divide-y divide-[#F4F4F5]">
              {filtered.map((emp) => {
                const isOut = emp.nextAction === 'out' || emp.presence?.kind === 'present'
                return (
                  <li key={emp.employee_id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <Avatar emp={emp} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-[#18181B]">{emp.name}</p>
                      <p className="text-[12.5px] text-[#52525B]">{presenceLabel(emp.presence, t, fmtTime)}</p>
                    </div>
                    <button
                      type="button"
                      disabled={emp.status !== 'active' || punching === emp.employee_id}
                      onClick={() => void punch(emp)}
                      className={`h-10 rounded-lg px-3.5 text-[13px] font-semibold transition-colors disabled:opacity-45 ${BIZ.focus} ${
                        isOut
                          ? 'border border-[#D4D4D8] bg-white text-[#18181B] hover:border-[#E8672A]'
                          : 'bg-[#1A1614] text-white hover:bg-[#33291F]'
                      }`}
                    >
                      {punching === emp.employee_id ? '…' : isOut ? t('biz.team.clockOut') : t('biz.team.clockIn')}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {tab === 'reports' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[#E4E4E7] bg-white p-0.5">
              {(['week', 'month'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReportRange(r)}
                  className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium ${reportRange === r ? 'bg-[#1A1614] text-white' : 'text-[#52525B]'}`}
                >
                  {t(r === 'week' ? 'biz.team.rangeWeek' : 'biz.team.rangeMonth')}
                </button>
              ))}
            </div>
            <button type="button" onClick={exportCsv} disabled={!report?.employees.length} className={`${BIZ.secondary} h-9`}>
              <Download size={14} />{t('biz.team.exportCsv')}
            </button>
          </div>

          <section className={`${BIZ.card} p-5`}>
            <h2 className={BIZ.cardTitle}>{t('biz.team.chartTitle')}</h2>
            {!report || report.chart.every((c) => c.hours === 0) ? (
              <p className="mt-6 text-center text-[13px] text-[#52525B]">{t('biz.team.reportEmpty')}</p>
            ) : (
              <div className="mt-4 flex h-48 items-end gap-2">
                {report.chart.map((bar) => (
                  <div key={bar.name} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <span className="text-[11px] font-medium text-[#52525B]">{bar.hours}h</span>
                    <div
                      className="w-full max-w-[48px] rounded-t-md"
                      style={{
                        height: `${Math.max(4, (bar.hours / maxHours) * 100)}%`,
                        background: `linear-gradient(180deg, ${ORANGE}, ${GREEN})`,
                      }}
                      title={`${bar.name}: ${bar.hours}h`}
                    />
                    <span className="w-full truncate text-center text-[10.5px] text-[#71717A]">{bar.name.split(' ')[0]}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={`${BIZ.card} overflow-x-auto`}>
            <table className="w-full min-w-[28rem] text-left text-[13px]">
              <thead className="border-b border-[#F4F4F5] text-[11.5px] uppercase tracking-wide text-[#71717A]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('biz.team.colBadge')}</th>
                  <th className="px-4 py-3 font-medium">{t('biz.team.colName')}</th>
                  <th className="px-4 py-3 font-medium">{t('biz.team.colRole')}</th>
                  <th className="px-4 py-3 font-medium">{t('biz.team.colHours')}</th>
                  <th className="px-4 py-3 font-medium">{t('biz.team.colDays')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F4F4F5]">
                {(report?.employees ?? []).map((row) => (
                  <tr key={row.employee_id}>
                    <td className="px-4 py-2.5 font-mono text-[12px]">{row.badge_code}</td>
                    <td className="px-4 py-2.5 font-medium text-[#18181B]">{row.name}</td>
                    <td className="px-4 py-2.5 text-[#52525B]">{row.role}</td>
                    <td className="px-4 py-2.5">{row.hours}</td>
                    <td className="px-4 py-2.5">{row.days_worked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {tab === 'rfid' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className={`${BIZ.card} p-5`}>
            <h2 className={BIZ.cardTitle}>
              <KeyRound size={16} className="text-[#E8672A]" />
              {t('biz.team.apiKeyTitle')}
            </h2>
            <p className="mt-1 text-[12.5px] text-[#52525B]">{t('biz.team.apiKeyHint')}</p>
            <p className="mt-3 text-[13px] text-[#18181B]">
              {apiKeyMeta?.configured
                ? t('biz.team.apiKeySet').replace('{prefix}', apiKeyMeta.prefix ?? 'mfk_…')
                : t('biz.team.apiKeyNone')}
            </p>
            {freshKey && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-[12px] font-semibold text-amber-900">{t('biz.team.apiKeyOnce')}</p>
                <code className="mt-1 block break-all font-mono text-[12px] text-[#18181B]">{freshKey}</code>
              </div>
            )}
            <button type="button" onClick={() => void rotateKey()} className={`${BIZ.primary} mt-4 h-10`}>
              {apiKeyMeta?.configured ? t('biz.team.rotateKey') : t('biz.team.createKey')}
            </button>
            <p className="mt-3 font-mono text-[11px] text-[#71717A]">POST /api/business/attendance/scan</p>
          </section>

          <section className={`${BIZ.card} p-5`}>
            <h2 className={BIZ.cardTitle}>
              <CreditCard size={16} className="text-[#E8672A]" />
              {t('biz.team.linkCardTitle')}
            </h2>
            <p className="mt-1 text-[12.5px] text-[#52525B]">{t('biz.team.linkCardHint')}</p>
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-[12px] font-semibold text-amber-950">{t('biz.team.lastScanTitle')}</p>
              <p className="mt-1 font-mono text-[14px] text-[#18181B]">
                {lastUid || t('biz.team.lastScanEmpty')}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-[#52525B]">{t('biz.team.lastScanHint')}</p>
              {lastUid && (
                <button
                  type="button"
                  onClick={() => setScanUid(lastUid)}
                  className={`${BIZ.secondary} mt-2 h-8`}
                >
                  {t('biz.team.lastScanUse')}
                </button>
              )}
            </div>
            <label className={BIZ.label}>{t('biz.team.cardUid')}</label>
            <input
              value={scanUid}
              onChange={(e) => setScanUid(e.target.value.toUpperCase())}
              placeholder="A1B2C3D4"
              className={`${BIZ.field} font-mono uppercase`}
            />
            <label className={`${BIZ.label} mt-3`}>{t('biz.team.employee')}</label>
            <select value={linkEmp} onChange={(e) => setLinkEmp(e.target.value)} className={BIZ.field}>
              <option value="">{t('biz.team.pickEmployee')}</option>
              {employees.filter((e) => e.status === 'active').map((e) => (
                <option key={e.employee_id} value={e.employee_id}>{e.name} ({e.badge_code})</option>
              ))}
            </select>
            <button type="button" onClick={() => void linkCard()} disabled={!scanUid || !linkEmp} className={`${BIZ.primary} mt-4 h-10`}>
              {t('biz.team.linkCard')}
            </button>
            {cards.length > 0 && (
              <ul className="mt-4 divide-y divide-[#F4F4F5] rounded-lg border border-[#E4E4E7]">
                {cards.map((c) => (
                  <li key={c.employee_id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{c.name} · <span className="font-mono">{c.card_uid}</span></span>
                    <button type="button" onClick={() => void unlinkCard(c.employee_id)} className="text-[12px] font-medium text-[#B91C1C]">
                      {t('biz.team.unlink')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal>
          <form onSubmit={(e) => void saveEmployee(e)} className={`${BIZ.card} w-full max-w-md p-5 shadow-xl`}>
            <h2 className="font-display text-[18px] font-semibold text-[#18181B]">
              {editing ? t('biz.team.editTitle') : t('biz.team.addTitle')}
            </h2>
            <label className={`${BIZ.label} mt-4`}>{t('biz.team.fieldName')}</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className={BIZ.field} maxLength={80} />
            <label className={`${BIZ.label} mt-3`}>{t('biz.team.fieldRole')}</label>
            <input required value={role} onChange={(e) => setRole(e.target.value)} className={BIZ.field} maxLength={60} placeholder={t('biz.team.rolePlaceholder')} />
            <label className={`${BIZ.label} mt-3`}>{t('biz.team.fieldPhone')}</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={BIZ.field} maxLength={40} />
            <label className={`${BIZ.label} mt-3`}>{t('biz.team.fieldPhoto')}</label>
            <div className="flex items-center gap-3">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F4F4F5] text-[#A1A1AA]"><Users size={18} /></span>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
              <button type="button" onClick={() => fileRef.current?.click()} className={`${BIZ.secondary} h-9`}>
                {t('biz.team.pickPhoto')}
              </button>
              {photo && (
                <button type="button" onClick={() => setPhoto(null)} className="text-[12.5px] text-[#52525B]">{t('biz.team.clearPhoto')}</button>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className={`${BIZ.secondary} h-10`}>{t('biz.team.cancel')}</button>
              <button type="submit" disabled={saving} className={`${BIZ.primary} h-10`}>{saving ? '…' : t('biz.team.save')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function Avatar({ emp }: { emp: Employee }) {
  const here = emp.presence?.kind === 'present'
  return (
    <UserAvatar
      src={emp.photo}
      name={emp.name}
      seed={emp.employee_id}
      size="md"
      status={here ? 'online' : 'offline'}
    />
  )
}
