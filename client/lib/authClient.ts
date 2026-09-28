/**
 * Client-side auth helpers. The httpOnly session cookie is the source of truth;
 * localStorage only caches display identity and must never grant access alone.
 */

export const AUTH_IDENTITY_KEYS = ['hodari_uid', 'hodari_email', 'hodari_name'] as const

export function clearLocalAuth(): void {
  try {
    for (const key of AUTH_IDENTITY_KEYS) localStorage.removeItem(key)
    localStorage.removeItem('hodari_active_session')
    localStorage.removeItem('hodari_history')
    localStorage.removeItem('hodari_chat_index')
    localStorage.removeItem('hodari_saved')
  } catch { /* private mode */ }
  try {
    sessionStorage.clear()
  } catch { /* private mode */ }
}

/** Server logout + wipe local identity, then hard-navigate to login. */
export async function logoutAndRedirect(next = '/login'): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', cache: 'no-store' })
  } catch { /* still clear locally */ }
  clearLocalAuth()
  window.location.replace(next)
}

/** On any 401 from a protected API: clear local state and go to login. */
export function handleAuthFailure(status: number): boolean {
  if (status !== 401) return false
  clearLocalAuth()
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.replace('/login?expired=1')
  }
  return true
}
