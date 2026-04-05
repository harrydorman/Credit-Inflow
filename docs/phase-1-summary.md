# Phase 1 – Backend Architecture Improvements

## Summary

Phase 1 introduces a clean **service layer** for the ingestion pipeline, **job
tracking** with Postgres advisory locking, **enhanced deduplication** via
content fingerprints, and an initial **test suite** – all without breaking any
existing API surfaces.

---

## What Changed

### 1. DB Schema additions (`lib/db/src/schema/`)

| File | Change |
|------|--------|
| `articles.ts` | Added `title_fingerprint` and `content_fingerprint` columns (text, nullable). Both are sha256 hex digests of normalised strings, enabling near-duplicate detection beyond URL equality. |
| `jobs.ts` _(new)_ | New `jobs` table tracking ingestion/backfill/alert-eval job lifecycle. Columns: `job_id` (UUID), `type`, `scope_key`, `status`, `started_at`, `completed_at`, `result` (JSON), `error_message`. Partial unique index on `(type, scope_key) WHERE status IN ('queued','running')` prevents duplicate active jobs for the same slot. |
| `schema/index.ts` | Re-exports new `jobs.ts` schema. |

### 2. Service layer (`artifacts/api-server/src/services/`)

#### `deduplication.ts` _(new)_
- `normalizeTitle(title)` – lowercase, strip punctuation, collapse whitespace.
- `normalizeContent(content)` – same normalisation, capped at 1,000 chars.
- `fingerprintTitle(title)` / `fingerprintContent(content)` – sha256 hex digests.
- `isDuplicate(fps)` – checks DB for existing row matching URL **or** title fingerprint **or** content fingerprint. Returns `true` if any match is found.
- `existingUrlSet()` – bulk URL fetch for the fast first-pass filter (preserves existing behaviour).

#### `jobService.ts` _(new)_
- `acquireJob(type, scopeKey)` – Postgres session-level advisory lock via `pg_try_advisory_lock`. Returns a held `PoolClient` and a job DB record, or `null` if another process already holds the lock.
- `finishJob(jobRecord, client, result)` – marks job completed/failed, releases advisory lock, returns pool client.
- `withJob(type, scopeKey, fn)` – convenience wrapper that manages the full job lifecycle; returns `null` if the lock could not be acquired (concurrent-safe).

Advisory lock keys are derived from a stable djb2-style hash of `"${type}::${scopeKey}"` so they are consistent across processes and restarts.

#### `ingestionService.ts` _(new)_
- `runIngestion(opts)` – encapsulates all logic previously in `POST /refresh`:
  - Acquires `ingestion` advisory lock via `withJob`.
  - Fast URL pre-filter → per-article fingerprint check → enrichment → noise filter → AI analysis → market validation → DB insert (with fingerprints) → alert evaluation.
  - Returns `IngestionStats`.
- `runBackfill(opts)` – encapsulates all logic previously in `POST /refresh/backfill`:
  - Acquires `backfill` advisory lock.
  - Phase 1: backfill structured JSON outputs for already-processed articles.
  - Phase 2: retry AI for previously unprocessed articles.
  - Returns `BackfillStats`.
- Structured logging uses `log.child({ jobId })` to tag every log line with the job ID.
- Shared helpers `sanitizeNullStr` / `sanitizeIssuer` moved here (still re-exported for compatibility).

### 3. Refactored route (`artifacts/api-server/src/routes/ingestion.ts`)

Route handlers are now **thin wrappers** that delegate to the service layer:

```ts
router.post("/refresh", async (req, res) => {
  const stats = await runIngestion({ log: req.log });
  res.json(TriggerRefreshResponse.parse({ ...stats }));
});
```

No API contract changes – the response shapes are identical to the pre-refactor handlers.

### 4. Tests (`artifacts/api-server/src/__tests__/`)

| File | Coverage |
|------|----------|
| `deduplication.test.ts` | `normalizeTitle`, `normalizeContent`, `fingerprintTitle`, `fingerprintContent`, `isDuplicate` (with mocked DB) |
| `ingestionService.test.ts` | `sanitizeNullStr`, `sanitizeIssuer`, `runIngestion` lock-skipping behaviour, `runIngestion` happy path |

**Test runner:** Vitest v4 (added as devDependency; run with `pnpm test` inside `artifacts/api-server`).

---

## How Concurrent Safety Works

```
Process A                     Process B
─────────────────             ─────────────────────────
withJob("ingestion", "global")
  → pg_try_advisory_lock(key) = true ✓
  → INSERT jobs(status='running')
  → run pipeline …             withJob("ingestion", "global")
                                 → pg_try_advisory_lock(key) = false ✗
                                 → returns null → "skipped" response
  → finishJob → UPDATE status='completed'
  → pg_advisory_unlock(key)
```

The advisory lock is held on a dedicated pool connection for the duration of
the job, so it survives transaction boundaries and is released even if the job
panics (via `finally`).

---

## Phase 2 TODOs

- **Multi-tenancy**: Add `tenant_id` FK to `articles`, `jobs`, `watchlists`,
  `alertRules`. Scope all queries and lock keys by tenant.
- **Job queue**: Introduce a proper async queue (e.g. BullMQ or pg-boss) so
  ingestion can be triggered as a background job with retry/backoff instead of
  blocking the HTTP request.
- **Webhook / SSE**: Stream progress events back to the client during ingestion
  rather than returning only on completion.
- **Rate limiting on ingestion routes**: Prevent runaway triggers.
- **Retry with back-off**: Wrap AI calls in exponential back-off retry logic
  (currently a single attempt).
- **Fingerprint indexes**: Add Postgres indexes on `title_fingerprint` and
  `content_fingerprint` columns in a subsequent migration for large-scale
  performance.
- **Alert eval service**: Move `evaluateAlerts` out of the shared lib and into
  its own service with job tracking (`alert_eval` job type already reserved).
- **Observability**: Emit OpenTelemetry spans for each pipeline stage.
