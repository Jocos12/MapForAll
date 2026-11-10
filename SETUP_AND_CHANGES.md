# MapForAll — Local setup guide & change log

This file explains **how to run MapForAll on your own computer** after a `git pull`,
and **everything that changed** in this update (new chat design, free maps,
speed fixes, bug fixes).

---

## 1. Quick start (macOS / Linux)

```bash
git clone https://github.com/Jocos12/MapForAll.git   # or: git pull
cd MapForAll
./setup.sh          # once: checks tools, installs Python + website packages, creates the .env files
# → fill in agents/.env and client/.env.local (section 3)
./start-all.sh      # starts the 4 services in order, then open http://localhost:3000
./stop-all.sh       # stops everything
```

`./start-all.sh` rebuilds the website **automatically** when the code changed
(after a `git pull`). Force a rebuild with `./start-all.sh --build`.
Logs of every service are in `.local-logs/` (`agents.log`, `website.log`, `connector.log`, `build.log`, `mongodb.log`).

What runs:

| Port | Service | Notes |
|---|---|---|
| 27017 | MongoDB | Only started if `MONGODB_URI` points to `localhost`/`127.0.0.1`. With Atlas, nothing to start. |
| 3100 | MongoDB MCP server | **Pinned to `mongodb-mcp-server@1.14.0`** (see 6.1) |
| 8000 | ADK agents (Python) | `adk api_server hodari` |
| 3000 | Website (Next.js, production build) | `npm start` — fast, no on-the-fly compiling |

### Windows

