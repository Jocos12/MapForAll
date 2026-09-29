'use client'

import { useCallback, useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { cn } from '@/lib/design/cn'
import { useI18n } from '@/components/I18nProvider'

const MAX_BYTES = 2 * 1024 * 1024
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp']

export type ImageUploadValue = {
  file: File
  previewUrl: string
  dataUrl?: string
}

export interface ImageUploaderProps {
  value: ImageUploadValue | null
  onChange: (value: ImageUploadValue | null) => void
  disabled?: boolean
  className?: string
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Drag-drop avatar picker with circular preview (jpg/png/webp, max 2 MB). */
export function ImageUploader({ value, onChange, disabled, className }: ImageUploaderProps) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  const applyFile = useCallback(
    async (file: File) => {
      setError('')
      if (!ACCEPT.includes(file.type)) {
        setError(t('admin.users.avatarInvalidType'))
        return
      }
      if (file.size > MAX_BYTES) {
        setError(t('admin.users.avatarTooLarge'))
        return
      }
      const previewUrl = URL.createObjectURL(file)
      const dataUrl = await readAsDataUrl(file)
      onChange({ file, previewUrl, dataUrl })
    },
    [onChange, t],
  )

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    const file = e.dataTransfer.files[0]
    if (file) void applyFile(file)
  }

  const clear = () => {
    if (value?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(value.previewUrl)
    onChange(null)
    setError('')
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={cn(
          'relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 transition-colors cursor-pointer',
          dragOver ? 'border-orange bg-orange/5' : 'border-border hover:border-orange/50',
          disabled && 'opacity-50 pointer-events-none',
        )}
      >
        {value ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value.previewUrl}
              alt=""
              className="h-24 w-24 rounded-full object-cover ring-2 ring-border"
            />
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  clear()
                }}
                className="absolute -top-1 -right-1 rounded-full bg-bg border border-border p-1 shadow-sm hover:bg-surface2"
                aria-label={t('admin.users.avatarRemove')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          <>
            <Upload className="h-8 w-8 text-text3" aria-hidden />
            <p className="text-sm text-text2 text-center">{t('admin.users.avatarDrop')}</p>
            <p className="text-xs text-text3">{t('admin.users.avatarHint')}</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(',')}
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void applyFile(file)
            e.target.value = ''
          }}
        />
      </div>
      {error && <p className="text-xs text-red">{error}</p>}
    </div>
  )
}
