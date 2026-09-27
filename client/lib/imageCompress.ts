/** Re-encode a picked image as a JPEG data URL small enough for a listing photo. */
export async function compressImage(file: File, maxChars = 90_000): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  const source = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = source
    })
    for (const edge of [1280, 1024, 800, 640, 480]) {
      const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.82, 0.7, 0.58, 0.46]) {
        const url = canvas.toDataURL('image/jpeg', quality)
        if (url.length <= maxChars) return url
      }
    }
    return null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(source)
  }
}