The `.sh` scripts are for macOS/Linux. On Windows follow the manual steps in
[README.md › Local development](./README.md#local-development) and remember:
`npx -y mongodb-mcp-server@1.14.0 …` (pinned version) and `npm run build && npm start`
for a fast website (instead of `npm run dev`).

---

## 2. Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20+ | `node -v` |
| Python | 3.11 – 3.13 (3.12 recommended) | Official python.org installer. macOS ships 3.9 — too old. |
| MongoDB | Atlas URI **or** local MongoDB Community | Local: `brew install mongodb-community` (Apple Silicon) or the `.tgz` from mongodb.com (Intel Macs: Homebrew no longer supports them). If `mongod` is not on your PATH, put it in `~/mongodb/<folder>/bin/mongod` or set `MONGOD_BIN=/path/to/mongod`. Data goes to `~/mongodb/data` (change with `MONGO_DATA`). |
| netcat (`nc`) | any | Preinstalled on macOS. |

Intel Mac notes:
- `setup.sh` installs Python packages with `--prefer-binary`, because the newest
  `cryptography` has no ready-made Intel wheel and fails to compile without Rust/OpenSSL.
- Python from python.org has no CA certificates by default; `start-all.sh` points the agents to `certifi`'s bundle (fixes `CERTIFICATE_VERIFY_FAILED`).

---

## 3. Configuration (`agents/.env` and `client/.env.local`)

These files hold secrets and are **never committed**. `setup.sh` copies the
`.example` files; ask the project owner for the real values.

### Minimum to run

| File | Key | What |
|---|---|---|
| both | `MONGODB_URI` | Atlas URI, or `mongodb://127.0.0.1:27017` for a local DB |
| both | `MONGODB_DATABASE` | `hodari` |
| both | `MONGODB_MCP_URL` | `http://127.0.0.1:3100/mcp` |
| client | `HODARI_SESSION_SECRET` | long random string |
| client | `PUBLIC_BASE_URL` | `http://localhost:3000` locally (also makes login cookies work on plain-http localhost, see 6.4) |
| client | `SMTP_*` | to email the 6-digit sign-in code (Gmail app password works) |

### AI (pick one)

- **Vertex AI (best, needs the Google Cloud project):** `GOOGLE_GENAI_USE_VERTEXAI=TRUE`,
  `GOOGLE_CLOUD_PROJECT=<id>`, and either `gcloud auth application-default login`
  or `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`.
- **Free AI Studio key (no card):** run `./set-gemini-key.sh` and paste a key from
  https://aistudio.google.com/apikey. It sets `GOOGLE_GENAI_USE_VERTEXAI=FALSE` + `GOOGLE_API_KEY`.
  Works, but slower (no prompt cache, lower priority when Gemini is busy).

### Maps

- With a Google key **with billing** and *Places API (New)* enabled → Google search, photos, Google map.
  `./set-maps-key.sh` writes one key into all 4 places it is needed.
- **Without billing nothing breaks:** search, photos and directions automatically use the
  free OpenStreetMap services (section 5.2).

### Admin account

```bash
# add to client/.env.local:  ADMIN_EMAIL=you@example.com  ADMIN_PASSWORD=<long password>
#                            HODARI_ADMIN_EMAILS=you@example.com
cd client && npm run create-admin      # creates or updates ONLY that admin, no demo data
```
Demo data instead (22 demo users, Kigali places): `npm run seed:demo`.

Roles: `client`, `business_owner` (seller — "J'ai un commerce" at sign-up), `moderator`, `admin`.
A business listing starts as **pending** and only appears in search after an admin validates it.

---

## 4. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Could not create your account" / "La base des comptes est indisponible" | The MongoDB MCP server is not `1.14.0` or not running. Use `./start-all.sh` (it pins it). Check `.local-logs/connector.log`. |
| `EADDRINUSE …:3100` | An old connector is still running → `./stop-all.sh` then `./start-all.sh`. |
| Sign-in code always "expired" (Safari) | Fixed (6.4). Make sure `PUBLIC_BASE_URL=http://localhost:3000`, then `./start-all.sh --build`. |
| "Nos assistants sont surchargés" | No AI credentials, or Gemini busy. Check `.local-logs/agents.log` for `default credentials were not found` → section 3 (AI). |
| `CERTIFICATE_VERIFY_FAILED` in agents log | Start the agents with `./start-all.sh` (it sets the certificate bundle). |
| `Failed building wheel for cryptography` | `agents/.venv/bin/pip install --prefer-binary -r agents/requirements.txt` |
| Map shows "API KEY REQUIRED" or stays grey | Rebuild: `./start-all.sh --build` (fixed in this update, 5.3). |
| Changes don't appear in the browser | The website is a production build: `./start-all.sh --build`, then reload. |

---

## 5. What changed in this update

### 5.1 New client chat portal — iOS "Liquid Glass" design
Files: `client/components/ChatPanel.tsx`, `InlinePlaceGallery.tsx`, `InlineMapPreview.tsx` (new),
`LandingPage.tsx`, `PlaceDetailsPanel.tsx`, `PlaceCardStrip.tsx`, `client/app/globals.css` (`.ios-*` styles).

- AI-chat layout like ChatGPT/Claude: **conversation sidebar** (new chat, search, saved places,
  community, business space, history with delete, account, theme, logout) — open on desktop,
  slide-over drawer on phones.
- Frosted-glass header (conversation title, Chat/Voix segmented control, map, sound, ⋯ menu
  with theme + language FR/EN/RW).
- iMessage-style user bubbles, assistant answers with avatar; welcome screen with 4 suggestion cards.
- Results inside the conversation: **swipeable place cards** + a **mini map** (OpenStreetMap) per answer.
- Floating glass composer with a swipeable row of chips (location, local shops, markets, accessible, add a place).
- Light and dark mode, SF system font, iOS spring animations, reduced-motion support.
- Place details panel redesigned (photo gallery, iOS Maps action buttons, grouped Information /
  Accessibility sections, reviews).
- "Détails" in the chat now always opens the details panel.

### 5.2 Free maps, search, directions and photos (no Google billing needed)
- **Map sheet** (`client/components/MapSheet.tsx`, new): full-screen Leaflet map replacing the
  Google map in the chat. Numbered pins, your position, glass controls, swipeable cards, and
  **4 styles: Plan (OpenStreetMap), Satellite and Réaliste (Esri World Imagery + labels), Relief (OpenTopoMap)**.
- **Directions**: OSRM (`routing.openstreetmap.de`), walking / driving, time + distance, end button.
- **Place search fallback** (`agents/hodari/tools/osm_fallback.py`, new; hooked in `maps_client.py`):
  when Google Places is unavailable (no key, 403, quota) search uses OpenStreetMap
  (Overpass + Nominatim). Understands FR/EN/RW category words and "X près de Y".
  Overpass is skipped for 10 min when unreachable; results cached 10 min.
- **Real photos for free**: places linked to Wikimedia Commons / Wikidata in OpenStreetMap get
  their real photo; others get a themed Kigali picture; owner-uploaded photos always come first.
  With a billed Google key, Google photos are used as before.
- Disable the OSM fallback with `HODARI_OSM_FALLBACK=0` in `agents/.env`.

### 5.3 Speed fixes
- Website runs as a **production build** (`npm start`) — pages load in < 50 ms instead of compiling on each click.
- **Agent loop fixed** (`agents/hodari/llm/fast_path.py`): with recent ADK versions the fast path
  re-ran hundreds of times per search ("search cache hit" spam). It now stops after sending the cards.
- Overpass timeouts: 1 mirror, 6 s max, then skipped (was 4 mirrors × 21 s = 84 s per search).
- Vector search is skipped without Vertex AI (saved 1.5 s per search).
- Place search: **~90 s → 2–5 s**. Chat answers (Gemini) depend on the AI key (Vertex is faster).

### 5.4 Search relevance (`agents/hodari/tools/discovery.py`, `query_intent.py`)
- Names matching the typed words come first ("burger" → Burger Bros / Burger Planet).
- A local listing that matches nothing the user typed no longer tops every search.
- OpenStreetMap results are accepted by the relevance ranking.

### 5.5 Bug fixes
- **MongoDB MCP server pinned to `1.14.0`** (README, scripts). `mongodb-mcp-server` 2.x/3.x require
  a `connectionId` argument on every tool call; the app (and agents) don't send it, so every DB
  call failed (sign-up, login, search).
- **Sign-in code "expired" in Safari** (`client/lib/session.ts`): in a production build the login
  cookies were `Secure`, which Safari drops on `http://localhost`. They stay non-secure only when
  `PUBLIC_BASE_URL` is `http://localhost…`; real https deployments are unchanged.
- **Gemini fallback model** default `gemini-2.0-flash` (retired, 404) → `gemini-3.6-flash`
  (`agents/hodari/llm/resolve.py`).
- Map tiles collapsing to 0 px when switching styles (React overwrote Leaflet's classes) — fixed + CSS guard.

### 5.6 New developer tools
| File | Purpose |
|---|---|
| `setup.sh` | One-time setup (tools check, venv, packages, .env files) |
| `start-all.sh` / `stop-all.sh` | Start/stop the 4 services in the right order, logs in `.local-logs/` |
| `set-gemini-key.sh` | Switch the agents to a free AI Studio Gemini key |
| `set-maps-key.sh` | Put one Google Maps key in all 4 places it's needed (old values kept as comments) |
| `client/scripts/create-admin.mjs` | `npm run create-admin` — create/update only the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` |

---

## 6. Notes for maintainers
1. Keep `mongodb-mcp-server@1.14.0` until `client/lib/mcp.ts` and the agents pass `connectionId`
   (newer servers accept `"preconfigured"` when started with a connection string).
2. Leaflet in React: never put a changing `className` on the element passed to `L.map()`.
3. Tile/route providers used without keys have fair-use policies (OSM, Nominatim 1 req/s, OSRM demo,
   Esri, OpenTopoMap). Fine for development and demos; for production traffic use a paid/hosted provider.
4. `next.config.mjs` uses `output: 'standalone'`; `next start` prints a warning but works locally.
