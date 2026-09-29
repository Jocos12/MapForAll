'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/components/I18nProvider'
import { Skeleton } from '@/components/ui/Skeleton'

type Row = {
  place_id: string
  name: string
  lang_content: Record<string, { name?: string; summary?: string }>
  completeness: { overall: number; perLang: Record<string, { name: boolean; summary: boolean; pct: number }> }
}

export default function AdminTranslationsPage() {
  const { t } = useI18n()
  const [items, setItems] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [incompleteOnly, setIncompleteOnly] = useState(true)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ limit: '50' })
      if (q.trim()) qs.set('q', q.trim())
      if (incompleteOnly) qs.set('incomplete', 'true')
      const res = await fetch(`/api/admin/translations?${qs}`, { credentials: 'include', cache: 'no-store' })
      const json = await res.json()
      if (res.ok) setItems(json.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [q, incompleteOnly])

  useEffect(() => { void load() }, [load])

  async function saveField(placeId: string, lang: 'fr' | 'en' | 'rw', field: 'name' | 'summary', value: string) {
    setSavingId(`${placeId}-${lang}-${field}`)
    try {
      const res = await fetch(`/api/admin/translations/${encodeURIComponent(placeId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang, field, value }),
      })
      if (res.ok) await load()
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{t('admin.nav.translations')}</h1>
        <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.translations.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('admin.translations.search')}
          className="min-w-[200px] flex-1 rounded-full border border-black/10 px-4 py-2 text-[13px] dark:border-white/10 dark:bg-white/5"
        />
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={incompleteOnly} onChange={(e) => setIncompleteOnly(e.target.checked)} className="accent-[#E8672A]" />
          {t('admin.translations.incompleteOnly')}
        </label>
        <button type="button" onClick={() => void load()} className="rounded-full bg-[#E8672A] px-4 py-2 text-[13px] text-white">
          {t('admin.translations.refresh')}
        </button>
      </div>

      {loading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-white dark:border-white/10 dark:bg-white/[0.04]">
          <table className="min-w-full text-left text-[12px]">
            <thead className="border-b border-black/5 bg-[#F7F1E8]/50 text-[11px] uppercase tracking-wide dark:border-white/10 dark:bg-white/5">
              <tr>
                <th className="px-3 py-2">{t('admin.translations.place')}</th>
                <th className="px-3 py-2">FR</th>
                <th className="px-3 py-2">EN</th>
                <th className="px-3 py-2">RW</th>
                <th className="px-3 py-2">{t('admin.translations.complete')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.place_id} className="border-b border-black/5 align-top dark:border-white/5">
                  <td className="px-3 py-3">
                    <p className="font-medium">{row.name}</p>
                    <p className="font-mono text-[10px] text-[#6E5B50]">{row.place_id}</p>
                  </td>
                  {(['fr', 'en', 'rw'] as const).map((lang) => (
                    <td key={lang} className="px-3 py-3">
                      <LangCell
                        lang={lang}
                        placeId={row.place_id}
                        content={row.lang_content[lang]}
                        flags={row.completeness.perLang[lang]}
                        savingId={savingId}
                        onSave={saveField}
                        t={t}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-3 font-semibold text-[#E8672A]">{row.completeness.overall}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && (
            <p className="px-4 py-8 text-center text-[13px] text-[#6E5B50]">{t('admin.translations.empty')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function LangCell({
  lang,
  placeId,
  content,
  flags,
  savingId,
  onSave,
  t,
}: {
  lang: 'fr' | 'en' | 'rw'
  placeId: string
  content?: { name?: string; summary?: string }
  flags?: { name: boolean; summary: boolean; pct: number }
  savingId: string | null
  onSave: (placeId: string, lang: 'fr' | 'en' | 'rw', field: 'name' | 'summary', value: string) => void
  t: (k: string) => string
}) {
  const [name, setName] = useState(content?.name ?? '')
  const [summary, setSummary] = useState(content?.summary ?? '')

  useEffect(() => {
    setName(content?.name ?? '')
    setSummary(content?.summary ?? '')
  }, [content?.name, content?.summary])

  const busy = savingId?.startsWith(`${placeId}-${lang}`) ?? false

  return (
    <div className="space-y-2 min-w-[160px]">
      <Field
        label={t('admin.translations.name')}
        ok={flags?.name}
        value={name}
        onChange={setName}
        onBlur={() => onSave(placeId, lang, 'name', name)}
        busy={busy}
      />
      <Field
        label={t('admin.translations.summary')}
        ok={flags?.summary}
        value={summary}
        onChange={setSummary}
        onBlur={() => onSave(placeId, lang, 'summary', summary)}
        busy={busy}
      />
    </div>
  )
}

function Field({
  label,
  ok,
  value,
  onChange,
  onBlur,
  busy,
}: {
  label: string
  ok?: boolean
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  busy: boolean
}) {
  return (
    <label className="block">
      <span className={`text-[10px] uppercase ${ok ? 'text-[#1F8A5B]' : 'text-[#B45309]'}`}>{label}</span>
      <input
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="mt-0.5 w-full rounded-lg border border-black/10 px-2 py-1 text-[12px] dark:border-white/10 dark:bg-white/5"
      />
    </label>
  )
}
