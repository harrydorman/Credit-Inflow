/**
 * pipeline/pipelineRunner.ts
 *
 * Orchestrates the full article processing pipeline for a single article.
 *
 * processArticlePipeline(articleId, jobId):
 *   1. Loads the article from the DB
 *   2. Sets processingStatus = "processing" + processingStartedAt
 *   3. Executes stages in sequence, persisting DB updates after each step
 *   4. On per-stage failure: marks failed/filtered, stops pipeline
 *   5. On success: marks processingStatus = "success", processingCompletedAt
 *
 * Each stage runs independently — a failure stops subsequent stages but
 * does NOT roll back earlier persisted updates (partial completion is
 * intentional and recoverable via backfill or re-run).
 */
import { eq } from "drizzle-orm";
import { db, articlesTable } from "@workspace/db";
import { logger as rootLogger } from "../../lib/logger";
import type { Logger } from "pino";
import {
  processEligibility,
  processEnrichment,
  extractIssuer,
  classifyEvent,
  scoreSignal,
  validateAgainstMarket,
  PipelineStageError,
} from "./stages";
import type {
  PipelineResult,
  ProcessingStage,
  StageOutput,
  EligibilityData,
  EnrichmentData,
  IssuerData,
  ClassificationData,
  ScoringData,
  MarketValidationData,
} from "./types";
import { PIPELINE_VERSION, PROMPT_VERSION, MODEL_VERSION } from "./traceability";
import { sanitizeNullStr } from "../ingestionService";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Processes a single article through the full stage pipeline.
 *
 * Designed to be called:
 *  - During ingestion (inline, right after DB insert)
 *  - By a backfill job (on articles stuck at "raw" or "failed")
 *  - For re-processing (idempotent: later pipeline runs overwrite earlier data)
 *
 * @param articleId  Database primary key of the article.
 * @param jobId      Parent job ID (for log correlation).
 * @param log        Optional logger child (inherits jobId context if provided).
 */
