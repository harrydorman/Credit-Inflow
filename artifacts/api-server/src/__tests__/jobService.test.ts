/**
 * Tests for jobService — retry/backoff, NonRetryableError, concurrent-skip,
 * advisory-lock helpers, and job metrics persistence.
 *
 * All Postgres/DB interactions are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateNextRetryAt,
  NonRetryableError,
  advisoryLockKey,
} from "../services/jobService";

// ---------------------------------------------------------------------------
// calculateNextRetryAt
// ---------------------------------------------------------------------------

describe("calculateNextRetryAt", () => {
  it("returns a Date in the future", () => {
    const before = Date.now();
    const next = calculateNextRetryAt(1);
    expect(next.getTime()).toBeGreaterThan(before);
  });

  it("delay grows with attempt count (exponential backoff)", () => {
    // Use a seed-friendly check: delay for attempt 3 > delay for attempt 1
    const attempt1 = calculateNextRetryAt(1).getTime() - Date.now();
    const attempt3 = calculateNextRetryAt(3).getTime() - Date.now();
    expect(attempt3).toBeGreaterThan(attempt1);
  });

  it("does not exceed the cap (30 minutes + 10% jitter)", () => {
    const CAP_MS = 30 * 60 * 1000;
    const JITTER_FACTOR = 1.1;
    const next = calculateNextRetryAt(20); // very high attempt number
    const delayMs = next.getTime() - Date.now();
    expect(delayMs).toBeLessThanOrEqual(CAP_MS * JITTER_FACTOR + 100 /* buffer */);
  });

  it("attempt 1 delay is approximately 30 seconds (±10% jitter)", () => {
    const BASE_MS = 30_000;
    const next = calculateNextRetryAt(1);
    const delayMs = next.getTime() - Date.now();
    expect(delayMs).toBeGreaterThanOrEqual(BASE_MS * 0.88);
    expect(delayMs).toBeLessThanOrEqual(BASE_MS * 1.12 + 50);
  });
});

// ---------------------------------------------------------------------------
// NonRetryableError
// ---------------------------------------------------------------------------

describe("NonRetryableError", () => {
  it("is an instance of Error", () => {
    const err = new NonRetryableError("configuration invalid");
    expect(err).toBeInstanceOf(Error);
  });

  it("has name 'NonRetryableError'", () => {
    const err = new NonRetryableError("bad config");
    expect(err.name).toBe("NonRetryableError");
  });

  it("message is accessible", () => {
    const err = new NonRetryableError("something went wrong");
    expect(err.message).toBe("something went wrong");
  });

  it("can carry a cause", () => {
    const cause = new Error("root cause");
    const err = new NonRetryableError("wrapper", cause);
    expect(err.cause).toBe(cause);
  });
});

// ---------------------------------------------------------------------------
// advisoryLockKey
// ---------------------------------------------------------------------------

describe("advisoryLockKey", () => {
  it("returns a positive integer", () => {
    const key = advisoryLockKey("ingestion", "global");
    expect(key).toBeGreaterThan(0);
    expect(Number.isInteger(key)).toBe(true);
  });

  it("is deterministic", () => {
    expect(advisoryLockKey("ingestion", "global")).toBe(advisoryLockKey("ingestion", "global"));
  });

  it("differs for different type/scopeKey combinations", () => {
    expect(advisoryLockKey("ingestion", "global")).not.toBe(advisoryLockKey("backfill", "global"));
    expect(advisoryLockKey("ingestion", "tenant_a")).not.toBe(advisoryLockKey("ingestion", "tenant_b"));
  });

  it("stays within 32-bit unsigned range", () => {
    const key = advisoryLockKey("ingestion", "global");
    expect(key).toBeLessThanOrEqual(0xFFFFFFFF);
  });
});

// ---------------------------------------------------------------------------
// withJob — concurrent-skip and NonRetryableError propagation
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{
      id: 1, jobId: "test-uuid", type: "ingestion", scopeKey: "global",
      status: "running", attemptCount: 1, maxAttempts: 3, retryable: true,
    }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
  jobsTable: {
    id: "id", jobId: "job_id", type: "type", scopeKey: "scope_key",
    status: "status", attemptCount: "attempt_count", maxAttempts: "max_attempts",
    retryable: "retryable", startedAt: "started_at", completedAt: "completed_at",
    result: "result", errorMessage: "error_message", nextRetryAt: "next_retry_at",
    lastError: "last_error", lastErrorAt: "last_error_at",
  },
  pool: {
    connect: vi.fn(),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ type: "and", args }),
  or: (...args: unknown[]) => ({ type: "or", args }),
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
  sql: (template: TemplateStringsArray, ...args: unknown[]) => ({ type: "sql", template, args }),
}));

describe("withJob", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null when active job already exists in DB (conflict)", async () => {
    const { db } = await import("@workspace/db");
    // Simulate an active job found
    (db.select as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).from = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).where = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).limit = vi.fn().mockResolvedValue([
      { id: 1, status: "running", jobId: "existing-job" },
    ]);

    const { withJob } = await import("../services/jobService");
    const result = await withJob("ingestion", "global", async () => ({ done: true }));
    expect(result).toBeNull();
  });

  it("propagates NonRetryableError from job function", async () => {
    const { db, pool } = await import("@workspace/db");

    // No active job
    (db.select as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).from = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).where = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).limit = vi.fn().mockResolvedValue([]);

    // Advisory lock acquired
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }),
      release: vi.fn(),
    };
    (pool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(fakeClient);

    // DB insert for job record
    (db.insert as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).values = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).returning = vi.fn().mockResolvedValue([{
      id: 1, jobId: "test-uuid", type: "ingestion", scopeKey: "global",
      status: "running", attemptCount: 1, maxAttempts: 3, retryable: true,
    }]);
    (db as unknown as Record<string, unknown>).update = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockReturnThis();

    const { withJob, NonRetryableError } = await import("../services/jobService");

    await expect(
      withJob("ingestion", "global", async () => {
        throw new NonRetryableError("bad config");
      })
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});
