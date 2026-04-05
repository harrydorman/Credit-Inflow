import { pgTable, text, serial, timestamp, json, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type JobType = "ingestion" | "backfill" | "alert_eval";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "retrying";

export const jobsTable = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    /** Stable UUID used for structured logging correlation. */
    jobId: text("job_id").notNull().unique(),
    /** Logical job category. */
    type: text("type").$type<JobType>().notNull(),
    /**
     * Optional partition key (e.g. tenant ID). Combined with `type` for
     * advisory-lock key generation and uniqueness checks.
     */
    scopeKey: text("scope_key").notNull().default("global"),
    /** Current lifecycle state. */
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Summary stats / return value stored after completion. */
    result: json("result").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // ── Retry / backoff fields ───────────────────────────────────────────────
    /** How many times this job has been attempted (incremented on each run). */
    attemptCount: integer("attempt_count").notNull().default(0),
    /** Maximum attempts before the job is permanently failed. Default 3. */
    maxAttempts: integer("max_attempts").notNull().default(3),
    /** Earliest time the next retry should be executed (null = ready immediately). */
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    /** Error message from the most-recent failed attempt. */
    lastError: text("last_error"),
    /** Timestamp of the most-recent failure. */
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    /**
     * When false the job will NOT be retried regardless of attemptCount.
     * Set for configuration / data errors that retrying would not fix.
     */
    retryable: boolean("retryable").notNull().default(true),
  },
  (t) => [
    index("jobs_type_status_idx").on(t.type, t.status),
    index("jobs_scope_key_idx").on(t.scopeKey),
    index("jobs_next_retry_idx").on(t.nextRetryAt),
    /**
     * Prevents a second job from being queued/started while one is already
     * queued or running for the same (type, scopeKey) combination.
     * The application layer must clear (complete/fail/retrying) jobs before
     * new ones can be created for the same slot.  This is supplemented by
     * Postgres advisory locks for the running phase to handle race conditions.
     */
    uniqueIndex("jobs_active_unique_idx").on(t.type, t.scopeKey).where(
      sql`${t.status} IN ('queued', 'running', 'retrying')`
    ),
  ]
);

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true, jobId: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
