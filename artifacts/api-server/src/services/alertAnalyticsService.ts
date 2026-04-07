/**
 * services/alertAnalyticsService.ts
 *
 * Phase 8: Workflow Analytics + Ranking Feedback Infrastructure.
 *
 * Provides modular, org-scoped analytics queries over workflow state and
 * feedback data.  All exported functions accept an `orgId` as their first
 * argument and only operate on data that belongs to that organisation.
 *
 * Exported query groups
 * ─────────────────────
 * Counts
 *   getWorkflowActionCounts         – alert count by workflow action
 *   getFeedbackRatingCounts         – alert count by feedback rating
 *
 * Distributions
 *   getActionDistributionByEventType  – workflow action counts per event type
 *   getFeedbackDistributionByEventType – feedback rating counts per event type
 *
 * Ratios by entity
 *   getInvestigateIgnoreRatioByIssuer  – per-issuer investigate / ignore counts
 *   getUsefulNoiseRatioByRule          – per-rule useful / noise counts
 *   getPortfolioLinkedWorkflowCounts   – portfolio-linked vs. non-linked counts
 *
 * Ranking-prep outputs (not wired into ranking yet)
 *   getEventTypeUsefulnessScores  – usefulness score per event type
 *   getIssuerInvestigateScores    – investigate-rate score per issuer
 *   getRuleNoiseScores            – noise-rate score per rule
 */

