'use client'

import { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { storeDemoSession } from '@/components/admin/DemoModeBanner'
import { Skeleton } from '@/components/ui/Skeleton'

type SettingsPayload = {
  app: {
    default_lang: 'fr' | 'en' | 'rw'
    demo_mode?: boolean
    email?: Record<string, string>
  }
  scoring: { confirmation_threshold: number }
  smtpConfigured: boolean
}

const EMAIL_KEYS = [
  'welcome_subject',
  'welcome_body',
  'otp_subject',
  'otp_body',
  'validate_subject',
  'validate_body',
  'reject_subject',
  'reject_body',
] as const

export default function AdminSettingsPage() {
  const { t } = useI18n()
  const [data, setData] = useState<SettingsPayload | null>(null)
  const [defaultLang, setDefaultLang] = useState<'fr' | 'en' | 'rw'>('fr')
  const [threshold, setThreshold] = useState(3)
  const [email, setEmail] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [demoBusy, setDemoBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings', { credentials: 'include', cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setData(json)
      setDefaultLang(json.app.default_lang)
      setThreshold(json.scoring.confirmation_threshold)
      setEmail(json.app.email ?? {})
    } catch {
      setMessage(t('admin.shell.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  async function save() {
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_lang: defaultLang,
          confirmation_threshold: threshold,
          email,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMessage(t('admin.settings.saved'))
      setData(json)
    } catch {
      setMessage(t('admin.settings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function startDemo() {
    setDemoBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/demo/start', { method: 'POST', credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      storeDemoSession({ steps: json.steps, place_id: json.place_id })
      setMessage(t('admin.demo.started'))
      window.location.href = '/admin/dashboard'
    } catch {
      setMessage(t('admin.demo.failed'))
    } finally {
      setDemoBusy(false)
    }
  }

  async function exportData() {
    const res = await fetch('/api/admin/settings?action=export', { method: 'POST', credentials: 'include' })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mapforall-export.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <Skeleton className="mx-auto h-96 max-w-3xl rounded-2xl" />

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{t('admin.nav.settings')}</h1>
        <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.settings.subtitle')}</p>
      </div>

      <section className="rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
        <h2 className="text-[15px] font-semibold">{t('admin.settings.general')}</h2>
        <label className="mt-3 block text-[13px]">
          {t('admin.settings.defaultLang')}
          <select
            value={defaultLang}
            onChange={(e) => setDefaultLang(e.target.value as 'fr' | 'en' | 'rw')}
            className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 dark:border-white/10 dark:bg-white/5"
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
            <option value="rw">Kinyarwanda</option>
          </select>
        </label>
        <label className="mt-3 block text-[13px]">
          {t('admin.settings.threshold')}
          <input type="number" min={1} max={50} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 dark:border-white/10 dark:bg-white/5" />
        </label>
        <p className="mt-2 text-[12px] text-[#6E5B50]">
          SMTP: {data?.smtpConfigured ? t('admin.dashboard.healthOk') : t('admin.dashboard.healthCheck')}
        </p>
      </section>

      <section className="rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
        <h2 className="text-[15px] font-semibold">{t('admin.settings.emailTitle')}</h2>
        <p className="mt-1 text-[12px] text-[#6E5B50]">{t('admin.settings.emailHint')}</p>
        <div className="mt-4 space-y-3">
          {EMAIL_KEYS.map((key) => (
            <label key={key} className="block text-[12px]">
              <span className="font-mono text-[11px] text-[#6E5B50]">{key}</span>
              <textarea
                value={email[key] ?? ''}
                onChange={(e) => setEmail((prev) => ({ ...prev, [key]: e.target.value }))}
                rows={key.endsWith('body') ? 3 : 1}
                className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/5"
              />
            </label>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} disabled={saving} className="rounded-full bg-[#E8672A] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60">
          {saving ? t('admin.settings.saving') : t('admin.settings.save')}
        </button>
        <button type="button" onClick={() => void exportData()} className="rounded-full border border-black/10 px-4 py-2 text-[13px] dark:border-white/10">
          {t('admin.settings.exportData')}
        </button>
        <button
          type="button"
          onClick={() => void startDemo()}
          disabled={demoBusy}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#E8672A]/50 px-4 py-2 text-[13px] font-medium text-[#E8672A] disabled:opacity-60"
        >
          <Sparkles size={14} /> {demoBusy ? t('admin.demo.starting') : t('admin.demo.start')}
        </button>
      </div>
      {message && <p className="text-[13px] text-[#E8672A]">{message}</p>}
    </div>
  )
}
