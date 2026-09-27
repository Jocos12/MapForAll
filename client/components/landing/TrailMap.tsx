/**
 * Paper-map backdrop for the login page: contour rings, hairline roads and a
 * dotted walking trail that draws itself, with pins landing where the pen
 * passes. All geometry is computed at module load from fixed numbers so the
 * server and client render identical SVG.
 */

type Pt = [number, number]
type Cubic = [Pt, Pt, Pt]

const r1 = (n: number) => Math.round(n * 10) / 10

// â”€â”€ Trail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Drawn in the same 900Ã—900 space as the backdrop; TRAIL_VIEWBOX frames the
// trail, its pins and their labels.
const TRAIL_VIEWBOX = '100 120 680 700'
const START: Pt = [140, 760]
const TRAIL: Cubic[] = [
  [[190, 700], [250, 690], [300, 640]],
  [[350, 590], [300, 520], [360, 480]],
  [[420, 440], [500, 500], [560, 450]],
  [[620, 400], [560, 330], [600, 290]],
  [[630, 260], [680, 250], [700, 212]],
]
/** Segment index each pin sits at the end of. */
const PIN_AT = [0, 2, 4]

const TRAIL_START_MS = 250
const TRAIL_DRAW_MS = 1800
const PIN_IMPACT_MS = 300 // time into the landing keyframes when the pin touches down

function bezier(p0: Pt, [c1, c2, p3]: Cubic, t: number): Pt {
  const u = 1 - t
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]]
}

function segmentLength(p0: Pt, seg: Cubic): number {
  let len = 0
  let prev = p0
  for (let i = 1; i <= 64; i++) {
    const p = bezier(p0, seg, i / 64)
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1])
    prev = p
  }
  return len
}

const trailD = `M${START.join(' ')} ${TRAIL.map(([c1, c2, p]) => `C${c1.join(' ')} ${c2.join(' ')} ${p.join(' ')}`).join(' ')}`

const PINS = (() => {
  const ends: Pt[] = []
  const lengths: number[] = []
  let from = START
  for (const seg of TRAIL) {
    lengths.push(segmentLength(from, seg))
    ends.push(seg[2])
    from = seg[2]
  }
  const total = lengths.reduce((a, b) => a + b, 0)
  let run = 0
  const reached = lengths.map((l) => (run += l) / total)
  return PIN_AT.map((i) => ({
    at: ends[i],
    delay: Math.round(TRAIL_START_MS + reached[i] * TRAIL_DRAW_MS - PIN_IMPACT_MS),
  }))
})()

// â”€â”€ Contours â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type Hill = { c: Pt; rings: number; base: number; gap: number; phase: number }
const HILLS: Hill[] = [
  { c: [230, 250], rings: 6, base: 28, gap: 27, phase: 0.4 },
  { c: [700, 650], rings: 7, base: 24, gap: 25, phase: 2.1 },
  { c: [60, 470], rings: 5, base: 40, gap: 30, phase: 4.3 },
  { c: [520, 900], rings: 5, base: 50, gap: 30, phase: 1.2 },
  { c: [860, 120], rings: 4, base: 40, gap: 34, phase: 3.3 },
]

function closedSmoothPath(points: Pt[]): string {
  const n = points.length
  const at = (i: number) => points[(i + n) % n]
  let d = `M${r1(points[0][0])} ${r1(points[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`
  }
  return `${d}Z`
}

const CONTOURS: string[] = HILLS.flatMap(({ c, rings, base, gap, phase }) =>
  Array.from({ length: rings }, (_, k) => {
    const r = base + k * gap
    const wobble = 1 + k * 0.08
    const pts: Pt[] = Array.from({ length: 36 }, (_, i) => {
      const a = (i / 36) * Math.PI * 2
      const f = 1 + wobble * (0.1 * Math.sin(3 * a + phase) + 0.06 * Math.sin(5 * a + phase * 1.7) + 0.035 * Math.sin(2 * a - phase))
      return [c[0] + Math.cos(a) * r * f, c[1] + Math.sin(a) * r * f * 0.86]
    })
    return closedSmoothPath(pts)
  }),
)

const MAJOR_ROADS = [
  'M-20 575 C 180 548, 360 612, 520 566 S 770 486, 920 505',
  'M418 -20 C 440 190, 372 340, 428 476 S 530 760, 486 920',
]
const MINOR_ROADS = [
  'M120 -20 C 150 120, 110 260, 170 380',
  'M170 380 C 240 440, 330 430, 428 476',
  'M-20 330 C 90 350, 130 372, 170 380',
  'M520 566 C 540 660, 610 720, 640 920',
  'M640 280 C 720 300, 800 260, 920 290',
  'M600 -20 C 610 120, 660 200, 640 280',
  'M170 380 C 160 480, 210 600, 180 700 S 200 860, 150 920',
  'M300 640 C 380 660, 420 700, 470 780',
  'M720 470 C 760 540, 820 560, 920 560',
]
const NEIGHBOURHOODS: Array<{ name: string; at: Pt; rotate?: number }> = [
  { name: 'Kibagabaga', at: [190, 150], rotate: -4 },
  { name: 'Kimironko', at: [214, 820], rotate: 3 },
  { name: 'Remera', at: [640, 520], rotate: -6 },
  { name: 'Kacyiru', at: [720, 360], rotate: 4 },
]

export type TrailMapLabels = {
  start: string
  market: string
  pharmacy: string
  shop: string
  confirmed: string
}

