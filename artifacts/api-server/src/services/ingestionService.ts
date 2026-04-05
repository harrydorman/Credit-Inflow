/**
 * IngestionService — Phase 1 service layer
 *
 * Extracts all ingestion and backfill business logic out of route handlers.
 * Responsibilities:
 *   - DB-backed job locking (prevents concurrent ingestion collisions)
 *   - Improved deduplication via URL + content fingerprint
 *   - Structured logging with job IDs and article IDs
 *   - Job lifecycle tracking (ingestion_jobs table)
 *   - All article processing steps (enrich → noise-filter → AI → persist → alert)
 */

import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db, articlesTable, ingestionJobsTable } from "@workspace/db";
import type { RefreshJobResult, BackfillJobResult } from "@workspace/db";
import { fetchAllArticles } from "../lib/dataProviders";
import { analyzeArticle, passesNoiseFilter, isCreditTitleOverride } from "../lib/aiProcessing";
import { getETFSnapshot, validateWithMarketData } from "../lib/marketData";
import { logger as rootLogger } from "../lib/logger";
import { enrichContent } from "../lib/contentEnricher";
import { evaluateAlerts } from "../lib/alertEvaluation";
import type { Logger } from "pino";
import { sanitizeNullStr, sanitizeIssuer, computeContentFingerprint } from "./ingestionHelpers";

export { sanitizeNullStr, sanitizeIssuer, computeContentFingerprint };

// Rate-limiting delays between AI calls to avoid overwhelming the OpenAI API.
// Kept small but non-zero to respect rate limits during batch processing.
const INGESTION_ARTICLE_DELAY_MS = 100;
const BACKFILL_ARTICLE_DELAY_MS = 150;

// ── Job lifecycle ────────────────────────────────────────────────────────────

export class JobAlreadyRunningError extends Error {
  constructor(jobKey: string) {
    super(`A ${jobKey} job is already running`);
    this.name = "JobAlreadyRunningError";
  }
}

/** Inserts a running job row. Throws JobAlreadyRunningError on unique-constraint collision. */
async function startJob(jobKey: string, jobType: "refresh" | "backfill"): Promise<number> {
  try {
    const [row] = await db
      .insert(ingestionJobsTable)
      .values({ jobType, jobKey, status: "running" })
      .returning({ id: ingestionJobsTable.id });
    return row.id;
  } catch (err: unknown) {
    // PostgreSQL unique-violation code is '23505'
    const pgCode = (err as { code?: string }).code;
    if (pgCode === "23505") {
      throw new JobAlreadyRunningError(jobKey);
    }
    throw err;
  }
}

async function completeJob(jobId: number, result: RefreshJobResult | BackfillJobResult): Promise<void> {
  await db
    .update(ingestionJobsTable)
    .set({ status: "completed", completedAt: new Date(), result })
    .where(eq(ingestionJobsTable.id, jobId));
}

async function failJob(jobId: number, errorMessage: string): Promise<void> {
  await db
    .update(ingestionJobsTable)
    .set({ status: "failed", completedAt: new Date(), errorMessage })
    .where(eq(ingestionJobsTable.id, jobId));
}

// ── Refresh (main ingestion) ─────────────────────────────────────────────────

