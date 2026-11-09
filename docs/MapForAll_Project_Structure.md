# MapForAll — Project structure

Annotated tree (same style as a typical full-stack repo overview).
Build caches such as `node_modules`, `.venv`, and `.next` are omitted.

```text
MapForAll/   (repo folder: Map_me · product also called Hodari)
│
├── client/                              Next.js website + BFF APIs
│   ├── .env.local                       Local secrets (do not commit)
│   ├── package.json
│   ├── middleware.ts                    Auth / role gates for routes
│   ├── next.config.mjs
│   ├── tailwind.config.ts
│   ├── locales/
│   │   ├── en.json                      English UI strings
│   │   ├── fr.json                      French
│   │   └── rw.json                      Kinyarwanda
│   │
│   ├── app/
│   │   ├── layout.tsx                   Root layout
│   │   ├── globals.css
│   │   ├── page.tsx                     Landing / homepage
│   │   ├── login/
│   │   │   └── page.tsx                 Email + OTP login
│   │   ├── chat/
│   │   │   └── page.tsx                 Chat + interactive map
│   │   ├── saved/
│   │   │   └── page.tsx                 Saved places
│   │   ├── billing/
│   │   │   └── page.tsx                 Plans / paywall
│   │   ├── p/[id]/
│   │   │   └── page.tsx                 Public place link
│   │   ├── business/
│   │   │   ├── onboarding/page.tsx      Owner claims / creates listing
│   │   │   └── dashboard/page.tsx       Owner stats, team, listing
│   │   ├── admin/
│   │   │   ├── dashboard/page.tsx       Staff KPIs
│   │   │   ├── places/page.tsx          Approve / reject / delete places
│   │   │   ├── businesses/page.tsx
│   │   │   ├── users/page.tsx
│   │   │   ├── moderation/page.tsx
│   │   │   ├── reports/page.tsx
│   │   │   ├── reviews/page.tsx
│   │   │   └── …                        categories, scoring, audit, settings
│   │   └── api/                         Server routes (secrets stay here)
│   │       ├── auth/                    login · otp · me · logout
│   │       ├── chat/                    Bridge to Hodari agents (SSE)
│   │       ├── places/                  Public places + view tracking
│   │       ├── business/                Owner dashboard + attendance
│   │       ├── admin/                   Staff-only APIs
│   │       ├── community/               People, messages, shared pins
│   │       ├── voice/                   STT / TTS
│   │       └── billing/                 Stripe checkout + webhook
│   │
│   ├── components/
│   │   ├── MapView.tsx                  Main map (pins, routes)
│   │   ├── ChatPanel.tsx                Conversation UI
│   │   ├── PlaceDetailsPanel.tsx        Place sheet (views, route, call…)
│   │   ├── LandingPage.tsx
│   │   ├── landing/                     Marketing / login visuals
│   │   ├── admin/                       Admin tables, charts, shells
│   │   ├── business/                    Owner dashboard sections
│   │   ├── community/                   Chats & people layer
│   │   └── ui/                          Button, Modal, Toast, Skeleton…
│   │
│   ├── lib/
│   │   ├── mcp.ts                       MongoDB MCP client
│   │   ├── session.ts                   Cookie sessions
│   │   ├── places.ts                    Place mapping / publish rules
│   │   ├── listingLifecycle.ts          Status: draft → validated…
│   │   ├── adminPlaces.ts               Admin list filters
│   │   ├── adminPlaceModeration.ts      Approve + search index write
│   │   ├── searchIndex.ts               Keywords / normalized name
│   │   ├── viewRules.ts                 Official view counting rules
│   │   ├── trackPlace.ts                Beacon tracking from the browser
│   │   └── …                            billing, community, voice, i18n helpers
│   │
│   ├── hooks/                           useVoice, useIsMobile, attendance
│   └── scripts/                         seed-demo, reindex-places, reconcile-views
│
├── agents/                              Python AI runtime (Google ADK)
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .env.example
│   │
│   ├── hodari/
│   │   ├── agent.py                     Root orchestrator wiring
│   │   ├── intent.py                    Intent classification
│   │   ├── telemetry.py
│   │   ├── sub_agents/
│   │   │   ├── planner.py               Request → Plan
│   │   │   ├── explorer.py              Plan → CandidateSet (places)
│   │   │   └── itinerary.py             Stops + routes
│   │   ├── tools/
│   │   │   ├── discovery.py             Geo + text catalog search + ranking
│   │   │   ├── query_intent.py          tomatoes/tomates/inyanya → market
│   │   │   ├── mongo_tools.py           Mongo via MCP
│   │   │   ├── places_tools.py          Vector search helper
│   │   │   ├── maps_client.py           Google Places / routes HTTP
│   │   │   ├── maps_mcp.py              Maps Grounding Lite MCP
│   │   │   ├── place_dedupe.py          Merge duplicate venues
│   │   │   └── category_match.py
│   │   ├── schemas/
│   │   │   └── contracts.py             Plan / CandidateSet / Itinerary
│   │   └── llm/
│   │       └── resolve.py               Model selection
│   │
│   ├── services/                        Per-agent Cloud Run entrypoints
│   │   ├── orchestrator/
│   │   ├── planner/
│   │   ├── explorer/
│   │   └── itinerary/
│   │
│   ├── scripts/                         seed_places, embed_place, indexes
│   ├── tests/                           pytest suite
│   └── community_mcp/                   Community MCP server
│
├── deploy/
│   └── cloud_run/
│       ├── orchestrator.yaml
│       ├── planner.yaml
│       ├── explorer.yaml
│       ├── itinerary.yaml
│       └── deploy.sh
│
├── infra/
│   ├── mongodb-mcp/
│   │   └── Dockerfile                   MCP sidecar image
│   ├── cloudrun-agent.example.yaml
│   └── cloudrun-frontend.example.yaml
│
├── docs/
│   ├── Hodari_System_Architecture.md    Full architecture
│   ├── BILLING.md
│   ├── SECURITY_HARDENING.md
│   ├── CAPABILITIES_ROADMAP.md
│   └── …                                performance, UI sprints, etc.
│
├── hardware/
│   └── esp32-rfid/
│       └── attendance_reader.ino        Shop badge scanner
│
├── firmware/
│   └── dumpInfo/
│       ├── dumpInfo.ino
│       └── config.h
│
├── scripts/                             Repo-level utilities
│   ├── dedupe_places.py
│   └── verify-louvre-map.mjs
│
├── README.md                            Project entry
├── CLAUDE.md                            Dev / agent guidance
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```

## How to read it

| Folder | Role |
|---|---|
| `client/` | Everything the browser shows, plus Next.js APIs |
| `agents/` | Hodari multi-agent brain (search, plan, itinerary) |
| `deploy/` + `infra/` | Cloud Run / Docker packaging |
| `docs/` | Architecture and product docs |
| `hardware/` + `firmware/` | Optional ESP32 attendance hardware |

**Typical local ports:** Mongo MCP `:3100` · ADK agents `:8000` · Next.js `:3001`
