# Credit Intelligence Dashboard

A Bloomberg-terminal-style dark UI for credit analysts, fixed income traders, and CLO professionals. Aggregates news from 17 RSS feeds, enriches articles with full-text fetching, scores them with OpenAI, and surfaces structured credit signals, issuer snapshots, sector risk views, and a daily analyst brief.

---

## What It Does

- **Live Feed** — real-time article stream with urgency scoring and credit signal extraction
- **Market Overview** — ETF move summaries (HYG, LQD) and macro credit conditions
- **Sectors** — sector-level risk heatmap aggregated from recent signal flow
- **Issuers** — per-issuer credit health table with 14-day sparklines
- **Issuer Detail** (`/issuer/:name`) — analyst snapshot, credit signals, trade implications, article timeline
- **Signals** — raw signal stream filterable by urgency and type
- **Daily Brief** — PM-style credit note with issuer hotspots and key events
- **Article Detail** (`/article/:id`) — full structured output: urgency meter, trust profile, CLO fields, evidence ledger

---

## Repo Structure

```
.
├── artifacts/
│   ├── api-server/          # Express + TypeScript backend (esbuild bundle)
│   └── credit-dashboard/    # React + Vite + Tailwind frontend
│
├── lib/
│   ├── db/                  # Drizzle ORM schema + client (@workspace/db)
│   ├── api-spec/            # OpenAPI spec (openapi.yaml, orval config)
│   ├── api-zod/             # Zod schemas generated from OpenAPI spec
│   └── api-client-react/    # React Query hooks generated from api-spec
│
├── scripts/
│   ├── setup.sh             # Installs deps + pushes DB schema (idempotent)
│   └── post-merge.sh        # Called automatically after task-agent merges
│
├── .env.example             # All env vars with descriptions and defaults
├── docker-compose.dev.yml   # Local PostgreSQL for non-Replit development
├── pnpm-workspace.yaml      # Workspace packages + catalog versions
├── tsconfig.base.json       # Shared TypeScript base config
└── IMPLEMENTATION_NOTES.md  # Sprint-by-sprint changelog and codebase map
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in values for local development. On Replit, manage all values via the **Secrets** panel — do not create a `.env` file there.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `OPENAI_API_KEY` | Yes (local) | — | Standard OpenAI key; not needed if Replit AI proxy vars are set |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Replit only | — | Injected automatically by the Replit AI integration proxy |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Replit only | — | Injected automatically by the Replit AI integration proxy |
| `NEWS_API_KEY` | No | — | Optional NewsAPI.org key; RSS feeds are the primary source |
| `SESSION_SECRET` | Prod only | — | Cookie signing secret; required in production |
| `API_PORT` | No | `8080` | API server port (locally) |
| `PORT` | No | `5173` (frontend) / `8080` (backend) | Set automatically by Replit per artifact; set manually locally |
| `BASE_PATH` | Replit only | `/` | Injected by Replit's artifact path router; leave unset locally |

The API server reads `PORT` first, then `API_PORT`, then defaults to `8080`. The frontend Vite server reads `PORT`, defaulting to `5173`.

---

## Local Development Quickstart

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`npm install -g pnpm`)
- Docker (for the local PostgreSQL container)

### Steps

**1. Clone and install**

```bash
git clone <repo-url>
cd <repo>
pnpm install
```

**2. Copy and fill environment variables**

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL, OPENAI_API_KEY at minimum
```

**3. Start the local database**

```bash
docker-compose -f docker-compose.dev.yml up -d
```

This starts a PostgreSQL 16 container on `localhost:5432` with the credentials already set in `.env.example`.

**4. Push the database schema**

```bash
pnpm --filter @workspace/db run push
```