export async function runRefresh(log: Logger = rootLogger): Promise<RefreshJobResult> {
  const jobId = await startJob("refresh", "refresh");
  const jobLog = log.child({ jobId, jobType: "refresh" });

  let fetched = 0;
  let processed = 0;
  let duplicatesSkipped = 0;
  let fingerprintSkipped = 0;
  let noiseFiltered = 0;
  let errors = 0;
  let marketValidated = 0;

  try {
    const etfSnapshot = await getETFSnapshot();
    jobLog.info(
      { hygMove: etfSnapshot.hyg?.move1D?.toFixed(3) ?? "n/a", lqdMove: etfSnapshot.lqd?.move1D?.toFixed(3) ?? "n/a" },
      "ETF snapshot ready",
    );

    const allRaw = await fetchAllArticles();
    fetched = allRaw.length;
    jobLog.info({ fetched }, "Fetched raw articles from all providers");

    // ── Deduplication: URL + content fingerprint ─────────────────────────────
    const [existingUrlRows, existingFingerprintRows] = await Promise.all([
      db.select({ url: articlesTable.url }).from(articlesTable),
      db.select({ fp: articlesTable.contentFingerprint }).from(articlesTable).where(isNotNull(articlesTable.contentFingerprint)),
    ]);

    const existingUrls = new Set(existingUrlRows.map((r) => r.url));
    const existingFingerprints = new Set(
      existingFingerprintRows.map((r) => r.fp).filter(Boolean) as string[],
    );

    for (const raw of allRaw) {
      // URL-based dedup (fast path)
      if (existingUrls.has(raw.url)) {
        duplicatesSkipped++;
        continue;
      }

      // Fingerprint-based dedup (catches re-published articles with different URLs)
      const fingerprint = computeContentFingerprint(raw.title, raw.rawContent);
      if (existingFingerprints.has(fingerprint)) {
        fingerprintSkipped++;
        jobLog.info(
          { title: raw.title.slice(0, 70), source: raw.source },
          "Fingerprint duplicate: skipping article with different URL but same content",
        );
        continue;
      }

      // Register so in-batch duplicates from the same feed are also caught
      existingUrls.add(raw.url);
      existingFingerprints.add(fingerprint);

      try {
        const rawSnippet = raw.rawContent ?? "";
        const enriched = await enrichContent(raw.url, raw.source, rawSnippet).catch(() => ({
          rawContent: rawSnippet,
          contentSourceType: "rss_snippet" as const,
          contentDepthScore: Math.min(30, Math.floor(rawSnippet.length / 10)),
        }));

        let hasContent = (enriched.rawContent?.trim().length ?? 0) > 0;

        if (!hasContent && isCreditTitleOverride(raw.title)) {
          jobLog.info(
            { title: raw.title.slice(0, 70), source: raw.source },
            "Empty content + credit title override: forcing enrichment re-attempt",
          );
          const forced = await enrichContent(raw.url, raw.source, rawSnippet, true).catch(() => enriched);
          if ((forced.rawContent?.trim().length ?? 0) > (enriched.rawContent?.trim().length ?? 0)) {
            Object.assign(enriched, forced);
            hasContent = true;
            jobLog.info(
              { title: raw.title.slice(0, 70), contentLen: forced.rawContent?.length },
              "Title override enrichment succeeded",
            );
          } else {
            jobLog.info({ title: raw.title.slice(0, 70) }, "Title override enrichment: still empty after force-attempt");
          }
        }

        if (!hasContent) {
          noiseFiltered++;
          jobLog.info(
            { title: raw.title.slice(0, 70), source: raw.source },
            "Empty content: skipping AI processing",
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
            contentFingerprint: fingerprint,
            processFailureReason: "empty_content",
            processedAt: null,
          });
          continue;
        }

        const noisePass = passesNoiseFilter(raw.title, enriched.rawContent);
        const titleOverride = !noisePass && isCreditTitleOverride(raw.title);
        if (!noisePass && !titleOverride) {
          noiseFiltered++;
          jobLog.info(
            { title: raw.title.slice(0, 70), source: raw.source },
            "Noise-filtered: skipping AI processing (score < threshold)",
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
            contentFingerprint: fingerprint,
            processFailureReason: "noise_filtered",
            processedAt: null,
          });
          continue;
        }
        if (titleOverride) {
          jobLog.info(
            { title: raw.title.slice(0, 70), source: raw.source },
            "Noise filter bypassed: credit title override triggered",
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
          jobLog.warn({ title: raw.title.slice(0, 70) }, "AI processing returned null — storing as unprocessed stub");
        }

        const [persisted] = await db.insert(articlesTable).values({
          title: raw.title,
          source: raw.source,
          publishedAt: raw.publishedAt,
          url: raw.url,
          rawSnippet,
          rawContent: enriched.rawContent,
          contentSourceType: enriched.contentSourceType,
          contentDepthScore: enriched.contentDepthScore,
          contentFingerprint: fingerprint,
          processFailureReason: analysis ? null : "ai_null",

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
        }).returning({
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

        await new Promise((resolve) => setTimeout(resolve, INGESTION_ARTICLE_DELAY_MS));
      } catch (err) {
        rootLogger.error({ err, url: raw.url, jobId }, "Error processing article");
        errors++;
      }
    }

    jobLog.info(
      { fetched, processed, duplicatesSkipped, fingerprintSkipped, noiseFiltered, marketValidated, errors },
      "Ingestion complete",
    );

    const result: RefreshJobResult = {
      fetched,
      processed,
      duplicatesSkipped: duplicatesSkipped + fingerprintSkipped,
      fingerprintSkipped,
      noiseFiltered,
      marketValidated,
      errors,
      message: `Ingestion complete: ${processed} new articles processed (${marketValidated} market-validated), ${noiseFiltered} noise-filtered, ${duplicatesSkipped + fingerprintSkipped} duplicates skipped (${fingerprintSkipped} by fingerprint)`,
    };

    await completeJob(jobId, result);
    return result;
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) throw err;
    await failJob(jobId, err instanceof Error ? err.message : String(err)).catch(() => undefined);
    throw err;
  }
}

