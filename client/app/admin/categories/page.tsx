'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, GripVertical, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useI18n, type Lang } from '@/components/I18nProvider'
import { EmptyState } from '@/components/admin/EmptyState'
import { useToast } from '@/components/ui/Toast'

type Category = {
  category_id: string
  slug: string
  name_fr: string
  name_en: string
  name_rw: string
  icon: string
  color: string
  order: number
  place_count?: number
}

type Criterion = {
  criterion_id: string
  label_fr: string
  label_en: string
  label_rw: string
  order: number
}

function catLabel(c: Category, lang: Lang) {
  if (lang === 'fr') return c.name_fr
  if (lang === 'rw') return c.name_rw
  return c.name_en
}

export default function AdminCategoriesPage() {
  const { t, lang } = useI18n()
  const { toast } = useToast()
  const [categories, setCategories] = useState<Category[]>([])
  const [criteria, setCriteria] = useState<Criterion[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    slug: '',
    name_fr: '',
    name_en: '',
    name_rw: '',
    icon: 'map-pin',
    color: '#E8672A',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [catRes, critRes] = await Promise.all([
        fetch('/api/admin/categories', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/admin/categories/access-criteria', { credentials: 'include', cache: 'no-store' }),
      ])
      const catJson = await catRes.json().catch(() => ({}))
      const critJson = await critRes.json().catch(() => ({}))
      if (catRes.ok) setCategories(Array.isArray(catJson.items) ? catJson.items : [])
      if (critRes.ok) setCriteria(Array.isArray(critJson.items) ? critJson.items : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const reorderCategories = async (from: number, dir: -1 | 1) => {
    const to = from + dir
    if (to < 0 || to >= categories.length) return
    const next = [...categories]
    const tmp = next[from]
    next[from] = next[to]
    next[to] = tmp
    setCategories(next)
    const res = await fetch('/api/admin/categories', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reorder: next.map((c) => c.category_id) }),
    })
    if (!res.ok) toast({ title: t('admin.shell.loadError'), tone: 'danger' })
    else await load()
  }

  const createCategory = async () => {
    const res = await fetch('/api/admin/categories', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({ title: t('admin.shell.loadError'), description: json.error, tone: 'danger' })
      return
    }
    toast({ title: t('admin.categories.created'), tone: 'success' })
    setForm({ slug: '', name_fr: '', name_en: '', name_rw: '', icon: 'map-pin', color: '#E8672A' })
    await load()
  }

  const deleteCategory = async (category_id: string) => {
    if (!window.confirm(t('admin.categories.deleteConfirm'))) return
    const res = await fetch(`/api/admin/categories?category_id=${encodeURIComponent(category_id)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) toast({ title: t('admin.shell.loadError'), tone: 'danger' })
    else await load()
  }

  const saveCategory = async (c: Category) => {
    const res = await fetch('/api/admin/categories', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: c.category_id,
        name_fr: c.name_fr,
        name_en: c.name_en,
        name_rw: c.name_rw,
        icon: c.icon,
        color: c.color,
      }),
    })
    if (!res.ok) toast({ title: t('admin.shell.loadError'), tone: 'danger' })
    else toast({ title: t('admin.categories.saved'), tone: 'success' })
  }

  const updateCategoryField = (id: string, field: keyof Category, value: string) => {
    setCategories((list) => list.map((c) => (c.category_id === id ? { ...c, [field]: value } : c)))
  }

  const reorderCriteria = async (from: number, dir: -1 | 1) => {
    const to = from + dir
    if (to < 0 || to >= criteria.length) return
    const next = [...criteria]
    const tmp = next[from]
    next[from] = next[to]
    next[to] = tmp
    setCriteria(next)
    await fetch('/api/admin/categories/access-criteria', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reorder: next.map((c) => c.criterion_id) }),
    })
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">{t('admin.nav.categories')}</h1>
        <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.categories.subtitle')}</p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-xl border border-black/10 px-3 py-2 text-[13px]"
        >
          <RefreshCw size={14} /> {t('admin.businesses.refresh')}
        </button>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t('admin.categories.sectionCategories')}</h2>
        {loading ? (
          <p className="text-[13px]">{t('admin.moderation.loading')}</p>
        ) : categories.length === 0 ? (
          <EmptyState title={t('admin.categories.empty')} />
        ) : (
          <ul className="space-y-2">
            {categories.map((c, index) => (
              <li
                key={c.category_id}
                className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-white/5"
              >
                <GripVertical size={16} className="text-[#6E5B50]" aria-hidden />
                <span className="h-4 w-4 rounded-full" style={{ background: c.color }} />
                <input
                  value={c.slug}
                  readOnly
                  className="w-24 rounded-lg bg-black/5 px-2 py-1 text-[12px] dark:bg-white/10"
                />
                <input
                  value={catLabel(c, lang)}
                  onChange={(e) => {
                    const field = lang === 'fr' ? 'name_fr' : lang === 'rw' ? 'name_rw' : 'name_en'
                    updateCategoryField(c.category_id, field, e.target.value)
                  }}
                  className="min-w-[120px] flex-1 rounded-lg border border-black/10 px-2 py-1 text-[13px] dark:border-white/10"
                />
                <span className="text-[12px] text-[#6E5B50]">
                  {t('admin.categories.placesCount').replace('{n}', String(c.place_count ?? 0))}
                </span>
                <div className="flex gap-1">
                  <button type="button" onClick={() => void reorderCategories(index, -1)} className="rounded-lg p-1 hover:bg-black/5">
                    <ChevronUp size={16} />
                  </button>
                  <button type="button" onClick={() => void reorderCategories(index, 1)} className="rounded-lg p-1 hover:bg-black/5">
                    <ChevronDown size={16} />
                  </button>
                  <button type="button" onClick={() => void saveCategory(c)} className="rounded-lg px-2 py-1 text-[12px] text-[#E8672A]">
                    {t('admin.places.save')}
                  </button>
                  <button type="button" onClick={() => void deleteCategory(c.category_id)} className="rounded-lg p-1 text-red-600">
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-2xl border border-dashed border-black/15 p-4 dark:border-white/15">
          <p className="mb-3 text-[13px] font-medium">{t('admin.categories.add')}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input
              placeholder="slug"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
              className="rounded-lg border border-black/10 px-2 py-1.5 text-[13px] dark:border-white/10"
            />
            <input
              placeholder={t('admin.categories.nameFr')}
              value={form.name_fr}
              onChange={(e) => setForm((f) => ({ ...f, name_fr: e.target.value }))}
              className="rounded-lg border border-black/10 px-2 py-1.5 text-[13px] dark:border-white/10"
            />
            <input
              placeholder={t('admin.categories.nameEn')}
              value={form.name_en}
              onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))}
              className="rounded-lg border border-black/10 px-2 py-1.5 text-[13px] dark:border-white/10"
            />
            <input
              placeholder={t('admin.categories.nameRw')}
              value={form.name_rw}
              onChange={(e) => setForm((f) => ({ ...f, name_rw: e.target.value }))}
              className="rounded-lg border border-black/10 px-2 py-1.5 text-[13px] dark:border-white/10"
            />
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
              className="h-9 w-full cursor-pointer rounded-lg border border-black/10"
            />
          </div>
          <button
            type="button"
            onClick={() => void createCategory()}
            className="mt-3 inline-flex items-center gap-1 rounded-xl bg-[#E8672A] px-3 py-2 text-[13px] text-white"
          >
            <Plus size={14} /> {t('admin.categories.add')}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('admin.categories.sectionCriteria')}</h2>
        <ul className="space-y-2">
          {criteria.map((c, index) => (
            <li
              key={c.criterion_id}
              className="flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/5"
            >
              <span className="flex-1">
                {lang === 'fr' ? c.label_fr : lang === 'rw' ? c.label_rw : c.label_en}
              </span>
              <button type="button" onClick={() => void reorderCriteria(index, -1)}>
                <ChevronUp size={14} />
              </button>
              <button type="button" onClick={() => void reorderCriteria(index, 1)}>
                <ChevronDown size={14} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
