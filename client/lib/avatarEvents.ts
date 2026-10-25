const CHANNEL = 'hodari-avatar'

/** Tell every open tab that the signed-in user's photo changed. */
export function publishAvatar(url: string | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('hodari-avatar', { detail: url }))
  try {
    const channel = new BroadcastChannel(CHANNEL)
    channel.postMessage({ url })
    channel.close()
  } catch { /* private mode or unsupported */ }
}
