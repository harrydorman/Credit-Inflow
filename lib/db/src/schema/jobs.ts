import { pgTable, serial, text, timestamp, json } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uniqueIndex } from "drizzle-orm/pg-core";

export type JobType = "refresh" | "backfill";
export type JobStatus = "running" | "completed" | "failed";

export interface RefreshJobResult {
  fetched: number;
  processed: number;
  duplicatesSkipped: number;
  fingerprintSkipped: number;
  noiseFiltered: number;
  marketValidated: number;
  errors: number;
  message: string;
}

export interface BackfillJobResult {
  backfilledStructured: number;
  retriedUnprocessed: number;
  skippedNoiseFilter: number;
  aiNullReturned: number;
  errors: number;
  message: string;
}

/**
 * Tracks ingestion and backfill jobs.
 *
 * DB-backed locking: a partial unique index on (job_key) WHERE status = 'running'
 * ensures only one active job of each type can run at a time. Attempting to insert
 * a second running job for the same key will throw a unique-constraint violation,
 * which the service converts into a 409 Conflict response.
 */
export const ingestionJobsTable = pgTable(
  "ingestion_jobs",
  {
    id: serial("id").primaryKey(),
    jobType: text("job_type").notNull().$type<JobType>(),
    jobKey: text("job_key").notNull(),
    status: text("status").notNull().$type<JobStatus>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    result: json("result").$type<RefreshJobResult | BackfillJobResult>(),
    errorMessage: text("error_message"),
  },
  (table) => [
    uniqueIndex("uq_ingestion_job_running")
      .on(table.jobKey)
      .where(sql`${table.status} = 'running'`),
  ],
);

export type IngestionJob = typeof ingestionJobsTable.$inferSelect;
export type NewIngestionJob = typeof ingestionJobsTable.$inferInsert;
