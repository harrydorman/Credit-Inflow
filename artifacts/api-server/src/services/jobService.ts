/**
 * jobService.ts
 *
 * Job lifecycle management with Postgres advisory locking.
 *
 * Concerns are separated into two layers:
 *  1. Advisory lock — acquireLock / releaseLock (raw connection-level primitives)
 *  2. Job lifecycle — acquireJob / finishJob / scheduleRetry / withJob
 *
 * This makes it straightforward to later swap the locking backend (e.g. Redis
 * SETNX) without touching job record logic, and vice-versa.
 *
 * Retry / backoff:
 *  - `withJob` catches errors from the job function.
 *  - If the error is a `NonRetryableError`, the job is permanently failed.
 *  - Otherwise the job is rescheduled with exponential backoff up to maxAttempts.
 *  - The next scheduled run is stored in `nextRetryAt` so an external scheduler
 *    (cron / worker) can query for due jobs.  For now the in-process scheduler
 *    in index.ts calls withJob directly and retries happen on the next cycle.
 */
import { db, jobsTable } from "@workspace/db";
import type { JobStatus, JobType } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { pool } from "@workspace/db";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";
import type { PoolClient } from "pg";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Throw this inside a `withJob` callback to mark the failure as non-retryable.
 * The job will be set to status="failed", retryable=false.
 */
export class NonRetryableError extends Error {
  override readonly name = "NonRetryableError";
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Advisory lock primitives
// ---------------------------------------------------------------------------

/** Stable 32-bit unsigned integer derived from a string (djb2-style).
 *
 * Postgres advisory lock functions (`pg_advisory_lock`, `pg_try_advisory_lock`)
 * accept a `bigint` (int8) parameter.  We derive a 32-bit unsigned value here,
 * which is implicitly cast to bigint when passed to Postgres.  The 32-bit key
 * space is sufficient for the small number of distinct job types and scope keys
 * expected in this application.  For finer-grained control the two-argument
 * form `pg_try_advisory_lock(classid int4, objid int4)` could be used instead.
 */
function stableHash(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
  }
  return Math.abs(hash >>> 0); // 32-bit unsigned integer
}

export function advisoryLockKey(type: JobType, scopeKey: string): number {
  return stableHash(`${type}::${scopeKey}`);
}

/**
 * Attempts to acquire a Postgres *session-level* advisory lock on a dedicated
 * pool connection.
 *
 * Returns the held client if the lock was acquired, or `null` if another
 * process already holds it.  The caller **must** call `releaseLock` with the
 * returned client to free the connection and unlock.
 */
export async function acquireLock(
  lockKey: number
): Promise<PoolClient | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [lockKey]
    );
    if (result.rows[0]?.acquired) return client;
    client.release();
    return null;
  } catch (err) {
    client.release();
    throw err;
  }
}

/** Releases a session-level advisory lock and returns the client to the pool. */
export async function releaseLock(client: PoolClient, lockKey: number): Promise<void> {
  await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch((e) => {
    logger.error({ err: e, lockKey }, "jobService: error releasing advisory lock");
  });
  client.release();
}

// ---------------------------------------------------------------------------
// Retry / backoff helpers
// ---------------------------------------------------------------------------

const BASE_RETRY_DELAY_MS = 30_000; // 30 seconds
const MAX_RETRY_DELAY_MS = 30 * 60_000; // 30 minutes cap

/**
 * Computes the next retry timestamp using exponential backoff with jitter.
 * Delay = min(base * 2^(attempt-1), cap) + jitter(±10%)
 */
export function calculateNextRetryAt(attemptCount: number): Date {
  const base = BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attemptCount - 1));
  const capped = Math.min(base, MAX_RETRY_DELAY_MS);
  const jitter = capped * 0.1 * (Math.random() * 2 - 1); // ±10%
  const delayMs = Math.round(capped + jitter);
  return new Date(Date.now() + delayMs);
}

