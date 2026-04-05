/**
 * ingestionService.ts
 *
 * Service layer for the ingestion pipeline.  Route handlers delegate here
 * so they remain thin.
 *
 * Phase 1b additions:
 *  - Richer structured metrics per job run
 *  - Article-level processingStatus / processingError / lastProcessedAt
 *  - jobId surfaced in stats so callers can correlate logs
 *  - Uses updated withJob / NonRetryableError from jobService
 *
 * Phase 4 (unified pipeline):
 *  - Eligible articles are inserted as raw/pending records only
 *  - processArticlePipeline is the sole AI-processing path for eligible articles
 *  - Filtered article behaviour (empty_content, noise_filtered) is preserved unchanged
 */
import { and, isNull, isNotNull, eq } from "drizzle-orm";
import { db, articlesTable } from "@workspace/db";
import type { Logger } from "pino";

import { fetchAllArticles } from "../lib/dataProviders";
import { analyzeArticle, passesNoiseFilter, isCreditTitleOverride } from "../lib/aiProcessing";
import { enrichContent } from "../lib/contentEnricher";
import { canonicalizeIssuer } from "../lib/canonicalIssuers";
import { sanitizeNullStr as sanitizeNullStrUtil } from "../lib/stringUtils";
import { logger as rootLogger } from "../lib/logger";
import {
  fingerprintTitle,
  fingerprintContent,
  isDuplicate,
  existingUrlSet,
} from "./deduplication";
import { withJob } from "./jobService";
import { processArticlePipeline } from "./pipeline";

// ---------------------------------------------------------------------------
// Shared sanitise helpers
// ---------------------------------------------------------------------------

/**
 * Re-exported from lib/stringUtils for backward compatibility.
 * New code should import directly from "../lib/stringUtils".
 */
export function sanitizeNullStr(val: string | null | undefined): string | null {
  return sanitizeNullStrUtil(val);
}

export function sanitizeIssuer(val: string | null | undefined): string | null {
  return canonicalizeIssuer(sanitizeNullStr(val));
}

// ---------------------------------------------------------------------------
// Article processing status
// ---------------------------------------------------------------------------

export type ArticleProcessingStatus =
  | "pending"
  | "processing"
  | "processed" // legacy Phase 1b value — kept for backward compatibility
  | "success"   // Phase 2 pipeline success
  | "failed"
  | "filtered";

// ---------------------------------------------------------------------------
// Ingestion result types (Phase 1b: richer metrics)
// ---------------------------------------------------------------------------

export interface IngestionMetrics {
  /** Number of RSS/API feeds checked. */
  feedsChecked: number;
  /** Feeds that returned at least one article. */
  feedsSucceeded: number;
  /** Feeds that threw errors during fetch. */
  feedsFailed: number;
  /** Total raw articles returned from all providers. */
  articlesFetched: number;
  /** Articles actually written to the DB (filtered + raw combined). */
  articlesInserted: number;
  /** Articles skipped because URL or fingerprint already existed. */
  articlesSkippedDuplicate: number;
  /**
   * Articles inserted as filtered records (empty content or noise-filtered).
   * Kept for backward compatibility — equals articlesFiltered.
   */
  articlesSkippedFiltered: number;
  /** Articles where the pipeline failed to start (insert succeeded but pipeline threw). */
  articlesProcessingFailed: number;
  /**
   * Articles for which the pipeline was successfully triggered.
   * Kept for backward compatibility — equals articlesPipelineTriggered.
   */
  articlesFullyProcessed: number;
  /** Wall-clock duration in ms. */
  totalDurationMs: number;
  // ── Phase 4 (unified pipeline) ────────────────────────────────────────────
  /** Eligible articles inserted as raw/pending and handed off to the pipeline. */
  articlesInsertedRaw: number;
  /** Articles inserted as filtered (empty_content or noise_filtered). */
  articlesFiltered: number;
  /** Articles for which processArticlePipeline was invoked without error. */
  articlesPipelineTriggered: number;
  /** Articles where processArticlePipeline threw before completing. */
  articlesPipelineFailedToStart: number;
}

export interface IngestionStats extends IngestionMetrics {
  jobId: string | null;
  message: string;
}

