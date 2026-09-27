export interface LeafletMarker {
  addTo: (map: LeafletMap) => LeafletMarker
  on: (event: string, handler: () => void) => LeafletMarker
  setLatLng: (latlng: [number, number]) => LeafletMarker
  getLatLng: () => { lat: number; lng: number }
}

export interface LeafletMap {
  remove: () => void
  setView: (center: [number, number], zoom: number) => LeafletMap
  on: (event: string, handler: (e: { latlng: { lat: number; lng: number } }) => void) => LeafletMap
  invalidateSize: () => void
  getZoom: () => number
}

export interface LeafletNS {
  map: (el: HTMLElement, opts: object) => LeafletMap
  tileLayer: (url: string, opts: object) => { addTo: (map: LeafletMap) => void }
  divIcon: (opts: { className: string; html: string; iconSize: [number, number]; iconAnchor: [number, number] }) => unknown
  marker: (latlng: [number, number], opts: object) => LeafletMarker
}

declare global {
  interface Window {
    L?: LeafletNS
  }
}

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

let loading: Promise<LeafletNS> | null = null

/** Leaflet is self-hosted under /vendor and loaded once, on demand. */
export function loadLeaflet(): Promise<LeafletNS> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.L) return Promise.resolve(window.L)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement('link')
      css.rel = 'stylesheet'
      css.href = '/vendor/leaflet/leaflet.css'
      css.dataset.leaflet = '1'
      document.head.appendChild(css)
    }
    const script = document.createElement('script')
    script.src = '/vendor/leaflet/leaflet.js'
    script.async = true
    script.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet missing')))
    script.onerror = () => {
      loading = null
      reject(new Error('Leaflet failed to load'))
    }
    document.body.appendChild(script)
  })
  return loading
}
