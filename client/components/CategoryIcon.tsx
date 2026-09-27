'use client'

import {
  Coffee,
  Hotel,
  Landmark,
  MapPin,
  Pill,
  ShoppingCart,
  Stethoscope,
  Store,
  Utensils,
  type LucideIcon,
} from 'lucide-react'

/** One Lucide icon per place category. Neutral stroke, no fill. */
export function iconForCategories(categories?: string[]): LucideIcon {
  const blob = (categories ?? []).join(' ').toLowerCase()
  if (/market|super|shop|duka|store/.test(blob)) return ShoppingCart
  if (/cafe|coffee/.test(blob)) return Coffee
  if (/restaurant|food/.test(blob)) return Utensils
  if (/pharm/.test(blob)) return Pill
  if (/hotel|lodg/.test(blob)) return Hotel
  if (/clinic|health|hospital/.test(blob)) return Stethoscope
  if (/attract|museum|memorial/.test(blob)) return Landmark
  if (/shop/.test(blob)) return Store
  return MapPin
}

export function CategoryIcon({
  categories,
  className = 'h-6 w-6 text-neutral-400',
}: {
  categories?: string[]
  className?: string
}) {
  const Icon = iconForCategories(categories)
  return <Icon className={className} strokeWidth={1.75} aria-hidden />
}
