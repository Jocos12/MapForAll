/** Client helper: reverse-geocode via our Nominatim proxy (throttled server-side). */

export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<{ address: string | null; failed: boolean }> {
  const url = `/api/geocode/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`
  try {
    const res = await fetch(url, { signal, cache: 'no-store' })
    if (!res.ok) return { address: null, failed: true }
    const data = (await res.json()) as { address?: string | null; failed?: boolean }
    const address = typeof data.address === 'string' && data.address.trim() ? data.address.trim() : null
    return { address, failed: Boolean(data.failed) || !address }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return { address: null, failed: false }
    return { address: null, failed: true }
  }
}
