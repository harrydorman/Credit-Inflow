/**
 * ingestionService.ts
 *
 * Service layer for the ingestion pipeline. This module owns all business
 * logic previously embedded in the /refresh and /refresh/backfill route
 * handlers so that route handlers remain thin.
 *
 * Public API:
 *  - runIngestion(opts)   – fetches, deduplicates, enriches, analyses & persists new articles
 *  - runBackfill(opts)    – backfills structured AI outputs and retries unprocessed articles
 */
import { and, isNull, isNotNull, eq } from "drizzle-orm";
import { db, articlesTable } from "@workspace/db";
import type { Logger } from "pino";

import { fetchAllArticles } from "../lib/dataProviders";
import { analyzeArticle, passesNoiseFilter, isCreditTitleOverride } from "../lib/aiProcessing";
import { getETFSnapshot, validateWithMarketData } from "../lib/marketData";
import { enrichContent } from "../lib/contentEnricher";
import { canonicalizeIssuer } from "../lib/canonicalIssuers";
import { evaluateAlerts } from "../lib/alertEvaluation";
import { logger as rootLogger } from "../lib/logger";
import {
  fingerprintTitle,
  fingerprintContent,
  isDuplicate,
  existingUrlSet,
} from "./deduplication";
import { withJob } from "./jobService";

// ---------------------------------------------------------------------------
// Shared sanitise helpers (previously in the route file)
// ---------------------------------------------------------------------------

export function sanitizeNullStr(val: string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const trimmed = val.trim();
  if (
    trimmed === "" ||
    trimmed === "null" ||
    trimmed === "undefined" ||
    trimmed === "N/A" ||
    trimmed === "n/a"
  )
    return null;
  return trimmed;
}

export function sanitizeIssuer(val: string | null | undefined): string | null {
  return canonicalizeIssuer(sanitizeNullStr(val));
}

// ---------------------------------------------------------------------------
// Ingestion result types
// ---------------------------------------------------------------------------

export interface IngestionStats {
  jobId: string | null;
  fetched: number;
  processed: number;
  duplicatesSkipped: number;
  noiseFiltered: number;
  errors: number;
  marketValidated: number;
  message: string;
}

export interface BackfillStats {
  jobId: string | null;
  backfilledStructured: number;
  retriedUnprocessed: number;
  skippedNoiseFilter: number;
  aiNullReturned: number;
  errors: number;
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
  /** Max unprocessed articles to retry (Phase 2). Default 20. */
  unprocessedLimit?: number;
}

// ---------------------------------------------------------------------------
// Main ingestion
// ---------------------------------------------------------------------------