import {
  db,
  alertRulesTable,
  alertEventsTable,
  alertFeedbackTable,
  alertWorkflowStateTable,
  portfolioIssuerMapTable,
  portfolioHoldingsTable,
  portfoliosTable,
} from "@workspace/db";
import { and, eq, count, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ActionCount {
  action: string;
  count: number;
}

export interface FeedbackCount {
  rating: string;
  count: number;
}

export interface ActionByEventType {
  eventType: string;
  investigate: number;
  monitor: number;
  ignore: number;
  total: number;
}

export interface FeedbackByEventType {
  eventType: string;
  useful: number;
  noise: number;
  investigate_later: number;
  total: number;
}

export interface IssuerWorkflowRatio {
  issuerName: string;
  investigateCount: number;
  ignoreCount: number;
  monitorCount: number;
  total: number;
  /** investigateCount / total, or 0 when total === 0 */
  investigateRatio: number;
  /** ignoreCount / total, or 0 when total === 0 */
  ignoreRatio: number;
}

export interface RuleFeedbackRatio {
  ruleId: number;
  ruleName: string;
  usefulCount: number;
  noiseCount: number;
  total: number;
  /** noiseCount / total, or 0 when total === 0 */
  noiseRatio: number;
  /** usefulCount / total, or 0 when total === 0 */
  usefulRatio: number;
}

export interface PortfolioLinkedWorkflowCounts {
  portfolioLinked: {
    investigate: number;
    monitor: number;
    ignore: number;
    total: number;
  };
  nonPortfolioLinked: {
    investigate: number;
    monitor: number;
    ignore: number;
    total: number;
  };
}

// Ranking-prep types
export interface EventTypeUsefulnessScore {
  eventType: string;
  usefulCount: number;
  noiseCount: number;
  totalFeedback: number;
  /** usefulCount / totalFeedback, or 0 when no feedback */
  usefulnessScore: number;
}

export interface IssuerInvestigateScore {
  issuerName: string;
  investigateCount: number;
  totalWorkflow: number;
  /** investigateCount / totalWorkflow, or 0 when no workflow */
  investigateScore: number;
}

export interface RuleNoiseScore {
  ruleId: number;
  ruleName: string;
  noiseCount: number;
  totalFeedback: number;
  /** noiseCount / totalFeedback, or 0 when no feedback */
  noiseScore: number;
}

// ---------------------------------------------------------------------------
// Aggregated analytics response (returned by the API endpoint)
// ---------------------------------------------------------------------------

export interface AlertAnalyticsResponse {
  workflowActionCounts: ActionCount[];
  feedbackRatingCounts: FeedbackCount[];
  actionByEventType: ActionByEventType[];
  feedbackByEventType: FeedbackByEventType[];
  investigateIgnoreRatioByIssuer: IssuerWorkflowRatio[];
  usefulNoiseRatioByRule: RuleFeedbackRatio[];
  portfolioLinkedWorkflowCounts: PortfolioLinkedWorkflowCounts;
  rankingPrep: {
    eventTypeUsefulnessScores: EventTypeUsefulnessScore[];
    issuerInvestigateScores: IssuerInvestigateScore[];
    ruleNoiseScores: RuleNoiseScore[];
  };
}

// ---------------------------------------------------------------------------
// 1. Workflow action counts
// ---------------------------------------------------------------------------

/**
 * Returns the number of alerts (workflow states) per action for an org.
 */
export async function getWorkflowActionCounts(
  orgId: string,
): Promise<ActionCount[]> {
  const rows = await db
    .select({
      action: alertWorkflowStateTable.action,
      count: count(),
    })
    .from(alertWorkflowStateTable)
    .innerJoin(
      alertEventsTable,
      eq(alertWorkflowStateTable.alertEventId, alertEventsTable.id),
    )
    .innerJoin(
      alertRulesTable,
      eq(alertEventsTable.alertRuleId, alertRulesTable.id),
    )
    .where(
      and(
        eq(alertWorkflowStateTable.organizationId, orgId),
        eq(alertRulesTable.organizationId, orgId),
      ),
    )
    .groupBy(alertWorkflowStateTable.action);

  return rows.map((r) => ({ action: r.action, count: Number(r.count) }));
}

// ---------------------------------------------------------------------------
// 2. Feedback rating counts
// ---------------------------------------------------------------------------

/**
 * Returns the number of feedback records per rating for an org.
 */
export async function getFeedbackRatingCounts(
  orgId: string,
): Promise<FeedbackCount[]> {
  const rows = await db
    .select({
      rating: alertFeedbackTable.rating,
      count: count(),
    })
    .from(alertFeedbackTable)
    .where(eq(alertFeedbackTable.organizationId, orgId))
    .groupBy(alertFeedbackTable.rating);

  return rows.map((r) => ({ rating: r.rating, count: Number(r.count) }));
}

// ---------------------------------------------------------------------------
// 3. Action distribution by event type
// ---------------------------------------------------------------------------

/**
 * Returns workflow action counts broken down by event type for an org.
 * Event types with no workflow state are excluded.
 */
export async function getActionDistributionByEventType(
  orgId: string,
): Promise<ActionByEventType[]> {
  const rows = await db
    .select({
      eventType: alertEventsTable.eventType,
      action: alertWorkflowStateTable.action,
      count: count(),
    })
    .from(alertWorkflowStateTable)
    .innerJoin(
      alertEventsTable,
      eq(alertWorkflowStateTable.alertEventId, alertEventsTable.id),
    )
    .innerJoin(
      alertRulesTable,
      eq(alertEventsTable.alertRuleId, alertRulesTable.id),
    )
    .where(
      and(
        eq(alertWorkflowStateTable.organizationId, orgId),
        eq(alertRulesTable.organizationId, orgId),
      ),
    )
    .groupBy(alertEventsTable.eventType, alertWorkflowStateTable.action);

  // Pivot in-memory
  const map = new Map<string, ActionByEventType>();
  for (const row of rows) {
    const et = row.eventType ?? "(unknown)";
    if (!map.has(et)) {
      map.set(et, { eventType: et, investigate: 0, monitor: 0, ignore: 0, total: 0 });
    }
    const entry = map.get(et)!;
    const n = Number(row.count);
    if (row.action === "investigate") entry.investigate += n;
    else if (row.action === "monitor") entry.monitor += n;
    else if (row.action === "ignore") entry.ignore += n;
    entry.total += n;
  }

  return [...map.values()].sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// 4. Feedback distribution by event type
// ---------------------------------------------------------------------------

/**
 * Returns feedback rating counts broken down by event type for an org.
 */
export async function getFeedbackDistributionByEventType(
  orgId: string,
): Promise<FeedbackByEventType[]> {
  const rows = await db
    .select({
      eventType: alertEventsTable.eventType,
      rating: alertFeedbackTable.rating,
      count: count(),
    })
    .from(alertFeedbackTable)
    .innerJoin(
      alertEventsTable,
      eq(alertFeedbackTable.alertEventId, alertEventsTable.id),
    )
    .innerJoin(
      alertRulesTable,
      eq(alertEventsTable.alertRuleId, alertRulesTable.id),
    )
    .where(
      and(
        eq(alertFeedbackTable.organizationId, orgId),
        eq(alertRulesTable.organizationId, orgId),
      ),
    )
    .groupBy(alertEventsTable.eventType, alertFeedbackTable.rating);

  const map = new Map<string, FeedbackByEventType>();
  for (const row of rows) {
    const et = row.eventType ?? "(unknown)";
    if (!map.has(et)) {
      map.set(et, { eventType: et, useful: 0, noise: 0, investigate_later: 0, total: 0 });
    }
    const entry = map.get(et)!;
    const n = Number(row.count);
    if (row.rating === "useful") entry.useful += n;
    else if (row.rating === "noise") entry.noise += n;
    else if (row.rating === "investigate_later") entry.investigate_later += n;
    entry.total += n;
  }

  return [...map.values()].sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// 5. Investigate / ignore ratio by issuer
// ---------------------------------------------------------------------------

/**
 * Returns per-issuer workflow counts and investigate/ignore ratios for an org.
 * Only issuers with at least one workflow action are included.
 */
export async function getInvestigateIgnoreRatioByIssuer(
  orgId: string,
): Promise<IssuerWorkflowRatio[]> {
  const rows = await db
    .select({
      issuerName: alertEventsTable.issuerName,
      action: alertWorkflowStateTable.action,
      count: count(),
    })
    .from(alertWorkflowStateTable)
    .innerJoin(
      alertEventsTable,
      eq(alertWorkflowStateTable.alertEventId, alertEventsTable.id),
    )
    .innerJoin(
      alertRulesTable,
      eq(alertEventsTable.alertRuleId, alertRulesTable.id),
    )
    .where(
      and(
        eq(alertWorkflowStateTable.organizationId, orgId),
        eq(alertRulesTable.organizationId, orgId),
      ),
    )
    .groupBy(alertEventsTable.issuerName, alertWorkflowStateTable.action);

  const map = new Map<string, IssuerWorkflowRatio>();
  for (const row of rows) {
    const issuer = row.issuerName;
    if (!map.has(issuer)) {
      map.set(issuer, {
        issuerName: issuer,
        investigateCount: 0,
        ignoreCount: 0,
        monitorCount: 0,
        total: 0,
        investigateRatio: 0,
        ignoreRatio: 0,
      });
    }
    const entry = map.get(issuer)!;
    const n = Number(row.count);
    if (row.action === "investigate") entry.investigateCount += n;
    else if (row.action === "ignore") entry.ignoreCount += n;
    else if (row.action === "monitor") entry.monitorCount += n;
    entry.total += n;
  }

  for (const entry of map.values()) {
    entry.investigateRatio = entry.total > 0 ? entry.investigateCount / entry.total : 0;
    entry.ignoreRatio = entry.total > 0 ? entry.ignoreCount / entry.total : 0;
  }

  return [...map.values()].sort((a, b) => b.investigateCount - a.investigateCount);
}

// ---------------------------------------------------------------------------
// 6. Useful / noise ratio by rule
// ---------------------------------------------------------------------------

/**
 * Returns per-rule feedback counts and useful/noise ratios for an org.
 */
export async function getUsefulNoiseRatioByRule(
  orgId: string,
): Promise<RuleFeedbackRatio[]> {
  const rows = await db
    .select({
      ruleId: alertRulesTable.id,
      ruleName: alertRulesTable.name,
      rating: alertFeedbackTable.rating,
      count: count(),
    })
    .from(alertFeedbackTable)
    .innerJoin(
      alertEventsTable,
      eq(alertFeedbackTable.alertEventId, alertEventsTable.id),
    )
    .innerJoin(
      alertRulesTable,
      eq(alertEventsTable.alertRuleId, alertRulesTable.id),
    )
    .where(
      and(
        eq(alertFeedbackTable.organizationId, orgId),
        eq(alertRulesTable.organizationId, orgId),
      ),
    )
    .groupBy(alertRulesTable.id, alertRulesTable.name, alertFeedbackTable.rating);

  const map = new Map<number, RuleFeedbackRatio>();
  for (const row of rows) {
    if (!map.has(row.ruleId)) {
      map.set(row.ruleId, {
        ruleId: row.ruleId,
        ruleName: row.ruleName,
        usefulCount: 0,
        noiseCount: 0,
        total: 0,
        noiseRatio: 0,
        usefulRatio: 0,
      });
    }
    const entry = map.get(row.ruleId)!;
    const n = Number(row.count);
    if (row.rating === "useful") entry.usefulCount += n;
    else if (row.rating === "noise") entry.noiseCount += n;
    entry.total += n;
  }

  for (const entry of map.values()) {
    entry.noiseRatio = entry.total > 0 ? entry.noiseCount / entry.total : 0;
    entry.usefulRatio = entry.total > 0 ? entry.usefulCount / entry.total : 0;
  }

  return [...map.values()].sort((a, b) => b.noiseRatio - a.noiseRatio);
}

// ---------------------------------------------------------------------------
// 7. Portfolio-linked workflow counts
// ---------------------------------------------------------------------------

/**
 * Compares workflow action distribution for portfolio-linked vs. non-portfolio-
 * linked alerts for an org.
 */
export async function getPortfolioLinkedWorkflowCounts(
  orgId: string,
): Promise<PortfolioLinkedWorkflowCounts> {
  // Get all canonical issuer names in this org's portfolios
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

  // Get all workflow states for the org with issuer names
  const rows = await db
    .select({
      issuerName: alertEventsTable.issuerName,
      action: alertWorkflowStateTable.action,
      count: count(),
    })
    .from(alertWorkflowStateTable)
    .innerJoin(
      alertEventsTable,
      eq(alertWorkflowStateTable.alertEventId, alertEventsTable.id),
    )
    .innerJoin(
      alertRulesTable,
      eq(alertEventsTable.alertRuleId, alertRulesTable.id),
    )
    .where(
      and(
        eq(alertWorkflowStateTable.organizationId, orgId),
        eq(alertRulesTable.organizationId, orgId),
      ),
    )
    .groupBy(alertEventsTable.issuerName, alertWorkflowStateTable.action);

  const linked = { investigate: 0, monitor: 0, ignore: 0, total: 0 };
  const nonLinked = { investigate: 0, monitor: 0, ignore: 0, total: 0 };

  for (const row of rows) {
    const n = Number(row.count);
    const bucket = portfolioIssuerSet.has(row.issuerName) ? linked : nonLinked;
    if (row.action === "investigate") bucket.investigate += n;
    else if (row.action === "monitor") bucket.monitor += n;
    else if (row.action === "ignore") bucket.ignore += n;
    bucket.total += n;
  }

  return { portfolioLinked: linked, nonPortfolioLinked: nonLinked };
}

// ---------------------------------------------------------------------------
// 8. Ranking-prep: event type usefulness scores
// ---------------------------------------------------------------------------

/**
 * Returns a usefulness score per event type (useful / total feedback with
 * rating) for ranking prep. Does not affect the live priority model.
 */
export async function getEventTypeUsefulnessScores(
  orgId: string,
): Promise<EventTypeUsefulnessScore[]> {
  const dist = await getFeedbackDistributionByEventType(orgId);
  return dist
    .filter((d) => d.total > 0)
    .map((d) => ({
      eventType: d.eventType,
      usefulCount: d.useful,
      noiseCount: d.noise,
      totalFeedback: d.total,
      usefulnessScore: d.total > 0 ? d.useful / d.total : 0,
    }))
    .sort((a, b) => b.usefulnessScore - a.usefulnessScore);
}

// ---------------------------------------------------------------------------
// 9. Ranking-prep: issuer investigate scores
// ---------------------------------------------------------------------------

/**
 * Returns an investigate-rate score per issuer (investigate / total workflow)
 * for ranking prep. Does not affect the live priority model.
 */
export async function getIssuerInvestigateScores(
  orgId: string,
): Promise<IssuerInvestigateScore[]> {
  const ratios = await getInvestigateIgnoreRatioByIssuer(orgId);
  return ratios
    .filter((r) => r.total > 0)
    .map((r) => ({
      issuerName: r.issuerName,
      investigateCount: r.investigateCount,
      totalWorkflow: r.total,
      investigateScore: r.investigateRatio,
    }))
    .sort((a, b) => b.investigateScore - a.investigateScore);
}

// ---------------------------------------------------------------------------
// 10. Ranking-prep: rule noise scores
// ---------------------------------------------------------------------------

/**
 * Returns a noise score per rule (noise / total feedback with rating) for
 * ranking prep. Does not affect the live priority model.
 */
export async function getRuleNoiseScores(
  orgId: string,
): Promise<RuleNoiseScore[]> {
  const ratios = await getUsefulNoiseRatioByRule(orgId);
  return ratios
    .filter((r) => r.total > 0)
    .map((r) => ({
      ruleId: r.ruleId,
      ruleName: r.ruleName,
      noiseCount: r.noiseCount,
      totalFeedback: r.total,
      noiseScore: r.noiseRatio,
    }))
    .sort((a, b) => b.noiseScore - a.noiseScore);
}

// ---------------------------------------------------------------------------
// 11. Aggregate all analytics for an org (used by the API route)
// ---------------------------------------------------------------------------

/**
 * Fetches and assembles all analytics data for an org in parallel.
 */
export async function getAlertAnalytics(
  orgId: string,
): Promise<AlertAnalyticsResponse> {
  const [
    workflowActionCounts,
    feedbackRatingCounts,
    actionByEventType,
    feedbackByEventType,
    investigateIgnoreRatioByIssuer,
    usefulNoiseRatioByRule,
    portfolioLinkedWorkflowCounts,
    eventTypeUsefulnessScores,
    issuerInvestigateScores,
    ruleNoiseScores,
  ] = await Promise.all([
    getWorkflowActionCounts(orgId),
    getFeedbackRatingCounts(orgId),
    getActionDistributionByEventType(orgId),
    getFeedbackDistributionByEventType(orgId),
    getInvestigateIgnoreRatioByIssuer(orgId),
    getUsefulNoiseRatioByRule(orgId),
    getPortfolioLinkedWorkflowCounts(orgId),
    getEventTypeUsefulnessScores(orgId),
    getIssuerInvestigateScores(orgId),
    getRuleNoiseScores(orgId),
  ]);

  return {
    workflowActionCounts,
    feedbackRatingCounts,
    actionByEventType,
    feedbackByEventType,
    investigateIgnoreRatioByIssuer,
    usefulNoiseRatioByRule,
    portfolioLinkedWorkflowCounts,
    rankingPrep: {
      eventTypeUsefulnessScores,
      issuerInvestigateScores,
      ruleNoiseScores,
    },
  };
}
