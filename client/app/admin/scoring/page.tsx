'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useI18n } from '@/components/I18nProvider'
import { ChartCard } from '@/components/admin/ChartCard'
import { Skeleton } from '@/components/ui/Skeleton'

const BRAND = '#E8672A'

type Payload = {
  weights: { local_bonus: number; accessible_bonus: number; confirmation_threshold: number }
  simulation: {
    avgVisibility: {
      localBefore: number
      localAfter: number
      accessibleBefore: number
      accessibleAfter: number
    }
    sets: { id: string; category: string; visibilityBefore: { local: number }; visibilityAfter: { local: number } }[]
  }
}

export default function AdminScoringPage() {
  const { t } = useI18n()
  const [data, setData] = useState<Payload | null>(null)
  const [localBonus, setLocalBonus] = useState(0.15)
  const [accessibleBonus, setAccessibleBonus] = useState(0.12)
  const [threshold, setThreshold] = useState(3)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/scoring', { credentials: 'include', cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'load')
      setData(json)
      setLocalBonus(json.weights.local_bonus)
      setAccessibleBonus(json.weights.accessible_bonus)
      setThreshold(json.weights.confirmation_threshold)
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
      const res = await fetch('/api/admin/scoring', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          local_bonus: localBonus,
          accessible_bonus: accessibleBonus,
          confirmation_threshold: threshold,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMessage(t('admin.scoring.saved'))
      await load()
    } catch {
      setMessage(t('admin.scoring.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const chartData = data
    ? [
        { label: t('admin.scoring.localShare'), before: data.simulation.avgVisibility.localBefore, after: data.simulation.avgVisibility.localAfter },
        { label: t('admin.scoring.accessShare'), before: data.simulation.avgVisibility.accessibleBefore, after: data.simulation.avgVisibility.accessibleAfter },
      ]
    : []

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{t('admin.nav.scoring')}</h1>
        <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.scoring.subtitle')}</p>
      </div>

      {loading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <section className="rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
          <h2 className="text-[15px] font-semibold">{t('admin.scoring.weightsTitle')}</h2>
          <p className="mt-1 text-[12px] text-[#6E5B50] dark:text-white/50">{t('admin.scoring.weightsHint')}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block text-[13px]">
              <span className="font-medium">{t('admin.scoring.localBonus')}</span>
              <input type="range" min={0} max={1} step={0.01} value={localBonus} onChange={(e) => setLocalBonus(Number(e.target.value))} className="mt-2 w-full accent-[#E8672A]" />
              <span className="text-[#E8672A]">{localBonus.toFixed(2)}</span>
            </label>
            <label className="block text-[13px]">
              <span className="font-medium">{t('admin.scoring.accessBonus')}</span>
              <input type="range" min={0} max={1} step={0.01} value={accessibleBonus} onChange={(e) => setAccessibleBonus(Number(e.target.value))} className="mt-2 w-full accent-[#E8672A]" />
              <span className="text-[#E8672A]">{accessibleBonus.toFixed(2)}</span>
            </label>
            <label className="block text-[13px]">
              <span className="font-medium">{t('admin.scoring.threshold')}</span>
              <input type="number" min={1} max={50} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2 dark:border-white/10 dark:bg-white/5" />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={saving} className="rounded-full bg-[#E8672A] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60">
              {saving ? t('admin.scoring.saving') : t('admin.scoring.save')}
            </button>
            <button type="button" onClick={() => void load()} className="rounded-full border border-black/10 px-4 py-2 text-[13px] dark:border-white/10">
              {t('admin.scoring.rerun')}
            </button>
          </div>
          {message && <p className="mt-3 text-[13px] text-[#E8672A]">{message}</p>}
        </section>
      )}

      <ChartCard title={t('admin.scoring.simTitle')} subtitle={t('admin.scoring.simHint')}>
        {loading || !data ? (
          <Skeleton className="h-[220px] rounded-xl" />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#00000010" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis unit="%" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="before" name={t('admin.scoring.before')} fill="#94A3B8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="after" name={t('admin.scoring.after')} fill={BRAND} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {data && data.simulation.sets.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-white dark:border-white/10 dark:bg-white/[0.04]">
          <table className="min-w-full text-left text-[13px]">
            <thead className="border-b border-black/5 text-[11px] uppercase tracking-wide text-[#6E5B50] dark:border-white/10">
              <tr>
                <th className="px-4 py-3">{t('admin.scoring.set')}</th>
                <th className="px-4 py-3">{t('admin.scoring.category')}</th>
                <th className="px-4 py-3">{t('admin.scoring.localBefore')}</th>
                <th className="px-4 py-3">{t('admin.scoring.localAfter')}</th>
              </tr>
            </thead>
            <tbody>
              {data.simulation.sets.slice(0, 10).map((row) => (
                <tr key={row.id} className="border-b border-black/5 dark:border-white/5">
                  <td className="px-4 py-2 font-mono text-[12px]">{row.id}</td>
                  <td className="px-4 py-2">{row.category}</td>
                  <td className="px-4 py-2">{Math.round(row.visibilityBefore.local * 100)}%</td>
                  <td className="px-4 py-2 text-[#E8672A]">{Math.round(row.visibilityAfter.local * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
