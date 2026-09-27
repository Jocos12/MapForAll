'use client'

import { useState } from 'react'
import type { Place } from '@/lib/types'

interface Props {
  places: Place[]
  activeIndex: number | null
  onSelect: (index: number) => void
  onShowDetails: (place: Place) => void
  onRouteFromMe: (index: number) => void
  onAsk: (index: number, prompt: string) => void
  hasUserLocation: boolean
  locationPending?: boolean
  leftOffset?: number
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current shrink-0">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current shrink-0">
      <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2z" />
    </svg>
  )
}

function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current shrink-0">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm-1 14H8v-2h3v-2H9V8h4v6h3v2h-5v2z" />
    </svg>
  )
}

function askChips(place: Place): { label: string; prompt: string }[] {
  return [
    { label: 'Tell me more', prompt: `Tell me more about ${place.name} — vibe, what to order, and anything I should know before going.` },
    { label: 'Worth it?', prompt: `Is ${place.name} a good pick for my budget and plans? Why or why not?` },
    { label: 'Hours & price', prompt: `What are ${place.name}'s typical hours and price range?` },
    { label: 'Route from me', prompt: `Show me the best route from my current location to ${place.name}.` },
  ]
}

export function PlaceStack({
  places,
  activeIndex,
  onSelect,
  onShowDetails,
  onRouteFromMe,
  onAsk,
  hasUserLocation,
  locationPending = false,
  leftOffset = 0,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  function handleCardClick(i: number) {
    if (activeIndex === i) {
      setExpanded((v) => !v)
    } else {
      onSelect(i)
      setExpanded(true)
    }
  }

  const active = activeIndex != null ? places[activeIndex] : null
  const isOpen = expanded && active != null

  return (
    <div className="absolute bottom-0 right-0 p-4 z-10" style={{ left: leftOffset }}>
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          title="Show places"
          className="glass rounded-xl px-4 py-3 flex items-center gap-2 text-text2 hover:text-gold transition-colors animate-fade-up"
        >
          <span className="font-mono text-xs tracking-wider uppercase">
            Places · {places.length}
          </span>
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" /></svg>
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2.5 max-w-lg">
            <span className="font-mono text-[11px] tracking-widest uppercase text-text3">
              Nearby picks · {places.length} {places.length === 1 ? 'place' : 'places'}
            </span>
            <button
              onClick={() => setCollapsed(true)}
              title="Hide places"
              className="glass p-1.5 rounded-lg text-text3 hover:text-gold transition-all"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" /></svg>
            </button>
          </div>

          {isOpen && active && activeIndex != null && (
            <div className="glass rounded-2xl max-h-[42vh] overflow-y-auto px-5 pt-4 pb-4 mb-3 max-w-md scrollbar-hide animate-fade-up">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <span className="font-mono text-[10px] tracking-widest uppercase text-gold">
                    Pick {(activeIndex) + 1}
                  </span>
                  <p className="font-display text-lg font-semibold leading-snug text-text mt-0.5">
                    {active.name}
                  </p>
                </div>
                <button
                  onClick={() => setExpanded(false)}
                  title="Collapse"
                  className="shrink-0 p-1 rounded-lg text-text3 hover:text-gold hover:bg-gold/5 transition-all"
                >
                  <svg viewBox="0 0 24 24" className={`w-4 h-4 fill-current transition-transform ${expanded ? 'rotate-180' : ''}`}>
                    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                  </svg>
                </button>
              </div>

              {active.address && (
                <div className="flex items-start gap-1.5 text-text2 mb-2">
                  <span className="text-gold/70 mt-0.5"><PinIcon /></span>
                  <span className="text-[12.5px] leading-relaxed">{active.address}</span>
                </div>
              )}

              {active.summary && (
                <p className="text-sm text-text leading-relaxed mb-3">{active.summary}</p>
              )}

              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  onClick={() => onShowDetails(active)}
                  className="font-mono text-[11px] tracking-wider uppercase text-gold hover:text-gold-light transition-colors px-3 py-1.5 rounded-full border border-gold/30 hover:bg-gold/5"
                >
                  Photos & details
                </button>
                <button
                  onClick={() => onRouteFromMe(activeIndex)}
                  className="flex items-center gap-1.5 font-mono text-[11px] tracking-wider uppercase text-text2 hover:text-text px-3 py-1.5 rounded-full border border-border hover:border-gold/40 transition-all"
                >
                  <RouteIcon />
                  {locationPending ? 'Getting location…' : hasUserLocation ? 'Route from me' : 'Allow location for route'}
                </button>
              </div>

              <div className="mb-1">
                <p className="font-mono text-[9px] tracking-widest uppercase text-text3 mb-1.5">Ask MapForAll</p>
                <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
                  {askChips(active).map((chip) => (
                    <button
                      key={chip.label}
                      onClick={() => onAsk(activeIndex, chip.prompt)}
                      className="shrink-0 flex items-center gap-1.5 font-sans text-[11px] text-text2 px-3 py-1.5 rounded-full border border-border hover:border-gold/40 hover:text-text hover:bg-gold/5 transition-all"
                    >
                      <span className="text-gold/60"><SparkIcon /></span>
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 overflow-x-auto scrollbar-hide max-w-[min(100%,42rem)] pb-1">
            {places.map((place, i) => {
              const isActive = activeIndex === i
              return (
                <button
                  key={`${place.place_id || place.name}-${i}`}
                  onClick={() => handleCardClick(i)}
                  className={`shrink-0 glass rounded-xl px-4 py-3 text-left min-w-[140px] max-w-[200px] transition-all ${
                    isActive ? 'ring-1 ring-gold/50 border-gold/30' : 'hover:border-gold/20'
                  }`}
                >
                  <span className="font-mono text-[9px] tracking-widest uppercase text-text3 block mb-0.5">
                    {i + 1}
                  </span>
                  <span className="font-sans text-[13px] font-medium text-text line-clamp-2 leading-snug">
                    {place.name}
                  </span>
                  {place.rating != null && (
                    <span className="font-mono text-[10px] text-text3 mt-1 block">★ {place.rating}</span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
