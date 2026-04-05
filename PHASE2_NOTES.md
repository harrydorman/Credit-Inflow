# Phase 1 Backend Refactor — Summary

## What Changed

### 1. Database Schema (`lib/db/src/schema/`)

#### New: `jobs.ts` — `ingestion_jobs` table
Tracks every ingestion and backfill run with full lifecycle status.

| Column | Purpose |
|---|---|
| `id` | Auto-increment PK |
| `job_type` | `"refresh"` or `"backfill"` |
| `job_key` | Logical lock key (same value for jobs of the same type) |
| `status` | `"running"` / `"completed"` / `"failed"` |
| `started_at` / `completed_at` | Timing |
| `result` | JSON snapshot of the run counters |
| `error_message` | First-class error capture |

**DB-backed locking**: a partial unique index `WHERE status = 'running'` on `(job_key)` ensures only one active job of each type runs at a time. A second concurrent call receives a PostgreSQL `23505` error which the service converts into a `409 Conflict` HTTP response.

#### Updated: `articles.ts`
Added `content_fingerprint TEXT` column. Populated at insert time with a 16-hex-char SHA-256 hash of `normalize(title + "|" + content[:300])`. Used by the ingestion deduplication pass to detect re-published stories with different URLs.

### 2. New Service Layer (`artifacts/api-server/src/services/`)

#### `ingestionHelpers.ts`
Pure, side-effect-free utilities:
- `sanitizeNullStr` — trims and nullifies sentinel strings
- `sanitizeIssuer` — calls `canonicalizeIssuer` after sanitizing
- `computeContentFingerprint` — case-insensitive, whitespace-normalized SHA-256 fingerprint

#### `ingestionService.ts`
All ingestion and backfill business logic lives here:
- `runRefresh(log?)` — full article fetch → dedup → enrich → AI → persist → alert pipeline, wrapped in job lifecycle
- `runBackfill(log?)` — structured-output and unprocessed-article backfill, wrapped in job lifecycle
- `JobAlreadyRunningError` — typed error surfaced when concurrent job detected
- Structured logging with `jobId` and `articleId` on every significant log line

### 3. Thin Route Handlers (`artifacts/api-server/src/routes/ingestion.ts`)
Both `POST /refresh` and `POST /refresh/backfill` now:
- Delegate entirely to `runRefresh` / `runBackfill`
- Return `409` if a job is already running
- Are < 40 lines each

### 4. Tests (`artifacts/api-server/src/services/__tests__/ingestionService.test.ts`)
22 unit tests using Node.js's built-in `node:test` runner (no additional dependencies).  
Run with: `pnpm test` in the `artifacts/api-server` directory.

Covers:
- `sanitizeNullStr` — all sentinel cases, whitespace trimming
- `sanitizeIssuer` — null passthrough, real issuer canonicalization
- `computeContentFingerprint` — determinism, case normalization, whitespace normalization, 300-char boundary, near-duplicate detection

---

## What Remains for Phase 2

### Multi-tenant foundations
- Add a `tenant_id` / `organization_id` column to all core tables (`articles`, `watchlists`, `alert_rules`, etc.)
- Introduce Row-Level Security (RLS) policies in PostgreSQL, or application-level tenant scoping middleware
- Auth: JWT or session-based auth with tenant claim; middleware that injects tenant context into `req`

### Worker / queue architecture
- Move ingestion out of synchronous HTTP request lifecycle into a background worker (BullMQ, pg-boss, or Temporal)
- Expose `/refresh` as a job enqueue endpoint (immediate `202 Accepted`) rather than blocking until done
- Add SSE or WebSocket endpoint for real-time job progress streaming
- Retry logic with exponential back-off for transient AI / enrichment failures

### Observability
- Add OpenTelemetry tracing spans around key stages (fetch, enrich, AI call, DB insert)
- Expose Prometheus metrics endpoint (`/metrics`) for ingestion throughput, latency, and error rates
- Alert on job failures via PagerDuty / Slack webhook integration

### Data quality
- Backfill existing articles missing `content_fingerprint` (one-time migration script)
- Deduplicate existing near-duplicate rows identified by fingerprint matching
- Track per-issuer article velocity to detect coverage gaps

### API surface hardening
- Rate-limiting on ingestion endpoints (prevent runaway refreshes)
- Request validation with Zod on all incoming payloads
- API versioning (`/api/v1/...`)
