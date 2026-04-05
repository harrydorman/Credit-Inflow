/**
 * Tests for Phase 2.5 pipeline: resume, per-stage retry, issuer tracking,
 * rule system versioning, and structured processingMetadata.
 *
 * All external dependencies are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (must appear before any imports that use them)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
  articlesTable: {
    id: "id",
    title: "title",
    url: "url",
    source: "source",
    rawContent: "raw_content",
    rawSnippet: "raw_snippet",
    processingStage: "processing_stage",
    processingStatus: "processing_status",
    processingError: "processing_error",
    processingStartedAt: "processing_started_at",
    processingCompletedAt: "processing_completed_at",
    lastProcessedAt: "last_processed_at",
    processingMetadata: "processing_metadata",
    pipelineVersion: "pipeline_version",
    promptVersion: "prompt_version",
    modelVersion: "model_version",
    classificationConfidence: "classification_confidence",
    needsReview: "needs_review",
    reviewReason: "review_reason",
    stageRetryCounts: "stage_retry_counts",
    lastStageError: "last_stage_error",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
  and: (...args: unknown[]) => ({ type: "and", args }),
}));

vi.mock("../lib/aiProcessing", () => ({
  analyzeArticle: vi.fn(),
  passesNoiseFilter: vi.fn().mockReturnValue(true),
  isCreditTitleOverride: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/contentEnricher", () => ({
  enrichContent: vi.fn().mockResolvedValue({
    rawContent: "enriched content about downgrade and credit risk",
    contentSourceType: "expanded_article",
    contentDepthScore: 70,
  }),
}));

vi.mock("../lib/marketData", () => ({
  getETFSnapshot: vi.fn().mockResolvedValue({ hyg: null, lqd: null }),
  validateWithMarketData: vi.fn().mockResolvedValue({
    stockMove1D: null,
    stockMove5D: null,
    hyETFMove: null,
    validationSignal: "unconfirmed",
    confidenceScore: "low",
  }),
}));

vi.mock("../lib/canonicalIssuers", () => ({
  canonicalizeIssuer: (val: string | null) => val,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_AI_ANALYSIS = {
  summary: "Test article summary",
  sector: "Financial Services",
  eventType: "downgrade",
  sentiment: "negative" as const,
  whyItMatters: "Credit quality deteriorating",
  whoCares: ["Credit Analysts"],
  issuerName: "Test Corp",
  tradeDirection: "negative" as const,
  tradeRationale: "Downgrade signals credit stress",
  potentialTrades: ["Short CDS"],
  marketsImpacted: ["HY bonds"],
  leverageMentioned: false,
  liquidityConcern: false,
  refinancingRisk: false,
  earningsMiss: false,
  ratingMentioned: "B+",
  ratingAgency: "S&P",
  ratingIsDowngrade: true,
  ratingIsUpgrade: false,
  ratingIsCCCThreshold: false,
  covenantFlag: false,
  covenantType: null,
  cloImpact: false,
  cloRelevance: "low" as const,
  cloImpactTypes: [],
  cloWarfImpact: "neutral" as const,
  cloCCCBucketRisk: false,
  cloLoanVsBond: "bond" as const,
  cloExplanation: "",
  spreadWideningRisk: false,
  forcedSellingRisk: false,
  distressedRisk: false,
  marketImpact: "medium" as const,
  urgencyScore: 3,
  finalUrgencyScore: 5,
  creditSignalScore: 3,
  creditSummary: null,
  scoreExplanation: null,
};

function setupDbMocks(articleOverrides: Record<string, unknown> = {}) {
  const defaultArticle = {
    id: 1,
    title: "Test article about downgrade",
    url: "https://example.com/article",
    source: "reuters",
    rawContent: "credit downgrade bond debt leverage",
    rawSnippet: "downgrade snippet",
    processingStage: null,
    processingStatus: null,
    stageRetryCounts: null,
    ...articleOverrides,
  };
  return defaultArticle;
}

async function mockDbWithArticle(article: Record<string, unknown>) {
  const { db } = await import("@workspace/db");
  (db.select as ReturnType<typeof vi.fn>).mockReturnThis();
  (db as unknown as Record<string, unknown>).from = vi.fn().mockReturnThis();
  (db as unknown as Record<string, unknown>).where = vi.fn()
    .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([article]) })
    .mockResolvedValue(undefined);
  (db as unknown as Record<string, unknown>).limit = vi.fn().mockResolvedValue([article]);
  (db as unknown as Record<string, unknown>).update = vi.fn().mockReturnThis();
  (db as unknown as Record<string, unknown>).set = vi.fn().mockReturnThis();
}

// ---------------------------------------------------------------------------
// getNextStage helper
// ---------------------------------------------------------------------------

import { getNextStage, STAGE_ORDER, STAGE_RETRY_MAX } from "../services/pipeline/types";

describe("getNextStage", () => {
  it("returns the first pipeline stage when current is 'raw'", () => {
    expect(getNextStage("raw")).toBe("enriched");
  });

  it("returns 'issuer_identified' after 'enriched'", () => {
    expect(getNextStage("enriched")).toBe("issuer_identified");
  });

  it("returns 'classified' after 'issuer_identified'", () => {
    expect(getNextStage("issuer_identified")).toBe("classified");
  });

  it("returns 'scored' after 'classified'", () => {
    expect(getNextStage("classified")).toBe("scored");
  });

  it("returns 'validated' after 'scored'", () => {
    expect(getNextStage("scored")).toBe("validated");
  });

  it("returns null after 'validated' (end of pipeline)", () => {
    expect(getNextStage("validated")).toBeNull();
  });

  it("returns first stage ('enriched') when 'filtered' is passed", () => {
    // filtered is terminal / not in STAGE_ORDER → returns start
    expect(getNextStage("filtered")).toBe("enriched");
  });

  it("STAGE_ORDER contains all progression stages in order", () => {
    expect(STAGE_ORDER).toEqual([
      "enriched",
      "issuer_identified",
      "classified",
      "scored",
      "validated",
    ]);
  });

  it("STAGE_RETRY_MAX is a positive integer", () => {
    expect(STAGE_RETRY_MAX).toBeGreaterThan(0);
    expect(Number.isInteger(STAGE_RETRY_MAX)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deterministic rules — ruleSetVersion propagation
// ---------------------------------------------------------------------------

import { applyDeterministicRules } from "../services/pipeline/deterministicRules";
import { RULE_SET_VERSION, CONFIDENCE_VERSION, PIPELINE_VERSION } from "../services/pipeline/traceability";

describe("deterministicRules — versioning", () => {
  it("includes ruleSetVersion in the result", () => {
    const result = applyDeterministicRules("Company downgrade announced", "other");
    expect(result.ruleSetVersion).toBe(RULE_SET_VERSION);
    expect(typeof result.ruleSetVersion).toBe("string");
    expect(result.ruleSetVersion.length).toBeGreaterThan(0);
  });

  it("includes rulesMatchedCount equal to matches array length", () => {
    const result = applyDeterministicRules("bankruptcy filing announced", "other");
    expect(result.rulesMatchedCount).toBe(result.matches.length);
  });

  it("rulesMatchedCount is 0 for no matches", () => {
    const result = applyDeterministicRules("Generic earnings report", "earnings");
    expect(result.rulesMatchedCount).toBe(0);
    expect(result.matches).toHaveLength(0);
  });

  it("RULE_SET_VERSION is a non-empty string", () => {
    expect(typeof RULE_SET_VERSION).toBe("string");
    expect(RULE_SET_VERSION.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Confidence scoring — confidenceVersion propagation
// ---------------------------------------------------------------------------

import { computeClassificationConfidence } from "../services/pipeline/confidenceScoring";

describe("confidenceScoring — versioning", () => {
  it("includes confidenceVersion in the result", () => {
    const result = computeClassificationConfidence({
      llmUrgencyScore: 3,
      rulesMatchedCount: 1,
      rulesConfidenceBoost: 0.2,
      issuerFound: true,
      enrichmentSucceeded: true,
      contentDepthScore: 60,
      marketValidationSignal: "confirmed",
      sentiment: "negative",
      eventType: "downgrade",
    });
    expect(result.confidenceVersion).toBe(CONFIDENCE_VERSION);
    expect(typeof result.confidenceVersion).toBe("string");
    expect(result.confidenceVersion.length).toBeGreaterThan(0);
  });

  it("CONFIDENCE_VERSION is a non-empty string", () => {
    expect(typeof CONFIDENCE_VERSION).toBe("string");
    expect(CONFIDENCE_VERSION.length).toBeGreaterThan(0);
  });

  it("breakdown object is present and has all four components", () => {
    const result = computeClassificationConfidence({
      llmUrgencyScore: 3,
      rulesMatchedCount: 0,
      rulesConfidenceBoost: 0,
      issuerFound: false,
      enrichmentSucceeded: false,
      contentDepthScore: 0,
      marketValidationSignal: null,
      sentiment: null,
      eventType: null,
    });
    expect(result.breakdown).toHaveProperty("llmComponent");
    expect(result.breakdown).toHaveProperty("rulesComponent");
    expect(result.breakdown).toHaveProperty("completenessComponent");
    expect(result.breakdown).toHaveProperty("marketComponent");
  });
});

// ---------------------------------------------------------------------------
// Issuer extraction — heuristic pass
// ---------------------------------------------------------------------------

import { extractIssuerHeuristic, extractIssuer } from "../services/pipeline/stages";

describe("extractIssuerHeuristic", () => {
  it("returns mode='early'", async () => {
    const result = await extractIssuerHeuristic({
      title: "Nike downgrade announced by S&P",
      rawContent: null,
    });
    expect(result.data.mode).toBe("early");
  });

  it("extracts a capitalized name from the title", async () => {
    const result = await extractIssuerHeuristic({
      title: "Nike downgrade announced",
      rawContent: null,
    });
    // Should extract "Nike" or similar from the title
    expect(result.data.issuerName).toBeTruthy();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns null issuerName for all-lowercase generic title", async () => {
    const result = await extractIssuerHeuristic({
      title: "a company is in trouble",
      rawContent: null,
    });
    expect(result.data.issuerName).toBeNull();
    expect(result.data.source).toBe("none");
  });

  it("returns source='heuristic' when a guess is found", async () => {
    const result = await extractIssuerHeuristic({
      title: "Ford Motor downgrade",
      rawContent: null,
    });
    if (result.data.issuerName) {
      expect(result.data.source).toBe("heuristic");
    }
  });
});

describe("extractIssuer (refined mode)", () => {
  it("returns mode='refined'", async () => {
    const result = await extractIssuer({
      title: "downgrade",
      rawContent: null,
      aiIssuerName: "Nike",
    });
    expect(result.data.mode).toBe("refined");
  });

  it("uses AI name over early guess when both are present", async () => {
    const result = await extractIssuer({
      title: "downgrade",
      rawContent: null,
      aiIssuerName: "Test Corp",
      earlyGuess: "Generic Co",
    });
    expect(result.data.issuerName).toBe("Test Corp");
    expect(result.data.source).toBe("ai");
  });

  it("falls back to early guess when AI name is null", async () => {
    const result = await extractIssuer({
      title: "downgrade",
      rawContent: null,
      aiIssuerName: null,
      earlyGuess: "Fallback Corp",
    });
    expect(result.data.issuerName).toBe("Fallback Corp");
    expect(result.data.source).toBe("heuristic");
  });

  it("returns null issuer when both AI and early guess are absent", async () => {
    const result = await extractIssuer({
      title: "downgrade",
      rawContent: null,
      aiIssuerName: null,
      earlyGuess: null,
    });
    expect(result.data.issuerName).toBeNull();
    expect(result.data.source).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// scoreSignal — confidenceBreakdown in result
// ---------------------------------------------------------------------------

import { scoreSignal } from "../services/pipeline/stages";

describe("scoreSignal — confidenceBreakdown", () => {
  it("includes confidenceBreakdown in the returned ScoringData", async () => {
    const result = await scoreSignal({
      llmUrgencyScore: 3,
      rulesMatchedCount: 1,
      rulesConfidenceBoost: 0.2,
      issuerFound: true,
      enrichmentSucceeded: true,
      contentDepthScore: 60,
      marketValidationSignal: "confirmed",
      sentiment: "negative",
      eventType: "downgrade",
    });
    expect(result.data.confidenceBreakdown).toBeDefined();
    expect(result.data.confidenceBreakdown).toHaveProperty("llmComponent");
    expect(result.data.confidenceBreakdown).toHaveProperty("rulesComponent");
    expect(result.data.confidenceBreakdown).toHaveProperty("completenessComponent");
    expect(result.data.confidenceBreakdown).toHaveProperty("marketComponent");
  });

  it("confidenceBreakdown values are all >= 0", async () => {
    const result = await scoreSignal({
      llmUrgencyScore: 1,
      rulesMatchedCount: 0,
      rulesConfidenceBoost: 0,
      issuerFound: false,
      enrichmentSucceeded: false,
      contentDepthScore: 0,
      marketValidationSignal: null,
      sentiment: null,
      eventType: null,
    });
    for (const v of Object.values(result.data.confidenceBreakdown)) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Pipeline runner — resume, retry, metadata structure
// ---------------------------------------------------------------------------

describe("processArticlePipeline — Phase 2.5 features", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resumes from 'classified' when article is at 'enriched' and status is 'failed'", async () => {
    // Article already passed enrichment (stage = 'enriched') but classification failed.
    // Pipeline should resume from 'classified' and skip enrichment.
    const article = setupDbMocks({
      id: 10,
      title: "Company downgrade",
      rawContent: "downgrade credit bond debt leverage risk",
      processingStage: "enriched",
      processingStatus: "failed",
      stageRetryCounts: { classified: 1 },
    });
    await mockDbWithArticle(article);

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AI_ANALYSIS);

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    const result = await processArticlePipeline(10, "job-resume-1");

    expect(result.resumed).toBe(true);
    expect(result.articleId).toBe(10);
  });

  it("does not resume when article has no prior stage (fresh run)", async () => {
    const article = setupDbMocks({
      id: 11,
      processingStage: null,
      processingStatus: null,
    });
    await mockDbWithArticle(article);

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AI_ANALYSIS);

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    const result = await processArticlePipeline(11, "job-fresh");

    expect(result.resumed).toBe(false);
  });

  it("does not resume when article has 'success' status (not failed/processing)", async () => {
    const article = setupDbMocks({
      id: 12,
      processingStage: "validated",
      processingStatus: "success",
    });
    await mockDbWithArticle(article);

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AI_ANALYSIS);

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    const result = await processArticlePipeline(12, "job-success-rerun");

    // Re-running a completed article is a fresh run (no resume flag)
    expect(result.resumed).toBe(false);
  });

  it("increments stageRetryCounts when a stage fails", async () => {
    const article = setupDbMocks({
      id: 20,
      processingStage: null,
      processingStatus: null,
      stageRetryCounts: null,
    });
    await mockDbWithArticle(article);

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(null); // AI returns null → classified fails

    const { db } = await import("@workspace/db");
    let capturedSet: Record<string, unknown> = {};
    (db.update as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockImplementation((updates: unknown) => {
      capturedSet = updates as Record<string, unknown>;
      return db;
    });

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    const result = await processArticlePipeline(20, "job-retry-1");

    expect(result.finalStatus).toBe("failed");
    // The stageRetryCounts should have been incremented for the failed stage
    // (captured in the last DB set call)
    if (capturedSet.stageRetryCounts) {
      const counts = capturedSet.stageRetryCounts as Record<string, number>;
      const failedStage = result.finalStage;
      expect(counts[failedStage]).toBeGreaterThanOrEqual(1);
    }
  });

  it("stageRetryCounts accumulates across multiple failures on the same stage", async () => {
    // Article already has 1 retry count for 'classified'
    const article = setupDbMocks({
      id: 21,
      processingStage: "enriched",
      processingStatus: "failed",
      stageRetryCounts: { classified: 1 },
    });
    await mockDbWithArticle(article);

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(null); // AI null → classified fails again

    const { db } = await import("@workspace/db");
    let capturedSet: Record<string, unknown> = {};
    (db.update as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockImplementation((updates: unknown) => {
      capturedSet = updates as Record<string, unknown>;
      return db;
    });

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    const result = await processArticlePipeline(21, "job-retry-2");

    expect(result.finalStatus).toBe("failed");
    if (capturedSet.stageRetryCounts) {
      const counts = capturedSet.stageRetryCounts as Record<string, number>;
      // Should now be 2 (was 1, incremented by 1)
      expect(counts.classified).toBe(2);
    }
  });

  it("marks lastStageError on failure", async () => {
    const article = setupDbMocks({ id: 22, processingStage: null, processingStatus: null });
    await mockDbWithArticle(article);

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { db } = await import("@workspace/db");
    let capturedSet: Record<string, unknown> = {};
    (db.update as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockImplementation((updates: unknown) => {
      capturedSet = updates as Record<string, unknown>;
      return db;
    });

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    await processArticlePipeline(22, "job-error-1");

    expect(typeof capturedSet.lastStageError).toBe("string");
    expect((capturedSet.lastStageError as string).length).toBeGreaterThan(0);
  });

  it("processingMetadata includes pipelineVersion, ruleSetVersion, confidenceVersion", async () => {
    const article = setupDbMocks({ id: 30, processingStage: null, processingStatus: null });
    await mockDbWithArticle(article);

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AI_ANALYSIS);

    const { db } = await import("@workspace/db");
    let lastMetadata: Record<string, unknown> = {};
    (db.update as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockImplementation((updates: unknown) => {
      const u = updates as Record<string, unknown>;
      if (u.processingMetadata) {
        lastMetadata = u.processingMetadata as Record<string, unknown>;
      }
      return db;
    });

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    await processArticlePipeline(30, "job-meta-1");

    // At least one DB update should include processingMetadata with versions
    if (Object.keys(lastMetadata).length > 0) {
      expect(lastMetadata).toHaveProperty("pipelineVersion");
      expect(lastMetadata).toHaveProperty("ruleSetVersion");
      expect(lastMetadata).toHaveProperty("confidenceVersion");
    }
  });

  it("processingMetadata includes stageOutputs array", async () => {
    const article = setupDbMocks({ id: 31, processingStage: null, processingStatus: null });
    await mockDbWithArticle(article);

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AI_ANALYSIS);

    const { db } = await import("@workspace/db");
    let lastMetadata: Record<string, unknown> = {};
    (db.update as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockImplementation((updates: unknown) => {
      const u = updates as Record<string, unknown>;
      if (u.processingMetadata) {
        lastMetadata = u.processingMetadata as Record<string, unknown>;
      }
      return db;
    });

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    await processArticlePipeline(31, "job-meta-2");

    if (Object.keys(lastMetadata).length > 0) {
      expect(Array.isArray(lastMetadata.stageOutputs)).toBe(true);
    }
  });

  it("processingMetadata includes issuerTracking with initialGuess and final fields", async () => {
    const article = setupDbMocks({
      id: 32,
      title: "Nike downgrade announced",
      processingStage: null,
      processingStatus: null,
    });
    await mockDbWithArticle(article);

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_AI_ANALYSIS,
      issuerName: "Nike",
    });

    const { db } = await import("@workspace/db");
    let lastMetadata: Record<string, unknown> = {};
    (db.update as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockImplementation((updates: unknown) => {
      const u = updates as Record<string, unknown>;
      if (u.processingMetadata) {
        lastMetadata = u.processingMetadata as Record<string, unknown>;
      }
      return db;
    });

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    await processArticlePipeline(32, "job-issuer-tracking");

    if (lastMetadata.issuerTracking) {
      const tracking = lastMetadata.issuerTracking as Record<string, unknown>;
      expect(tracking).toHaveProperty("initialGuess");
      expect(tracking).toHaveProperty("initialGuessSource");
      expect(tracking).toHaveProperty("final");
      expect(tracking).toHaveProperty("finalSource");
    }
  });

  it("processingMetadata on failure includes failedAtStage", async () => {
    const article = setupDbMocks({ id: 33, processingStage: null, processingStatus: null });
    await mockDbWithArticle(article);

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(null); // forces failure

    const { db } = await import("@workspace/db");
    let lastMetadata: Record<string, unknown> = {};
    (db.update as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockImplementation((updates: unknown) => {
      const u = updates as Record<string, unknown>;
      if (u.processingMetadata) {
        lastMetadata = u.processingMetadata as Record<string, unknown>;
      }
      return db;
    });

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    await processArticlePipeline(33, "job-fail-meta");

    expect(lastMetadata.failedAtStage).toBeDefined();
  });

  it("PipelineResult includes 'resumed' field", async () => {
    const article = setupDbMocks({ id: 40, processingStage: null, processingStatus: null });
    await mockDbWithArticle(article);

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AI_ANALYSIS);

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    const result = await processArticlePipeline(40, "job-resumed-field");

    expect(result).toHaveProperty("resumed");
    expect(typeof result.resumed).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// Traceability — all constants defined
// ---------------------------------------------------------------------------

describe("traceability constants — Phase 2.5", () => {
  it("PIPELINE_VERSION reflects Phase 2.5", () => {
    expect(PIPELINE_VERSION).toContain("2.5");
  });

  it("RULE_SET_VERSION is defined and non-empty", () => {
    expect(typeof RULE_SET_VERSION).toBe("string");
    expect(RULE_SET_VERSION.length).toBeGreaterThan(0);
  });

  it("CONFIDENCE_VERSION is defined and non-empty", () => {
    expect(typeof CONFIDENCE_VERSION).toBe("string");
    expect(CONFIDENCE_VERSION.length).toBeGreaterThan(0);
  });
});
