/**
 * pipeline/pipelineRunner.ts
 *
 * Orchestrates the full article processing pipeline for a single article.
 *
 * processArticlePipeline(articleId, jobId):
 *   1. Loads the article from the DB
 *   2. Detects whether a prior partial run exists and resumes from the next stage
 *   3. Executes stages in sequence, persisting DB updates after each step
 *   4. On per-stage failure: increments stage retry count; when max retries
 *      reached marks article permanently failed; otherwise marks failed for retry
 *   5. On success: marks processingStatus = "success", processingCompletedAt
 *
 * Stage order (Phase 2.5):
 *   eligibility → enrichment → early_issuer_guess → classification
 *   → issuer_refinement → scoring → market_validation
 *
 * Resume logic:
 *   - If processingStage is already set and processingStatus is "failed" or
 *     "processing", the runner skips already-completed stages and resumes
 *     from the next stage after the last successfully persisted one.
 *   - Earlier stage data (enriched content, etc.) is re-loaded from the DB
 *     row so the resume path is data-consistent.
 *
 * Idempotency:
 *   Running the pipeline twice on the same article is safe. A fresh run
 *   overwrites prior stage data for stages that are re-run.
 */
import { eq } from "drizzle-orm";
import { db, articlesTable } from "@workspace/db";
import { logger as rootLogger } from "../../lib/logger";
import type { Logger } from "pino";
import {
  processEligibility,
  processEnrichment,
  extractIssuerHeuristic,
  extractIssuer,
  classifyEvent,
  scoreSignal,
  validateAgainstMarket,
  PipelineStageError,
} from "./stages";
import type {
  PipelineResult,
  ProcessingStage,
  ProcessingMetadata,
  StageOutput,
  EligibilityData,
  EnrichmentData,
  IssuerData,
  IssuerTracking,
  ClassificationData,
  ScoringData,
  MarketValidationData,
} from "./types";
import { STAGE_ORDER, getNextStage, STAGE_RETRY_MAX } from "./types";
import { PIPELINE_VERSION, PROMPT_VERSION, MODEL_VERSION, RULE_SET_VERSION, CONFIDENCE_VERSION } from "./traceability";
import { sanitizeNullStr } from "../../lib/stringUtils";
import { evaluateAlertsForArticle } from "../alertEvaluationService";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Processes a single article through the full stage pipeline.
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
      processingStatus: articlesTable.processingStatus,
      stageRetryCounts: articlesTable.stageRetryCounts,
    })
    .from(articlesTable)
    .where(eq(articlesTable.id, articleId))
    .limit(1);

  if (!article) {
    throw new Error(`processArticlePipeline: article ${articleId} not found`);
  }

  // ── Determine resume point ─────────────────────────────────────────────────
  const priorStage = article.processingStage as ProcessingStage | null;
  const priorStatus = article.processingStatus;
  const isResume =
    priorStage !== null &&
    priorStage !== "filtered" &&
    (priorStatus === "failed" || priorStatus === "processing");

  // The first stage to (re-)run. On a fresh run this is always "enriched".
  // On a resume it is the stage AFTER the last successfully persisted one.
  const resumeFromStage: ProcessingStage =
    isResume && priorStage ? (getNextStage(priorStage) ?? "enriched") : "enriched";

  if (isResume) {
    pipelineLog.info(
      { priorStage, priorStatus, resumeFromStage },
      "pipeline: resuming from prior partial run"
    );
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

  pipelineLog.info({ stage: "start", isResume, resumeFromStage }, "pipeline: starting");

  // ── Current retry counts (preserve across resume) ─────────────────────────
  const retryCounts: Record<string, number> = { ...(article.stageRetryCounts ?? {}) };

  // ── State accumulated across stages ───────────────────────────────────────
  let eligibilityData: EligibilityData | null = null;
  let enrichmentData: EnrichmentData | null = null;
  let earlyIssuerData: IssuerData | null = null;
  let issuerData: IssuerData | null = null;
  let classificationData: ClassificationData | null = null;
  let scoringData: ScoringData | null = null;
  let marketData: MarketValidationData | null = null;

  // On resume, pre-populate rawContent from the DB row so downstream stages
  // that depend on enriched content can still access it.
  if (isResume && article.rawContent) {
    enrichmentData = {
      rawContent: article.rawContent,
      contentSourceType: "rss_snippet", // conservative fallback; actual type is in metadata
      contentDepthScore: 0,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Returns true when a stage should be skipped because it was already completed. */
  function shouldSkip(stage: ProcessingStage): boolean {
    if (!isResume) return false;
    const stageIdx = STAGE_ORDER.indexOf(stage);
    const resumeIdx = STAGE_ORDER.indexOf(resumeFromStage);
    return stageIdx < resumeIdx;
  }

  /** Record stage output and persist current stage to DB. */
  async function persistStage(
    stage: ProcessingStage,
    output: StageOutput,
    updates: Record<string, unknown>,
    issuerTracking?: IssuerTracking,
    confidenceBreakdown?: ScoringData["confidenceBreakdown"]
  ): Promise<void> {
    stageOutputs.push(output);
    const metadata = buildMetadata(stageOutputs, issuerTracking, confidenceBreakdown, classificationData);
    await db
      .update(articlesTable)
      .set({
        processingStage: stage,
        lastProcessedAt: new Date(),
        stageRetryCounts: retryCounts,
        processingMetadata: metadata as unknown as Record<string, unknown>,
        ...updates,
      } as Record<string, unknown>)
      .where(eq(articlesTable.id, articleId));
  }

  /** Build standardized processingMetadata. */
  function buildMetadata(
    outputs: StageOutput[],
    issuerTracking?: IssuerTracking,
    confidenceBreakdown?: ScoringData["confidenceBreakdown"],
    classification?: ClassificationData | null
  ): ProcessingMetadata {
    const rulesMatched = classification?.ruleOverrides.map((r) => r.ruleName) ?? [];
    return {
      pipelineVersion: PIPELINE_VERSION,
      ruleSetVersion: RULE_SET_VERSION,
      confidenceVersion: CONFIDENCE_VERSION,
      stageOutputs: outputs,
      ...(confidenceBreakdown ? { confidenceBreakdown } : {}),
      ...(issuerTracking ? { issuerTracking } : {}),
      ...(rulesMatched.length > 0 ? { rulesMatched } : {}),
    };
  }

  // ── Issuer tracking accumulator (both passes) ──────────────────────────────
  let issuerTracking: IssuerTracking = {
    initialGuess: null,
    initialGuessSource: "none",
    final: null,
    finalSource: "none",
  };

  // =========================================================================
  // Stage 1: Eligibility
  // =========================================================================
  {
    const stageStart = Date.now();

    if (shouldSkip("enriched")) {
      pipelineLog.debug({ stage: "eligibility" }, "pipeline: stage skipped (resume)");
    } else {
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
            resumed: isResume,
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
        return await handleStageError(
          "enriched", err, pipelineStart, stageStart,
          stageOutputs, articleId, pipelineLog, jobId,
          retryCounts, buildMetadata, issuerTracking, isResume
        );
      }
    }
  }

  // =========================================================================
  // Stage 2: Enrichment
  // =========================================================================
  {
    const stageStart = Date.now();

    if (shouldSkip("enriched")) {
      pipelineLog.debug({ stage: "enrichment" }, "pipeline: stage skipped (resume)");
    } else {
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
        }, issuerTracking);
        pipelineLog.info(
          { stage: "enrichment", contentDepthScore: enrichmentData.contentDepthScore, durationMs },
          "pipeline: stage complete"
        );
      } catch (err) {
        return await handleStageError(
          "enriched", err, pipelineStart, stageStart,
          stageOutputs, articleId, pipelineLog, jobId,
          retryCounts, buildMetadata, issuerTracking, isResume
        );
      }
    }
  }

  // Re-check eligibility after enrichment (content may have changed)
  if (!shouldSkip("enriched")) {
    const recheckContent = enrichmentData?.rawContent ?? article.rawContent;
    const noiseRecheck = (recheckContent?.trim().length ?? 0) > 0;
    if (!noiseRecheck && !eligibilityData?.titleOverride) {
      await db.update(articlesTable).set({
        processingStage: "filtered",
        processingStatus: "filtered",
        processingError: "empty_content_after_enrichment",
        processingCompletedAt: new Date(),
        stageRetryCounts: retryCounts,
      }).where(eq(articlesTable.id, articleId));
      return {
        articleId, jobId,
        finalStage: "filtered",
        finalStatus: "filtered",
        totalDurationMs: Date.now() - pipelineStart,
        stageOutputs,
        resumed: isResume,
      };
    }
  }

  // =========================================================================
  // Stage 3a: Early heuristic issuer extraction (before classification)
  // =========================================================================
  {
    const stageStart = Date.now();

    if (shouldSkip("issuer_identified")) {
      pipelineLog.debug({ stage: "early_issuer" }, "pipeline: stage skipped (resume)");
    } else {
      pipelineLog.info({ stage: "early_issuer" }, "pipeline: stage start");
      try {
        const result = await extractIssuerHeuristic({
          title: article.title,
          rawContent: enrichmentData?.rawContent ?? article.rawContent,
        });
        earlyIssuerData = result.data;
        const durationMs = Date.now() - stageStart;

        // Update issuer tracking with initial guess
        issuerTracking = {
          ...issuerTracking,
          initialGuess: earlyIssuerData.issuerName,
          initialGuessSource: earlyIssuerData.issuerName ? "heuristic" : "none",
        };

        pipelineLog.info(
          { stage: "early_issuer", initialGuess: earlyIssuerData.issuerName, durationMs },
          "pipeline: stage complete"
        );
      } catch (err) {
        // Early issuer extraction is non-fatal — log and continue
        pipelineLog.warn(
          { stage: "early_issuer", err },
          "pipeline: early issuer extraction failed (non-fatal)"
        );
      }
    }
  }

  // =========================================================================
  // Stage 4: Classification (AI + deterministic rules)
  // =========================================================================
  {
    const stageStart = Date.now();

    if (shouldSkip("classified")) {
      pipelineLog.debug({ stage: "classification" }, "pipeline: stage skipped (resume)");
    } else {
      pipelineLog.info({ stage: "classification" }, "pipeline: stage start");
      try {
        const result = await classifyEvent({
          title: article.title,
          rawContent: enrichmentData?.rawContent ?? article.rawContent,
        });
        classificationData = result.data;
        const durationMs = Date.now() - stageStart;

        // Refined issuer identification with AI-extracted name + early guess as fallback
        const issuerResult = await extractIssuer({
          title: article.title,
          rawContent: enrichmentData?.rawContent ?? article.rawContent,
          aiIssuerName: classificationData.aiAnalysis.issuerName,
          earlyGuess: earlyIssuerData?.issuerName ?? null,
        });
        issuerData = issuerResult.data;

        // Update issuer tracking with refined result
        issuerTracking = {
          ...issuerTracking,
          final: issuerData.issuerName,
          finalSource: (issuerData.source === "ai" || issuerData.source === "heuristic" || issuerData.source === "none")
            ? issuerData.source
            : "none",
        };

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
            ruleSetVersion: RULE_SET_VERSION,
            issuerName: issuerData.issuerName,
            issuerSource: issuerData.source,
            issuerMode: issuerData.mode,
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
        }, issuerTracking);

        pipelineLog.info(
          {
            stage: "classification",
            eventType: classificationData.eventType,
            rulesMatched: classificationData.ruleOverrides.length,
            issuerName: issuerData.issuerName,
            issuerSource: issuerData.source,
            durationMs,
          },
          "pipeline: stage complete"
        );
      } catch (err) {
        return await handleStageError(
          "classified", err, pipelineStart, stageStart,
          stageOutputs, articleId, pipelineLog, jobId,
          retryCounts, buildMetadata, issuerTracking, isResume
        );
      }
    }
  }

  // =========================================================================
  // Stage 5: Scoring (confidence + review flag)
  // =========================================================================
  {
    const stageStart = Date.now();

    if (shouldSkip("scored")) {
      pipelineLog.debug({ stage: "scoring" }, "pipeline: stage skipped (resume)");
    } else {
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
            confidenceVersion: CONFIDENCE_VERSION,
          },
        };
        await persistStage("scored", stageOut, {
          classificationConfidence: scoringData.classificationConfidence,
          needsReview: scoringData.needsReview,
          reviewReason: scoringData.reviewReason,
        }, issuerTracking, scoringData.confidenceBreakdown);

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
        return await handleStageError(
          "scored", err, pipelineStart, stageStart,
          stageOutputs, articleId, pipelineLog, jobId,
          retryCounts, buildMetadata, issuerTracking, isResume
        );
      }
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
          confidenceVersion: CONFIDENCE_VERSION,
        },
      };

      const totalDurationMs = Date.now() - pipelineStart;
      await persistStage("validated", stageOut, {
        stockMove1D: marketData.stockMove1D,
        stockMove5D: marketData.stockMove5D,
        hyETFMove: marketData.hyETFMove,
        marketValidationSignal: marketData.validationSignal,
        confidenceScore: marketData.confidenceScore,
        classificationConfidence: scoringData.classificationConfidence,
        needsReview: scoringData.needsReview,
        reviewReason: scoringData.reviewReason,
        processingStatus: "success",
        processingCompletedAt: new Date(),
      }, issuerTracking, scoringData.confidenceBreakdown);

      pipelineLog.info(
        {
          stage: "market_validation",
          validationSignal: marketData.validationSignal,
          finalConfidence: scoringData.classificationConfidence.toFixed(3),
          needsReview: scoringData.needsReview,
          totalDurationMs,
          durationMs,
          isResume,
        },
        "pipeline: complete"
      );

      // ── Phase 3: Trigger alert evaluation (non-fatal) ─────────────────────
      evaluateAlertsForArticle(articleId).catch((alertErr) => {
        pipelineLog.error(
          { alertErr, articleId },
          "pipeline: alert evaluation failed (non-fatal)"
        );
      });

      return {
        articleId,
        jobId,
        finalStage: "validated",
        finalStatus: "success",
        totalDurationMs,
        stageOutputs,
        classificationConfidence: scoringData.classificationConfidence,
        needsReview: scoringData.needsReview,
        resumed: isResume,
      };
    } catch (err) {
      return await handleStageError(
        "validated", err, pipelineStart, stageStart,
        stageOutputs, articleId, pipelineLog, jobId,
        retryCounts, buildMetadata, issuerTracking, isResume
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Error handler with per-stage retry tracking
// ---------------------------------------------------------------------------

async function handleStageError(
  stage: ProcessingStage,
  err: unknown,
  pipelineStart: number,
  stageStart: number,
  stageOutputs: StageOutput[],
  articleId: number,
  log: Logger,
  jobId: string,
  retryCounts: Record<string, number>,
  buildMetadata: (
    outputs: StageOutput[],
    issuerTracking?: IssuerTracking,
    confidenceBreakdown?: ScoringData["confidenceBreakdown"],
    classification?: ClassificationData | null
  ) => Record<string, unknown>,
  issuerTracking: IssuerTracking,
  isResume: boolean
): Promise<PipelineResult> {
  const durationMs = Date.now() - stageStart;
  const errorMessage =
    err instanceof PipelineStageError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);

  // Increment retry count for this stage
  retryCounts[stage] = (retryCounts[stage] ?? 0) + 1;
  const retryCount = retryCounts[stage];
  const permanentlyFailed = retryCount >= STAGE_RETRY_MAX;

  stageOutputs.push({
    stage,
    durationMs,
    success: false,
    error: errorMessage,
  });

  log.error(
    { stage, err, durationMs, retryCount, maxRetries: STAGE_RETRY_MAX, permanentlyFailed },
    `pipeline: stage failed`
  );

  const metadata = buildMetadata(stageOutputs, issuerTracking);
  const metadataWithFail = {
    ...(metadata as Record<string, unknown>),
    failedAtStage: stage,
  };

  await db
    .update(articlesTable)
    .set({
      processingStatus: "failed",
      processingError: errorMessage,
      lastStageError: errorMessage,
      processingStage: stage,
      lastProcessedAt: new Date(),
      stageRetryCounts: retryCounts,
      processingMetadata: metadataWithFail,
    })
    .where(eq(articlesTable.id, articleId));

  if (permanentlyFailed) {
    log.error(
      { stage, retryCount, maxRetries: STAGE_RETRY_MAX },
      "pipeline: stage permanently failed — max retries reached"
    );
  }

  return {
    articleId,
    jobId,
    finalStage: stage,
    finalStatus: "failed",
    totalDurationMs: Date.now() - pipelineStart,
    stageOutputs,
    resumed: isResume,
  };
}

