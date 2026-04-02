# Credit Intelligence Dashboard — Implementation Notes

---

## Sprint: Signal Coverage & Data Quality (April 2, 2026 — Eve Sprint)

### Priority 1 — Content Enrichment Override for Empty-Content Articles
**File:** `artifacts/api-server/src/lib/contentEnricher.ts`
- Added `forceAttempt = false` parameter to `enrichContent()`
- When `forceAttempt=true`, bypasses the `SKIP_SOURCES` check (WSJ, FT, Barron's) and attempts full URL fetch
- Hex entity decoding added to `stripHtml()`: handles `&#x2019;`, `&#39;`, `&#123;` and all numeric variants

**File:** `artifacts/api-server/src/routes/ingestion.ts`
- Added title-triggered enrichment override block:
  - After initial enrichment returns empty content, checks `isCreditTitleOverride(title)`
  - If match: re-attempts enrichment with `forceAttempt=true`
  - Logs `"Empty content + credit title override: forcing enrichment re-attempt"` and `"Title override enrichment succeeded"` or `"Title override enrichment: still empty after force-attempt"`
  - Falls through to `empty_content` classification if still empty — ingestion never blocked

**Impact:** 3 previously `empty_content` articles recovered in first cycle

---

### Priority 2 — Noise Filter Precision (Credit Title Override)
**File:** `artifacts/api-server/src/lib/aiProcessing.ts`
- New exported function: `isCreditTitleOverride(title: string): boolean`
- Two allowlists checked against lowercased title:
  - **Keywords**: "credit", "clo", "private credit", "fund redemption", "rate hike", "default", "downgrade", "leveraged loan", "high yield", "junk bond", "maturity wall", "covenant", "bankruptcy", "restructuring", "refinanc", "distressed", "spread widen", "credit fund", "debt load", "loan fund", "bond fund", "credit market", "fixed income", "investment grade"
  - **Firms**: "kkr", "goldman", "blackstone", "apollo", "ares", "blue owl", "carlyle", "bain capital", "oaktree", "pimco", "blackrock", "citadel", "cerberus", "fortress", "warburg", "sixth street"
- Global `NOISE_FILTER_THRESHOLD` unchanged (still 2)

**File:** `artifacts/api-server/src/routes/ingestion.ts` (Phase 1 — new articles)
- Logic: `noisePass = passesNoiseFilter(...)`, `titleOverride = !noisePass && isCreditTitleOverride(...)`
- Only classifies as `noise_filtered` when BOTH `noisePass=false` AND `titleOverride=false`
- Logs `"Noise filter bypassed: credit title override triggered"` when override fires

**File:** `artifacts/api-server/src/routes/ingestion.ts` (Phase 2 — backfill)
- Same override logic applied in `POST /api/refresh/backfill` Phase 2 retry loop
- Logs `"Backfill Phase 2: noise filter bypassed by credit title override"`

**Impact:** 5 previously `noise_filtered` articles unlocked on first backfill cycle:
- KKR caps redemptions in retail credit fund (id 18) — "kkr" match
- KKR caps redemptions at one of its private credit funds (id 21) — "kkr" match
- Markets now see the Fed's next move as a potential rate hike (id 34) — "rate hike" match
- Berkeley shares tumble as housebuilder cuts profit forecast (id 48) — "credit" in content
- Goldman Sachs Initiates Coverage of Smurfit Westrock (id 61) — "goldman" match

---

### Priority 3 — Feed Health Monitoring
**File:** `artifacts/api-server/src/lib/dataProviders.ts`
- New types: `FeedHealthEntry { feedName, lastAttempt, lastSuccess, lastFailure, lastError, consecutiveFailures, status }`
- Module-level `feedHealthMap: Map<string, FeedHealthEntry>`
- `markSuccess(feedName)` and `markFailure(feedName, err)` helper functions called after each feed attempt
- `getFeedHealth(): FeedHealthEntry[]` exported — returns all feeds sorted by name

**Wire-up:**
- RSS `fetchArticles()` loop: `markSuccess(feed.source)` inside try, `markFailure(feed.source, err)` in catch
- NewsAPI `fetchArticles()`: `markFailure("NewsAPI", "HTTP 401")` on non-OK response; `markSuccess("NewsAPI")` on success; `markFailure("NewsAPI", err)` in catch

**File:** `artifacts/api-server/src/routes/debug.ts`
- New route: `GET /api/debug/feed-health`
- Returns: `{ summary: { totalFeeds, healthy, failing, neverAttempted, healthPct }, feeds: FeedHealthEntry[] }`
- Returns informational message if no ingestion cycle has run yet

**Current feed health:** 15 feeds tracked, 12 healthy (80%), 3 failing:
- `NewsAPI` — HTTP 401 (invalid API key)
- `Reuters Business` — ENOTFOUND feeds.reuters.com (DNS blocked)
- `Reuters Companies` — ENOTFOUND feeds.reuters.com (DNS blocked)

---

### Priority 4 — Issuer Trend Visualization Support
**File:** `artifacts/api-server/src/lib/intelligence.ts`
- New interface: `SignalTimePoint { date: string, signalCount: number, avgUrgency: number }`
- `IssuerSnapshot` extended with `signalTimeSeries: SignalTimePoint[]`
- `buildIssuerSnapshot()`: computes 14-day time series — one bucket per day
  - Buckets each article by `publishedAt.toISOString().split("T")[0]`
  - Computes `avgUrgency` from `finalUrgencyScore ?? urgencyScore` per day bucket

**File:** `artifacts/credit-dashboard/src/pages/issuer-detail.tsx`
- `SignalTimePoint` interface added to frontend
- `IssuerDetailData.snapshot.signalTimeSeries?: SignalTimePoint[]` field added
- New `SignalSparkline({ series })` SVG component:
  - 280×44px SVG with 4px padding
  - Background bars: signal count per day (amber fill at 25% opacity)
  - Foreground polyline: average urgency over time (amber #primary)
  - Dot markers for non-zero urgency days
  - Date labels at left/right (MM-DD format)
  - Header: `SIGNAL ACTIVITY · 14D`
- Rendered in issuer header, next to ARTICLES/NEGATIVE/MAX URGENCY stats, separated by a border

---

### Priority 5 — HTML Entity Decoding
**Backend (new articles):**
- `artifacts/api-server/src/lib/dataProviders.ts`: `decodeHtmlEntities()` helper function; applied to `title` and `description` in RSS parser
- `artifacts/api-server/src/lib/contentEnricher.ts`: `stripHtml()` extended with hex entity patterns

**Frontend (existing articles in DB):**
- New utility: `artifacts/credit-dashboard/src/lib/decode-html.ts` — `decodeHtml(text)` function
- Handles: `&#x2019;` → `'`, `&#x2018;` → `'`, `&#(\d+);`, `&amp;`, `&apos;`, `&quot;`, `&lt;`, `&gt;`, `&nbsp;`
- Applied in: `article.tsx` (h1 title), `article-card.tsx` (h3 title), `brief.tsx` (3× alert.title, 1× event.title), `dashboard.tsx` (article title), `issuer-detail.tsx` (cs.title, ti.title, article.title)

---

### Validated State (End of Eve Sprint)
| Check | Before | After |
|---|---|---|
| processed_ok | 52 | 59 |
| noise_filtered | 19 | 22 (+3 new articles legitimately filtered) |
| empty_content | 15 | 12 (−3 recovered by force enrichment) |
| ai_null | 0 | 0 |
| Issuers | 12 | 15 (+Blue Owl, Berkeley, Smurfit Westrock) |
| Credit title override | — | 5 articles unlocked |
| Feed health endpoint | — | 15 feeds, 12 ok, 3 failing |
| signalTimeSeries | — | 14-day sparkline on all issuer pages |
| HTML entity titles | &#x2019; rendered raw | Curly quotes, apostrophes correct |
| 100% creditSummary | ✓ | ✓ |
| 100% scoreExplanation | ✓ | ✓ |
| potentialTrades coverage | 90% | 92% |

---

## Sprint: Hardening Pass (April 2026)

---

### Batch 0 — Foundation (Previous Session)
**Changes:**
- Built Bloomberg-terminal dark UI with amber accents
- 7 navigation pages: Market Overview, Live Feed, Sectors, Issuers, `/issuer/:name`, Signals, Daily Brief
- 17 RSS feeds ingested via `dataProviders.ts`
- AI processing via OpenAI (Replit AI proxy) in `aiProcessing.ts`
- Full schema: articles with urgency scoring, credit signals, CLO fields, trust profiles
- Content enricher: `contentEnricher.ts` — fetches full article HTML for open sources
- Source registry: 12 source profiles with tier (primary / secondary / tertiary)
- Issuer detail page: `/issuer/:name` with Analyst Snapshot, Credit Signals, Trade Implications, Article Timeline
- Daily Brief upgraded to PM note format with Issuer Hotspots section

---

### Batch 1 — Data Quality & Null Hardening (April 2, 2026 AM)
**Problem:** AI sometimes returned the literal string "null" instead of a null value. This caused `issuerName = "null"` to appear in the issuers list and `ratingAgency = "null"` to display as "null: B" in the UI.

**Fixes:**
- `ingestion.ts`: Added `sanitizeNullStr()` helper — strips "null", "undefined", "N/A", empty strings → proper null
- Applied to all 15 string fields in both INSERT and Phase 2 backfill UPDATE
- DB: Bulk-cleaned 52 existing rows with null-string field values (`UPDATE ... WHERE ... IN ('null','undefined','N/A','')`)
- `issuers.ts`: Added defensive `!== "null"` guard in issuerMap loop
- `brief.tsx` + `issuer-detail.tsx`: Added `&& field !== "null"` guard in rating agency badge render

**Added:**
- `GET /api/debug/ingestion-stats` — first observability endpoint (totals, coverage %, enrichment stats)

**Verified:**
- Issuers list: 12 clean names, 0 "null" issuer
- Brief: "null: B" → "B" (no agency prefix when ratingAgency is null)
- All 12 issuer detail pages return HTTP 200 with valid data

---

### Batch 2 — Hardening Sprint (April 2, 2026 PM)

#### 2a — Scheduled Auto-Ingestion + Overlap Lock
**File changed:** `artifacts/api-server/src/index.ts`

Pre-existing: 45-minute interval scheduler calling `/api/refresh` then `/api/refresh/backfill`.

**Added:**
- `isIngestionRunning: boolean` flag — prevents overlapping cycles (scheduler skips if previous run still in progress)
- Per-phase duration timing (`durationMs`) logged for refresh and backfill phases
- Total cycle duration logged on completion
- Clear log messages: `"cycle: starting"`, `"refresh complete"`, `"backfill complete"`, `"cycle: finished"`

Preserved: manual `/api/refresh` endpoint unchanged.

#### 2b — Failure Classification
**File changed:** `lib/db/src/schema/articles.ts`
**New column:** `process_failure_reason TEXT` (nullable)

Values:
| Reason | Meaning |
|---|---|
| `null` | Processed OK — article has full AI output |
| `"empty_content"` | raw_content was empty/null after enrichment |
| `"noise_filtered"` | passesNoiseFilter() returned false |
| `"ai_null"` | AI returned null (OpenAI failure or low-quality input) |
| `"ai_error"` | Unhandled exception during AI call (future use) |
| `"duplicate"` | Duplicate URL (future use) |

**DB push applied:** `pnpm --filter @workspace/db run push`

**Backfill of existing 33 unprocessed articles:**
- 14 empty_content (raw_content NULL or 0 bytes — came from feeds with no description)
- 19 noise_filtered (content present but failed keyword/quality threshold)

**ingestion.ts changes:**
- Added `empty_content` check **before** noise filter — saves stub immediately with `process_failure_reason: "empty_content"`
- Noise-filtered articles now saved with `process_failure_reason: "noise_filtered"`
- Successfully processed articles saved with `processFailureReason: null`
- AI null return saves `processFailureReason: "ai_null"`
- Phase 2 backfill clears `processFailureReason` to null on successful re-process

#### 2c — Canonical Issuer Normalization
**New file:** `artifacts/api-server/src/lib/canonicalIssuers.ts`

Contains `CANONICAL_MAP: Record<string, string>` with 60+ variant → canonical name entries covering:
- Nike / Nike Inc. / Nike, Inc. → "Nike"
- JPMorgan / JP Morgan / JPMorgan Chase & Co → "JPMorgan"
- Amazon.com / Amazon.com Inc. → "Amazon"
- KKR & Co / KKR & Co. Inc → "KKR"
- Blue Owl / Blue Owl Capital → "Blue Owl"
- (and 55+ more)

`canonicalizeIssuer(name)` performs case-insensitive lookup. Falls back to trimmed input if no mapping found.

**ingestion.ts:** New `sanitizeIssuer()` helper = `canonicalizeIssuer(sanitizeNullStr(val))`. Applied to `issuerName` in both INSERT and Phase 2 UPDATE.

#### 2d — Observability Expansion
**File changed:** `artifacts/api-server/src/routes/debug.ts`

`GET /api/debug/ingestion-stats` now returns:
```json
{
  "totals": { "totalArticles", "aiProcessed", "aiNotProcessed" },
  "failureReasonBreakdown": {
    "processed_ok", "noise_filtered", "empty_content", "ai_null", "ai_error", "other"
  },
  "structuredOutputCoverage": {
    "withCreditSummary", "withCreditSummaryPct",
    "withScoreExplanation", "withScoreExplanationPct",
    "withPotentialTrades", "withPotentialTradesPct",
    "withTradeImplication", "withTradeImplicationPct"
  },
  "issuerExtractionCoverage": {
    "withIssuerName", "withIssuerNamePct", "badIssuerNameStrings"
  },
  "contentEnrichment": {
    "enrichmentSuccessRate", "expandedArticles", "rssSnippetArticles",
    "preEnricherRows", "avgDepthScoreAll", "avgDepthScoreProcessed",
    "avgRawContentLenChars", "maxRawContentLenChars"
  },
  "avgDepthBySource": [ { "source", "avgDepth", "articles" } ... ]
}
```

#### 2e — Article Detail Navigation (verified, not built — already existed)
- `artifacts/credit-dashboard/src/pages/article.tsx` — full detail page (urgency meter, trust profile, signal card, credit summary, score explanation, trade implications, CLO section, evidence ledger)
- `artifacts/credit-dashboard/src/App.tsx` — route `/article/:id` registered
- `dashboard.tsx`, `signals.tsx`, `issuer-detail.tsx` — all already link to `/article/:id`
- Navigation loop is complete: signal → article → issuer → articles

---

## Validated State (End of Sprint)
| Check | Result |
|---|---|
| Debug endpoint | ✅ Returns 7 sections, all correct |
| Failure reason breakdown | ✅ 52 processed_ok / 19 noise_filtered / 15 empty_content / 0 ai_null |
| Scheduled ingestion overlap lock | ✅ `isIngestionRunning` flag prevents concurrent runs |
| Issuers list | ✅ 12 clean names, 0 "null" |
| Structured output coverage | ✅ 100% creditSummary, 100% scoreExplanation, 90% potentialTrades |
| Content enrichment | ✅ Yahoo Finance avg depth 70, 3 expanded articles |
| Bad issuer name strings | ✅ 0 |
| Article detail page | ✅ Full navigation loop working |

---

## Known Limitations
1. **issuerName coverage 25%** — Macro articles (Fed, ETF, geopolitical) correctly have no named issuer; no fabrication
2. **19 noise_filtered articles** — These are legitimately filtered (personal finance, sports, unrelated news); they're not recoverable without lowering the quality bar
3. **14 empty_content articles** — These came from RSS feeds that returned no description; the enricher is correctly gating them
4. **Pre-enricher rows (72)** — Articles from before the content enricher was deployed have no contentDepthScore or contentSourceType; this heals itself organically as new articles come in
5. **Content expansion rate** — Only 3 articles have been fully expanded (`expanded_article`); most fall back to `rss_snippet`. Paywalled sources (WSJ, FT, Bloomberg) will never expand.

---

## Sprint: Platform Restructuring (April 2, 2026 — GitHub Export Readiness)

---

### Overview

Goal: make the repo cloneable and runnable outside Replit without changing app logic, schema, or deployment architecture. Structured as four batches, each independently validatable.

---

### Batch 1 — Repo Hygiene

**Goal:** Add the files a new contributor needs on first clone.

**Files created:**

- **`.gitignore`** — Added Replit-specific exclusions: `.replit`, `replit.nix`, `.upm/`, `.cache/`, `attached_assets/`, `.local/`. Preserved existing Node/pnpm/dist patterns.
- **`.env.example`** — Documents all 9 environment variables with `[REQUIRED]` / `[OPTIONAL]` / `[DEFAULT: ...]` markers. Covers: `DATABASE_URL`, `OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_*` (Replit-only), `NEWS_API_KEY`, `SESSION_SECRET`, `API_PORT`, `PORT`, `BASE_PATH`. Cross-references `docker-compose.dev.yml`.
- **`docker-compose.dev.yml`** — PostgreSQL 16 Alpine container at `localhost:5432` with a `pgdata` named volume, health check, and inline step-by-step usage comments. All connection values match `.env.example` defaults.
- **`scripts/setup.sh`** — Idempotent setup: `pnpm install --frozen-lockfile` then `pnpm --filter @workspace/db run push`. Works identically on Replit (post-merge) and locally (post-clone).
- **`scripts/post-merge.sh`** — Delegates entirely to `setup.sh`. Called automatically by the Replit platform after a task-agent merge is approved.

**No application logic changed.**

---

### Batch 2 — Cross-Platform pnpm Install

**Goal:** Remove platform-specific package exclusions so `pnpm install` works on linux-x64, macOS arm64, and macOS x64 without manual intervention.

**File changed:** `pnpm-workspace.yaml`

**What changed:** Removed 79 lines of `"-"` package exclusion entries covering platform-specific binaries: `esbuild-*`, `@esbuild/*`, `lightningcss-*`, `@tailwindcss/oxide-*`, `rollup/rollup-*`, `@expo/ngrok-bin-*`. These exclusions were preventing pnpm from installing the correct native binaries for non-linux-x64 platforms.

**Retained:**
- `"@esbuild-kit/esm-loader": "npm:tsx@^4.21.0"` — redirects a drizzle-kit internal dep to tsx (security/compatibility override)
- `esbuild: "0.27.3"` — pins esbuild to the version `build.mjs` is tested against

**Verified:** Zero lockfile churn on linux-x64 after removal. pnpm resolves platform natives correctly via its built-in `onlyBuiltDependencies` mechanism.

---

### Batch 3A — Backend Config Centralization

**Goal:** Eliminate scattered `process.env.*` reads for ports, OpenAI keys, and NewsAPI key across the backend. Single source of truth for all environment configuration.

**New file:** `artifacts/api-server/src/lib/config.ts`

```typescript
export const config = {
  port: ...,         // process.env.PORT → process.env.API_PORT → "8080"
  openai: {
    apiKey: ...,     // AI_INTEGRATIONS_OPENAI_API_KEY → OPENAI_API_KEY
    baseUrl: ...,    // AI_INTEGRATIONS_OPENAI_BASE_URL → "https://api.openai.com/v1"
  },
  newsApiKey: ...,   // process.env.NEWS_API_KEY (optional)
} as const;
```

Port resolution validates the parsed value and names which env var produced an invalid result in the thrown error message.

**Files updated:**

| File | Change |
|---|---|
| `artifacts/api-server/src/index.ts` | Removed 13-line PORT parsing block; imports `config.port` |
| `artifacts/api-server/src/lib/aiProcessing.ts` | Replaced 2 inline env reads with `config.openai.*` |
| `artifacts/api-server/src/routes/issuerThesis.ts` | Same — eliminated duplicate of the above 2 lines |
| `artifacts/api-server/src/lib/dataProviders.ts` | `private readonly apiKey = config.newsApiKey` |
| `artifacts/api-server/src/lib/newsIngestion.ts` | `const NEWS_API_KEY = config.newsApiKey` |

**Intentionally not changed:**
- `logger.ts` — `LOG_LEVEL` and `NODE_ENV` reads are already correct, have no duplication, and adding a `config` import would create a subtle module initialization ordering dependency.
- `lib/db` — `DATABASE_URL` is read at module import time; restructuring would require touching all consumers and is deferred.

**Validation:** TypeScript typecheck passes (0 errors after rebuilding project-referenced lib packages). API server restarts in 194ms. `/api/healthz` returns `{"status":"ok"}`. grep confirms zero `process.env.PORT`, `process.env.OPENAI*`, or `process.env.NEWS_API_KEY` reads outside `config.ts`.

---

### Batch 3B — Frontend Vite Portability

**Goal:** Make the Vite config runnable without `PORT` and `BASE_PATH` being set, and add a dev-only API proxy for local development.

**File changed:** `artifacts/credit-dashboard/vite.config.ts`

**Changes:**

1. **PORT** — Removed hard throw on missing `PORT`; replaced with safe fallback to `5173`. Invalid-but-set values still throw.

2. **BASE_PATH** — Removed hard throw on missing `BASE_PATH`; replaced with `?? "/"` default. Added `hasBasePath` boolean.

3. **Dev proxy** — Added conditional proxy block to `server` config:
   ```typescript
   ...(!hasBasePath && {
     proxy: {
       "/api": {
         target: `http://localhost:${apiPort}`,
         changeOrigin: true,
       },
     },
   })
   ```
   `apiPort` reads `process.env.API_PORT ?? 8080`. The proxy activates only when `BASE_PATH` is not set (i.e., outside Replit). On Replit, `BASE_PATH` is platform-injected, disabling the proxy automatically.

**Unchanged:** `base`, `plugins` array, `REPL_ID` guard for Replit plugins, `runtimeErrorOverlay`, `cartographer`, `devBanner`, `resolve.alias`, `resolve.dedupe`, `root`, `build.outDir`, `server.host`, `server.allowedHosts`, `server.fs.*`, `preview.*`.

**Validation:** Frontend workflow restarts cleanly (`VITE v7.3.1 ready in 589 ms`). Browser connects. No application source files changed. Replit plugin guard (`REPL_ID !== undefined`) intact.

**Note on proxy in Replit dev environment:** `BASE_PATH` is not injected by Replit during development (only in the path-routing layer above Vite), so the proxy is active in the current Replit dev setup. This is harmless — it proxies `localhost:{vite-port}/api → localhost:8080`, which is where the API server runs. Setting `BASE_PATH=/credit-dashboard` in the workflow environment would disable the proxy on Replit dev, but this is not required for correctness.

---

### Batch 4 — Documentation (This Batch)

**Goal:** Create GitHub-quality documentation so an external developer can understand and run the repo without Replit-specific knowledge.

**Files created/updated:**

- **`README.md`** (new) — Full external developer guide. Sections: product description, repo structure tree, environment variable table, local development quickstart (6 steps), seeding instructions, frontend-to-backend communication (local vs Replit), Replit vs local comparison table, observability endpoints, key architectural decisions, current limitations, deferred work, and a useful commands reference.
- **`IMPLEMENTATION_NOTES.md`** (this update) — Platform restructuring sprint added as a new top-level section covering all four batches with exact file changes, rationale, and validation results.

**No application logic changed. No schema changed.**

---

### Platform Restructuring — Validated State

| Check | Result |
|---|---|
| `pnpm install` on linux-x64 | ✅ Zero lockfile churn after removing platform exclusion lines |
| API server typecheck | ✅ 0 errors (with lib packages pre-built) |
| API server build | ✅ 194ms, 2.3mb bundle |
| API server `/api/healthz` | ✅ `{"status":"ok"}` |
| Frontend cold start | ✅ `VITE v7.3.1 ready in 589ms`, browser connects |
| `process.env.*` reads outside `config.ts` (api-server) | ✅ Only `logger.ts` lines for `NODE_ENV` and `LOG_LEVEL` |
| Replit plugin guard intact | ✅ `REPL_ID !== undefined` on cartographer/devBanner |
| `.env.example` complete | ✅ All 9 env vars documented with context |
| `docker-compose.dev.yml` complete | ✅ Health check, volume, inline usage comments |
| `setup.sh` idempotent | ✅ install + push, safe to re-run |
| `README.md` created | ✅ Full external developer guide |

---

### Deferred from This Sprint

| Item | Status |
|---|---|
| Rename `artifacts/` → `apps/` | Deferred — no current blocker, requires workflow config updates |
| Split API to separate deployment domain | Deferred — deployment architecture not finalized |
| DB package lazy init (`DATABASE_URL` reads at import time) | Deferred — requires touching all DB consumers |
| Drizzle migration files (replace push mode) | Deferred — planned for production hardening phase |
| GitHub Actions CI/CD scaffolding | Deferred — pending repo export |
| Auth layer | Deferred — implementation approach not chosen |

---

## Codebase Map
```
lib/db/src/schema/articles.ts          — DB schema (108 lines, 50+ columns)
artifacts/api-server/src/
  index.ts                             — Server entry + scheduled ingestion loop (lock, timing)
  lib/
    aiProcessing.ts                    — OpenAI call via Replit proxy; returns ArticleAnalysis
    contentEnricher.ts                 — HTML fetch + depth scoring
    canonicalIssuers.ts                — Issuer name normalization map (NEW)
    intelligence.ts                    — enrichArticle, buildIssuerSnapshot, buildDailyBrief
    dataProviders.ts                   — 17 RSS feed parsers
    marketData.ts                      — ETF snapshot + market validation
    logger.ts                          — Pino logger
  routes/
    ingestion.ts                       — POST /api/refresh, POST /api/refresh/backfill
    articles.ts                        — GET /api/articles, GET /api/articles/:id
    issuers.ts                         — GET /api/issuers, GET /api/issuers/:name
    signals.ts                         — GET /api/signals, GET /api/signals/daily-brief
    debug.ts                           — GET /api/debug/ingestion-stats (NEW, expanded)
    marketOverview.ts                  — GET /api/market-overview
    trends.ts                          — GET /api/trends
artifacts/credit-dashboard/src/
  App.tsx                              — Wouter router (7 routes incl. /article/:id)
  pages/
    market-overview.tsx                — Market Overview page
    dashboard.tsx                      — Live Feed (article cards → /article/:id)
    sectors.tsx                        — Sector risk table
    signals.tsx                        — Signal stream → /article/:id
    issuers.tsx                        — Issuer table → /issuer/:name
    issuer-detail.tsx                  — Per-issuer deep dive
    brief.tsx                          — Daily Credit Brief (PM note format)
    article.tsx                        — Article detail page (full signal card, trust profile)
```
