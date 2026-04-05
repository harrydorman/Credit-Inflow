/**
 * Tests for articlePipelineJob.ts
 *
 * Covers:
 *  - enqueueArticlePipelineJob: queues a new pipeline job and returns its ID
 *  - enqueueArticlePipelineJob: throws AlreadyQueuedError when a job is already active
 *  - runArticlePipelineJob: calls processArticlePipeline via runQueuedJob
 *  - runArticlePipelineJob: handles the case where no queued job exists (noop)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../services/jobService", () => ({
  enqueueJob: vi.fn(),
  runQueuedJob: vi.fn(),
  NonRetryableError: class NonRetryableError extends Error {
    constructor(msg: string) { super(msg); this.name = "NonRetryableError"; }
  },
}));

vi.mock("../services/pipeline", () => ({
  processArticlePipeline: vi.fn().mockResolvedValue({
    articleId: 10,
    jobId: "pipe-job-1",
    finalStage: "validated",
    finalStatus: "success",
    totalDurationMs: 350,
    stageOutputs: [],
  }),
}));

// ---------------------------------------------------------------------------
// enqueueArticlePipelineJob
// ---------------------------------------------------------------------------

describe("enqueueArticlePipelineJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an EnqueuedPipelineJob when enqueueJob succeeds", async () => {
    const { enqueueJob } = await import("../services/jobService");
    (enqueueJob as ReturnType<typeof vi.fn>).mockResolvedValue("new-pipeline-job-id");

    const { enqueueArticlePipelineJob } = await import("../services/articlePipelineJob");
    const result = await enqueueArticlePipelineJob(42, "ingestion-job-1");

    expect(result.pipelineJobId).toBe("new-pipeline-job-id");
    expect(result.articleId).toBe(42);
    expect(enqueueJob).toHaveBeenCalledOnce();
    expect(enqueueJob).toHaveBeenCalledWith("article_pipeline", "42");
  });

  it("throws AlreadyQueuedError when enqueueJob returns null (job already active)", async () => {
    const { enqueueJob } = await import("../services/jobService");
    (enqueueJob as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { enqueueArticlePipelineJob, AlreadyQueuedError } = await import(
      "../services/articlePipelineJob"
    );

    await expect(enqueueArticlePipelineJob(99, "ingestion-job-2")).rejects.toThrow(
      AlreadyQueuedError
    );
  });

  it("propagates DB errors from enqueueJob", async () => {
    const { enqueueJob } = await import("../services/jobService");
    (enqueueJob as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB unavailable")
    );

    const { enqueueArticlePipelineJob } = await import("../services/articlePipelineJob");

    await expect(enqueueArticlePipelineJob(5, "ingestion-job-3")).rejects.toThrow(
      "DB unavailable"
    );
  });
});

// ---------------------------------------------------------------------------
// runArticlePipelineJob
// ---------------------------------------------------------------------------

describe("runArticlePipelineJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls processArticlePipeline inside runQueuedJob", async () => {
    const { runQueuedJob } = await import("../services/jobService");
    // Simulate runQueuedJob executing the callback immediately
    (runQueuedJob as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _type: string,
        _scope: string,
        fn: (jobId: string) => Promise<Record<string, unknown>>
      ) => fn("pipe-job-exec-1")
    );

    const { processArticlePipeline } = await import("../services/pipeline");

    const { runArticlePipelineJob } = await import("../services/articlePipelineJob");
    await runArticlePipelineJob("pipe-job-1", 10);

    expect(runQueuedJob).toHaveBeenCalledOnce();
    expect(runQueuedJob).toHaveBeenCalledWith(
      "article_pipeline",
      "10",
      expect.any(Function)
    );
    expect(processArticlePipeline).toHaveBeenCalledOnce();
    expect(processArticlePipeline).toHaveBeenCalledWith(10, "pipe-job-exec-1", expect.anything());
  });

  it("is a noop (returns without error) when runQueuedJob returns null (no queued job)", async () => {
    const { runQueuedJob } = await import("../services/jobService");
    (runQueuedJob as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { processArticlePipeline } = await import("../services/pipeline");

    const { runArticlePipelineJob } = await import("../services/articlePipelineJob");
    // Should not throw
    await expect(runArticlePipelineJob("no-such-job", 77)).resolves.toBeUndefined();

    expect(processArticlePipeline).not.toHaveBeenCalled();
  });

  it("returns pipeline result stats through the job lifecycle", async () => {
    const { runQueuedJob } = await import("../services/jobService");
    (runQueuedJob as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _type: string,
        _scope: string,
        fn: (jobId: string) => Promise<Record<string, unknown>>
      ) => fn("pipe-job-stats-1")
    );

    const { processArticlePipeline } = await import("../services/pipeline");
    (processArticlePipeline as ReturnType<typeof vi.fn>).mockResolvedValue({
      articleId: 55,
      jobId: "pipe-job-stats-1",
      finalStage: "validated",
      finalStatus: "success",
      totalDurationMs: 500,
      classificationConfidence: 0.87,
      stageOutputs: [],
    });

    const { runArticlePipelineJob } = await import("../services/articlePipelineJob");
    await runArticlePipelineJob("pipe-job-stats-1", 55);

    // runQueuedJob receives the stats object back from the fn
    const fnArg = (runQueuedJob as ReturnType<typeof vi.fn>).mock.calls[0][2];
    const returnedStats = await fnArg("pipe-job-stats-1");

    expect(returnedStats.articleId).toBe(55);
    expect(returnedStats.finalStatus).toBe("success");
    expect(returnedStats.totalDurationMs).toBe(500);
    expect(returnedStats.classificationConfidence).toBe(0.87);
  });
});

// ---------------------------------------------------------------------------
// No artificial throttle
// ---------------------------------------------------------------------------

describe("ingestion: no artificial throttle in article processing loop", () => {
  it("does not call setTimeout in the runIngestion article processing loop", async () => {
    // Extract only the runIngestion function body from the source to verify
    // the fixed 100ms throttle was removed and was NOT re-introduced.
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const ingestionSrc = readFileSync(
      resolve(__dirname, "../services/ingestionService.ts"),
      "utf8"
    );

    // Extract just the runIngestion function (everything from its declaration to
    // the closing brace of withJob, just before the runBackfill function).
    const runIngestionSection = ingestionSrc.split("// ---------------------------------------------------------------------------\n// Backfill")[0];

    // The ingestion main loop must not use fixed-time throttling
    expect(runIngestionSection).not.toMatch(/await new Promise.*setTimeout/);
    expect(runIngestionSection).not.toMatch(/setTimeout\(\s*resolve/);
  });
});