export async function processArticlePipeline(
  articleId: number,
  jobId: string,
  log?: Logger
): Promise<PipelineResult> {
  const pipelineLog = (log ?? rootLogger).child({ jobId, articleId, pipeline: PIPELINE_VERSION });
  const pipelineStart = Date.now();
  const stageOutputs: StageOutput[] = [];

  // ── Load article ───────────────────────────────────────────────────────────
  const [article] = await db
    .select({
      id: articlesTable.id,
      title: articlesTable.title,
      url: articlesTable.url,
      source: articlesTable.source,
      rawContent: articlesTable.rawContent,
      rawSnippet: articlesTable.rawSnippet,
      processingStage: articlesTable.processingStage,
    })
    .from(articlesTable)
    .where(eq(articlesTable.id, articleId))
    .limit(1);

  if (!article) {
    throw new Error(`processArticlePipeline: article ${articleId} not found`);
  }

  // ── Mark as in-progress ────────────────────────────────────────────────────
  await db
    .update(articlesTable)
    .set({
      processingStatus: "processing",
      processingStartedAt: new Date(),
      pipelineVersion: PIPELINE_VERSION,
      promptVersion: PROMPT_VERSION,
      modelVersion: MODEL_VERSION,
    })
    .where(eq(articlesTable.id, articleId));

  pipelineLog.info({ stage: "start" }, "pipeline: starting");

  // ── State accumulated across stages ───────────────────────────────────────
  let eligibilityData: EligibilityData | null = null;
  let enrichmentData: EnrichmentData | null = null;
  let issuerData: IssuerData | null = null;
  let classificationData: ClassificationData | null = null;
  let scoringData: ScoringData | null = null;
  let marketData: MarketValidationData | null = null;

  // ── Helper: record stage output and persist current stage ─────────────────
  async function persistStage(
    stage: ProcessingStage,
    output: StageOutput,
    updates: Record<string, unknown>
  ): Promise<void> {
    stageOutputs.push(output);
    await db
      .update(articlesTable)
      .set({
        processingStage: stage,
        lastProcessedAt: new Date(),
        processingMetadata: buildMetadata(stageOutputs, updates),
        ...updates,
      } as Parameters<typeof db.update>[0] extends infer T ? Record<string, unknown> : never)
      .where(eq(articlesTable.id, articleId));
  }

  // ── Helper: build processingMetadata JSON ─────────────────────────────────
  function buildMetadata(
    outputs: StageOutput[],
    extra?: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      pipelineVersion: PIPELINE_VERSION,
      stageOutputs: outputs,
      ...extra,
    };
  }

  // =========================================================================
  // Stage 1: Eligibility
  // =========================================================================
  {
    const stageStart = Date.now();
    pipelineLog.info({ stage: "eligibility" }, "pipeline: stage start");
    try {
      const result = await processEligibility({
        title: article.title,
        rawContent: article.rawContent,
      });
      eligibilityData = result.data;
      const durationMs = Date.now() - stageStart;

      if (!eligibilityData.eligible) {
        const stageOut: StageOutput = {
          stage: "filtered",
          durationMs,
          success: false,
          error: eligibilityData.reason,
        };
        await persistStage("filtered", stageOut, {
          processingStatus: "filtered",
          processingError: eligibilityData.reason ?? "filtered",
          processingCompletedAt: new Date(),
        });
        pipelineLog.info(
          { stage: "eligibility", reason: eligibilityData.reason, durationMs },
          "pipeline: article filtered"
        );
        return {
          articleId,
          jobId,
          finalStage: "filtered",
          finalStatus: "filtered",
          totalDurationMs: Date.now() - pipelineStart,
          stageOutputs,
        };
      }

      const stageOut: StageOutput = {
        stage: "enriched",
        durationMs,
        success: true,
        data: eligibilityData as unknown as Record<string, unknown>,
      };
      stageOutputs.push(stageOut);
      pipelineLog.info({ stage: "eligibility", durationMs }, "pipeline: stage complete");
    } catch (err) {
      return await handleStageError("enriched", err, pipelineStart, stageStart, stageOutputs, articleId, pipelineLog, jobId);
    }
  }

  // =========================================================================
  // Stage 2: Enrichment
  // =========================================================================
  {
    const stageStart = Date.now();
    pipelineLog.info({ stage: "enrichment" }, "pipeline: stage start");
    try {
      const result = await processEnrichment({
        url: article.url,
        source: article.source,
        rawSnippet: article.rawSnippet ?? article.rawContent ?? "",
      });
      enrichmentData = result.data;
      const durationMs = Date.now() - stageStart;
      const stageOut: StageOutput = {
        stage: "enriched",
        durationMs,
        success: true,
        data: {
          contentSourceType: enrichmentData.contentSourceType,
          contentDepthScore: enrichmentData.contentDepthScore,
          rawContentLength: enrichmentData.rawContent.length,
        },
      };
      await persistStage("enriched", stageOut, {
        rawContent: enrichmentData.rawContent,
        contentSourceType: enrichmentData.contentSourceType,
        contentDepthScore: enrichmentData.contentDepthScore,
      });
      pipelineLog.info(
        { stage: "enrichment", contentDepthScore: enrichmentData.contentDepthScore, durationMs },
        "pipeline: stage complete"
      );
    } catch (err) {
      return await handleStageError("enriched", err, pipelineStart, stageStart, stageOutputs, articleId, pipelineLog, jobId);
    }
  }

  // Re-check eligibility after enrichment (content may have changed)
  {
    const recheckContent = enrichmentData?.rawContent ?? article.rawContent;
    const noiseRecheck = (recheckContent?.trim().length ?? 0) > 0;
    if (!noiseRecheck && !eligibilityData?.titleOverride) {
      await db.update(articlesTable).set({
        processingStage: "filtered",
        processingStatus: "filtered",
        processingError: "empty_content_after_enrichment",
        processingCompletedAt: new Date(),
      }).where(eq(articlesTable.id, articleId));
      return {
        articleId, jobId,
        finalStage: "filtered",
        finalStatus: "filtered",
        totalDurationMs: Date.now() - pipelineStart,
        stageOutputs,
      };
    }
  }

  // =========================================================================
  // Stage 3: Issuer identification (pre-AI pass — will be refined in stage 4)
  // =========================================================================
  // We call extractIssuer again after classification with the AI-provided name.
  // This first pass stores a placeholder; stage 4 will refine it.

  // =========================================================================
  // Stage 4: Classification (AI + deterministic rules)
  // =========================================================================
  {
    const stageStart = Date.now();
    pipelineLog.info({ stage: "classification" }, "pipeline: stage start");
    try {
      const result = await classifyEvent({
        title: article.title,
        rawContent: enrichmentData?.rawContent ?? article.rawContent,
      });
      classificationData = result.data;
      const durationMs = Date.now() - stageStart;

      // Now run issuer identification with AI-extracted name
      const issuerResult = await extractIssuer({
        title: article.title,
        rawContent: enrichmentData?.rawContent ?? article.rawContent,
        aiIssuerName: classificationData.aiAnalysis.issuerName,
      });
      issuerData = issuerResult.data;

      const stageOut: StageOutput = {
        stage: "classified",
        durationMs,
        success: true,
        data: {
          eventType: classificationData.eventType,
          sector: classificationData.sector,
          sentiment: classificationData.sentiment,
          rulesMatched: classificationData.ruleOverrides.length,
          ruleNames: classificationData.ruleOverrides.map((r) => r.ruleName),
          issuerName: issuerData.issuerName,
          issuerSource: issuerData.source,
        },
      };

      const ai = classificationData.aiAnalysis;
      await persistStage("classified", stageOut, {
        summary: sanitizeNullStr(ai.summary),
        sector: sanitizeNullStr(ai.sector),
        eventType: sanitizeNullStr(classificationData.eventType),
        sentiment: sanitizeNullStr(ai.sentiment),
        whyItMatters: sanitizeNullStr(ai.whyItMatters),
        whoCares: ai.whoCares.join(", ") || null,
        issuerName: issuerData.issuerName,
        urgencyScore: ai.urgencyScore,
        finalUrgencyScore: classificationData.finalUrgencyScore,
        creditSignalScore: ai.creditSignalScore,
        covenantFlag: ai.covenantFlag,
        covenantType: sanitizeNullStr(ai.covenantType),
        ratingMentioned: sanitizeNullStr(ai.ratingMentioned),
        ratingAgency: sanitizeNullStr(ai.ratingAgency),
        ratingIsDowngrade: ai.ratingIsDowngrade,
        ratingIsUpgrade: ai.ratingIsUpgrade,
        ratingIsCCCThreshold: ai.ratingIsCCCThreshold,
        leverageMentioned: ai.leverageMentioned,
        liquidityConcern: ai.liquidityConcern,
        refinancingRisk: ai.refinancingRisk,
        earningsMiss: ai.earningsMiss,
        cloImpact: ai.cloImpact,
        cloRelevance: sanitizeNullStr(ai.cloRelevance),
        cloLoanVsBond: sanitizeNullStr(ai.cloLoanVsBond),
        cloWarfImpact: sanitizeNullStr(ai.cloWarfImpact),
        cloCCCBucketRisk: ai.cloCCCBucketRisk,
        cloExplanation: sanitizeNullStr(ai.cloExplanation),
        cloImpactTypes: ai.cloImpactTypes,
        spreadWideningRisk: ai.spreadWideningRisk,
        forcedSellingRisk: ai.forcedSellingRisk,
        distressedRisk: ai.distressedRisk,
        tradeDirection: sanitizeNullStr(ai.tradeDirection),
        tradeRationale: sanitizeNullStr(ai.tradeRationale),
        potentialTrades: ai.potentialTrades,
        marketsImpacted: ai.marketsImpacted,
        marketImpact: sanitizeNullStr(ai.marketImpact),
        creditSummaryJson: ai.creditSummary ?? null,
        scoreExplanationJson: ai.scoreExplanation ?? null,
        processedAt: new Date(),
      });

      pipelineLog.info(
        {
          stage: "classification",
          eventType: classificationData.eventType,
          rulesMatched: classificationData.ruleOverrides.length,
          issuerName: issuerData.issuerName,
          durationMs,
        },
        "pipeline: stage complete"
      );
    } catch (err) {
      return await handleStageError("classified", err, pipelineStart, stageStart, stageOutputs, articleId, pipelineLog, jobId);
    }
  }

  // =========================================================================
  // Stage 5: Scoring (confidence + review flag)
  // =========================================================================
  {
    const stageStart = Date.now();
    pipelineLog.info({ stage: "scoring" }, "pipeline: stage start");
    try {
      const result = await scoreSignal({
        llmUrgencyScore: classificationData!.aiAnalysis.urgencyScore,
        rulesMatchedCount: classificationData!.ruleOverrides.length,
        rulesConfidenceBoost: classificationData!.ruleOverrides.reduce(
          (sum, r) => sum + r.confidenceBoost,
          0
        ),
        issuerFound: !!issuerData?.issuerName,
        enrichmentSucceeded:
          (enrichmentData?.contentSourceType ?? "rss_snippet") !== "rss_snippet",
        contentDepthScore: enrichmentData?.contentDepthScore ?? 0,
        marketValidationSignal: null, // market validation not run yet
        sentiment: classificationData!.sentiment,
        eventType: classificationData!.eventType,
      });
      scoringData = result.data;
      const durationMs = Date.now() - stageStart;

      const stageOut: StageOutput = {
        stage: "scored",
        durationMs,
        success: true,
        data: {
          classificationConfidence: scoringData.classificationConfidence,
          needsReview: scoringData.needsReview,
          reviewReason: scoringData.reviewReason,
        },
      };
      await persistStage("scored", stageOut, {
        classificationConfidence: scoringData.classificationConfidence,
        needsReview: scoringData.needsReview,
        reviewReason: scoringData.reviewReason,
      });
      pipelineLog.info(
        {
          stage: "scoring",
          confidence: scoringData.classificationConfidence.toFixed(3),
          needsReview: scoringData.needsReview,
          reviewReason: scoringData.reviewReason,
          durationMs,
        },
        "pipeline: stage complete"
      );
    } catch (err) {
      return await handleStageError("scored", err, pipelineStart, stageStart, stageOutputs, articleId, pipelineLog, jobId);
    }
  }

  // =========================================================================
  // Stage 6: Market validation
  // =========================================================================
  {
    const stageStart = Date.now();
    pipelineLog.info({ stage: "market_validation" }, "pipeline: stage start");
    try {
      const result = await validateAgainstMarket({
        issuerName: issuerData?.issuerName ?? null,
        sentiment: classificationData!.sentiment,
        finalUrgencyScore: classificationData!.finalUrgencyScore,
        creditSignalScore: classificationData!.creditSignalScore,
      });
      marketData = result.data;
      const durationMs = Date.now() - stageStart;

      // Re-score confidence now that we have market validation data
      const refinedScoring = await scoreSignal({
        llmUrgencyScore: classificationData!.aiAnalysis.urgencyScore,
        rulesMatchedCount: classificationData!.ruleOverrides.length,
        rulesConfidenceBoost: classificationData!.ruleOverrides.reduce(
          (sum, r) => sum + r.confidenceBoost,
          0
        ),
        issuerFound: !!issuerData?.issuerName,
        enrichmentSucceeded:
          (enrichmentData?.contentSourceType ?? "rss_snippet") !== "rss_snippet",
        contentDepthScore: enrichmentData?.contentDepthScore ?? 0,
        marketValidationSignal: marketData.validationSignal,
        sentiment: classificationData!.sentiment,
        eventType: classificationData!.eventType,
      });
      scoringData = refinedScoring.data;

      const stageOut: StageOutput = {
        stage: "validated",
        durationMs,
        success: true,
        data: {
          validationSignal: marketData.validationSignal,
          stockMove1D: marketData.stockMove1D,
          hyETFMove: marketData.hyETFMove,
          refinedConfidence: scoringData.classificationConfidence,
        },
      };

      const totalDurationMs = Date.now() - pipelineStart;
      await persistStage("validated", stageOut, {
        stockMove1D: marketData.stockMove1D,
        stockMove5D: marketData.stockMove5D,
        hyETFMove: marketData.hyETFMove,
        marketValidationSignal: marketData.validationSignal,
        confidenceScore: marketData.confidenceScore,
        // Update confidence with market-refined score
        classificationConfidence: scoringData.classificationConfidence,
        needsReview: scoringData.needsReview,
        reviewReason: scoringData.reviewReason,
        // Final pipeline state
        processingStatus: "success",
        processingCompletedAt: new Date(),
      });

      pipelineLog.info(
        {
          stage: "market_validation",
          validationSignal: marketData.validationSignal,
          finalConfidence: scoringData.classificationConfidence.toFixed(3),
          needsReview: scoringData.needsReview,
          totalDurationMs,
          durationMs,
        },
        "pipeline: complete"
      );

      return {
        articleId,
        jobId,
        finalStage: "validated",
        finalStatus: "success",
        totalDurationMs,
        stageOutputs,
        classificationConfidence: scoringData.classificationConfidence,
        needsReview: scoringData.needsReview,
      };
    } catch (err) {
      return await handleStageError("validated", err, pipelineStart, stageStart, stageOutputs, articleId, pipelineLog, jobId);
    }
  }
}

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

async function handleStageError(
  stage: ProcessingStage,
  err: unknown,
  pipelineStart: number,
  stageStart: number,
  stageOutputs: StageOutput[],
  articleId: number,
  log: Logger,
  jobId: string
): Promise<PipelineResult> {
  const durationMs = Date.now() - stageStart;
  const errorMessage =
    err instanceof PipelineStageError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);

  stageOutputs.push({
    stage,
    durationMs,
    success: false,
    error: errorMessage,
  });

  log.error({ stage, err, durationMs }, `pipeline: stage failed`);

  await db
    .update(articlesTable)
    .set({
      processingStatus: "failed",
      processingError: errorMessage,
      processingStage: stage,
      lastProcessedAt: new Date(),
      processingMetadata: {
        pipelineVersion: PIPELINE_VERSION,
        stageOutputs,
        failedAtStage: stage,
      },
    })
    .where(eq(articlesTable.id, articleId));

  return {
    articleId,
    jobId,
    finalStage: stage,
    finalStatus: "failed",
    totalDurationMs: Date.now() - pipelineStart,
    stageOutputs,
  };
}
