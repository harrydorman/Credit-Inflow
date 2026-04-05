# Phase 4 – Unified Pipeline Processing Model

## Overview

Prior to Phase 4, the credit-intelligence platform had **two competing
article-processing paths**:

1. `ingestionService.runIngestion()` would call `analyzeArticle()`,
   `validateWithMarketData()`, and `evaluateAlerts()` **inline** and write
   articles directly to the database with `processingStage = "validated"`.
2. `processArticlePipeline(articleId, jobId)` performed the same work via the
   structured stage pipeline (raw → enriched → issuer_identified → classified
   → scored → validated).

This inconsistency meant AI results could be produced outside the pipeline's
auditable stage framework, bypassing per-stage retry tracking, confidence
scoring, issuer tracking, and `processingMetadata` traceability.

Phase 4 removes the inline path so the pipeline is the **single processing
path** for all eligible articles.

---

## New Article Lifecycle

```
fetchAllArticles()
      │
      ▼
 deduplication  ──── duplicate ──────────► skip
      │
      ▼
 enrichContent()
      │
      ▼
 empty content? ──── yes ────────────────► insert as filtered (processFailureReason=empty_content)
      │
      ▼
 passesNoiseFilter()
      │
   no, no titleOverride ──────────────────► insert as filtered (processFailureReason=noise_filtered)
      │
      ▼
 insert raw/pending record
 (processingStage="raw", processingStatus="pending")
      │
      ▼
 processArticlePipeline(articleId, jobId)
      │
   throws ──────────────────────────────► update article: processingStatus="failed"
      │                                    processingError="pipeline_start_failed"
      ▼
 pipeline stages:
   enriched → issuer_identified → classified → scored → validated
      │
      ▼
 evaluateAlertsForArticle()  (triggered inside pipeline on success)
```

**Filtered articles** (empty content, noise-filtered) are still inserted as
`processingStage = "filtered"` records in `ingestionService` — this behaviour
is unchanged from Phase 1b.

---

## Updated Ingestion Metrics

`IngestionMetrics` now exposes additional fields alongside the existing ones
(which are preserved for backward compatibility):

| Field | Description |
|---|---|
| `articlesInsertedRaw` | Eligible articles inserted as raw/pending |
| `articlesFiltered` | Articles inserted as filtered records |
| `articlesPipelineTriggered` | Pipeline invocations that completed without throwing |
| `articlesPipelineFailedToStart` | Pipeline invocations that threw (article marked failed) |
| `articlesFullyProcessed` | Backward-compat alias for `articlesPipelineTriggered` |
| `articlesSkippedFiltered` | Backward-compat alias for `articlesFiltered` |
| `articlesProcessingFailed` | Total processing failures (pipeline start errors) |

---

## Circular Dependency Resolution

`pipelineRunner.ts` previously imported `sanitizeNullStr` from
`ingestionService.ts`. Importing the pipeline back into `ingestionService.ts`
would have created a circular dependency.

**Resolution:** `sanitizeNullStr` was extracted to `src/lib/stringUtils.ts`.
`ingestionService.ts` re-exports it for backward compatibility, and
`pipelineRunner.ts` now imports it from `../../lib/stringUtils`.

---

## Pipeline Failure Hardening

If `processArticlePipeline` throws unexpectedly (e.g., DB connection lost
before the first stage update), `ingestionService` now:

1. Catches the error and logs `{ err, articleId, jobId }`.
2. Updates the article row:
   - `processingStatus = "failed"`
   - `processingError = "pipeline_start_failed"`
   - `lastStageError = <error message>`
3. Increments `articlesPipelineFailedToStart` and `articlesProcessingFailed`.
4. Continues processing the remaining articles — the ingestion job itself
   remains resilient.

---

## Deferred Follow-Up Items

The following items were intentionally deferred and should be considered for a
future phase:

1. **Queue-based pipeline orchestration** — Currently `processArticlePipeline`
   is called synchronously within the ingestion loop.  For production
   scalability, eligible articles should be placed on a durable queue (e.g.
   BullMQ, SQS) and workers should consume pipeline jobs asynchronously.
   The insert-then-enqueue pattern (inserting a raw record, then publishing
   `{ articleId }` to the queue) is already compatible with the current DB
   schema.

2. **Deferred content enrichment** — Ingestion still enriches content before
   inserting the raw record (to enable the noise filter check). Once a queue
   is in place, enrichment can be deferred fully to the pipeline's Enrichment
   stage, reducing ingestion latency.

3. **`runBackfill` pipeline migration** — `runBackfill` still calls
   `analyzeArticle` directly.  Once queue-based orchestration is available,
   backfill should also enqueue pipeline jobs rather than running AI inline.

4. **ETF snapshot removal** — `getETFSnapshot()` has been removed from
   `runIngestion`.  The pipeline's Market Validation stage fetches its own
   market snapshot.  The backfill path does not use market data and can be
   left as-is.
