'use client'

import { useState } from 'react'
import { notFound } from 'next/navigation'
import { MapPin, Search, Star } from 'lucide-react'
import {
  Button, Card, CardLabel, Badge, Skeleton, SkeletonText, Avatar,
  Input, Select, Modal, Sheet, ToastProvider, useToast,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui'
import { accents, colorTokens, typeScale } from '@/lib/design/tokens'

// Dev-only reference page for the design system. Returns 404 in production builds.
export default function KitchenSink() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <ToastProvider>
      <Sink />
    </ToastProvider>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-mono text-[11px] text-gold tracking-[0.2em] uppercase">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  )
}

function Sink() {
  const { toast } = useToast()
  const [modal, setModal] = useState(false)
  const [sheet, setSheet] = useState(false)

  return (
    <main className="min-h-screen overflow-y-auto p-8 md:p-12 max-w-4xl mx-auto space-y-12">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold text-text">Design system</h1>
        <p className="font-mono text-[11px] text-text3 tracking-widest uppercase">MapForAll · kitchen sink (dev only)</p>
      </header>

      <Section title="Color">
        {colorTokens.map((c) => (
          <div key={c.name} className="space-y-1.5">
            <div className="w-20 h-12 rounded-lg border border-border" style={{ background: `rgb(var(--color-${c.name}))` }} title={c.usage} />
            <p className="font-mono text-[10px] text-text2">{c.name}</p>
          </div>
        ))}
        {(['gold', 'green', 'danger'] as const).map((c) => (
          <div key={c} className="space-y-1.5">
            <div className="w-20 h-12 rounded-lg" style={{ background: accents[c] }} />
            <p className="font-mono text-[10px] text-text2">{c}</p>
          </div>
        ))}
      </Section>

      <Section title="Type scale">
        <div className="space-y-2 w-full">
          <p className="font-display text-text" style={{ fontSize: typeScale['2xl'] }}>Playfair Display — headings</p>
          <p className="font-sans text-text" style={{ fontSize: typeScale.base }}>Outfit — body copy for paragraphs and UI.</p>
          <p className="font-mono text-text2 tracking-widest uppercase" style={{ fontSize: typeScale.label }}>DM Mono — micro label</p>
        </div>
      </Section>

      <Section title="Buttons">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button loading>Loading</Button>
        <Button disabled>Disabled</Button>
        <Button leftIcon={<Search className="w-4 h-4" />}>With icon</Button>
        <Button pill variant="secondary">Pill</Button>
        <Button iconOnly aria-label="Pin" variant="secondary"><MapPin className="w-4 h-4" /></Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
      </Section>

      <Section title="Badges">
        <Badge>Neutral</Badge>
        <Badge tone="gold">Gold</Badge>
        <Badge tone="success">Open now</Badge>
        <Badge tone="danger">Closed</Badge>
        <Badge tone="outline" mono>Mono tag</Badge>
        <Badge tone="gold" mono><Star className="w-3 h-3" /> 4.6</Badge>
      </Section>

      <Section title="Inputs">
        <div className="grid sm:grid-cols-2 gap-4 w-full">
          <Input label="Search" placeholder="Restaurants near…" leftIcon={<Search className="w-4 h-4" />} />
          <Input label="Email" placeholder="you@example.com" hint="We never share it." />
          <Input label="Budget" defaultValue="abc" error="Enter a number." />
          <Select label="Travel mode" defaultValue="WALK">
            <option value="WALK">Walking</option>
            <option value="DRIVE">Driving</option>
          </Select>
        </div>
      </Section>

      <Section title="Cards & avatars">
        <Card className="w-56">
          <CardLabel>Restaurant</CardLabel>
          <p className="font-display text-lg text-text mt-1">El Nacional</p>
          <p className="text-sm text-text2 mt-1">Catalan · 5 min walk</p>
        </Card>
        <Card glass interactive className="w-56">
          <p className="text-sm text-text">Glass · interactive (hover me)</p>
        </Card>
        <div className="flex items-center gap-3">
          <Avatar name="Pacifique Mugisho" status="online" />
          <Avatar name="Ana Ruiz" size="lg" />
          <Avatar name="No Image" size="sm" status="offline" />
        </div>
      </Section>

      <Section title="Skeletons">
        <Card className="w-64 space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <SkeletonText lines={3} />
        </Card>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="list" className="w-full">
          <TabsList>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="map">Map</TabsTrigger>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
          </TabsList>
          <TabsContent value="list"><p className="text-sm text-text2">A ranked list of places.</p></TabsContent>
          <TabsContent value="map"><p className="text-sm text-text2">A compact map view.</p></TabsContent>
          <TabsContent value="reviews"><p className="text-sm text-text2">What visitors said.</p></TabsContent>
        </Tabs>
      </Section>

      <Section title="Overlays">
        <Button variant="secondary" onClick={() => setModal(true)}>Open modal</Button>
        <Button variant="secondary" onClick={() => setSheet(true)}>Open sheet</Button>
        <Button variant="secondary" onClick={() => toast({ title: 'Saved to favourites', tone: 'success' })}>Toast: success</Button>
        <Button variant="secondary" onClick={() => toast({ title: 'Couldn’t load details', description: 'Check your connection.', tone: 'danger' })}>Toast: error</Button>
      </Section>

      <Modal open={modal} onClose={() => setModal(false)} title="Save this spot?">
        <p className="text-sm text-text2 leading-relaxed">Add El Nacional to your saved places and set a reminder for matchday.</p>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={() => { setModal(false); toast({ title: 'Saved', tone: 'success' }) }}>Save</Button>
        </div>
      </Modal>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Place details">
        <SkeletonText lines={4} />
      </Sheet>
    </main>
  )
}
