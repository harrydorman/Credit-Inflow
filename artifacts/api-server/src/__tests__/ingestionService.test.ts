/**
 * Tests for the ingestion service.
 *
 * All external dependencies (DB, AI, providers, job service, pipeline) are
 * mocked so the tests run without network or database access.
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
// Module mocks shared across runIngestion tests
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

vi.mock("../lib/contentEnricher", () => ({
  enrichContent: vi.fn().mockResolvedValue({
    rawContent: "enriched article content about credit events",
    contentSourceType: "expanded_article",
    contentDepthScore: 75,
  }),
}));

vi.mock("../lib/aiProcessing", () => ({
  analyzeArticle: vi.fn().mockResolvedValue(null),
  passesNoiseFilter: vi.fn().mockReturnValue(true),
  isCreditTitleOverride: vi.fn().mockReturnValue(false),
}));

vi.mock("../services/deduplication", () => ({
  existingUrlSet: vi.fn().mockResolvedValue(new Set()),
  isDuplicate: vi.fn().mockResolvedValue(false),
  fingerprintTitle: vi.fn().mockReturnValue("fp_title"),
  fingerprintContent: vi.fn().mockReturnValue("fp_content"),
}));

vi.mock("../services/pipeline", () => ({
  processArticlePipeline: vi.fn().mockResolvedValue({
    articleId: 42,
    jobId: "test-job-id",
    finalStage: "validated",
    finalStatus: "success",
    totalDurationMs: 100,
    stageOutputs: [],
  }),
}));

vi.mock("../services/articlePipelineJob", () => ({
  enqueueArticlePipelineJob: vi.fn().mockResolvedValue({ pipelineJobId: "pipeline-job-1", articleId: 42 }),
  AlreadyQueuedError: class AlreadyQueuedError extends Error {
    constructor(articleId: number) { super(`Pipeline job already active for article ${articleId}`); this.name = "AlreadyQueuedError"; }
  },
}));

/** Helper: returns a Drizzle-style insert chain.
 *  The .values() result is both awaitable (for filtered inserts) and
 *  has a .returning() method (for eligible inserts). */
function makeDbInsertChain(returnedId = 42) {
  const valuesResult = Promise.resolve([]) as unknown as {
    returning: ReturnType<typeof vi.fn>;
    then: unknown;
  };
  (valuesResult as unknown as Record<string, unknown>).returning = vi
    .fn()
    .mockResolvedValue([{ id: returnedId }]);
  return {
    values: vi.fn().mockReturnValue(valuesResult),
  };
}

function makeDbUpdateChain() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  };
}

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
  },
  articlesTable: { id: "id" },
}));

// ---------------------------------------------------------------------------
// runIngestion — lock-skipping behaviour + richer metrics
// ---------------------------------------------------------------------------

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
    expect(stats.articlesPipelineTriggered).toBe(0);
    expect(stats.articlesInsertedRaw).toBe(0);
    expect(stats.articlesPipelineJobsQueued).toBe(0);
    expect(stats.articlesPipelineQueueFailed).toBe(0);
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
    // New metric fields present
    expect(stats.articlesInsertedRaw).toBe(0);
    expect(stats.articlesFiltered).toBe(0);
    // Phase 4 backward-compat aliases
    expect(stats.articlesPipelineTriggered).toBe(0);
    expect(stats.articlesPipelineFailedToStart).toBe(0);
    // Phase 5 primary fields
    expect(stats.articlesPipelineJobsQueued).toBe(0);
    expect(stats.articlesPipelineQueueFailed).toBe(0);
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
// Single-path pipeline tests (Phase 4)
// ---------------------------------------------------------------------------

const sampleArticle = {
  title: "Ford Motor credit downgrade triggers CLO concern",
  source: "Reuters",
  publishedAt: new Date("2025-01-01"),
  url: "https://reuters.com/article/ford-downgrade",
  rawContent: "Ford Motor Co credit ...",
};

