import { db, alertRulesTable, alertEventsTable, watchlistItemsTable } from "@workspace/db";
import { and, eq, inArray, or } from "drizzle-orm";
import { logger } from "./logger";

/**
 * The subset of article fields required to evaluate alert rules.
 * Passed in after the article has been persisted (so `id` is available).
 */
export interface ArticleForAlertEval {
  id: number;
  issuerName: string | null;
  title: string;
  finalUrgencyScore: number | null;
  eventType: string | null;
  covenantFlag: boolean;
}

/**
 * Evaluates alert rules against a newly-persisted article.
 *
 * Flow:
 * 1. Find watchlist items whose issuer matches the article (raw or canonical name).
 * 2. Fetch active alert rules for those watchlists.
 * 3. Apply per-rule filters (minimumUrgency, eventTypes, covenantFlagOnly).
 * 4. Bulk-insert matching alert events; duplicate rows are silently ignored via
 *    the DB uniqueness constraint on (alertRuleId, articleId).
 *
 * Returns the number of newly-inserted alert events (0 on no match or error).
 * Never throws — evaluation failures are logged and swallowed so ingestion
 * continues normally.
 */
export async function evaluateAlerts(article: ArticleForAlertEval): Promise<number> {
  if (!article.issuerName) return 0;

  try {
    // Step 1: find watchlist items that match this article's issuer.
    // Articles store canonicalized issuer names; watchlist items store both the
    // raw user-entered name and the normalized canonical form. We match against
    // both columns so edge cases (pre-canonicalization articles, exact-match
    // entries) are covered — mirrors the approach used in GetWatchlistArticles.
    const matchingItems = await db
      .select({ watchlistId: watchlistItemsTable.watchlistId })
      .from(watchlistItemsTable)
      .where(
        or(
          eq(watchlistItemsTable.normalizedIssuerName, article.issuerName),
          eq(watchlistItemsTable.issuerName, article.issuerName),
        ),
      );

    if (matchingItems.length === 0) return 0;

    const watchlistIds = [...new Set(matchingItems.map((i) => i.watchlistId))];

    // Step 2: fetch active alert rules for the matched watchlists only.
    const rules = await db
      .select()
      .from(alertRulesTable)
      .where(
        and(
          inArray(alertRulesTable.watchlistId, watchlistIds),
          eq(alertRulesTable.isActive, true),
        ),
      );

    if (rules.length === 0) return 0;

    // Step 3: apply rule-level filters in memory.
    const eventsToInsert: {
      alertRuleId: number;
      watchlistId: number;
      articleId: number;
      issuerName: string;
      title: string;
      urgency: number | null;
      eventType: string | null;
    }[] = [];

    for (const rule of rules) {
      // minimumUrgency: article must meet or exceed the threshold
      if (rule.minimumUrgency !== null && rule.minimumUrgency !== undefined) {
        if ((article.finalUrgencyScore ?? 0) < rule.minimumUrgency) continue;
      }

      // eventTypes: null means no filter; non-empty array is an allowlist
      if (rule.eventTypes !== null && rule.eventTypes !== undefined && rule.eventTypes.length > 0) {
        if (!article.eventType || !rule.eventTypes.includes(article.eventType)) continue;
      }

      // covenantFlagOnly: skip if article didn't trigger a covenant flag
      if (rule.covenantFlagOnly && !article.covenantFlag) continue;

      eventsToInsert.push({
        alertRuleId: rule.id,
        watchlistId: rule.watchlistId,
        articleId: article.id,
        issuerName: article.issuerName,
        title: article.title,
        urgency: article.finalUrgencyScore ?? null,
        eventType: article.eventType ?? null,
      });
    }

    if (eventsToInsert.length === 0) return 0;

    // Step 4: insert — ON CONFLICT DO NOTHING handles the unique constraint on
    // (alertRuleId, articleId), so re-ingesting the same article is safe.
    const inserted = await db
      .insert(alertEventsTable)
      .values(eventsToInsert)
      .onConflictDoNothing()
      .returning({ id: alertEventsTable.id });

    return inserted.length;
  } catch (err) {
    logger.error({ err, articleId: article.id }, "Alert evaluation failed for article");
    return 0;
  }
}
