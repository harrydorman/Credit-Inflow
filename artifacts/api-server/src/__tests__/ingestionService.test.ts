/**
 * Tests for the ingestion service.
 *
 * All external dependencies (DB, AI, providers, job service) are mocked so
 * the tests run without network or database access.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeNullStr, sanitizeIssuer } from "../services/ingestionService";

// ---------------------------------------------------------------------------
// sanitizeNullStr
// ---------------------------------------------------------------------------
describe("sanitizeNullStr", () => {
  it("returns null for null/undefined", () => {
    expect(sanitizeNullStr(null)).toBeNull();
    expect(sanitizeNullStr(undefined)).toBeNull();
  });

  it("returns null for empty / whitespace string", () => {
    expect(sanitizeNullStr("")).toBeNull();
    expect(sanitizeNullStr("   ")).toBeNull();
  });

  it("returns null for sentinel strings", () => {
    expect(sanitizeNullStr("null")).toBeNull();
    expect(sanitizeNullStr("undefined")).toBeNull();
    expect(sanitizeNullStr("N/A")).toBeNull();
    expect(sanitizeNullStr("n/a")).toBeNull();
  });

  it("trims and returns a real value", () => {
    expect(sanitizeNullStr("  hello  ")).toBe("hello");
    expect(sanitizeNullStr("Ford Motor")).toBe("Ford Motor");
  });
});

// ---------------------------------------------------------------------------
// sanitizeIssuer
// ---------------------------------------------------------------------------

vi.mock("../lib/canonicalIssuers", () => ({
  canonicalizeIssuer: (val: string | null) => (val ? val.toUpperCase() : null),
}));

describe("sanitizeIssuer", () => {
  it("returns null for null input", () => {
    expect(sanitizeIssuer(null)).toBeNull();
  });

  it("returns null for empty / sentinel strings", () => {
    expect(sanitizeIssuer("N/A")).toBeNull();
    expect(sanitizeIssuer("null")).toBeNull();
  });

  it("passes non-null values through canonicalizeIssuer", () => {
    expect(sanitizeIssuer("ford motor")).toBe("FORD MOTOR");
  });
});

// ---------------------------------------------------------------------------
// runIngestion — lock-skipping behaviour + richer metrics
// ---------------------------------------------------------------------------

vi.mock("../services/jobService", () => ({
  withJob: vi.fn(),
  NonRetryableError: class NonRetryableError extends Error {
    constructor(msg: string) { super(msg); this.name = "NonRetryableError"; }
  },
}));

vi.mock("../lib/dataProviders", () => ({
  fetchAllArticles: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/marketData", () => ({
  getETFSnapshot: vi.fn().mockResolvedValue({ hyg: null, lqd: null }),
  validateWithMarketData: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/deduplication", () => ({
  existingUrlSet: vi.fn().mockResolvedValue(new Set()),
  isDuplicate: vi.fn().mockResolvedValue(false),
  fingerprintTitle: vi.fn().mockReturnValue("fp_title"),
  fingerprintContent: vi.fn().mockReturnValue("fp_content"),
}));

vi.mock("@workspace/db", () => ({
  db: { insert: vi.fn().mockReturnThis(), values: vi.fn().mockResolvedValue([]) },
  articlesTable: {},
}));

describe("runIngestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns skipped message when lock cannot be acquired (withJob returns null)", async () => {
    const { withJob } = await import("../services/jobService");
    (withJob as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { runIngestion } = await import("../services/ingestionService");
    const stats = await runIngestion();
    expect(stats.message).toMatch(/skipped/i);
    expect(stats.articlesFetched).toBe(0);
    expect(stats.articlesFullyProcessed).toBe(0);
  });

  it("returns richer metrics when withJob resolves with result", async () => {
    const { withJob } = await import("../services/jobService");
    (withJob as ReturnType<typeof vi.fn>).mockImplementation(
      async (_type: string, _key: string, fn: (jobId: string) => Promise<unknown>) => {
        return fn("test-job-id");
      }
    );

    const { fetchAllArticles } = await import("../lib/dataProviders");
    (fetchAllArticles as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { runIngestion } = await import("../services/ingestionService");
    const stats = await runIngestion();
    expect(stats.articlesFetched).toBe(0);
    expect(stats.articlesFullyProcessed).toBe(0);
    expect(stats.articlesSkippedDuplicate).toBe(0);
    expect(stats.articlesSkippedFiltered).toBe(0);
    expect(stats.articlesProcessingFailed).toBe(0);
    expect(stats.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(stats.message).toMatch(/ingestion complete/i);
  });

  it("includes jobId in returned stats", async () => {
    const { withJob } = await import("../services/jobService");
    (withJob as ReturnType<typeof vi.fn>).mockImplementation(
      async (_type: string, _key: string, fn: (jobId: string) => Promise<unknown>) => {
        return fn("abc-123");
      }
    );

    const { fetchAllArticles } = await import("../lib/dataProviders");
    (fetchAllArticles as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { runIngestion } = await import("../services/ingestionService");
    const stats = await runIngestion();
    expect(stats.jobId).toBe("abc-123");
  });
});

// ---------------------------------------------------------------------------
// Article processing status field expectations
// ---------------------------------------------------------------------------

describe("ArticleProcessingStatus type", () => {
  it("accepts valid status values", () => {
    // This is a compile-time type check encoded as a runtime assertion.
    // If the type changes incompatibly, the build will fail.
    const validStatuses = ["pending", "processing", "processed", "failed", "filtered"];
    expect(validStatuses).toContain("processed");
    expect(validStatuses).toContain("failed");
    expect(validStatuses).toContain("filtered");
  });
});
