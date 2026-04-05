import { pgTable, text, serial, timestamp, json, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type JobType = "ingestion" | "backfill" | "alert_eval";
export type JobStatus = "queued" | "running" | "completed" | "failed";

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
  },
  (t) => [
    index("jobs_type_status_idx").on(t.type, t.status),
    index("jobs_scope_key_idx").on(t.scopeKey),
    /**
     * Prevents a second job from being queued/started while one is already
     * queued or running for the same (type, scopeKey) combination.
     * The application layer must clear (complete/fail) jobs before new ones
     * can be created for the same slot.  This is supplemented by Postgres
     * advisory locks for the running phase to handle race conditions.
     */
    uniqueIndex("jobs_active_unique_idx").on(t.type, t.scopeKey).where(
      sql`${t.status} IN ('queued', 'running')`
    ),
  ]
);

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true, jobId: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
