# Phase 1b – Hardening: Retry, Metrics, Indexes, and Processing Visibility

## Overview

Phase 1b hardens the Phase 1 service-layer architecture without changing product behaviour.
It adds retry/backoff support, richer per-job metrics, DB indexes for deduplication,
minimal article-level processing visibility, and cleaner job/lock abstractions.

---

## What Changed

### 1. Job Retry and Backoff (`lib/db/src/schema/jobs.ts`, `services/jobService.ts`)

**New schema fields on `jobs`:**

| Column | Type | Description |
|---|---|---|
| `attempt_count` | integer | How many times this job has been attempted. Defaults to 0; incremented on each start. |
| `max_attempts` | integer | Maximum attempts before permanent failure. Defaults to 3. |
| `next_retry_at` | timestamp | Earliest time the next retry should run. Null = ready immediately. |
| `last_error` | text | Error message from the most-recent failed attempt. |
| `last_error_at` | timestamp | When the most-recent failure occurred. |
| `retryable` | boolean | False = never retry regardless of attempt count. |

**New `JobStatus` value:** `"retrying"` — job has failed once but is scheduled to try again.

**`calculateNextRetryAt(attemptCount)`** — exponential backoff:
- Base delay: 30 seconds
- Doubles per attempt: `min(30s × 2^(attempt-1), 30min)`
- ±10% jitter to spread load across processes

**`NonRetryableError`** — throw this inside `withJob` to permanently fail the job without retry.

**`scheduleRetry(jobRecord, lockClient, errorMessage, nonRetryable?)`** — marks a failed job for retry (status `"retrying"`) or permanent failure. The `nextRetryAt` field signals to the scheduler (cron / future worker) when to next attempt.

The in-process scheduler in `index.ts` naturally retries on the next 45-minute cycle because it calls `withJob` directly. A future queue system will query `WHERE status = 'retrying' AND next_retry_at <= now()`.

### 2. Separated Lock and Job Lifecycle Concerns (`services/jobService.ts`)

Lock acquisition and release are now separate, named primitives:

```ts
// Lock layer (connection-scoped, reusable for non-job use cases)
export async function acquireLock(lockKey: number): Promise<PoolClient | null>
export async function releaseLock(client: PoolClient, lockKey: number): Promise<void>
export function advisoryLockKey(type: JobType, scopeKey: string): number

// Job lifecycle layer (builds on lock layer)
export async function acquireJob(type, scopeKey): Promise<{ jobRecord, lockClient } | { conflict } | null>
export async function finishJob(jobRecord, lockClient, result): Promise<void>
export async function scheduleRetry(jobRecord, lockClient, errorMessage, nonRetryable?): Promise<void>
export async function withJob(type, scopeKey, fn): Promise<T | null>  // convenience wrapper
```

`acquireJob` now returns a typed discriminated union:
- `{ jobRecord, lockClient }` — lock acquired, job started
- `{ conflict: ConcurrentJobInfo }` — another job is already active in DB
- `null` — advisory lock held by another OS-level process

This makes conflict handling explicit and extensible: callers can distinguish DB conflicts (e.g. to attach to metadata) from process-level lock collisions.

### 3. Richer Job-Level Metrics (`services/ingestionService.ts`)

`IngestionStats` now includes a full `IngestionMetrics` breakdown persisted to `jobs.result`:

| Field | Description |
|---|---|
| `feedsChecked` | Number of feed aggregations attempted |
| `feedsSucceeded` | Feeds that returned articles |
| `feedsFailed` | Feeds that errored |
| `articlesFetched` | Total raw articles from providers |
| `articlesInserted` | Articles written to DB |
| `articlesSkippedDuplicate` | Skipped by URL or fingerprint match |
| `articlesSkippedFiltered` | Skipped by noise / empty-content filter |
| `articlesProcessingFailed` | Articles where an unhandled error occurred |
| `articlesFullyProcessed` | Articles with successful AI + market validation |
| `totalDurationMs` | Wall-clock duration of the job |

These metrics are returned from `runIngestion()` and saved to `jobs.result` by `finishJob`.

The `POST /refresh` route now returns both the backward-compatible fields (`fetched`, `processed`, etc.) **and** a `metrics` object and `jobId` for richer client consumption.

### 4. Fingerprint Indexes (`lib/db/src/schema/articles.ts`)

Two new indexes support fast fingerprint-based deduplication lookups:

```
articles_title_fingerprint_idx   ON articles(title_fingerprint)
articles_content_fingerprint_idx ON articles(content_fingerprint)
```

The existing `url` column already has a `UNIQUE` constraint (implicit index). No additional URL index is needed.

### 5. Minimal Article Processing Visibility (`lib/db/src/schema/articles.ts`, `services/ingestionService.ts`)

Three new columns on `articles`:

| Column | Type | Values |
|---|---|---|
| `processing_status` | text | `pending` \| `processing` \| `processed` \| `failed` \| `filtered` |
| `processing_error` | text | Human-readable error for most-recent failure |
| `last_processed_at` | timestamp | Timestamp of most-recent processing attempt |

The ingestion service now sets these fields on every article insert/update, making failures immediately visible without needing to cross-reference `processFailureReason` or `processedAt` alone.

### 6. Tests (`src/__tests__/`)

| File | New tests |
|---|---|
| `jobService.test.ts` _(new)_ | `calculateNextRetryAt` (backoff shape, cap, jitter), `NonRetryableError` (name, message, cause), `advisoryLockKey` (determinism, range, uniqueness), `withJob` (concurrent-skip, NonRetryableError propagation) |
| `ingestionService.test.ts` | Updated to verify richer metrics fields, `jobId` in stats, skipped-message shape |
| `deduplication.test.ts` | Unchanged — still green |

Total: **41 tests, all passing**.

---

## What Was Intentionally Deferred to Phase 2

| Deferred item | Rationale |
|---|---|
| Full queue system (BullMQ / pg-boss) | Phase 1b keeps advisory locks + in-process retry; a queue requires a worker host and deployment changes |
| `SKIP LOCKED` query-based job claiming | Needed only when multiple worker processes compete for jobs; not applicable yet |
| Multi-tenant `scope_key` routing | Schema is ready (`scope_key` field exists); routing logic deferred until auth is added |
| Alert-eval job type implementation | `alert_eval` is in the `JobType` union but the service is not migrated yet |
| Stage-based article processing pipeline | Full `pending → enriching → analyzing → persisted` state machine deferred; Phase 1b adds only the `processing_status` field as a bridge |
| Fingerprint index backfill migration | Drizzle `push` applies indexes on next deploy; historical nulls will not match fingerprint checks (safe — they fall back to URL check) |
| Rate-limiting on ingestion endpoints | Depends on auth/tenant layer |

---

## Recommended Next Step for Phase 2

**Implement stage-based article processing.**

Introduce an `ArticleProcessingStage` enum (`enriching` | `analyzing` | `market_validating` | `persisted`) and update the ingestion service to transition articles through stages, updating `processingStatus` at each step. This makes partial failures (e.g. AI timeout after enrichment) recoverable without reprocessing earlier stages.

Pair with:
1. A `processingStage` column on `articles`
2. A backfill worker that picks up `processingStatus = 'failed'` rows and resumes from the last successful stage
3. Consider adopting `pg-boss` as the job queue to gain visibility, concurrency control, and retries at the queue layer