export async function runIngestion(opts: IngestionOptions = {}): Promise<IngestionStats> {
  const log = opts.log ?? rootLogger;
  const scopeKey = opts.scopeKey ?? "global";

  const result = await withJob("ingestion", scopeKey, async (jobId) => {
    const jobLog = log.child({ jobId });
    jobLog.info("Ingestion service: starting");

    let fetched = 0;
    let processed = 0;
    let duplicatesSkipped = 0;
    let noiseFiltered = 0;
    let errors = 0;
    let marketValidated = 0;

    const etfSnapshot = await getETFSnapshot();
    jobLog.info(
      {
        hygMove: etfSnapshot.hyg?.move1D?.toFixed(3) ?? "n/a",
        lqdMove: etfSnapshot.lqd?.move1D?.toFixed(3) ?? "n/a",
      },
      "ETF snapshot ready"
    );

    const allRaw = await fetchAllArticles();
    fetched = allRaw.length;
    jobLog.info({ fetched }, "Fetched raw articles from all providers");

    // Fast URL pre-filter (existing behaviour)
    const knownUrls = await existingUrlSet();
    const urlFiltered = allRaw.filter((a) => !knownUrls.has(a.url));
    duplicatesSkipped = allRaw.length - urlFiltered.length;

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
          duplicatesSkipped++;
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

        if (!hasContent) {
          noiseFiltered++;
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
          });
          continue;
        }

        const noisePass = passesNoiseFilter(raw.title, enriched.rawContent);
        const titleOverride = !noisePass && isCreditTitleOverride(raw.title);
        if (!noisePass && !titleOverride) {
          noiseFiltered++;
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
          });
          continue;
        }
        if (titleOverride) {
          jobLog.info(
            { title: raw.title.slice(0, 70), source: raw.source },
            "Noise filter bypassed: credit title override triggered"
          );
        }

        const analysis = await analyzeArticle(raw.title, enriched.rawContent);

        let marketValidation = null;
        if (analysis) {
          marketValidation = await validateWithMarketData({
            issuerName: analysis.issuerName ?? null,
            sentiment: analysis.sentiment ?? null,
            finalUrgencyScore: analysis.finalUrgencyScore ?? null,
            creditSignalScore: analysis.creditSignalScore ?? null,
            etfSnapshot,
          });
          marketValidated++;
        }

        if (!analysis) {
          jobLog.warn(
            { title: raw.title.slice(0, 70) },
            "AI processing returned null — storing as unprocessed stub"
          );
        }

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
            processFailureReason: analysis ? null : "ai_null",
            titleFingerprint: titleFp,
            contentFingerprint: enrichedContentFp,

            summary: sanitizeNullStr(analysis?.summary),
            sector: sanitizeNullStr(analysis?.sector),
            eventType: sanitizeNullStr(analysis?.eventType),
            sentiment: sanitizeNullStr(analysis?.sentiment),
            whyItMatters: sanitizeNullStr(analysis?.whyItMatters),
            whoCares: analysis ? sanitizeNullStr(analysis.whoCares.join(", ")) : null,

            cloImpact: analysis?.cloImpact ?? false,
            issuerName: sanitizeIssuer(analysis?.issuerName),

            urgencyScore: analysis?.urgencyScore ?? null,
            covenantFlag: analysis?.covenantFlag ?? false,
            ratingMentioned: sanitizeNullStr(analysis?.ratingMentioned),
            ratingAgency: sanitizeNullStr(analysis?.ratingAgency),
            marketImpact: sanitizeNullStr(analysis?.marketImpact),

            finalUrgencyScore: analysis?.finalUrgencyScore ?? null,
            creditSignalScore: analysis?.creditSignalScore ?? null,

            tradeDirection: sanitizeNullStr(analysis?.tradeDirection),
            tradeRationale: sanitizeNullStr(analysis?.tradeRationale),
            potentialTrades: analysis?.potentialTrades ?? null,
            marketsImpacted: analysis?.marketsImpacted ?? null,

            leverageMentioned: analysis?.leverageMentioned ?? false,
            liquidityConcern: analysis?.liquidityConcern ?? false,
            refinancingRisk: analysis?.refinancingRisk ?? false,
            earningsMiss: analysis?.earningsMiss ?? false,

            ratingIsDowngrade: analysis?.ratingIsDowngrade ?? false,
            ratingIsUpgrade: analysis?.ratingIsUpgrade ?? false,
            ratingIsCCCThreshold: analysis?.ratingIsCCCThreshold ?? false,

            covenantType: sanitizeNullStr(analysis?.covenantType),

            cloRelevance: sanitizeNullStr(analysis?.cloRelevance),
            cloLoanVsBond: sanitizeNullStr(analysis?.cloLoanVsBond),
            cloWarfImpact: sanitizeNullStr(analysis?.cloWarfImpact),
            cloCCCBucketRisk: analysis?.cloCCCBucketRisk ?? false,
            cloExplanation: sanitizeNullStr(analysis?.cloExplanation),
            cloImpactTypes: analysis?.cloImpactTypes ?? null,

            spreadWideningRisk: analysis?.spreadWideningRisk ?? false,
            forcedSellingRisk: analysis?.forcedSellingRisk ?? false,
            distressedRisk: analysis?.distressedRisk ?? false,

            stockMove1D: marketValidation?.stockMove1D ?? null,
            stockMove5D: marketValidation?.stockMove5D ?? null,
            hyETFMove: marketValidation?.hyETFMove ?? null,
            marketValidationSignal: marketValidation?.validationSignal ?? null,
            confidenceScore: marketValidation?.confidenceScore ?? null,

            creditSummaryJson: analysis?.creditSummary ?? null,
            scoreExplanationJson: analysis?.scoreExplanation ?? null,

            processedAt: analysis ? new Date() : null,
          })
          .returning({
            id: articlesTable.id,
            issuerName: articlesTable.issuerName,
            finalUrgencyScore: articlesTable.finalUrgencyScore,
            eventType: articlesTable.eventType,
            covenantFlag: articlesTable.covenantFlag,
          });

        if (analysis) processed++;

        if (analysis && persisted?.issuerName) {
          const alertCount = await evaluateAlerts({
            id: persisted.id,
            issuerName: persisted.issuerName,
            title: raw.title,
            finalUrgencyScore: persisted.finalUrgencyScore,
            eventType: persisted.eventType,
            covenantFlag: persisted.covenantFlag ?? false,
          });
          if (alertCount > 0) {
            jobLog.info({ articleId: persisted.id, alertCount }, "Alert events created");
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (err) {
        rootLogger.error({ err, url: raw.url }, "Error processing article");
        errors++;
      }
    }

    const stats = { fetched, processed, duplicatesSkipped, noiseFiltered, marketValidated, errors };
    jobLog.info(stats, "Ingestion complete");
    return stats;
  });

  if (!result) {
    // Lock not acquired — another job is running
    return {
      jobId: null,
      fetched: 0,
      processed: 0,
      duplicatesSkipped: 0,
      noiseFiltered: 0,
      errors: 0,
      marketValidated: 0,
      message: "Ingestion skipped: another ingestion job is already running",
    };
  }

  const { fetched, processed, duplicatesSkipped, noiseFiltered, marketValidated, errors } = result;
  return {
    jobId: null, // jobId returned by withJob is not re-surfaced here; use job table for lookup
    fetched,
    processed,
    duplicatesSkipped,
    noiseFiltered,
    errors,
    marketValidated,
    message: `Ingestion complete: ${processed} new articles processed (${marketValidated} market-validated), ${noiseFiltered} noise-filtered, ${duplicatesSkipped} duplicates skipped`,
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

        await db
          .update(articlesTable)
          .set({
            creditSummaryJson: analysis.creditSummary ?? null,
            scoreExplanationJson: analysis.scoreExplanation ?? null,
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
            processedAt: new Date(),
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

    return { backfilledStructured, retriedUnprocessed, skippedNoiseFilter, aiNullReturned, errors };
  });

  if (!result) {
    return {
      jobId: null,
      backfilledStructured: 0,
      retriedUnprocessed: 0,
      skippedNoiseFilter: 0,
      aiNullReturned: 0,
      errors: 0,
      message: "Backfill skipped: another backfill job is already running",
    };
  }

  const { backfilledStructured, retriedUnprocessed, skippedNoiseFilter, aiNullReturned, errors } = result;
  return {
    jobId: null,
    backfilledStructured,
    retriedUnprocessed,
    skippedNoiseFilter,
    aiNullReturned,
    errors,
    message: `Backfill complete: ${backfilledStructured} structured outputs updated, ${retriedUnprocessed} unprocessed articles processed, ${skippedNoiseFilter} noise-filtered (legitimately skipped), ${aiNullReturned} AI null returns, ${errors} errors`,
  };
}
