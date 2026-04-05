# Phase 5 – Async Job-Backed Pipeline Orchestration

## Overview

Phase 4 made the article processing pipeline the single source of truth for
AI analysis.  Phase 4 still called `processArticlePipeline(articleId, jobId)`
**synchronously** inside the ingestion loop — meaning every ingestion run
blocked until every eligible article had fully traversed all pipeline stages.

Phase 5 decouples ingestion from execution:

- Ingestion **inserts** the raw article and **enqueues** a pipeline job.
- The pipeline is **not** called during ingestion.
- A future **worker process** will pick up queued `article_pipeline` jobs and
  execute the pipeline stages asynchronously.

---

## Previous Flow (Phase 4 — synchronous)

```
runIngestion()
  ├── insert raw/pending article
  └── await processArticlePipeline(articleId, jobId)   ← blocks here
```

---

## New Flow (Phase 5 — async)

```
runIngestion()
  ├── insert raw/pending article
  └── enqueueArticlePipelineJob(articleId, ingestionJobId)
        └── INSERT jobs (type="article_pipeline", status="queued")
              └── returns immediately ← ingestion moves to next article

(future worker)
  ├── SELECT * FROM jobs WHERE type='article_pipeline' AND status='queued'
  └── runArticlePipelineJob(pipelineJobId, articleId)
        └── runQueuedJob("article_pipeline", articleId)
              ├── acquire advisory lock
              ├── UPDATE jobs SET status='running'
              ├── await processArticlePipeline(articleId, pipelineJobId)
              └── UPDATE jobs SET status='completed'/'failed'/'retrying'
```

**Filtered articles** (empty content, noise-filtered) are unchanged — they are
still inserted as `processingStage = "filtered"` and no pipeline job is created.

---

## Changes from Phase 4

### 1. New `JobType`

`"article_pipeline"` was added to the `JobType` union in
`lib/db/src/schema/jobs.ts`.

Each `article_pipeline` job uses `articleId.toString()` as its `scopeKey`.
The existing unique partial index on `(type, scopeKey)` WHERE active prevents
duplicate jobs for the same article.

### 2. New `jobService` functions

**`enqueueJob(type, scopeKey, maxAttempts?): Promise<string | null>`**

Inserts a `"queued"` job record without executing it.  Returns the new
`jobId`, or `null` if a job is already active for that slot.

**`runQueuedJob(type, scopeKey, fn): Promise<T | null>`**

Picks up an existing `"queued"` record, acquires the advisory lock, transitions
it to `"running"`, and executes `fn(jobId)`.  On completion, calls `finishJob`
or `scheduleRetry` — identical to the retry/backoff logic in `withJob`.

### 3. New `articlePipelineJob.ts`

Provides two public functions:

| Function | Called by | Purpose |
|---|---|---|
| `enqueueArticlePipelineJob(articleId, ingestionJobId, log?)` | `ingestionService` | Creates a queued pipeline job |
| `runArticlePipelineJob(pipelineJobId, articleId, log?)` | future worker | Executes a queued pipeline job |

### 4. Ingestion updates

- `processArticlePipeline` is no longer imported or called from `ingestionService`.
- The fixed `100 ms setTimeout` throttle is removed.
- `enqueueArticlePipelineJob` is called instead.

### 5. Updated metrics

| Field | Description |
|---|---|
| `articlesPipelineJobsQueued` | *(new)* Pipeline jobs successfully queued |
| `articlesPipelineQueueFailed` | *(new)* Pipeline job creation failures |
| `articlesPipelineTriggered` | Backward-compat alias for `articlesPipelineJobsQueued` |
| `articlesPipelineFailedToStart` | Backward-compat alias for `articlesPipelineQueueFailed` |

---

## Failure Behavior

If `enqueueArticlePipelineJob` throws:

1. The error is logged with `{ err, articleId, jobId }`.
2. `articlesPipelineQueueFailed` and `articlesProcessingFailed` are incremented.
3. The article **remains in `raw/pending` state** — it is not marked failed.
4. Ingestion continues processing remaining articles.

Because the article is left as `raw/pending`, a future worker or backfill can
pick it up without requiring any state cleanup.

---

## Throttle Removal

The fixed `100 ms` per-article delay in the ingestion loop has been removed.
Since pipeline execution is no longer synchronous, there is no AI-rate-limiting
concern at ingestion time.

If future concurrency control is needed (e.g., limiting concurrent worker
goroutines or DB connection pressure), it should be implemented at the **worker
layer** using a configurable concurrency pool — not as an ingestion-side delay.

---

## Worker Deployment — Next Steps

The following items are deferred to the next phase:

1. **Worker process** — A standalone worker that polls for
   `type = "article_pipeline"` + `status = "queued"` (and `nextRetryAt <= now`
   for retries) and calls `runArticlePipelineJob`.

2. **Retry scheduling** — `scheduleRetry` sets `nextRetryAt` using exponential
   backoff.  The worker must filter on `nextRetryAt IS NULL OR nextRetryAt <= NOW()`.

3. **Concurrency control** — The worker should limit parallel pipeline
   executions (e.g., semaphore of 5) to avoid overwhelming the LLM API.

4. **`runBackfill` migration** — `runBackfill` still calls `analyzeArticle`
   inline.  Once a worker is available, backfill should enqueue pipeline jobs
   instead.
