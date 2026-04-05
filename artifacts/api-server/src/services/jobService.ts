/**
 * jobService.ts
 *
 * Manages job lifecycle (create → running → completed/failed) and
 * provides Postgres session-level advisory locking to prevent concurrent
 * execution of the same job type across multiple processes/instances.
 *
 * Advisory lock keys are derived from a stable numeric hash of the job
 * type + scopeKey string so they are consistent across processes.
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
// Advisory lock helpers
// ---------------------------------------------------------------------------

/** Stable 32-bit unsigned integer derived from a string (djb2-style).
 *
 * Note: Postgres advisory lock functions accept `bigint`, but a 32-bit key
 * is sufficient here because the number of distinct job types is small.
 * Collision probability is negligible for the expected key space.
 */
function stableHash(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
  }
  // Keep within Postgres bigint-safe positive range for advisory locks
  return Math.abs(hash >>> 0); // 32-bit unsigned integer
}

function advisoryLockKey(type: JobType, scopeKey: string): number {
  return stableHash(`${type}::${scopeKey}`);
}

// ---------------------------------------------------------------------------
// Job record management
// ---------------------------------------------------------------------------

export interface JobRecord {
  jobId: string;
  id: number;
  type: JobType;
  scopeKey: string;
  status: JobStatus;
}

/**
 * Tries to acquire a Postgres session-level advisory lock and create a
 * running job record atomically.
 *
 * Returns the new job record if the lock was obtained, or `null` if another
 * process already holds it (i.e. the job is already running).
 *
 * **Important:** the caller MUST call `finishJob` to release the lock even
 * if the job body throws an error.
 */
export async function acquireJob(
  type: JobType,
  scopeKey = "global"
): Promise<{ jobRecord: JobRecord; client: PoolClient } | null> {
  const lockKey = advisoryLockKey(type, scopeKey);
  const jobId = randomUUID();

  // Check for an existing active (queued or running) job for this slot
  // before trying the advisory lock to give a clearer conflict signal.
  const [existing] = await db
    .select({ id: jobsTable.id, status: jobsTable.status, jobId: jobsTable.jobId })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.type, type),
        eq(jobsTable.scopeKey, scopeKey),
        or(eq(jobsTable.status, "queued"), eq(jobsTable.status, "running"))
      )
    )
    .limit(1);

  if (existing) {
    logger.warn(
      { type, scopeKey, conflictingJobId: existing.jobId, status: existing.status },
      "jobService: active job already exists for this slot — skipping"
    );
    return null;
  }

  // Acquire a dedicated pg client for the advisory lock lifetime.
  // Session-level advisory locks are tied to the connection, so we hold this
  // client open until the job finishes.
  const client = await pool.connect();

  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [lockKey]
    );

    if (!lockResult.rows[0]?.acquired) {
      client.release();
      logger.warn(
        { type, scopeKey, lockKey },
        "jobService: could not acquire advisory lock — another process is running this job"
      );
      return null;
    }

    // Insert the job record
    const [record] = await db
      .insert(jobsTable)
      .values({
        jobId,
        type,
        scopeKey,
        status: "running",
        startedAt: new Date(),
      })
      .returning({ id: jobsTable.id, jobId: jobsTable.jobId, type: jobsTable.type, scopeKey: jobsTable.scopeKey, status: jobsTable.status });

    if (!record) {
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
      client.release();
      logger.error({ type, scopeKey }, "jobService: failed to insert job record");
      return null;
    }

    logger.info({ jobId: record.jobId, type, scopeKey }, "jobService: job started");
    return { jobRecord: record as JobRecord, client };
  } catch (err) {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => {});
    client.release();
    throw err;
  }
}

export interface JobResult {
  success: boolean;
  stats: Record<string, unknown>;
  errorMessage?: string;
}

/**
 * Marks the job as completed or failed, releases the advisory lock, and
 * returns the pool client.
 */
export async function finishJob(
  jobRecord: JobRecord,
  client: PoolClient,
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
      })
      .where(eq(jobsTable.id, jobRecord.id));

    logger.info(
      { jobId: jobRecord.jobId, status: finalStatus, ...result.stats },
      "jobService: job finished"
    );
  } catch (err) {
    logger.error({ err, jobId: jobRecord.jobId }, "jobService: error updating job record");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch((e) => {
      logger.error({ err: e, jobId: jobRecord.jobId }, "jobService: error releasing advisory lock");
    });
    client.release();
  }
}

/**
 * Convenience wrapper: runs `fn` inside a job lifecycle.
 * Acquires the lock, runs `fn`, then releases regardless of outcome.
 * Returns the job stats on success, or `null` if the lock could not be acquired.
 */
export async function withJob<T extends Record<string, unknown>>(
  type: JobType,
  scopeKey: string,
  fn: (jobId: string) => Promise<T>
): Promise<T | null> {
  const acquired = await acquireJob(type, scopeKey);
  if (!acquired) return null;

  const { jobRecord, client } = acquired;
  try {
    const stats = await fn(jobRecord.jobId);
    await finishJob(jobRecord, client, { success: true, stats });
    return stats;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await finishJob(jobRecord, client, { success: false, stats: {}, errorMessage });
    throw err;
  }
}