function Pin({ at, delay, confirmed = false }: { at: Pt; delay: number; confirmed?: boolean }) {
  return (
    <g transform={`translate(${at[0]} ${at[1]})`}>
      <ellipse className="pp-pin-shadow" style={{ animationDelay: `${delay}ms` }} cx="0" cy="1" rx="9" ry="2.6" fill="var(--ink)" opacity="0.2" />
      <g className="pp-pin" style={{ animationDelay: `${delay}ms` }}>
        <path
          d="M0 0 C-4 -9 -13 -15 -13 -26 A13 13 0 1 1 13 -26 C13 -15 4 -9 0 0 Z"
          fill="var(--clay)"
          stroke="var(--paper)"
          strokeWidth="2"
        />
        <circle cx="0" cy="-26" r="4.6" fill={confirmed ? 'var(--gold)' : 'var(--paper)'} />
      </g>
    </g>
  )
}

/** Static paper-map texture; `slice` so it always fills the column. */
function Backdrop() {
  return (
    <svg viewBox="0 0 900 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
      <g stroke="var(--line)" strokeWidth="0.6" opacity="0.55">
        {[150, 300, 450, 600, 750].map((v) => (
          <g key={v}>
            <line x1={v} y1="0" x2={v} y2="900" />
            <line x1="0" y1={v} x2="900" y2={v} />
          </g>
        ))}
      </g>

      <g fill="none" stroke="var(--line)" strokeWidth="1">
        {CONTOURS.map((d, i) => <path key={i} d={d} opacity={i % 3 === 0 ? 0.95 : 0.6} />)}
      </g>

      <g fill="none" strokeLinecap="round">
        {MINOR_ROADS.map((d) => <path key={d} d={d} stroke="var(--ink)" strokeOpacity="0.22" strokeWidth="1" />)}
        {MAJOR_ROADS.map((d) => <path key={`${d}-casing`} d={d} stroke="var(--line)" strokeWidth="9" />)}
        {MAJOR_ROADS.map((d) => <path key={d} d={d} stroke="var(--paper)" strokeWidth="6" />)}
      </g>

      <g className="pp-serif" fill="var(--ink-soft)" fontSize="17" fontStyle="italic" letterSpacing="1.4">
        {NEIGHBOURHOODS.map(({ name, at, rotate = 0 }) => (
          <text key={name} x={at[0]} y={at[1]} transform={`rotate(${rotate} ${at[0]} ${at[1]})`} textAnchor="middle" opacity="0.8">
            {name}
          </text>
        ))}
      </g>
    </svg>
  )
}

/** The animated layer. `meet` keeps the whole trail visible at any aspect ratio. */
function Trail({ labels }: { labels: TrailMapLabels }) {
  const [p1, p2, p3] = PINS
  return (
    <svg viewBox={TRAIL_VIEWBOX} preserveAspectRatio="xMidYMid meet" className="h-full max-h-[760px] w-full max-w-[760px] overflow-visible" aria-hidden>
      <defs>
        <mask id="pp-trail-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="900">
          <path
            d={trailD}
            pathLength={1}
            className="pp-trail-reveal"
            style={{ animationDuration: `${TRAIL_DRAW_MS}ms`, animationDelay: `${TRAIL_START_MS}ms` }}
            fill="none"
            stroke="#fff"
            strokeWidth="14"
          />
        </mask>
      </defs>

      <path d={trailD} mask="url(#pp-trail-mask)" fill="none" stroke="var(--clay)" strokeWidth="3.2" strokeLinecap="round" strokeDasharray="0.1 11" />

      <g transform={`translate(${START[0]} ${START[1]})`}>
        <circle r="9" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2" />
        <circle r="3.5" fill="var(--ink)" />
        <text x="-14" y="30" fontSize="14" fill="var(--ink)" fontWeight="500">{labels.start}</text>
      </g>

      <Pin at={p1.at} delay={p1.delay} />
      <text className="pp-card" style={{ animationDelay: `${p1.delay + 260}ms` }} x={p1.at[0] + 20} y={p1.at[1] + 2} fontSize="14" fill="var(--ink)" fontWeight="500">
        {labels.market}
      </text>

      <Pin at={p2.at} delay={p2.delay} />
      <text className="pp-card" style={{ animationDelay: `${p2.delay + 260}ms` }} x={p2.at[0] + 20} y={p2.at[1] + 2} fontSize="14" fill="var(--ink)" fontWeight="500">
        {labels.pharmacy}
      </text>

      <Pin at={p3.at} delay={p3.delay} confirmed />
      <g className="pp-card" style={{ animationDelay: `${p3.delay + 300}ms` }} transform={`translate(${p3.at[0] - 262} ${p3.at[1] - 70})`}>
        <rect width="232" height="74" rx="6" fill="var(--paper)" stroke="var(--line)" />
        <text className="pp-serif" x="16" y="30" fontSize="19" fontWeight="600" fill="var(--ink)">{labels.shop}</text>
        <rect x="14" y="42" width="204" height="22" rx="11" fill="var(--gold)" />
        <circle cx="28" cy="53" r="4" fill="var(--ink)" />
        <text x="40" y="57.5" fontSize="12.5" fontWeight="600" fill="var(--ink)">{labels.confirmed}</text>
      </g>
    </svg>
  )
}

export default function TrailMap({ labels }: { labels: TrailMapLabels }) {
  return (
    <>
      <Backdrop />
      {/* Bottom inset keeps the trail clear of the legend and scale bar. */}
      <div className="absolute inset-x-10 bottom-36 top-10 flex items-center justify-center">
        <Trail labels={labels} />
      </div>
    </>
  )
}