Re-run this after any schema changes. It is safe to run multiple times (idempotent via Drizzle's push mode).

**5. Start the API server** (terminal 1)

```bash
pnpm --filter @workspace/api-server run dev
# Listens on http://localhost:8080
```

**6. Start the frontend** (terminal 2)

```bash
pnpm --filter @workspace/credit-dashboard run dev
# Listens on http://localhost:5173
```

Open `http://localhost:5173` in a browser.

### Seeding Data

There is no seed file. Trigger the ingestion cycle manually:

```bash
curl -X POST http://localhost:8080/api/refresh
```

This fetches from all 17 RSS feeds and runs AI processing on new articles. A backfill pass to retry unprocessed articles runs as a second step:

```bash
curl -X POST http://localhost:8080/api/refresh/backfill
```

Ingestion also runs on a 45-minute scheduler automatically after the API server starts.

---

## How Frontend Talks to Backend

### Locally

The Vite dev server proxies all `/api/*` requests to the API server. This proxy activates automatically when `BASE_PATH` is not set:

```
Browser → http://localhost:5173/api/... → Vite proxy → http://localhost:8080/api/...
```

No CORS configuration is needed. The proxy target port is read from `API_PORT` (default: `8080`).

### On Replit

Replit's platform-level path router handles routing between artifacts. `BASE_PATH` is set automatically by the platform, which disables the Vite proxy. The frontend's API client uses the same relative `/api/...` paths — the platform router directs them to the API server artifact.

---

## Replit vs. Local Differences

| Concern | Replit | Local |
|---|---|---|
| Database | Auto-provisioned PostgreSQL; `DATABASE_URL` injected | Docker container via `docker-compose.dev.yml` |
| OpenAI | Replit AI proxy (`AI_INTEGRATIONS_OPENAI_*` vars injected) | Standard `OPENAI_API_KEY` in `.env` |
| Ports | Injected per-artifact via `PORT` | Set manually in `.env` or shell |
| `BASE_PATH` | Injected by Replit artifact router | Not set; Vite dev proxy activates |
| Frontend → API | Routed by Replit platform proxy | Routed by Vite dev proxy |
| Secrets | Managed via Replit Secrets panel | Managed via `.env` file |
| Replit plugins | `cartographer` and `devBanner` load when `REPL_ID` is set | Not loaded (plugins are no-ops outside Replit) |
| `setup.sh` | Run automatically after task-agent code merges | Run manually after `git clone` or `git pull` |

---

## Observability Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/healthz` | Health check — returns `{"status":"ok"}` |
| `GET /api/debug/ingestion-stats` | Article counts, failure reason breakdown, structured output coverage, enrichment metrics |
| `GET /api/debug/feed-health` | Per-feed status: last attempt, last success, consecutive failures |

---

## Key Architectural Decisions

**Replit AI proxy** — OpenAI calls use the Replit AI integration proxy when `AI_INTEGRATIONS_OPENAI_API_KEY` is present, falling back to a standard `OPENAI_API_KEY`. This is handled in `artifacts/api-server/src/lib/config.ts`.

**esbuild bundle for the API server** — The backend is bundled with esbuild (not ts-node or tsx) for production. The dev script runs `build.mjs` then `node ./dist/index.mjs`. This means schema changes in `lib/db` do not require a separate build step — Drizzle's push mode handles the DB side, and the next `dev` restart picks up source changes.

**Drizzle push instead of migrations** — The project uses `drizzle-kit push` rather than migration files. This is intentional for this development phase. The tradeoff is simpler iteration with no migration history.

**pnpm catalog** — Shared package versions are pinned in the `catalog:` section of `pnpm-workspace.yaml`, not in individual `package.json` files. This prevents version skew across packages.

---

## Current Limitations

1. **RSS-only ingestion** — NewsAPI is configured but its key is currently invalid (HTTP 401). All working articles come from the 17 RSS feeds.
2. **Reuters feeds blocked** — Replit's sandbox blocks DNS for `feeds.reuters.com`. Both Reuters feeds show as failing in the feed health endpoint. This resolves automatically outside Replit.
3. **Content expansion rate** — Most articles fall back to `rss_snippet` depth. Paywalled sources (WSJ, FT, Bloomberg, Barron's) will never expand.
4. **Issuer coverage ~25%** — Macro/geopolitical articles correctly have no named issuer. Coverage reflects the nature of the feed mix, not a bug.
5. **No migration history** — Drizzle push mode is used; there is no up/down migration chain. Schema rollbacks require manual intervention.
6. **No auth layer** — The dashboard is currently public. No authentication is implemented.
7. **Single-process scheduled ingestion** — The 45-minute scheduler runs inside the API server process with an in-memory overlap lock. This does not survive restarts between cycles; a missed cycle is harmless.

---

## Deferred Work

These items are intentionally out of scope for the current platform restructuring pass:

| Item | Reason for deferral |
|---|---|
| Rename `artifacts/` → `apps/` | Requires updating all pnpm filter commands, workflow configs, and Replit artifact registrations; no current blocker |
| Split API to separate deployment domain | Requires separate Replit deployment or reverse proxy config; deferred until post-MVP |
| DB package lazy init refactor | `DATABASE_URL` is read at module import time in `lib/db`; refactoring requires touching all consumers |
| Full migration off Replit | Deployment architecture not finalized; Replit compatibility is preserved deliberately |
| Drizzle migration files | Planned for production hardening phase |
| Auth layer | Planned; implementation approach not yet chosen |
| CI/CD workflows | GitHub Actions scaffolding deferred until repo is exported |

---

## Useful Commands

```bash
# Install all workspace dependencies
pnpm install

# Push DB schema (safe to re-run)
pnpm --filter @workspace/db run push

# Start API server (dev, with auto-rebuild)
pnpm --filter @workspace/api-server run dev

# Start frontend (dev, with HMR)
pnpm --filter @workspace/credit-dashboard run dev

# Typecheck the API server
pnpm --filter @workspace/api-server run typecheck

# Typecheck the frontend
pnpm --filter @workspace/credit-dashboard run typecheck

# Build the API server bundle
pnpm --filter @workspace/api-server run build

# Run setup (install + DB push) — same as after a task-agent merge
bash scripts/setup.sh

# Stop local DB
docker-compose -f docker-compose.dev.yml down

# Stop local DB and wipe data volume
docker-compose -f docker-compose.dev.yml down -v
```