// ---------------------------------------------------------------------------
// Job record types
// ---------------------------------------------------------------------------

export interface JobRecord {
  jobId: string;
  id: number;
  type: JobType;
  scopeKey: string;
  status: JobStatus;
  attemptCount: number;
  maxAttempts: number;
  retryable: boolean;
}

/** Structured result from a job function. */
export interface JobResult {
  success: boolean;
  stats: Record<string, unknown>;
  errorMessage?: string;
  /** When true, overrides retryable=false even for generic Error. */
  nonRetryable?: boolean;
}

// ---------------------------------------------------------------------------
// Concurrency status
// ---------------------------------------------------------------------------

export type ConcurrentJobInfo = {
  conflictingJobId: string;
  status: JobStatus;
};

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

/**
 * Looks up an existing active (queued/running/retrying) job for the given slot.
 */
async function findActiveJob(type: JobType, scopeKey: string): Promise<ConcurrentJobInfo | null> {
  const [existing] = await db
    .select({ id: jobsTable.id, status: jobsTable.status, jobId: jobsTable.jobId })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.type, type),
        eq(jobsTable.scopeKey, scopeKey),
        or(
          eq(jobsTable.status, "queued"),
          eq(jobsTable.status, "running"),
          eq(jobsTable.status, "retrying")
        )
      )
    )
    .limit(1);

  if (!existing) return null;
  return { conflictingJobId: existing.jobId, status: existing.status as JobStatus };
}

/**
 * Tries to acquire the advisory lock and insert a running job record.
 *
 * Returns `{ jobRecord, lockClient }` on success, or `{ conflict }` when
 * another job is already active for the same slot.
 */
export async function acquireJob(
  type: JobType,
  scopeKey = "global"
): Promise<{ jobRecord: JobRecord; lockClient: PoolClient } | { conflict: ConcurrentJobInfo } | null> {
  const lockKey = advisoryLockKey(type, scopeKey);
  const jobId = randomUUID();

  // DB-level check first for a clear conflict message
  const conflict = await findActiveJob(type, scopeKey);
  if (conflict) {
    logger.warn(
      { type, scopeKey, conflictingJobId: conflict.conflictingJobId, status: conflict.status },
      "jobService: active job already exists for this slot — skipping"
    );
    return { conflict };
  }

  const lockClient = await acquireLock(lockKey);
  if (!lockClient) {
    logger.warn(
      { type, scopeKey, lockKey },
      "jobService: could not acquire advisory lock — another process is running this job"
    );
    return null;
  }

  try {
    const [record] = await db
      .insert(jobsTable)
      .values({
        jobId,
        type,
        scopeKey,
        status: "running",
        startedAt: new Date(),
        attemptCount: 1,
      })
      .returning({
        id: jobsTable.id,
        jobId: jobsTable.jobId,
        type: jobsTable.type,
        scopeKey: jobsTable.scopeKey,
        status: jobsTable.status,
        attemptCount: jobsTable.attemptCount,
        maxAttempts: jobsTable.maxAttempts,
        retryable: jobsTable.retryable,
      });

    if (!record) {
      await releaseLock(lockClient, lockKey);
      logger.error({ type, scopeKey }, "jobService: failed to insert job record");
      return null;
    }

    logger.info({ jobId: record.jobId, type, scopeKey, attempt: record.attemptCount }, "jobService: job started");
    return { jobRecord: record as JobRecord, lockClient };
  } catch (err) {
    await releaseLock(lockClient, lockKey);
    throw err;
  }
}

/**
 * Marks the job as completed or failed and releases the advisory lock.
 */
