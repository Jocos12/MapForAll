'use client'

import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/components/I18nProvider'

const VIEW = 280
const OUT = 512
const MAX_CHARS = 90_000

function coverDraw(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  zoom: number,
  dx: number,
  dy: number,
  size: number,
) {
  const base = Math.max(size / img.naturalWidth, size / img.naturalHeight)
  const scale = base * zoom
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  const x = (size - w) / 2 + dx * (size / VIEW)
  const y = (size - h) / 2 + dy * (size / VIEW)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(img, x, y, w, h)
}

/** Circle crop. The saved file is a 512×512 JPEG (EXIF is dropped by the canvas). */
export function AvatarCropDialog({
  file,
  onCancel,
  onSave,
}: {
  file: File
  onCancel: () => void
  onSave: (dataUrl: string) => void
}) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setReady(true)
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !ready) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    coverDraw(ctx, img, zoom, offset.x, offset.y, VIEW)
  }, [zoom, offset, ready])

  function pointerDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, dx: offset.x, dy: offset.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function pointerMove(e: React.PointerEvent) {
    const start = drag.current
    if (!start) return
    setOffset({ x: start.dx + (e.clientX - start.x), y: start.dy + (e.clientY - start.y) })
  }
  function pointerUp() {
    drag.current = null
  }

  function confirm() {
    const img = imgRef.current
    if (!img) return
    const out = document.createElement('canvas')
    out.width = OUT
    out.height = OUT
    const ctx = out.getContext('2d')
    if (!ctx) return
    coverDraw(ctx, img, zoom, offset.x, offset.y, OUT)
    let url = out.toDataURL('image/jpeg', 0.82)
    for (const quality of [0.7, 0.58, 0.46, 0.34]) {
      if (url.length <= MAX_CHARS) break
      url = out.toDataURL('image/jpeg', quality)
    }
    onSave(url)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-[#1A1614]">
        <h2 id="avatar-crop-title" className="font-display text-[20px] font-semibold">{t('greet.cropTitle')}</h2>
        <p className="mt-1 text-[13px] text-[#52525B] dark:text-white/55">{t('greet.cropHint')}</p>
        <div className="relative mx-auto mt-4 h-[280px] w-[280px] overflow-hidden rounded-full bg-[#F4F4F5]">
          <canvas
            ref={canvasRef}
            width={VIEW}
            height={VIEW}
            className="h-full w-full cursor-grab touch-none"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
          />
        </div>
        <label className="mt-4 block text-[13px] font-medium">
          {t('greet.zoom')}
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="mt-1 block w-full"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-full border border-black/10 px-4 text-[13px] font-medium dark:border-white/15">
            {t('biz.profile.cancel')}
          </button>
          <button type="button" onClick={confirm} disabled={!ready} className="min-h-11 rounded-full bg-[#E8672A] px-4 text-[13px] font-medium text-white disabled:opacity-60">
            {t('greet.cropSave')}
          </button>
        </div>
      </div>
    </div>
  )
}

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type AvatarFileError = 'invalid_type' | 'too_large' | 'too_small' | 'invalid_avatar'

/** JPG, PNG or WebP, at most 5 MB, at least 200×200. */
export function validateAvatarFile(file: File): Promise<AvatarFileError | null> {
  if (!ALLOWED.has(file.type)) return Promise.resolve('invalid_type')
  if (file.size > 5 * 1024 * 1024) return Promise.resolve('too_large')
  const url = URL.createObjectURL(file)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img.naturalWidth < 200 || img.naturalHeight < 200 ? 'too_small' : null)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve('invalid_avatar')
    }
    img.src = url
  })
}
