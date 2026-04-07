/**
 * services/alertEvaluationService.ts
 *
 * Phase 3: Enhanced alert evaluation service.
 *
 * evaluateAlertsForArticle(articleId):
 *   - Fetches the article from the DB after pipeline completes
 *   - Evaluates all active alert rules (org-scoped, portfolio-filtered)
 *   - Creates alert events with confidence + severity
 *   - Applies deduplication by (issuer + eventType + time window) to prevent
 *     flooding — rules that fired for the same issuer/eventType within the
 *     cooldown window are skipped
 *
 * The legacy evaluateAlerts() in lib/alertEvaluation.ts is preserved for
 * backward compatibility with the existing ingestion path.
 */
import {
  db,
  articlesTable,
  alertRulesTable,
  alertEventsTable,
  alertFeedbackTable,
  alertWorkflowStateTable,
  watchlistItemsTable,
  portfolioIssuerMapTable,
  portfolioHoldingsTable,
  portfoliosTable,
} from "@workspace/db";
import { and, eq, inArray, or, gte, lte, desc, count, isNull, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum minutes between duplicate alerts for the same issuer + eventType per rule. */
const ALERT_COOLDOWN_MINUTES = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertSeverity = "high" | "medium" | "low";

export interface AlertEvaluationResult {
  articleId: number;
  alertsCreated: number;
  alertsSkippedDuplicate: number;
  alertsSkippedCooldown: number;
  alertsSkippedPortfolioFilter: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeSeverity(urgency: number | null, confidence: number | null): AlertSeverity {
  const u = urgency ?? 0;
  const c = confidence ?? 0;
  if (u >= 7 || c >= 0.8) return "high";
  if (u >= 4 || c >= 0.5) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

/**
 * Evaluates all active alert rules against the article identified by `articleId`.
 *
 * Designed to be called immediately after processArticlePipeline completes.
 * Never throws — failures are logged and swallowed so the pipeline caller is
 * not affected.
 *
 * @returns Summary of evaluation outcome.
 */
export async function evaluateAlertsForArticle(
  articleId: number
): Promise<AlertEvaluationResult> {
  const result: AlertEvaluationResult = {
    articleId,
    alertsCreated: 0,
    alertsSkippedDuplicate: 0,
    alertsSkippedCooldown: 0,
    alertsSkippedPortfolioFilter: 0,
  };

  try {
    // ── 1. Fetch article fields needed for evaluation ──────────────────────
    const [article] = await db
      .select({
        id: articlesTable.id,
        title: articlesTable.title,
        issuerName: articlesTable.issuerName,
        finalUrgencyScore: articlesTable.finalUrgencyScore,
        eventType: articlesTable.eventType,
        sector: articlesTable.sector,
        covenantFlag: articlesTable.covenantFlag,
        classificationConfidence: articlesTable.classificationConfidence,
      })
      .from(articlesTable)
      .where(eq(articlesTable.id, articleId))
      .limit(1);

    if (!article) {
      logger.warn({ articleId }, "evaluateAlertsForArticle: article not found");
      return result;
    }

    if (!article.issuerName) return result;

    // ── 2. Find watchlists watching this issuer ────────────────────────────
    const matchingItems = await db
      .select({ watchlistId: watchlistItemsTable.watchlistId })
      .from(watchlistItemsTable)
      .where(
        or(
          eq(watchlistItemsTable.normalizedIssuerName, article.issuerName),
          eq(watchlistItemsTable.issuerName, article.issuerName),
        ),
      );

    if (matchingItems.length === 0) return result;

    const watchlistIds = [...new Set(matchingItems.map((i) => i.watchlistId))];

    // ── 3. Fetch active alert rules for those watchlists ───────────────────
    const rules = await db
      .select()
      .from(alertRulesTable)
      .where(
        and(
          inArray(alertRulesTable.watchlistId, watchlistIds),
          eq(alertRulesTable.isActive, true),
        ),
      );

    if (rules.length === 0) return result;

    // ── 4. Cooldown check: fetch recent events for this issuer ─────────────
    const cooldownCutoff = new Date(Date.now() - ALERT_COOLDOWN_MINUTES * 60 * 1000);
    const recentEvents = await db
      .select({
        alertRuleId: alertEventsTable.alertRuleId,
        issuerName: alertEventsTable.issuerName,
        eventType: alertEventsTable.eventType,
        triggeredAt: alertEventsTable.triggeredAt,
      })
      .from(alertEventsTable)
      .where(
        and(
          eq(alertEventsTable.issuerName, article.issuerName),
          gte(alertEventsTable.triggeredAt, cooldownCutoff),
        ),
      );

    // Build a set of rule IDs that fired recently for this issuer + eventType
    const cooledDown = new Set<string>();
    for (const ev of recentEvents) {
      if (ev.eventType === article.eventType) {
        cooledDown.add(`${ev.alertRuleId}:${ev.issuerName}:${ev.eventType}`);
      }
    }

    // ── 5. Portfolio membership cache ─────────────────────────────────────
    // Lazily build a set of portfolioIds that contain this issuer, to avoid
    // N DB queries when multiple rules reference different portfolios.
    const portfolioMembershipCache = new Map<number, boolean>();

    async function issuerInPortfolio(portfolioId: number): Promise<boolean> {
      const cached = portfolioMembershipCache.get(portfolioId);
      if (cached !== undefined) return cached;

      const [row] = await db
        .select({ id: portfolioIssuerMapTable.id })
        .from(portfolioIssuerMapTable)
        .innerJoin(
          portfolioHoldingsTable,
          eq(portfolioIssuerMapTable.portfolioHoldingId, portfolioHoldingsTable.id),
        )
        .where(
          and(
            eq(portfolioHoldingsTable.portfolioId, portfolioId),
            eq(portfolioIssuerMapTable.canonicalIssuerName, article.issuerName!),
          ),
        )
        .limit(1);

      const found = !!row;
      portfolioMembershipCache.set(portfolioId, found);
      return found;
    }

    // ── 6. Evaluate each rule ──────────────────────────────────────────────
    const eventsToInsert: {
      alertRuleId: number;
      watchlistId: number;
      articleId: number;
      issuerName: string;
      title: string;
      urgency: number | null;
      eventType: string | null;
      confidence: number | null;
      severity: AlertSeverity;
    }[] = [];

    for (const rule of rules) {
      // minimumUrgency filter
      if (rule.minimumUrgency !== null && rule.minimumUrgency !== undefined) {
        if ((article.finalUrgencyScore ?? 0) < rule.minimumUrgency) continue;
      }

      // severityThreshold filter (derived score)
      if (rule.severityThreshold !== null && rule.severityThreshold !== undefined) {
        if ((article.finalUrgencyScore ?? 0) < rule.severityThreshold) continue;
      }

      // confidenceThreshold filter
      if (rule.confidenceThreshold !== null && rule.confidenceThreshold !== undefined) {
        if ((article.classificationConfidence ?? 0) < rule.confidenceThreshold) continue;
      }

      // eventTypes allowlist
      if (rule.eventTypes !== null && rule.eventTypes !== undefined && rule.eventTypes.length > 0) {
        if (!article.eventType || !rule.eventTypes.includes(article.eventType)) continue;
      }

      // covenantFlagOnly
      if (rule.covenantFlagOnly && !article.covenantFlag) continue;

      // JSON conditions: sector filter
      const conds = rule.conditions as Record<string, unknown> | null | undefined;
      if (conds?.sectors && Array.isArray(conds.sectors) && conds.sectors.length > 0) {
        if (!article.sector || !(conds.sectors as string[]).includes(article.sector)) continue;
      }

      // Cooldown deduplication
      const cooldownKey = `${rule.id}:${article.issuerName}:${article.eventType}`;
      if (cooledDown.has(cooldownKey)) {
        result.alertsSkippedCooldown++;
        continue;
      }

      // Portfolio-scoped filter
      if (rule.portfolioId !== null && rule.portfolioId !== undefined) {
        const inPortfolio = await issuerInPortfolio(rule.portfolioId);
        if (!inPortfolio) {
          result.alertsSkippedPortfolioFilter++;
          continue;
        }
      }

      eventsToInsert.push({
        alertRuleId: rule.id,
        watchlistId: rule.watchlistId,
        articleId: article.id,
        issuerName: article.issuerName,
        title: article.title,
        urgency: article.finalUrgencyScore ?? null,
        eventType: article.eventType ?? null,
        confidence: article.classificationConfidence ?? null,
        severity: computeSeverity(article.finalUrgencyScore, article.classificationConfidence),
      });
    }

    if (eventsToInsert.length === 0) return result;

    // ── 7. Bulk insert (ON CONFLICT DO NOTHING for idempotency) ───────────
    const inserted = await db
      .insert(alertEventsTable)
      .values(eventsToInsert)
      .onConflictDoNothing()
      .returning({ id: alertEventsTable.id });

    result.alertsCreated = inserted.length;
    result.alertsSkippedDuplicate = eventsToInsert.length - inserted.length;

    logger.info(
      {
        articleId,
        alertsCreated: result.alertsCreated,
        alertsSkippedDuplicate: result.alertsSkippedDuplicate,
        alertsSkippedCooldown: result.alertsSkippedCooldown,
        alertsSkippedPortfolioFilter: result.alertsSkippedPortfolioFilter,
      },
      "Alert evaluation complete"
    );

    return result;
  } catch (err) {
    logger.error({ err, articleId }, "evaluateAlertsForArticle: unexpected error");
    return result;
  }
}

// ---------------------------------------------------------------------------
// Portfolio exposure alerts query
// ---------------------------------------------------------------------------

export interface PortfolioExposureAlert {
  issuerName: string;
  totalAlerts: number;
  highSeverityCount: number;
  mediumSeverityCount: number;
  lowSeverityCount: number;
  latestTriggeredAt: Date;
  events: Array<{
    id: number;
    alertRuleId: number;
    articleId: number;
    eventType: string | null;
    confidence: number | null;
    severity: string | null;
    triggeredAt: Date;
    isRead: boolean;
  }>;
}

/**
 * Returns all alert events affecting issuers in a given portfolio,
 * grouped by issuer and sorted by severity + recency.
 */
export async function getPortfolioExposureAlerts(
  portfolioId: number
): Promise<PortfolioExposureAlert[]> {
  // Get all canonical issuer names in this portfolio
  const holdings = await db
    .select({
      canonicalIssuerName: portfolioIssuerMapTable.canonicalIssuerName,
    })
    .from(portfolioIssuerMapTable)
    .innerJoin(
      portfolioHoldingsTable,
      eq(portfolioIssuerMapTable.portfolioHoldingId, portfolioHoldingsTable.id),
    )
    .where(eq(portfolioHoldingsTable.portfolioId, portfolioId));

  if (holdings.length === 0) return [];

  const issuerNames = [...new Set(holdings.map((h) => h.canonicalIssuerName))];

  // Fetch all alert events for those issuers
  const events = await db
    .select()
    .from(alertEventsTable)
    .where(inArray(alertEventsTable.issuerName, issuerNames))
    .orderBy(desc(alertEventsTable.triggeredAt));

  // Group by issuer
  const grouped = new Map<string, PortfolioExposureAlert>();

  for (const ev of events) {
    const existing = grouped.get(ev.issuerName);
    const evEntry = {
      id: ev.id,
      alertRuleId: ev.alertRuleId,
      articleId: ev.articleId,
      eventType: ev.eventType,
      confidence: ev.confidence,
      severity: ev.severity,
      triggeredAt: ev.triggeredAt,
      isRead: ev.isRead,
    };

    if (!existing) {
      grouped.set(ev.issuerName, {
        issuerName: ev.issuerName,
        totalAlerts: 1,
        highSeverityCount: ev.severity === "high" ? 1 : 0,
        mediumSeverityCount: ev.severity === "medium" ? 1 : 0,
        lowSeverityCount: ev.severity === "low" ? 1 : 0,
        latestTriggeredAt: ev.triggeredAt,
        events: [evEntry],
      });
    } else {
      existing.totalAlerts++;
      if (ev.severity === "high") existing.highSeverityCount++;
      else if (ev.severity === "medium") existing.mediumSeverityCount++;
      else existing.lowSeverityCount++;
      existing.events.push(evEntry);
    }
  }

  // Sort groups: most high-severity first, then by most recent event
  return [...grouped.values()].sort((a, b) => {
    if (b.highSeverityCount !== a.highSeverityCount) return b.highSeverityCount - a.highSeverityCount;
    if (b.mediumSeverityCount !== a.mediumSeverityCount) return b.mediumSeverityCount - a.mediumSeverityCount;
    return b.latestTriggeredAt.getTime() - a.latestTriggeredAt.getTime();
  });
}

// ---------------------------------------------------------------------------
// Org-scoped alert query
// ---------------------------------------------------------------------------

export interface AlertsFilter {
  severity?: "high" | "medium" | "low";
  issuerName?: string;
  eventType?: string;
  isRead?: boolean;
  portfolioLinked?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
  /**
   * Filter by analyst workflow action.
   * "unassigned" returns alerts that have no workflow state set.
   */
  action?: "investigate" | "monitor" | "ignore" | "unassigned";
  /** When provided, include per-user workflow and feedback state in each alert. */
  userId?: string;
  limit?: number;
  offset?: number;
}

export interface AlertsPage {
  alerts: Array<
    typeof alertEventsTable.$inferSelect & {
      portfolioLinked: boolean;
      workflowAction: "investigate" | "monitor" | "ignore" | null;
      feedbackRating: "useful" | "noise" | "investigate_later" | null;
    }
  >;
  total: number;
}

/**
 * Returns alert events for an organization with optional filters and pagination.
 * Org safety: joins alertEvents → alertRules and filters by organizationId.
 *
 * When filters.action is provided, the result is filtered by workflow action.
 * "unassigned" returns alerts with no workflow state for the org.
 */
export async function getAlertsForOrganization(
  orgId: string,
  filters: AlertsFilter = {},
): Promise<AlertsPage> {
  const {
    severity,
    issuerName,
    eventType,
    isRead,
    dateFrom,
    dateTo,
    action,
    limit = 50,
    offset = 0,
  } = filters;

  // Build WHERE conditions for alert_events joined with alert_rules
  const conditions: Parameters<typeof and>[0][] = [
    eq(alertRulesTable.organizationId, orgId),
  ];

  if (severity !== undefined) {
    conditions.push(eq(alertEventsTable.severity, severity));
  }
  if (issuerName !== undefined) {
    conditions.push(eq(alertEventsTable.issuerName, issuerName));
  }
  if (eventType !== undefined) {
    conditions.push(eq(alertEventsTable.eventType, eventType));
  }
  if (isRead !== undefined) {
    conditions.push(eq(alertEventsTable.isRead, isRead));
  }
  if (dateFrom !== undefined) {
    conditions.push(gte(alertEventsTable.triggeredAt, dateFrom));
  }
  if (dateTo !== undefined) {
    conditions.push(lte(alertEventsTable.triggeredAt, dateTo));
  }

  // Workflow action filter — applied after join
  if (action === "unassigned") {
    conditions.push(isNull(alertWorkflowStateTable.id));
  } else if (action !== undefined) {
    conditions.push(eq(alertWorkflowStateTable.action, action));
  }

  const where = and(...conditions);

  // Get portfolio issuer set for this org's portfolios to tag alerts
  const portfolioIssuers = await db
    .selectDistinct({ issuerName: portfolioIssuerMapTable.canonicalIssuerName })
    .from(portfolioIssuerMapTable)
    .innerJoin(
      portfolioHoldingsTable,
      eq(portfolioIssuerMapTable.portfolioHoldingId, portfolioHoldingsTable.id),
    )
    .innerJoin(
      portfoliosTable,
      eq(portfolioHoldingsTable.portfolioId, portfoliosTable.id),
    )
    .where(eq(portfoliosTable.organizationId, orgId));

  const portfolioIssuerSet = new Set(portfolioIssuers.map((r) => r.issuerName));

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: alertEventsTable.id,
        alertRuleId: alertEventsTable.alertRuleId,
        watchlistId: alertEventsTable.watchlistId,
        articleId: alertEventsTable.articleId,
        issuerName: alertEventsTable.issuerName,
        title: alertEventsTable.title,
        urgency: alertEventsTable.urgency,
        eventType: alertEventsTable.eventType,
        confidence: alertEventsTable.confidence,
        severity: alertEventsTable.severity,
        triggeredAt: alertEventsTable.triggeredAt,
        isRead: alertEventsTable.isRead,
        workflowAction: alertWorkflowStateTable.action,
        feedbackRating: alertFeedbackTable.rating,
      })
      .from(alertEventsTable)
      .innerJoin(alertRulesTable, eq(alertEventsTable.alertRuleId, alertRulesTable.id))
      .leftJoin(
        alertWorkflowStateTable,
        and(
          eq(alertWorkflowStateTable.alertEventId, alertEventsTable.id),
          eq(alertWorkflowStateTable.organizationId, orgId),
        ),
      )
      .leftJoin(
        alertFeedbackTable,
        and(
          eq(alertFeedbackTable.alertEventId, alertEventsTable.id),
          eq(alertFeedbackTable.organizationId, orgId),
        ),
      )
      .where(where)
      .orderBy(desc(alertEventsTable.triggeredAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(alertEventsTable)
      .innerJoin(alertRulesTable, eq(alertEventsTable.alertRuleId, alertRulesTable.id))
      .leftJoin(
        alertWorkflowStateTable,
        and(
          eq(alertWorkflowStateTable.alertEventId, alertEventsTable.id),
          eq(alertWorkflowStateTable.organizationId, orgId),
        ),
      )
      .where(where),
  ]);

  // Apply portfolioLinked filter after fetch (or tag)
  const tagged = rows.map((r) => ({
    ...r,
    portfolioLinked: portfolioIssuerSet.has(r.issuerName),
    workflowAction: r.workflowAction ?? null,
    feedbackRating: r.feedbackRating ?? null,
  }));

  const finalAlerts =
    filters.portfolioLinked !== undefined
      ? tagged.filter((r) => r.portfolioLinked === filters.portfolioLinked)
      : tagged;

  return { alerts: finalAlerts, total };
}