export interface BackfillStats {
  jobId: string | null;
  backfilledStructured: number;
  retriedUnprocessed: number;
  skippedNoiseFilter: number;
  aiNullReturned: number;
  errors: number;
  totalDurationMs: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface IngestionOptions {
  /** Optional pino-compatible child logger (e.g. from req.log). */
  log?: Logger;
  /** Scope key for job locking (default: "global"). */
  scopeKey?: string;
}

export interface BackfillOptions {
  log?: Logger;
  scopeKey?: string;
  /** Max articles to backfill for structured outputs (Phase 1). Default 30. */
  structuredLimit?: number;
  /** Max unprocessed articles to retry. Default 20. */
  unprocessedLimit?: number;
}

// ---------------------------------------------------------------------------
// Main ingestion
// ---------------------------------------------------------------------------

export async function runIngestion(opts: IngestionOptions = {}): Promise<IngestionStats> {
  const log = opts.log ?? rootLogger;
  const scopeKey = opts.scopeKey ?? "global";
  const startTime = Date.now();

  const result = await withJob("ingestion", scopeKey, async (jobId) => {
    const jobLog = log.child({ jobId });
    jobLog.info("Ingestion service: starting");

    const metrics: IngestionMetrics = {
      feedsChecked: 0,
      feedsSucceeded: 0,
      feedsFailed: 0,
      articlesFetched: 0,
      articlesInserted: 0,
      articlesSkippedDuplicate: 0,
      articlesSkippedFiltered: 0,
      articlesProcessingFailed: 0,
      articlesFullyProcessed: 0,
      totalDurationMs: 0,
      articlesInsertedRaw: 0,
      articlesFiltered: 0,
      articlesPipelineTriggered: 0,
      articlesPipelineFailedToStart: 0,
    };

    let allRaw: Awaited<ReturnType<typeof fetchAllArticles>> = [];
    try {
      allRaw = await fetchAllArticles();
      metrics.feedsSucceeded = 1; // fetchAllArticles aggregates all providers
    } catch (err) {
      metrics.feedsFailed = 1;
      jobLog.error({ err }, "Failed to fetch articles from providers");
      // Non-fatal at the job level — return partial metrics
    }
    metrics.feedsChecked = 1;
    metrics.articlesFetched = allRaw.length;
    jobLog.info({ articlesFetched: allRaw.length }, "Fetched raw articles from all providers");

    // Fast URL pre-filter (existing behaviour)
    const knownUrls = await existingUrlSet();
    const urlFiltered = allRaw.filter((a) => !knownUrls.has(a.url));
    metrics.articlesSkippedDuplicate = allRaw.length - urlFiltered.length;

    for (const raw of urlFiltered) {
      try {
        const titleFp = fingerprintTitle(raw.title);
        const rawSnippet = raw.rawContent ?? "";
        const contentFp = fingerprintContent(rawSnippet);

        // Secondary deduplication: fingerprint-based check
        const alreadyExists = await isDuplicate({
          url: raw.url,
          titleFingerprint: titleFp,
          contentFingerprint: contentFp,
        });

        if (alreadyExists) {
          metrics.articlesSkippedDuplicate++;
          jobLog.debug(
            { url: raw.url, title: raw.title.slice(0, 70) },
            "Fingerprint duplicate — skipping"
          );
          continue;
        }

        const enriched = await enrichContent(raw.url, raw.source, rawSnippet).catch(() => ({
          rawContent: rawSnippet,
          contentSourceType: "rss_snippet" as const,
          contentDepthScore: Math.min(30, Math.floor(rawSnippet.length / 10)),
        }));

        // Compute final content fingerprint after enrichment
        const enrichedContentFp = fingerprintContent(enriched.rawContent ?? "");

        let hasContent = (enriched.rawContent?.trim().length ?? 0) > 0;

        // Title-triggered enrichment override
        if (!hasContent && isCreditTitleOverride(raw.title)) {
          jobLog.info(
            { title: raw.title.slice(0, 70), source: raw.source },
            "Empty content + credit title override: forcing enrichment re-attempt"
          );
          const forced = await enrichContent(raw.url, raw.source, rawSnippet, true).catch(
            () => enriched
          );
          if ((forced.rawContent?.trim().length ?? 0) > (enriched.rawContent?.trim().length ?? 0)) {
            Object.assign(enriched, forced);
            hasContent = true;
            jobLog.info(
              { title: raw.title.slice(0, 70), contentLen: forced.rawContent?.length },
              "Title override enrichment succeeded"
            );
          } else {
            jobLog.info(
              { title: raw.title.slice(0, 70) },
              "Title override enrichment: still empty after force-attempt"
            );
          }
        }

        const now = new Date();

        if (!hasContent) {
          metrics.articlesSkippedFiltered++;
          metrics.articlesFiltered++;
          jobLog.info(
            { title: raw.title.slice(0, 70), source: raw.source },
            "Empty content: skipping AI processing"
          );
          await db.insert(articlesTable).values({
            title: raw.title,
            source: raw.source,
            publishedAt: raw.publishedAt,
            url: raw.url,
            rawSnippet,
            rawContent: enriched.rawContent,
            contentSourceType: enriched.contentSourceType,
            contentDepthScore: enriched.contentDepthScore,
            processFailureReason: "empty_content",
            processedAt: null,
            titleFingerprint: titleFp,
            contentFingerprint: enrichedContentFp,
            processingStatus: "filtered" satisfies ArticleProcessingStatus,
            processingError: "empty_content",
            processingStage: "filtered",
            lastProcessedAt: now,
          });
          metrics.articlesInserted++;
          continue;
        }

        const noisePass = passesNoiseFilter(raw.title, enriched.rawContent);
        const titleOverride = !noisePass && isCreditTitleOverride(raw.title);
        if (!noisePass && !titleOverride) {
          jobLog.info(
            { title: raw.title.slice(0, 70), source: raw.source },
            "Noise-filtered: skipping AI processing (score < threshold)"
          );
          await db.insert(articlesTable).values({
            title: raw.title,
            source: raw.source,
            publishedAt: raw.publishedAt,
            url: raw.url,
            rawSnippet,
            rawContent: enriched.rawContent,
            contentSourceType: enriched.contentSourceType,
            contentDepthScore: enriched.contentDepthScore,
            processFailureReason: "noise_filtered",
            processedAt: null,
            titleFingerprint: titleFp,
            contentFingerprint: enrichedContentFp,
            processingStatus: "filtered" satisfies ArticleProcessingStatus,
            processingError: "noise_filtered",
            processingStage: "filtered",
            lastProcessedAt: now,
          });
          metrics.articlesInserted++;
          metrics.articlesSkippedFiltered++;
          metrics.articlesFiltered++;
          continue;
        }
        if (titleOverride) {
          jobLog.info(
            { title: raw.title.slice(0, 70), source: raw.source },
            "Noise filter bypassed: credit title override triggered"
          );
        }

        // ── Eligible article: insert raw/pending, then invoke pipeline ──────
        const insertNow = new Date();
        const [persisted] = await db
          .insert(articlesTable)
          .values({
            title: raw.title,
            source: raw.source,
            publishedAt: raw.publishedAt,
            url: raw.url,
            rawSnippet,
            rawContent: enriched.rawContent,
            contentSourceType: enriched.contentSourceType,
            contentDepthScore: enriched.contentDepthScore,
            titleFingerprint: titleFp,
            contentFingerprint: enrichedContentFp,
            processingStatus: "pending" satisfies ArticleProcessingStatus,
            processingStage: "raw",
            lastProcessedAt: insertNow,
          })
          .returning({ id: articlesTable.id });

        metrics.articlesInserted++;
        metrics.articlesInsertedRaw++;

        if (!persisted) {
          jobLog.error({ url: raw.url }, "Insert returned no row — skipping pipeline invocation");
          metrics.articlesProcessingFailed++;
          continue;
        }

        jobLog.info(
          { articleId: persisted.id, title: raw.title.slice(0, 70) },
          "Eligible article inserted as raw/pending — invoking pipeline"
        );

        try {
          await processArticlePipeline(persisted.id, jobId, jobLog);
          metrics.articlesPipelineTriggered++;
          metrics.articlesFullyProcessed++; // backward-compat alias
        } catch (pipelineErr) {
          const errMsg = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
          metrics.articlesPipelineFailedToStart++;
          metrics.articlesProcessingFailed++;
          jobLog.error(
            { err: pipelineErr, articleId: persisted.id, jobId },
            "Pipeline invocation failed — persisting failure state on article"
          );
          await db
            .update(articlesTable)
            .set({
              processingStatus: "failed",
              processingError: "pipeline_start_failed",
              lastStageError: errMsg,
              lastProcessedAt: new Date(),
            })
            .where(eq(articlesTable.id, persisted.id));
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (err) {
        jobLog.error({ err, url: raw.url }, "Error processing article");
        metrics.articlesProcessingFailed++;
      }
    }

    metrics.totalDurationMs = Date.now() - startTime;
    jobLog.info(metrics, "Ingestion complete");
    return { jobId, ...metrics };
  });

  if (!result) {
    // Lock not acquired — another job is running
    return {
      jobId: null,
      feedsChecked: 0,
      feedsSucceeded: 0,
      feedsFailed: 0,
      articlesFetched: 0,
      articlesInserted: 0,
      articlesSkippedDuplicate: 0,
      articlesSkippedFiltered: 0,
      articlesProcessingFailed: 0,
      articlesFullyProcessed: 0,
      totalDurationMs: Date.now() - startTime,
      articlesInsertedRaw: 0,
      articlesFiltered: 0,
      articlesPipelineTriggered: 0,
      articlesPipelineFailedToStart: 0,
      message: "Ingestion skipped: another ingestion job is already running",
    };
  }

  const {
    jobId,
    articlesFetched,
    articlesFullyProcessed,
    articlesSkippedDuplicate,
    articlesSkippedFiltered,
    articlesProcessingFailed,
    totalDurationMs,
    feedsChecked,
    feedsSucceeded,
    feedsFailed,
    articlesInserted,
    articlesInsertedRaw,
    articlesFiltered,
    articlesPipelineTriggered,
    articlesPipelineFailedToStart,
  } = result;

  return {
    jobId,
    feedsChecked,
    feedsSucceeded,
    feedsFailed,
    articlesFetched,
    articlesInserted,
    articlesSkippedDuplicate,
    articlesSkippedFiltered,
    articlesProcessingFailed,
    articlesFullyProcessed,
    totalDurationMs,
    articlesInsertedRaw,
    articlesFiltered,
    articlesPipelineTriggered,
    articlesPipelineFailedToStart,
    message: `Ingestion complete: ${articlesPipelineTriggered} pipeline(s) triggered, ${articlesFiltered} filtered, ${articlesSkippedDuplicate} duplicates skipped, ${articlesPipelineFailedToStart} pipeline start error(s) (${totalDurationMs}ms)`,
  };
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

export async function runBackfill(opts: BackfillOptions = {}): Promise<BackfillStats> {
  const log = opts.log ?? rootLogger;
  const scopeKey = opts.scopeKey ?? "global";
  const structuredLimit = opts.structuredLimit ?? 30;
  const unprocessedLimit = opts.unprocessedLimit ?? 20;
  const startTime = Date.now();

  const result = await withJob("backfill", scopeKey, async (jobId) => {
    const jobLog = log.child({ jobId });
    jobLog.info("Backfill service: starting");

    let backfilledStructured = 0;
    let retriedUnprocessed = 0;
    let skippedNoiseFilter = 0;
    let aiNullReturned = 0;
    let errors = 0;

    // ── Phase 1: Already AI-processed but missing structured JSON ────────────
    const needsStructuredBackfill = await db
      .select({ id: articlesTable.id, title: articlesTable.title, rawContent: articlesTable.rawContent })
      .from(articlesTable)
      .where(and(isNotNull(articlesTable.processedAt), isNull(articlesTable.creditSummaryJson)))
      .limit(structuredLimit);

    jobLog.info(
      { count: needsStructuredBackfill.length },
      "Backfill Phase 1: articles needing structured output backfill"
    );

    for (const article of needsStructuredBackfill) {
      try {
        const analysis = await analyzeArticle(article.title, article.rawContent);
        if (!analysis) {
          jobLog.warn(
            { articleId: article.id, title: article.title.slice(0, 70) },
            "Backfill Phase 1: AI returned null"
          );
          aiNullReturned++;
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }

        const now = new Date();
        await db
          .update(articlesTable)
          .set({
            creditSummaryJson: analysis.creditSummary ?? null,
            scoreExplanationJson: analysis.scoreExplanation ?? null,
            lastProcessedAt: now,
          })
          .where(eq(articlesTable.id, article.id));

        backfilledStructured++;
        jobLog.info(
          { articleId: article.id, title: article.title.slice(0, 70), hasSummary: !!analysis.creditSummary },
          "Backfill Phase 1: structured outputs updated"
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (err) {
        rootLogger.error({ err, articleId: article.id }, "Backfill Phase 1: error");
        errors++;
      }
    }

    // ── Phase 2: Articles with processedAt=null — retry AI ──────────────────
    const unprocessed = await db
      .select({ id: articlesTable.id, title: articlesTable.title, rawContent: articlesTable.rawContent })
      .from(articlesTable)
      .where(isNull(articlesTable.processedAt))
      .limit(unprocessedLimit);

    jobLog.info({ count: unprocessed.length }, "Backfill Phase 2: unprocessed articles to retry");

    for (const article of unprocessed) {
      try {
        const noisePass = passesNoiseFilter(article.title, article.rawContent);
        const titleOverride = !noisePass && isCreditTitleOverride(article.title);
        if (!noisePass && !titleOverride) {
          skippedNoiseFilter++;
          jobLog.info(
            { articleId: article.id, title: article.title.slice(0, 70) },
            "Backfill Phase 2: noise-filtered, skip"
          );
          continue;
        }
        if (titleOverride) {
          jobLog.info(
            { articleId: article.id, title: article.title.slice(0, 70) },
            "Backfill Phase 2: noise filter bypassed by credit title override"
          );
        }

        const analysis = await analyzeArticle(article.title, article.rawContent);
        if (!analysis) {
          jobLog.warn(
            { articleId: article.id, title: article.title.slice(0, 70) },
            "Backfill Phase 2: AI returned null on retry"
          );
          aiNullReturned++;
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }

        const now = new Date();
        await db
          .update(articlesTable)
          .set({
            summary: sanitizeNullStr(analysis.summary),
            sector: sanitizeNullStr(analysis.sector),
            eventType: sanitizeNullStr(analysis.eventType),
            sentiment: sanitizeNullStr(analysis.sentiment),
            whyItMatters: sanitizeNullStr(analysis.whyItMatters),
            whoCares: sanitizeNullStr(analysis.whoCares.join(", ")),
            cloImpact: analysis.cloImpact,
            issuerName: sanitizeIssuer(analysis.issuerName),
            processFailureReason: null,
            urgencyScore: analysis.urgencyScore,
            covenantFlag: analysis.covenantFlag,
            ratingMentioned: sanitizeNullStr(analysis.ratingMentioned),
            ratingAgency: sanitizeNullStr(analysis.ratingAgency),
            marketImpact: sanitizeNullStr(analysis.marketImpact),
            finalUrgencyScore: analysis.finalUrgencyScore,
            creditSignalScore: analysis.creditSignalScore,
            tradeDirection: sanitizeNullStr(analysis.tradeDirection),
            tradeRationale: sanitizeNullStr(analysis.tradeRationale),
            potentialTrades: analysis.potentialTrades,
            marketsImpacted: analysis.marketsImpacted,
            leverageMentioned: analysis.leverageMentioned,
            liquidityConcern: analysis.liquidityConcern,
            refinancingRisk: analysis.refinancingRisk,
            earningsMiss: analysis.earningsMiss,
            ratingIsDowngrade: analysis.ratingIsDowngrade,
            ratingIsUpgrade: analysis.ratingIsUpgrade,
            ratingIsCCCThreshold: analysis.ratingIsCCCThreshold,
            covenantType: sanitizeNullStr(analysis.covenantType),
            cloRelevance: sanitizeNullStr(analysis.cloRelevance),
            cloLoanVsBond: sanitizeNullStr(analysis.cloLoanVsBond),
            cloWarfImpact: sanitizeNullStr(analysis.cloWarfImpact),
            cloCCCBucketRisk: analysis.cloCCCBucketRisk,
            cloExplanation: sanitizeNullStr(analysis.cloExplanation),
            cloImpactTypes: analysis.cloImpactTypes,
            spreadWideningRisk: analysis.spreadWideningRisk,
            forcedSellingRisk: analysis.forcedSellingRisk,
            distressedRisk: analysis.distressedRisk,
            creditSummaryJson: analysis.creditSummary ?? null,
            scoreExplanationJson: analysis.scoreExplanation ?? null,
            processedAt: now,
            processingStatus: "processed" satisfies ArticleProcessingStatus,
            processingError: null,
            lastProcessedAt: now,
          })
          .where(eq(articlesTable.id, article.id));

        retriedUnprocessed++;
        jobLog.info(
          { articleId: article.id, title: article.title.slice(0, 70) },
          "Backfill Phase 2: successfully processed previously-unprocessed article"
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (err) {
        rootLogger.error({ err, articleId: article.id }, "Backfill Phase 2: error");
        errors++;
      }
    }

    const totalDurationMs = Date.now() - startTime;
    return { jobId, backfilledStructured, retriedUnprocessed, skippedNoiseFilter, aiNullReturned, errors, totalDurationMs };
  });

  if (!result) {
    return {
      jobId: null,
      backfilledStructured: 0,
      retriedUnprocessed: 0,
      skippedNoiseFilter: 0,
      aiNullReturned: 0,
      errors: 0,
      totalDurationMs: Date.now() - startTime,
      message: "Backfill skipped: another backfill job is already running",
    };
  }

  const { jobId, backfilledStructured, retriedUnprocessed, skippedNoiseFilter, aiNullReturned, errors, totalDurationMs } = result;
  return {
    jobId,
    backfilledStructured,
    retriedUnprocessed,
    skippedNoiseFilter,
    aiNullReturned,
    errors,
    totalDurationMs,
    message: `Backfill complete: ${backfilledStructured} structured outputs updated, ${retriedUnprocessed} unprocessed articles processed, ${skippedNoiseFilter} noise-filtered (legitimately skipped), ${aiNullReturned} AI null returns, ${errors} errors (${totalDurationMs}ms)`,
  };
}