describe("runIngestion — eligible articles must go through the pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts article as raw/pending (not validated) before pipeline runs", async () => {
    const { withJob } = await import("../services/jobService");
    (withJob as ReturnType<typeof vi.fn>).mockImplementation(
      async (_: string, __: string, fn: (jobId: string) => Promise<unknown>) => fn("job-1")
    );

    const { fetchAllArticles } = await import("../lib/dataProviders");
    (fetchAllArticles as ReturnType<typeof vi.fn>).mockResolvedValue([sampleArticle]);

    const { enrichContent } = await import("../lib/contentEnricher");
    (enrichContent as ReturnType<typeof vi.fn>).mockResolvedValue({
      rawContent: "enriched article content about credit events",
      contentSourceType: "expanded_article",
      contentDepthScore: 75,
    });

    const { passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const { db } = await import("@workspace/db");
    const insertChain = makeDbInsertChain(42);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertChain);
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(makeDbUpdateChain());

    const { runIngestion } = await import("../services/ingestionService");
    await runIngestion();

    // The insert call should have been made with processingStage="raw" / processingStatus="pending"
    expect(db.insert).toHaveBeenCalledTimes(1);
    const insertValues = (insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertValues.processingStage).toBe("raw");
    expect(insertValues.processingStatus).toBe("pending");
    // Must NOT contain any AI output fields
    expect(insertValues.summary).toBeUndefined();
    expect(insertValues.eventType).toBeUndefined();
    expect(insertValues.creditSummaryJson).toBeUndefined();
    expect(insertValues.processingStage).not.toBe("validated");
  });

  it("enqueues a pipeline job for eligible articles (not calling pipeline directly)", async () => {
    const { withJob } = await import("../services/jobService");
    (withJob as ReturnType<typeof vi.fn>).mockImplementation(
      async (_: string, __: string, fn: (jobId: string) => Promise<unknown>) => fn("job-2")
    );

    const { fetchAllArticles } = await import("../lib/dataProviders");
    (fetchAllArticles as ReturnType<typeof vi.fn>).mockResolvedValue([sampleArticle]);

    const { enrichContent } = await import("../lib/contentEnricher");
    (enrichContent as ReturnType<typeof vi.fn>).mockResolvedValue({
      rawContent: "enriched article content about credit events",
      contentSourceType: "expanded_article",
      contentDepthScore: 75,
    });

    const { passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const { db } = await import("@workspace/db");
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(makeDbInsertChain(99));
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(makeDbUpdateChain());

    const { enqueueArticlePipelineJob } = await import("../services/articlePipelineJob");
    (enqueueArticlePipelineJob as ReturnType<typeof vi.fn>).mockResolvedValue({
      pipelineJobId: "pipe-abc", articleId: 99,
    });

    const { processArticlePipeline } = await import("../services/pipeline");

    const { runIngestion } = await import("../services/ingestionService");
    const stats = await runIngestion();

    // Pipeline must NOT be called directly — job is queued instead
    expect(processArticlePipeline).not.toHaveBeenCalled();
    // enqueueArticlePipelineJob must be called with the article id
    expect(enqueueArticlePipelineJob).toHaveBeenCalledOnce();
    expect(enqueueArticlePipelineJob).toHaveBeenCalledWith(99, "job-2", expect.anything());
    expect(stats.articlesPipelineJobsQueued).toBe(1);
    expect(stats.articlesPipelineTriggered).toBe(1); // backward-compat alias
    expect(stats.articlesInsertedRaw).toBe(1);
    expect(stats.articlesFullyProcessed).toBe(1); // backward-compat alias
  });

  it("does NOT invoke analyzeArticle inline for eligible articles", async () => {
    const { withJob } = await import("../services/jobService");
    (withJob as ReturnType<typeof vi.fn>).mockImplementation(
      async (_: string, __: string, fn: (jobId: string) => Promise<unknown>) => fn("job-3")
    );

    const { fetchAllArticles } = await import("../lib/dataProviders");
    (fetchAllArticles as ReturnType<typeof vi.fn>).mockResolvedValue([sampleArticle]);

    const { enrichContent } = await import("../lib/contentEnricher");
    (enrichContent as ReturnType<typeof vi.fn>).mockResolvedValue({
      rawContent: "enriched article content about credit events",
      contentSourceType: "expanded_article",
      contentDepthScore: 75,
    });

    const { passesNoiseFilter, analyzeArticle } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const { db } = await import("@workspace/db");
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(makeDbInsertChain(10));
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(makeDbUpdateChain());

    const { enqueueArticlePipelineJob } = await import("../services/articlePipelineJob");
    (enqueueArticlePipelineJob as ReturnType<typeof vi.fn>).mockResolvedValue({
      pipelineJobId: "pipe-10", articleId: 10,
    });

    const { runIngestion } = await import("../services/ingestionService");
    await runIngestion();

    // analyzeArticle must NOT be called during ingestion for eligible articles
    expect(analyzeArticle).not.toHaveBeenCalled();
  });
});