export async function finishJob(
  jobRecord: JobRecord,
  lockClient: PoolClient,
  result: JobResult
): Promise<void> {
  const lockKey = advisoryLockKey(jobRecord.type, jobRecord.scopeKey);
  const finalStatus: JobStatus = result.success ? "completed" : "failed";

  try {
    await db
      .update(jobsTable)
      .set({
        status: finalStatus,
        completedAt: new Date(),
        result: result.stats,
        errorMessage: result.errorMessage ?? null,
        ...(result.nonRetryable ? { retryable: false } : {}),
        ...(result.errorMessage
          ? { lastError: result.errorMessage, lastErrorAt: new Date() }
          : {}),
      })
      .where(eq(jobsTable.id, jobRecord.id));

    logger.info(
      { jobId: jobRecord.jobId, status: finalStatus, ...result.stats },
      "jobService: job finished"
    );
  } catch (err) {
    logger.error({ err, jobId: jobRecord.jobId }, "jobService: error updating job record");
  } finally {
    await releaseLock(lockClient, lockKey);
  }
}

/**
 * Marks the job for retry (status="retrying") and schedules the next attempt.
 * If maxAttempts has been reached or the job is non-retryable, permanently fails it.
 */
export async function scheduleRetry(
  jobRecord: JobRecord,
  lockClient: PoolClient,
  errorMessage: string,
  nonRetryable = false
): Promise<void> {
  const lockKey = advisoryLockKey(jobRecord.type, jobRecord.scopeKey);
  const shouldRetry =
    !nonRetryable &&
    jobRecord.retryable &&
    jobRecord.attemptCount < jobRecord.maxAttempts;

  try {
    if (shouldRetry) {
      const nextRetryAt = calculateNextRetryAt(jobRecord.attemptCount);
      await db
        .update(jobsTable)
        .set({
          status: "retrying",
          lastError: errorMessage,
          lastErrorAt: new Date(),
          nextRetryAt,
        })
        .where(eq(jobsTable.id, jobRecord.id));
      logger.warn(
        {
          jobId: jobRecord.jobId,
          attempt: jobRecord.attemptCount,
          maxAttempts: jobRecord.maxAttempts,
          nextRetryAt,
        },
        "jobService: job failed — scheduled for retry"
      );
    } else {
      await db
        .update(jobsTable)
        .set({
          status: "failed",
          completedAt: new Date(),
          lastError: errorMessage,
          lastErrorAt: new Date(),
          errorMessage,
          retryable: !nonRetryable && jobRecord.retryable,
        })
        .where(eq(jobsTable.id, jobRecord.id));
      logger.error(
        {
          jobId: jobRecord.jobId,
          attempt: jobRecord.attemptCount,
          maxAttempts: jobRecord.maxAttempts,
          nonRetryable,
        },
        "jobService: job permanently failed — no more retries"
      );
    }
  } finally {
    await releaseLock(lockClient, lockKey);
  }
}

// ---------------------------------------------------------------------------
// High-level wrapper
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper: runs `fn` inside a managed job lifecycle.
 *
 * - Acquires advisory lock + creates job record
 * - Calls `fn(jobId)` to execute the job body
 * - On success: marks job completed, returns stats
 * - On `NonRetryableError`: permanently fails the job, re-throws
 * - On other errors: schedules retry if attempts remain, re-throws
 * - If lock cannot be acquired: returns `null`
 */
export async function withJob<T extends Record<string, unknown>>(
  type: JobType,
  scopeKey: string,
  fn: (jobId: string) => Promise<T>
): Promise<T | null> {
  const acquired = await acquireJob(type, scopeKey);
  if (!acquired) return null;
  // conflict case: another job is active — return null (skip)
  if ("conflict" in acquired) return null;

  const { jobRecord, lockClient } = acquired;
  try {
    const stats = await fn(jobRecord.jobId);
    await finishJob(jobRecord, lockClient, { success: true, stats });
    return stats;
  } catch (err) {
    const isNonRetryable = err instanceof NonRetryableError;
    const errorMessage = err instanceof Error ? err.message : String(err);
    await scheduleRetry(jobRecord, lockClient, errorMessage, isNonRetryable);
    throw err;
  }
}
