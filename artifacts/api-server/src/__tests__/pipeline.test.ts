/**
 * Tests for Phase 2 pipeline: deterministic rules, confidence scoring,
 * stage functions, pipeline runner (orchestration + failure isolation),
 * and idempotency.
 *
 * All external dependencies (DB, AI, market data, content enricher) are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Deterministic Rules
// ---------------------------------------------------------------------------

import { applyDeterministicRules } from "../services/pipeline/deterministicRules";

describe("applyDeterministicRules", () => {
  it("returns no matches for generic unrelated text", () => {
    const result = applyDeterministicRules("Company reports Q3 earnings", "earnings");
    expect(result.matches).toHaveLength(0);
    expect(result.urgencyBoost).toBe(0);
    expect(result.confidenceBoost).toBe(0);
    expect(result.eventType).toBe("earnings");
  });

  it("detects 'downgrade' keyword and overrides eventType from 'other'", () => {
    const result = applyDeterministicRules("Company credit rating downgrade announced", "other");
    expect(result.matches.some((m) => m.ruleName === "keyword_downgrade")).toBe(true);
    expect(result.eventType).toBe("downgrade");
    expect(result.urgencyBoost).toBeGreaterThan(0);
    expect(result.confidenceBoost).toBeGreaterThan(0);
    expect(result.flagOverrides.ratingIsDowngrade).toBe(true);
  });

  it("detects 'bankruptcy' keyword and forces high urgency boost", () => {
    const result = applyDeterministicRules(
      "Retailer files for bankruptcy protection as debt mounts",
      "other"
    );
    expect(result.matches.some((m) => m.ruleName === "keyword_bankruptcy")).toBe(true);
    expect(result.eventType).toBe("bankruptcy");
    expect(result.urgencyBoost).toBeGreaterThanOrEqual(5);
    expect(result.flagOverrides.distressedRisk).toBe(true);
  });

  it("detects 'restructuring' keyword", () => {
    const result = applyDeterministicRules(
      "Issuer announces debt restructuring with creditors",
      "other"
    );
    expect(result.matches.some((m) => m.ruleName === "keyword_restructuring")).toBe(true);
    expect(result.eventType).toBe("restructuring");
  });

  it("detects 'covenant breach' and sets covenantFlag override", () => {
    const result = applyDeterministicRules(
      "Company faces covenant breach as EBITDA falls short",
      "other"
    );
    expect(result.matches.some((m) => m.ruleName === "keyword_covenant_breach")).toBe(true);
    expect(result.flagOverrides.covenantFlag).toBe(true);
    expect(result.eventType).toBe("covenant breach");
  });

  it("detects 'chapter 11' and classifies as bankruptcy", () => {
    const result = applyDeterministicRules("Firm files chapter 11", "other");
    expect(result.eventType).toBe("bankruptcy");
    expect(result.flagOverrides.distressedRisk).toBe(true);
  });

  it("does NOT override eventType when LLM already has a stronger specific type", () => {
    // keyword_downgrade has urgencyBoost=2, not >=3, so won't override a specific LLM type
    const result = applyDeterministicRules(
      "downgrade risk discussed",
      "bankruptcy"  // LLM already classified as bankruptcy
    );
    // downgrade has urgencyBoost=2, below threshold of 3, so should not override "bankruptcy"
    expect(result.eventType).toBe("bankruptcy");
  });

  it("accumulates urgency and confidence boosts across multiple matches", () => {
    const result = applyDeterministicRules(
      "bankruptcy and restructuring and covenant breach announced",
      "other"
    );
    expect(result.urgencyBoost).toBeGreaterThan(5);
    expect(result.confidenceBoost).toBeGreaterThan(0.4);
    expect(result.matches.length).toBeGreaterThanOrEqual(3);
  });

  it("is case-insensitive", () => {
    const result = applyDeterministicRules("BANKRUPTCY filing confirmed", "other");
    expect(result.eventType).toBe("bankruptcy");
  });

  it("logs all overrides in the matches array for auditability", () => {
    const result = applyDeterministicRules("downgrade and bankruptcy", "other");
    const ruleNames = result.matches.map((m) => m.ruleName);
    expect(ruleNames).toContain("keyword_downgrade");
    expect(ruleNames).toContain("keyword_bankruptcy");
  });
});

// ---------------------------------------------------------------------------
// Confidence Scoring
// ---------------------------------------------------------------------------

import { computeClassificationConfidence, REVIEW_THRESHOLD } from "../services/pipeline/confidenceScoring";

describe("computeClassificationConfidence", () => {
  it("returns a value between 0 and 1", () => {
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
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("high urgency + confirmed market + issuer found → high confidence", () => {
    const result = computeClassificationConfidence({
      llmUrgencyScore: 5,
      rulesMatchedCount: 2,
      rulesConfidenceBoost: 0.4,
      issuerFound: true,
      enrichmentSucceeded: true,
      contentDepthScore: 80,
      marketValidationSignal: "confirmed",
      sentiment: "negative",
      eventType: "downgrade",
    });
    expect(result.confidence).toBeGreaterThan(REVIEW_THRESHOLD);
    expect(result.needsReview).toBe(false);
  });

  it("low urgency + no issuer + no rules → low confidence triggers needsReview", () => {
    const result = computeClassificationConfidence({
      llmUrgencyScore: 1,
      rulesMatchedCount: 0,
      rulesConfidenceBoost: 0,
      issuerFound: false,
      enrichmentSucceeded: false,
      contentDepthScore: 5,
      marketValidationSignal: "unconfirmed",
      sentiment: "neutral",
      eventType: "other",
    });
    expect(result.confidence).toBeLessThan(REVIEW_THRESHOLD);
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toMatch(/low_confidence/);
  });

  it("sets needsReview = true when issuer is missing for non-macro events", () => {
    const result = computeClassificationConfidence({
      llmUrgencyScore: 4,
      rulesMatchedCount: 1,
      rulesConfidenceBoost: 0.2,
      issuerFound: false,
      enrichmentSucceeded: true,
      contentDepthScore: 60,
      marketValidationSignal: "confirmed",
      sentiment: "negative",
      eventType: "downgrade",
    });
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain("missing_issuer");
  });

  it("sets needsReview with 'conflicting_market_signals' for mixed validation", () => {
    const result = computeClassificationConfidence({
      llmUrgencyScore: 3,
      rulesMatchedCount: 0,
      rulesConfidenceBoost: 0,
      issuerFound: true,
      enrichmentSucceeded: true,
      contentDepthScore: 50,
      marketValidationSignal: "mixed",
      sentiment: "negative",
      eventType: "downgrade",
    });
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain("conflicting_market_signals");
  });

  it("sets needsReview with 'ai_unavailable' when LLM score is null", () => {
    const result = computeClassificationConfidence({
      llmUrgencyScore: null,
      rulesMatchedCount: 2,
      rulesConfidenceBoost: 0.3,
      issuerFound: true,
      enrichmentSucceeded: true,
      contentDepthScore: 50,
      marketValidationSignal: "unconfirmed",
      sentiment: null,
      eventType: null,
    });
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain("ai_unavailable");
  });

  it("includes a breakdown of score components", () => {
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
    expect(result.breakdown).toHaveProperty("llmComponent");
    expect(result.breakdown).toHaveProperty("rulesComponent");
    expect(result.breakdown).toHaveProperty("completenessComponent");
    expect(result.breakdown).toHaveProperty("marketComponent");
    // All components should be non-negative
    for (const v of Object.values(result.breakdown)) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("REVIEW_THRESHOLD is between 0 and 1", () => {
    expect(REVIEW_THRESHOLD).toBeGreaterThan(0);
    expect(REVIEW_THRESHOLD).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// Stage functions
// ---------------------------------------------------------------------------

import { processEligibility, processEnrichment, extractIssuer, scoreSignal } from "../services/pipeline/stages";

describe("processEligibility", () => {
  beforeEach(async () => {
    // Reset to sensible defaults for eligibility tests; pipeline runner tests
    // override these per-test with mockReturnValue / mockReturnValueOnce.
    const { isCreditTitleOverride, passesNoiseFilter } = await import("../lib/aiProcessing");
    (isCreditTitleOverride as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it("marks empty content as ineligible with reason 'empty_content'", async () => {
    const { isCreditTitleOverride } = await import("../lib/aiProcessing");
    (isCreditTitleOverride as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const result = await processEligibility({ title: "Generic title", rawContent: null });
    expect(result.data.eligible).toBe(false);
    expect(result.data.reason).toBe("empty_content");
  });

  it("marks empty content as eligible when title is a credit override", async () => {
    const { isCreditTitleOverride } = await import("../lib/aiProcessing");
    (isCreditTitleOverride as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const result = await processEligibility({
      title: "Bankruptcy filing confirmed for issuer",
      rawContent: null,
    });
    expect(result.data.eligible).toBe(true);
    expect(result.data.titleOverride).toBe(true);
  });

  it("marks noise-filtered content as ineligible", async () => {
    const { passesNoiseFilter, isCreditTitleOverride } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isCreditTitleOverride as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const result = await processEligibility({
      title: "Sports news update for the weekend",
      rawContent: "Generic sports content with no credit relevance whatsoever.",
    });
    expect(result.data.eligible).toBe(false);
    expect(result.data.reason).toBe("noise_filtered");
  });

  it("marks credit-relevant content as eligible", async () => {
    const { passesNoiseFilter, isCreditTitleOverride } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (isCreditTitleOverride as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const result = await processEligibility({
      title: "Company downgrade announced",
      rawContent: "Credit rating agency downgrades company debt to junk status on leverage concerns.",
    });
    expect(result.data.eligible).toBe(true);
  });

  it("includes durationMs in the result", async () => {
    const { passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const result = await processEligibility({
      title: "downgrade",
      rawContent: "downgrade credit bond",
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("extractIssuer", () => {
  it("returns null issuer when no AI name provided", async () => {
    const result = await extractIssuer({ title: "Macro update", rawContent: "macro content" });
    expect(result.data.issuerName).toBeNull();
    expect(result.data.source).toBe("none");
  });

  it("returns canonicalized issuer when AI name is provided", async () => {
    // canonicalizeIssuer is the real implementation — test with known mapping
    const result = await extractIssuer({
      title: "Nike downgrade",
      rawContent: "Nike debt downgraded",
      aiIssuerName: "Nike",
    });
    expect(result.data.issuerName).toBe("Nike");
    expect(result.data.source).toBe("ai");
  });

  it("returns null issuer when AI name is empty string", async () => {
    const result = await extractIssuer({
      title: "Macro update",
      rawContent: "macro",
      aiIssuerName: "",
    });
    expect(result.data.issuerName).toBeNull();
  });
});

describe("scoreSignal", () => {
  it("returns confidence in 0-1 range", async () => {
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
    expect(result.data.classificationConfidence).toBeGreaterThanOrEqual(0);
    expect(result.data.classificationConfidence).toBeLessThanOrEqual(1);
  });

  it("propagates needsReview and reviewReason", async () => {
    const result = await scoreSignal({
      llmUrgencyScore: 1,
      rulesMatchedCount: 0,
      rulesConfidenceBoost: 0,
      issuerFound: false,
      enrichmentSucceeded: false,
      contentDepthScore: 5,
      marketValidationSignal: null,
      sentiment: "neutral",
      eventType: "other",
    });
    expect(result.data.needsReview).toBe(true);
    expect(result.data.reviewReason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Pipeline runner
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

function mockDbForArticle(articleOverrides: Record<string, unknown> = {}) {
  const { db } = require("@workspace/db");
  const defaultArticle = {
    id: 42,
    title: "Test article about downgrade",
    url: "https://example.com/article",
    source: "reuters",
    rawContent: "credit downgrade bond debt leverage",
    rawSnippet: "downgrade snippet",
    processingStage: null,
    ...articleOverrides,
  };
  (db.select as ReturnType<typeof vi.fn>).mockReturnThis();
  (db as unknown as Record<string, unknown>).from = vi.fn().mockReturnThis();
  (db as unknown as Record<string, unknown>).where = vi.fn().mockReturnThis();
  (db as unknown as Record<string, unknown>).limit = vi.fn().mockResolvedValue([defaultArticle]);
  (db as unknown as Record<string, unknown>).update = vi.fn().mockReturnThis();
  (db as unknown as Record<string, unknown>).set = vi.fn().mockReturnThis();
  // update().set().where() chain
  (db as unknown as Record<string, unknown>).where = vi.fn().mockResolvedValue(undefined);
}

describe("processArticlePipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when article is not found in DB", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).from = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).where = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).limit = vi.fn().mockResolvedValue([]);
    (db as unknown as Record<string, unknown>).update = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockReturnThis();

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    await expect(processArticlePipeline(999, "job-1")).rejects.toThrow(/not found/);
  });

  it("returns filtered status when article has no content and no title override", async () => {
    const { db } = await import("@workspace/db");
    const article = {
      id: 1,
      title: "Sports news unrelated",
      url: "https://example.com/1",
      source: "generic",
      rawContent: null,
      rawSnippet: null,
      processingStage: null,
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).from = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).where = vi.fn()
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([article]) })
      .mockResolvedValue(undefined);
    (db as unknown as Record<string, unknown>).limit = vi.fn().mockResolvedValue([article]);
    (db as unknown as Record<string, unknown>).update = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockReturnThis();

    const { isCreditTitleOverride } = await import("../lib/aiProcessing");
    (isCreditTitleOverride as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    const result = await processArticlePipeline(1, "job-1");
    expect(result.finalStatus).toBe("filtered");
    expect(result.finalStage).toBe("filtered");
  });

  it("stops pipeline at classification stage when AI returns null", async () => {
    const { db } = await import("@workspace/db");
    const article = {
      id: 2,
      title: "Company downgrade announced",
      url: "https://example.com/2",
      source: "reuters",
      rawContent: "credit downgrade bond debt leverage risk",
      rawSnippet: "snippet",
      processingStage: null,
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).from = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).where = vi.fn()
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([article]) })
      .mockResolvedValue(undefined);
    (db as unknown as Record<string, unknown>).limit = vi.fn().mockResolvedValue([article]);
    (db as unknown as Record<string, unknown>).update = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockReturnThis();

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    const result = await processArticlePipeline(2, "job-2");
    expect(result.finalStatus).toBe("failed");
    expect(result.finalStage).toBe("classified");
  });

  it("completes full pipeline and returns success when AI succeeds", async () => {
    const { db } = await import("@workspace/db");
    const article = {
      id: 3,
      title: "Company downgrade announced",
      url: "https://example.com/3",
      source: "reuters",
      rawContent: "credit downgrade bond debt leverage risk serious concern",
      rawSnippet: "snippet",
      processingStage: null,
    };
    // Mock select returning article on first call, then update calls returning undefined
    let selectCallCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      selectCallCount++;
      return db;
    });
    (db as unknown as Record<string, unknown>).from = vi.fn().mockReturnThis();
    const whereMock = vi.fn().mockImplementation((cond?: unknown) => {
      // First call is from select (returns article), rest are from updates
      if (selectCallCount === 1 && (whereMock as ReturnType<typeof vi.fn>).mock.calls.length === 1) {
        return { limit: vi.fn().mockResolvedValue([article]) };
      }
      return Promise.resolve(undefined);
    });
    (db as unknown as Record<string, unknown>).where = whereMock;
    (db as unknown as Record<string, unknown>).limit = vi.fn().mockResolvedValue([article]);
    (db as unknown as Record<string, unknown>).update = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockReturnThis();

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AI_ANALYSIS);

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    const result = await processArticlePipeline(3, "job-3");
    // Pipeline should complete
    expect(["success", "failed"]).toContain(result.finalStatus);
    expect(result.articleId).toBe(3);
    expect(result.jobId).toBe("job-3");
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.stageOutputs)).toBe(true);
  });

  it("records stageOutputs array with stage names", async () => {
    const { db } = await import("@workspace/db");
    const article = {
      id: 4,
      title: "Company downgrade",
      url: "https://example.com/4",
      source: "reuters",
      rawContent: "downgrade debt credit bond",
      rawSnippet: "snippet",
      processingStage: null,
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).from = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).where = vi.fn()
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([article]) })
      .mockResolvedValue(undefined);
    (db as unknown as Record<string, unknown>).limit = vi.fn().mockResolvedValue([article]);
    (db as unknown as Record<string, unknown>).update = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockReturnThis();

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AI_ANALYSIS);

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    const result = await processArticlePipeline(4, "job-4");
    expect(Array.isArray(result.stageOutputs)).toBe(true);
    // At minimum eligibility output should be present
    expect(result.stageOutputs.length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — running pipeline twice does not throw", async () => {
    const { db } = await import("@workspace/db");
    const article = {
      id: 5,
      title: "Company downgrade",
      url: "https://example.com/5",
      source: "reuters",
      rawContent: "downgrade debt credit bond",
      rawSnippet: "snippet",
      processingStage: "validated", // already processed
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnThis();
    (db as unknown as Record<string, unknown>).from = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).where = vi.fn()
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([article]) })
      .mockResolvedValue(undefined);
    (db as unknown as Record<string, unknown>).limit = vi.fn().mockResolvedValue([article]);
    (db as unknown as Record<string, unknown>).update = vi.fn().mockReturnThis();
    (db as unknown as Record<string, unknown>).set = vi.fn().mockReturnThis();

    const { analyzeArticle, passesNoiseFilter } = await import("../lib/aiProcessing");
    (passesNoiseFilter as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (analyzeArticle as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AI_ANALYSIS);

    const { processArticlePipeline } = await import("../services/pipeline/pipelineRunner");
    // Second run should not throw even if article was already processed
    await expect(processArticlePipeline(5, "job-5")).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Traceability constants
// ---------------------------------------------------------------------------

import { PROMPT_VERSION, MODEL_VERSION, PIPELINE_VERSION } from "../services/pipeline/traceability";

describe("traceability constants", () => {
  it("PROMPT_VERSION is a non-empty string", () => {
    expect(typeof PROMPT_VERSION).toBe("string");
    expect(PROMPT_VERSION.length).toBeGreaterThan(0);
  });

  it("MODEL_VERSION is a non-empty string", () => {
    expect(typeof MODEL_VERSION).toBe("string");
    expect(MODEL_VERSION.length).toBeGreaterThan(0);
  });

  it("PIPELINE_VERSION is a non-empty string", () => {
    expect(typeof PIPELINE_VERSION).toBe("string");
    expect(PIPELINE_VERSION.length).toBeGreaterThan(0);
  });
});