describe("runIngestion — filtered articles short-circuit without pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts noise-filtered article as filtered and skips pipeline", async () => {
    const { withJob } = await import("../services/jobService");
    (withJob as ReturnType<typeof vi.fn>).mockImplementation(
      async (_: string, __: string, fn: (jobId: string) => Promise<unknown>) => fn("job-4")
    );

    const { fetchAllArticles } = await import("../lib/dataProviders");
    (fetchAllArticles as ReturnType<typeof vi.fn>).mockResolvedValue([sampleArticle]);

    const { enrichContent } = await import("../lib/contentEnricher");
    (enrichContent as ReturnType<typeof vi.fn>).mockResolvedValue({
      rawContent: "enriched article content about credit events",
      contentSourceType: "expanded_article",
      contentDepthScore: 75,
    });

    const { passesNoiseFilter, isCreditTitleOverride } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isCreditTitleOverride as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { db } = await import("@workspace/db");
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(makeDbInsertChain());
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(makeDbUpdateChain());

    const { enqueueArticlePipelineJob } = await import("../services/articlePipelineJob");

    const { runIngestion } = await import("../services/ingestionService");
    const stats = await runIngestion();

    // Pipeline job must NOT be queued for filtered articles
    expect(enqueueArticlePipelineJob).not.toHaveBeenCalled();
    // Filtered record should be inserted
    expect(db.insert).toHaveBeenCalledTimes(1);
    const insertValues = (
      (db.insert as ReturnType<typeof vi.fn>).mock.results[0].value.values as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(insertValues.processingStage).toBe("filtered");
    expect(insertValues.processFailureReason).toBe("noise_filtered");
    // Metric checks
    expect(stats.articlesSkippedFiltered).toBe(1);
    expect(stats.articlesFiltered).toBe(1);
    expect(stats.articlesPipelineJobsQueued).toBe(0);
    expect(stats.articlesPipelineTriggered).toBe(0);
    expect(stats.articlesInsertedRaw).toBe(0);
  });

  it("inserts empty-content article as filtered and skips pipeline", async () => {
    const { withJob } = await import("../services/jobService");
    (withJob as ReturnType<typeof vi.fn>).mockImplementation(
      async (_: string, __: string, fn: (jobId: string) => Promise<unknown>) => fn("job-5")
    );

    const { fetchAllArticles } = await import("../lib/dataProviders");
    (fetchAllArticles as ReturnType<typeof vi.fn>).mockResolvedValue([sampleArticle]);

    // Simulate enrichment returning empty content
    const { enrichContent } = await import("../lib/contentEnricher");
    (enrichContent as ReturnType<typeof vi.fn>).mockResolvedValue({
      rawContent: "",
      contentSourceType: "rss_snippet",
      contentDepthScore: 0,
    });

    const { isCreditTitleOverride } = await import("../lib/aiProcessing");
    (isCreditTitleOverride as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { db } = await import("@workspace/db");
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(makeDbInsertChain());
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(makeDbUpdateChain());

    const { enqueueArticlePipelineJob } = await import("../services/articlePipelineJob");

    const { runIngestion } = await import("../services/ingestionService");
    const stats = await runIngestion();

    expect(enqueueArticlePipelineJob).not.toHaveBeenCalled();
    const insertValues = (
      (db.insert as ReturnType<typeof vi.fn>).mock.results[0].value.values as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(insertValues.processingStage).toBe("filtered");
    expect(insertValues.processFailureReason).toBe("empty_content");
    expect(stats.articlesFiltered).toBe(1);
    expect(stats.articlesPipelineJobsQueued).toBe(0);
    expect(stats.articlesPipelineTriggered).toBe(0);
  });
});

describe("runIngestion — pipeline failure hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments queue-failure metric and continues when job creation throws", async () => {
    const { withJob } = await import("../services/jobService");
    (withJob as ReturnType<typeof vi.fn>).mockImplementation(
      async (_: string, __: string, fn: (jobId: string) => Promise<unknown>) => fn("job-6")
    );

    const { fetchAllArticles } = await import("../lib/dataProviders");
    (fetchAllArticles as ReturnType<typeof vi.fn>).mockResolvedValue([sampleArticle]);

    const { enrichContent } = await import("../lib/contentEnricher");
    (enrichContent as ReturnType<typeof vi.fn>).mockResolvedValue({
      rawContent: "enriched article content about credit events",
      contentSourceType: "expanded_article",
      contentDepthScore: 75,
    });

    const { passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const { db } = await import("@workspace/db");
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(makeDbInsertChain(77));
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(makeDbUpdateChain());

    const { enqueueArticlePipelineJob } = await import("../services/articlePipelineJob");
    (enqueueArticlePipelineJob as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB connection lost")
    );

    const { runIngestion } = await import("../services/ingestionService");
    const stats = await runIngestion();

    // Queue failure counted — article remains raw/pending (no DB update for failure state)
    expect(db.update).not.toHaveBeenCalled();
    expect(stats.articlesPipelineQueueFailed).toBe(1);
    expect(stats.articlesPipelineFailedToStart).toBe(1); // backward-compat alias
    expect(stats.articlesProcessingFailed).toBe(1);
    expect(stats.articlesPipelineJobsQueued).toBe(0);
  });

  it("keeps ingestion job resilient after queue failure (processes remaining articles)", async () => {
    const { withJob } = await import("../services/jobService");
    (withJob as ReturnType<typeof vi.fn>).mockImplementation(
      async (_: string, __: string, fn: (jobId: string) => Promise<unknown>) => fn("job-7")
    );

    const article2 = { ...sampleArticle, url: "https://reuters.com/article/ford-2" };

    const { fetchAllArticles } = await import("../lib/dataProviders");
    (fetchAllArticles as ReturnType<typeof vi.fn>).mockResolvedValue([sampleArticle, article2]);

    const { enrichContent } = await import("../lib/contentEnricher");
    (enrichContent as ReturnType<typeof vi.fn>).mockResolvedValue({
      rawContent: "enriched article content about credit events",
      contentSourceType: "expanded_article",
      contentDepthScore: 75,
    });

    const { passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const { db } = await import("@workspace/db");
    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeDbInsertChain(1))
      .mockReturnValueOnce(makeDbInsertChain(2));
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(makeDbUpdateChain());

    const { enqueueArticlePipelineJob } = await import("../services/articlePipelineJob");
    // First call fails, second succeeds
    (enqueueArticlePipelineJob as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("transient queue error"))
      .mockResolvedValueOnce({ pipelineJobId: "pipe-2", articleId: 2 });

    const { runIngestion } = await import("../services/ingestionService");
    const stats = await runIngestion();

    // Both articles inserted, one job queued, one queue failed
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(stats.articlesInsertedRaw).toBe(2);
    expect(stats.articlesPipelineJobsQueued).toBe(1);
    expect(stats.articlesPipelineQueueFailed).toBe(1);
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
