import { Router, type IRouter } from "express";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db, articlesTable } from "@workspace/db";
import { TriggerRefreshResponse } from "@workspace/api-zod";
import { fetchAllArticles } from "../lib/dataProviders";
import { analyzeArticle, passesNoiseFilter, isCreditTitleOverride } from "../lib/aiProcessing";
import { getETFSnapshot, validateWithMarketData } from "../lib/marketData";
import { logger } from "../lib/logger";
import { enrichContent } from "../lib/contentEnricher";
import { canonicalizeIssuer } from "../lib/canonicalIssuers";
import { evaluateAlerts } from "../lib/alertEvaluation";

function sanitizeNullStr(val: string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const trimmed = val.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "undefined" || trimmed === "N/A" || trimmed === "n/a") return null;
  return trimmed;
}

function sanitizeIssuer(val: string | null | undefined): string | null {
  return canonicalizeIssuer(sanitizeNullStr(val));
}

const router: IRouter = Router();

router.post("/refresh", async (req, res): Promise<void> => {
  req.log.info("Starting data ingestion");

  let fetched = 0;
  let processed = 0;
  let duplicatesSkipped = 0;
  let noiseFiltered = 0;
  let errors = 0;
  let marketValidated = 0;

  try {
    const etfSnapshot = await getETFSnapshot();
    req.log.info({
      hygMove: etfSnapshot.hyg?.move1D?.toFixed(3) ?? "n/a",
      lqdMove: etfSnapshot.lqd?.move1D?.toFixed(3) ?? "n/a",
    }, "ETF snapshot ready");

    const allRaw = await fetchAllArticles();
    fetched = allRaw.length;
    req.log.info({ fetched }, "Fetched raw articles from all providers");

    const existingUrls = new Set(
      (await db.select({ url: articlesTable.url }).from(articlesTable)).map((r) => r.url)
    );

    const newArticles = allRaw.filter((a) => !existingUrls.has(a.url));
    duplicatesSkipped = allRaw.length - newArticles.length;

    for (const raw of newArticles) {
      try {
        const rawSnippet = raw.rawContent ?? "";
        const enriched = await enrichContent(raw.url, raw.source, rawSnippet).catch(() => ({
          rawContent: rawSnippet,
          contentSourceType: "rss_snippet" as const,
          contentDepthScore: Math.min(30, Math.floor(rawSnippet.length / 10)),
        }));

        let hasContent = (enriched.rawContent?.trim().length ?? 0) > 0;

        // ── Title-triggered enrichment override ──────────────────────────────
        // For high-value credit titles, retry enrichment with forceAttempt=true
        // even if the source is normally on the skip list (e.g. WSJ, FT).
        // This recovers articles where the RSS snippet was empty but the page
        // is accessible.  We do NOT block ingestion if this also fails.
        if (!hasContent && isCreditTitleOverride(raw.title)) {
          req.log.info(
            { title: raw.title.slice(0, 70), source: raw.source },
            "Empty content + credit title override: forcing enrichment re-attempt"
          );
          const forced = await enrichContent(raw.url, raw.source, rawSnippet, true).catch(() => enriched);
          if ((forced.rawContent?.trim().length ?? 0) > enriched.rawContent?.trim().length) {
            Object.assign(enriched, forced);
            hasContent = true;
            req.log.info(
              { title: raw.title.slice(0, 70), contentLen: forced.rawContent?.length },
              "Title override enrichment succeeded"
            );
          } else {
            req.log.info(
              { title: raw.title.slice(0, 70) },
              "Title override enrichment: still empty after force-attempt"
            );
          }
        }

        if (!hasContent) {
          noiseFiltered++;
          req.log.info(
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
          });
          continue;
        }

        const noisePass = passesNoiseFilter(raw.title, enriched.rawContent);
        const titleOverride = !noisePass && isCreditTitleOverride(raw.title);
        if (!noisePass && !titleOverride) {
          noiseFiltered++;
          req.log.info(
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
          });
          continue;
        }
        if (titleOverride) {
          req.log.info(
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
          req.log.warn(
            { title: raw.title.slice(0, 70) },
            "AI processing returned null — storing as unprocessed stub"
          );
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

          // Structured AI outputs — persisted as JSON columns
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

        // Trigger alert evaluation for articles that have a matched issuer.
        // Uses fields from the just-inserted row — no extra query needed.
        // evaluateAlerts is self-contained and never throws — failures are logged
        // internally and do not affect the ingestion result.
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
            req.log.info({ articleId: persisted.id, alertCount }, "Alert events created");
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (err) {
        logger.error({ err, url: raw.url }, "Error processing article");
        errors++;
      }
    }

    req.log.info(
      { fetched, processed, duplicatesSkipped, noiseFiltered, marketValidated, errors },
      "Ingestion complete"
    );

    res.json(
      TriggerRefreshResponse.parse({
        fetched,
        processed,
        duplicatesSkipped,
        errors,
        message: `Ingestion complete: ${processed} new articles processed (${marketValidated} market-validated), ${noiseFiltered} noise-filtered, ${duplicatesSkipped} duplicates skipped`,
      })
    );
  } catch (err) {
    logger.error({ err }, "Ingestion failed");
    res.status(500).json({ error: "Ingestion failed" });
  }
});

// ── Backfill endpoint ──────────────────────────────────────────────────────────
// Fixes two gaps:
// 1. Articles processed before creditSummary/scoreExplanation were added to the prompt
//    → re-runs AI for structured outputs only, does UPDATE
// 2. Articles with processedAt=null that may have failed AI (not noise-filtered)
//    → re-checks noise filter, re-runs full AI if they pass, does UPDATE
router.post("/refresh/backfill", async (req, res): Promise<void> => {
  req.log.info("Starting structured-output backfill");

  let backfilledStructured = 0;
  let retriedUnprocessed = 0;
  let skippedNoiseFilter = 0;
  let aiNullReturned = 0;
  let errors = 0;

  try {
    // ── Phase 1: Articles already AI-processed but missing structured JSON ──
    const needsStructuredBackfill = await db
      .select({
        id: articlesTable.id,
        title: articlesTable.title,
        rawContent: articlesTable.rawContent,
      })
      .from(articlesTable)
      .where(
        and(
          isNotNull(articlesTable.processedAt),
          isNull(articlesTable.creditSummaryJson)
        )
      )
      .limit(30);

    req.log.info(
      { count: needsStructuredBackfill.length },
      "Phase 1: articles needing structured output backfill"
    );

    for (const article of needsStructuredBackfill) {
      try {
        const analysis = await analyzeArticle(article.title, article.rawContent);

        if (!analysis) {
          req.log.warn(
            { id: article.id, title: article.title.slice(0, 70) },
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
        req.log.info(
          { id: article.id, title: article.title.slice(0, 70), hasSummary: !!analysis.creditSummary },
          "Backfill Phase 1: structured outputs updated"
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (err) {
        logger.error({ err, id: article.id }, "Backfill Phase 1: error");
        errors++;
      }
    }

    // ── Phase 2: Articles with processedAt=null — retry AI ──────────────────
    const unprocessed = await db
      .select({
        id: articlesTable.id,
        title: articlesTable.title,
        rawContent: articlesTable.rawContent,
      })
      .from(articlesTable)
      .where(isNull(articlesTable.processedAt))
      .limit(20);

    req.log.info(
      { count: unprocessed.length },
      "Phase 2: unprocessed articles to retry"
    );

    for (const article of unprocessed) {
      try {
        const noisePass = passesNoiseFilter(article.title, article.rawContent);
        const titleOverride = !noisePass && isCreditTitleOverride(article.title);
        if (!noisePass && !titleOverride) {
          skippedNoiseFilter++;
          req.log.info(
            { id: article.id, title: article.title.slice(0, 70) },
            "Backfill Phase 2: noise-filtered, skip"
          );
          continue;
        }
        if (titleOverride) {
          req.log.info(
            { id: article.id, title: article.title.slice(0, 70) },
            "Backfill Phase 2: noise filter bypassed by credit title override"
          );
        }

        const analysis = await analyzeArticle(article.title, article.rawContent);

        if (!analysis) {
          req.log.warn(
            { id: article.id, title: article.title.slice(0, 70) },
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
        req.log.info(
          { id: article.id, title: article.title.slice(0, 70) },
          "Backfill Phase 2: successfully processed previously-unprocessed article"
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (err) {
        logger.error({ err, id: article.id }, "Backfill Phase 2: error");
        errors++;
      }
    }

    const message = `Backfill complete: ${backfilledStructured} structured outputs updated, ${retriedUnprocessed} unprocessed articles processed, ${skippedNoiseFilter} noise-filtered (legitimately skipped), ${aiNullReturned} AI null returns, ${errors} errors`;
    req.log.info(
      { backfilledStructured, retriedUnprocessed, skippedNoiseFilter, aiNullReturned, errors },
      "Backfill complete"
    );

    res.json({ backfilledStructured, retriedUnprocessed, skippedNoiseFilter, aiNullReturned, errors, message });
  } catch (err) {
    logger.error({ err }, "Backfill failed");
    res.status(500).json({ error: "Backfill failed" });
  }
});

export default router;