// ── Backfill ─────────────────────────────────────────────────────────────────

export async function runBackfill(log: Logger = rootLogger): Promise<BackfillJobResult> {
  const jobId = await startJob("backfill", "backfill");
  const jobLog = log.child({ jobId, jobType: "backfill" });

  let backfilledStructured = 0;
  let retriedUnprocessed = 0;
  let skippedNoiseFilter = 0;
  let aiNullReturned = 0;
  let errors = 0;

  try {
    // ── Phase 1: Articles already AI-processed but missing structured JSON ───
    const needsStructuredBackfill = await db
      .select({ id: articlesTable.id, title: articlesTable.title, rawContent: articlesTable.rawContent })
      .from(articlesTable)
      .where(and(isNotNull(articlesTable.processedAt), isNull(articlesTable.creditSummaryJson)))
      .limit(30);

    jobLog.info({ count: needsStructuredBackfill.length }, "Phase 1: articles needing structured output backfill");

    for (const article of needsStructuredBackfill) {
      try {
        const analysis = await analyzeArticle(article.title, article.rawContent);

        if (!analysis) {
          jobLog.warn({ articleId: article.id, title: article.title.slice(0, 70) }, "Backfill Phase 1: AI returned null");
          aiNullReturned++;
          await new Promise((resolve) => setTimeout(resolve, BACKFILL_ARTICLE_DELAY_MS));
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
          "Backfill Phase 1: structured outputs updated",
        );
        await new Promise((resolve) => setTimeout(resolve, BACKFILL_ARTICLE_DELAY_MS));
      } catch (err) {
        rootLogger.error({ err, articleId: article.id, jobId }, "Backfill Phase 1: error");
        errors++;
      }
    }

    // ── Phase 2: Articles with processedAt=null — retry AI ──────────────────
    const unprocessed = await db
      .select({ id: articlesTable.id, title: articlesTable.title, rawContent: articlesTable.rawContent })
      .from(articlesTable)
      .where(isNull(articlesTable.processedAt))
      .limit(20);

    jobLog.info({ count: unprocessed.length }, "Phase 2: unprocessed articles to retry");

    for (const article of unprocessed) {
      try {
        const noisePass = passesNoiseFilter(article.title, article.rawContent);
        const titleOverride = !noisePass && isCreditTitleOverride(article.title);
        if (!noisePass && !titleOverride) {
          skippedNoiseFilter++;
          jobLog.info(
            { articleId: article.id, title: article.title.slice(0, 70) },
            "Backfill Phase 2: noise-filtered, skip",
          );
          continue;
        }
        if (titleOverride) {
          jobLog.info(
            { articleId: article.id, title: article.title.slice(0, 70) },
            "Backfill Phase 2: noise filter bypassed by credit title override",
          );
        }

        const analysis = await analyzeArticle(article.title, article.rawContent);

        if (!analysis) {
          jobLog.warn(
            { articleId: article.id, title: article.title.slice(0, 70) },
            "Backfill Phase 2: AI returned null on retry",
          );
          aiNullReturned++;
          await new Promise((resolve) => setTimeout(resolve, BACKFILL_ARTICLE_DELAY_MS));
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
          "Backfill Phase 2: successfully processed previously-unprocessed article",
        );
        await new Promise((resolve) => setTimeout(resolve, BACKFILL_ARTICLE_DELAY_MS));
      } catch (err) {
        rootLogger.error({ err, articleId: article.id, jobId }, "Backfill Phase 2: error");
        errors++;
      }
    }

    const result: BackfillJobResult = {
      backfilledStructured,
      retriedUnprocessed,
      skippedNoiseFilter,
      aiNullReturned,
      errors,
      message: `Backfill complete: ${backfilledStructured} structured outputs updated, ${retriedUnprocessed} unprocessed articles processed, ${skippedNoiseFilter} noise-filtered (legitimately skipped), ${aiNullReturned} AI null returns, ${errors} errors`,
    };

    await completeJob(jobId, result);
    return result;
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) throw err;
    await failJob(jobId, err instanceof Error ? err.message : String(err)).catch(() => undefined);
    throw err;
  }
}
