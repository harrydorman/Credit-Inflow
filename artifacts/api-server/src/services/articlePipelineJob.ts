/**
 * articlePipelineJob.ts
 *
 * Job-backed execution entrypoint for the article processing pipeline.
 *
 * Two complementary functions:
 *
 *   enqueueArticlePipelineJob(articleId, ingestionJobId, log?)
 *     Called by ingestionService after a raw article record is inserted.
 *     Creates a "queued" pipeline job in the jobs table and returns immediately.
 *     Does NOT execute the pipeline.
 *
 *   runArticlePipelineJob(pipelineJobId, articleId, log?)
 *     Called by a worker process to execute a queued pipeline job.
 *     Transitions the job through running → completed/failed with full
 *     retry/backoff support from jobService (via runQueuedJob).
 */
import type { Logger } from "pino";
import { logger as rootLogger } from "../lib/logger";
import { enqueueJob, runQueuedJob, NonRetryableError } from "./jobService";
import { processArticlePipeline } from "./pipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnqueuedPipelineJob {
  /** The jobId of the newly created pipeline job record. */
  pipelineJobId: string;
  /** The article this job will process. */
  articleId: number;
}

// ---------------------------------------------------------------------------
// Enqueue (ingestion-side)
// ---------------------------------------------------------------------------

/**
 * Creates a "queued" pipeline job record for the given article.
 *
 * Called by `runIngestion` immediately after inserting a raw/pending article.
 * The pipeline is NOT executed here — a worker process will pick up the job.
 *
 * @param articleId       Database primary key of the inserted article.
 * @param ingestionJobId  Parent ingestion job ID (for log correlation).
 * @param log             Optional child logger.
 * @returns               The `pipelineJobId` of the newly queued job.
 * @throws                If the DB insert fails (unique constraint violation
 *                        is handled gracefully and returns the conflict jobId).
 */
export async function enqueueArticlePipelineJob(
  articleId: number,
  ingestionJobId: string,
  log?: Logger
): Promise<EnqueuedPipelineJob> {
  const jobLog = (log ?? rootLogger).child({ articleId, ingestionJobId });

  const pipelineJobId = await enqueueJob("article_pipeline", String(articleId));

  if (!pipelineJobId) {
    // A pipeline job is already active for this article (queued/running/retrying).
    // This is a benign race condition — treat it as success so ingestion continues.
    jobLog.debug("article_pipeline: job already active for article — skipping enqueue");
    // Return a sentinel value; the caller treats this as a successful queue.
    // The article will still be processed by the existing active job.
    throw new AlreadyQueuedError(articleId);
  }

  jobLog.info({ pipelineJobId }, "article_pipeline: job queued");
  return { pipelineJobId, articleId };
}

// ---------------------------------------------------------------------------
// Execute (worker-side)
// ---------------------------------------------------------------------------

/**
 * Executes a queued pipeline job for the given article.
 *
 * Intended to be called by a worker process that has identified a due
 * pipeline job.  Uses `runQueuedJob` for the full job lifecycle (advisory
 * lock, running → completed/failed, retry/backoff).
 *
 * @param pipelineJobId  The `jobId` value from the jobs table record.
 * @param articleId      The article to process (equals `parseInt(scopeKey)`).
 * @param log            Optional child logger.
 */
export async function runArticlePipelineJob(
  pipelineJobId: string,
  articleId: number,
  log?: Logger
): Promise<void> {
  const jobLog = (log ?? rootLogger).child({ pipelineJobId, articleId });

  jobLog.info("article_pipeline: starting job execution");

  const result = await runQueuedJob(
    "article_pipeline",
    String(articleId),
    async (jobId) => {
      jobLog.info({ jobId }, "article_pipeline: running pipeline stages");

      const pipelineResult = await processArticlePipeline(articleId, jobId, jobLog);

      jobLog.info(
        {
          jobId,
          finalStage: pipelineResult.finalStage,
          finalStatus: pipelineResult.finalStatus,
          totalDurationMs: pipelineResult.totalDurationMs,
        },
        "article_pipeline: pipeline stages complete"
      );

      return {
        articleId,
        finalStage: pipelineResult.finalStage,
        finalStatus: pipelineResult.finalStatus,
        totalDurationMs: pipelineResult.totalDurationMs,
        classificationConfidence: pipelineResult.classificationConfidence ?? null,
      } as Record<string, unknown>;
    }
  );

  if (result === null) {
    jobLog.warn("article_pipeline: no queued job found or lock not acquired — skipping");
  }
}

// ---------------------------------------------------------------------------
// Internal error types
// ---------------------------------------------------------------------------

/**
 * Thrown by `enqueueArticlePipelineJob` when a pipeline job is already
 * active for the article.  Callers should treat this as a non-fatal condition.
 */
export class AlreadyQueuedError extends Error {
  override readonly name = "AlreadyQueuedError";
  readonly articleId: number;
  constructor(articleId: number) {
    super(`Pipeline job already active for article ${articleId}`);
    this.articleId = articleId;
  }
}

export { NonRetryableError };
