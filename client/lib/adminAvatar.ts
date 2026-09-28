import { mkdir, unlink, writeFile } from 'fs/promises'
import path from 'path'

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function avatarExt(mime: string): 'jpg' | 'png' | 'webp' | null {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return null
}

export function avatarsDir(): string {
  return path.join(process.cwd(), 'public', 'uploads', 'avatars')
}

export function avatarPublicPath(userId: string, ext: string): string {
  return `/uploads/avatars/${userId}.${ext}`
}

export function avatarDiskPath(userId: string, ext: string): string {
  return path.join(avatarsDir(), `${userId}.${ext}`)
}

/** Remove any existing avatar file for this user (any supported extension). */
export async function deleteAvatarFiles(userId: string): Promise<void> {
  for (const ext of ['jpg', 'png', 'webp'] as const) {
    try {
      await unlink(avatarDiskPath(userId, ext))
    } catch {
      /* missing file */
    }
  }
}

export async function saveAvatarBuffer(userId: string, mime: string, buffer: Buffer): Promise<string> {
  const ext = avatarExt(mime)
  if (!ext) throw new Error('invalid_mime')
  if (buffer.length > AVATAR_MAX_BYTES) throw new Error('too_large')
  await mkdir(avatarsDir(), { recursive: true })
  await deleteAvatarFiles(userId)
  await writeFile(avatarDiskPath(userId, ext), buffer)
  return avatarPublicPath(userId, ext)
}

export function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim())
  if (!m) return null
  try {
    return { mime: m[1], buffer: Buffer.from(m[2], 'base64') }
  } catch {
    return null
  }
}
