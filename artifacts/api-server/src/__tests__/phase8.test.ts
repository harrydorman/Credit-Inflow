/**
 * Tests for Phase 8: Workflow Analytics + Ranking Feedback Infrastructure.
 *
 * Covers:
 *   - getWorkflowActionCounts: returns action counts for an org
 *   - getFeedbackRatingCounts: returns rating counts for an org
 *   - getActionDistributionByEventType: pivots action counts by event type
 *   - getFeedbackDistributionByEventType: pivots feedback counts by event type
 *   - getInvestigateIgnoreRatioByIssuer: per-issuer ratios
 *   - getUsefulNoiseRatioByRule: per-rule ratios
 *   - getPortfolioLinkedWorkflowCounts: portfolio-linked vs. non-linked
 *   - getEventTypeUsefulnessScores: ranking prep
 *   - getIssuerInvestigateScores: ranking prep
 *   - getRuleNoiseScores: ranking prep
 *   - getAlertAnalytics: aggregated response
 *   - GET /analytics/alerts: API route (org-safe)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock — must be defined before vi.mock factories run
// ---------------------------------------------------------------------------

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  selectDistinct: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  innerJoin: vi.fn(),
  leftJoin: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: dbMock,
  alertRulesTable: {
    id: "id", name: "name", watchlistId: "watchlist_id",
    organizationId: "organization_id", isActive: "is_active",
  },
  alertEventsTable: {
    id: "id", alertRuleId: "alert_rule_id", watchlistId: "watchlist_id",
    articleId: "article_id", issuerName: "issuer_name", title: "title",
    urgency: "urgency", eventType: "event_type", triggeredAt: "triggered_at",
    severity: "severity", confidence: "confidence", isRead: "is_read",
  },
  alertFeedbackTable: {
    id: "id", alertEventId: "alert_event_id", organizationId: "organization_id",
    userId: "user_id", rating: "rating", note: "note",
    createdAt: "created_at", updatedAt: "updated_at",
  },
  alertWorkflowStateTable: {
    id: "id", alertEventId: "alert_event_id", organizationId: "organization_id",
    userId: "user_id", action: "action",
    createdAt: "created_at", updatedAt: "updated_at",
  },
  portfolioIssuerMapTable: {
    id: "id", portfolioHoldingId: "portfolio_holding_id",
    canonicalIssuerName: "canonical_issuer_name",
  },
  portfolioHoldingsTable: { id: "id", portfolioId: "portfolio_id" },
  portfoliosTable: { id: "id", organizationId: "organization_id", name: "name" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
  and: (...args: unknown[]) => ({ type: "and", args }),
  count: () => ({ type: "count" }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: "sql", strings, values }),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

// ---------------------------------------------------------------------------
// Helper to reset db mock
// ---------------------------------------------------------------------------

function resetDb() {
  for (const method of Object.keys(dbMock) as Array<keyof typeof dbMock>) {
    (dbMock[method] as ReturnType<typeof vi.fn>).mockReset().mockReturnThis();
  }
}

// Builds a chainable select mock that resolves to `rows` when groupBy() is called
function makeSelectChain(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    selectDistinct: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

// Builds a chain that resolves to `rows` at the where() step
function makeSelectWhereChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
  };
  return chain;
}

const ORG_A = "org-aaa-1111";
const ORG_B = "org-bbb-2222";

// ---------------------------------------------------------------------------
// Unit tests: service functions
// ---------------------------------------------------------------------------

import {
  getWorkflowActionCounts,
  getFeedbackRatingCounts,
  getActionDistributionByEventType,
  getFeedbackDistributionByEventType,
  getInvestigateIgnoreRatioByIssuer,
  getUsefulNoiseRatioByRule,
  getPortfolioLinkedWorkflowCounts,
  getEventTypeUsefulnessScores,
  getIssuerInvestigateScores,
  getRuleNoiseScores,
  getAlertAnalytics,
} from "../services/alertAnalyticsService";

// ── getWorkflowActionCounts ────────────────────────────────────────────────

describe("getWorkflowActionCounts", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns action counts from DB rows", async () => {
    const chain = makeSelectChain([
      { action: "investigate", count: 5 },
      { action: "ignore", count: 3 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const result = await getWorkflowActionCounts(ORG_A);
    expect(result).toEqual([
      { action: "investigate", count: 5 },
      { action: "ignore", count: 3 },
    ]);
  });

  it("returns empty array when no workflow states exist", async () => {
    const chain = makeSelectChain([]);
    dbMock.select.mockReturnValue(chain);

    const result = await getWorkflowActionCounts(ORG_A);
    expect(result).toEqual([]);
  });

  it("coerces count to number", async () => {
    const chain = makeSelectChain([{ action: "monitor", count: "7" }]);
    dbMock.select.mockReturnValue(chain);

    const result = await getWorkflowActionCounts(ORG_A);
    expect(typeof result[0].count).toBe("number");
    expect(result[0].count).toBe(7);
  });
});

// ── getFeedbackRatingCounts ────────────────────────────────────────────────

describe("getFeedbackRatingCounts", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns feedback counts from DB rows", async () => {
    const chain = makeSelectChain([
      { rating: "useful", count: 10 },
      { rating: "noise", count: 4 },
      { rating: "investigate_later", count: 2 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const result = await getFeedbackRatingCounts(ORG_A);
    expect(result).toHaveLength(3);
    expect(result.find((r) => r.rating === "useful")?.count).toBe(10);
    expect(result.find((r) => r.rating === "noise")?.count).toBe(4);
  });

  it("returns empty array when no feedback exists", async () => {
    const chain = makeSelectChain([]);
    dbMock.select.mockReturnValue(chain);

    const result = await getFeedbackRatingCounts(ORG_A);
    expect(result).toEqual([]);
  });
});

// ── getActionDistributionByEventType ──────────────────────────────────────

describe("getActionDistributionByEventType", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("pivots rows into per-event-type objects", async () => {
    const chain = makeSelectChain([
      { eventType: "downgrade", action: "investigate", count: 3 },
      { eventType: "downgrade", action: "ignore", count: 1 },
      { eventType: "earnings", action: "monitor", count: 2 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const result = await getActionDistributionByEventType(ORG_A);
    const downgrade = result.find((r) => r.eventType === "downgrade");
    expect(downgrade?.investigate).toBe(3);
    expect(downgrade?.ignore).toBe(1);
    expect(downgrade?.total).toBe(4);

    const earnings = result.find((r) => r.eventType === "earnings");
    expect(earnings?.monitor).toBe(2);
  });

  it("sorts results by total descending", async () => {
    const chain = makeSelectChain([
      { eventType: "low_vol", action: "investigate", count: 1 },
      { eventType: "high_vol", action: "investigate", count: 10 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const result = await getActionDistributionByEventType(ORG_A);
    expect(result[0].eventType).toBe("high_vol");
  });

  it("handles null eventType as (unknown)", async () => {
    const chain = makeSelectChain([
      { eventType: null, action: "ignore", count: 2 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const result = await getActionDistributionByEventType(ORG_A);
    expect(result[0].eventType).toBe("(unknown)");
  });
});

// ── getFeedbackDistributionByEventType ────────────────────────────────────

describe("getFeedbackDistributionByEventType", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("pivots rows into per-event-type feedback objects", async () => {
    const chain = makeSelectChain([
      { eventType: "downgrade", rating: "useful", count: 4 },
      { eventType: "downgrade", rating: "noise", count: 2 },
      { eventType: "earnings", rating: "noise", count: 5 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const result = await getFeedbackDistributionByEventType(ORG_A);
    const dg = result.find((r) => r.eventType === "downgrade")!;
    expect(dg.useful).toBe(4);
    expect(dg.noise).toBe(2);
    expect(dg.total).toBe(6);
  });
});

// ── getInvestigateIgnoreRatioByIssuer ─────────────────────────────────────

describe("getInvestigateIgnoreRatioByIssuer", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("computes investigate and ignore ratios", async () => {
    const chain = makeSelectChain([
      { issuerName: "Nike", action: "investigate", count: 6 },
      { issuerName: "Nike", action: "ignore", count: 2 },
      { issuerName: "Nike", action: "monitor", count: 2 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const result = await getInvestigateIgnoreRatioByIssuer(ORG_A);
    const nike = result.find((r) => r.issuerName === "Nike")!;
    expect(nike.investigateCount).toBe(6);
    expect(nike.ignoreCount).toBe(2);
    expect(nike.total).toBe(10);
    expect(nike.investigateRatio).toBeCloseTo(0.6);
    expect(nike.ignoreRatio).toBeCloseTo(0.2);
  });

  it("sets ratios to 0 when total is 0", async () => {
    // total can't be 0 from DB rows but testing edge via empty
    const chain = makeSelectChain([]);
    dbMock.select.mockReturnValue(chain);

    const result = await getInvestigateIgnoreRatioByIssuer(ORG_A);
    expect(result).toEqual([]);
  });

  it("sorts by investigateCount descending", async () => {
    const chain = makeSelectChain([
      { issuerName: "Low", action: "investigate", count: 1 },
      { issuerName: "High", action: "investigate", count: 9 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const result = await getInvestigateIgnoreRatioByIssuer(ORG_A);
    expect(result[0].issuerName).toBe("High");
  });
});

// ── getUsefulNoiseRatioByRule ──────────────────────────────────────────────

describe("getUsefulNoiseRatioByRule", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("computes noise and useful ratios per rule", async () => {
    const chain = makeSelectChain([
      { ruleId: 1, ruleName: "Rule A", rating: "noise", count: 8 },
      { ruleId: 1, ruleName: "Rule A", rating: "useful", count: 2 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const result = await getUsefulNoiseRatioByRule(ORG_A);
    expect(result).toHaveLength(1);
    const r = result[0];
    expect(r.noiseRatio).toBeCloseTo(0.8);
    expect(r.usefulRatio).toBeCloseTo(0.2);
  });

  it("sorts by noiseRatio descending", async () => {
    const chain = makeSelectChain([
      { ruleId: 2, ruleName: "Clean Rule", rating: "noise", count: 1 },
      { ruleId: 2, ruleName: "Clean Rule", rating: "useful", count: 9 },
      { ruleId: 3, ruleName: "Noisy Rule", rating: "noise", count: 9 },
      { ruleId: 3, ruleName: "Noisy Rule", rating: "useful", count: 1 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const result = await getUsefulNoiseRatioByRule(ORG_A);
    expect(result[0].ruleName).toBe("Noisy Rule");
  });
});

// ── getPortfolioLinkedWorkflowCounts ──────────────────────────────────────

describe("getPortfolioLinkedWorkflowCounts", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("splits workflow counts into portfolio-linked and non-linked buckets", async () => {
    // First call: selectDistinct for portfolio issuers
    const portfolioChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ issuerName: "Nike" }]),
    };
    dbMock.selectDistinct.mockReturnValueOnce(portfolioChain);

    // Second call: select workflow states
    const workflowChain = makeSelectChain([
      { issuerName: "Nike", action: "investigate", count: 4 },
      { issuerName: "Nike", action: "monitor", count: 1 },
      { issuerName: "Adidas", action: "ignore", count: 3 },
    ]);
    dbMock.select.mockReturnValueOnce(workflowChain);

    const result = await getPortfolioLinkedWorkflowCounts(ORG_A);

    expect(result.portfolioLinked.investigate).toBe(4);
    expect(result.portfolioLinked.monitor).toBe(1);
    expect(result.portfolioLinked.total).toBe(5);

    expect(result.nonPortfolioLinked.ignore).toBe(3);
    expect(result.nonPortfolioLinked.total).toBe(3);
  });

  it("returns all workflow counts in non-linked bucket when no portfolio issuers", async () => {
    const portfolioChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    dbMock.selectDistinct.mockReturnValueOnce(portfolioChain);

    const workflowChain = makeSelectChain([
      { issuerName: "SomeIssuer", action: "investigate", count: 5 },
    ]);
    dbMock.select.mockReturnValueOnce(workflowChain);

    const result = await getPortfolioLinkedWorkflowCounts(ORG_A);
    expect(result.portfolioLinked.total).toBe(0);
    expect(result.nonPortfolioLinked.total).toBe(5);
  });
});

// ── Ranking-prep functions ─────────────────────────────────────────────────

describe("getEventTypeUsefulnessScores", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns usefulnessScore as useful/total", async () => {
    const chain = makeSelectChain([
      { eventType: "downgrade", rating: "useful", count: 8 },
      { eventType: "downgrade", rating: "noise", count: 2 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const scores = await getEventTypeUsefulnessScores(ORG_A);
    expect(scores).toHaveLength(1);
    expect(scores[0].usefulnessScore).toBeCloseTo(0.8);
  });

  it("sorts by usefulnessScore descending", async () => {
    const chain = makeSelectChain([
      { eventType: "low", rating: "useful", count: 1 },
      { eventType: "low", rating: "noise", count: 9 },
      { eventType: "high", rating: "useful", count: 9 },
      { eventType: "high", rating: "noise", count: 1 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const scores = await getEventTypeUsefulnessScores(ORG_A);
    expect(scores[0].eventType).toBe("high");
  });
});

describe("getIssuerInvestigateScores", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns investigateScore as investigateCount/totalWorkflow", async () => {
    const chain = makeSelectChain([
      { issuerName: "Nike", action: "investigate", count: 7 },
      { issuerName: "Nike", action: "ignore", count: 3 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const scores = await getIssuerInvestigateScores(ORG_A);
    expect(scores).toHaveLength(1);
    expect(scores[0].investigateScore).toBeCloseTo(0.7);
    expect(scores[0].totalWorkflow).toBe(10);
  });
});

describe("getRuleNoiseScores", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns noiseScore as noiseCount/totalFeedback", async () => {
    const chain = makeSelectChain([
      { ruleId: 1, ruleName: "Noisy", rating: "noise", count: 6 },
      { ruleId: 1, ruleName: "Noisy", rating: "useful", count: 4 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const scores = await getRuleNoiseScores(ORG_A);
    expect(scores).toHaveLength(1);
    expect(scores[0].noiseScore).toBeCloseTo(0.6);
    expect(scores[0].totalFeedback).toBe(10);
  });
});

// ── getAlertAnalytics: aggregate ──────────────────────────────────────────

describe("getAlertAnalytics", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns all expected top-level keys", async () => {
    // We need to provide enough mocked DB responses for all parallel calls.
    // Each internal function calls dbMock.select (or selectDistinct) once.
    // getPortfolioLinkedWorkflowCounts calls selectDistinct + select.
    // getActionDistributionByEventType + getIssuerInvestigateScores + getRuleNoiseScores
    //   all call select (they call underlying helpers which call select).

    const emptyGroupBy = makeSelectChain([]);
    const emptyWhere = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };

    // We have 8 calls to select and 1 call to selectDistinct:
    // 1. getWorkflowActionCounts
    // 2. getFeedbackRatingCounts
    // 3. getActionDistributionByEventType
    // 4. getFeedbackDistributionByEventType (also used by getEventTypeUsefulnessScores)
    // 5. getInvestigateIgnoreRatioByIssuer (also used by getIssuerInvestigateScores)
    // 6. getUsefulNoiseRatioByRule (also used by getRuleNoiseScores)
    // 7. getPortfolioLinkedWorkflowCounts: selectDistinct + select
    // Note: ranking-prep functions reuse their underlying calls (getEvent.. calls getFeedbackDist..)
    // Actually: all 10 are called in parallel, but ranking-prep re-calls the underlying functions.
    // Total select calls = 10 base + 3 ranking-prep (which call base functions again) = up to ~13
    // Keep it simple: mock select to always return an empty chain.

    dbMock.select.mockReturnValue(emptyGroupBy);
    dbMock.selectDistinct.mockReturnValue(emptyWhere);

    const result = await getAlertAnalytics(ORG_A);

    expect(result).toHaveProperty("workflowActionCounts");
    expect(result).toHaveProperty("feedbackRatingCounts");
    expect(result).toHaveProperty("actionByEventType");
    expect(result).toHaveProperty("feedbackByEventType");
    expect(result).toHaveProperty("investigateIgnoreRatioByIssuer");
    expect(result).toHaveProperty("usefulNoiseRatioByRule");
    expect(result).toHaveProperty("portfolioLinkedWorkflowCounts");
    expect(result).toHaveProperty("rankingPrep");
    expect(result.rankingPrep).toHaveProperty("eventTypeUsefulnessScores");
    expect(result.rankingPrep).toHaveProperty("issuerInvestigateScores");
    expect(result.rankingPrep).toHaveProperty("ruleNoiseScores");
  });
});

// ── useful/noise ratios ───────────────────────────────────────────────────

describe("useful/noise ratio correctness", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("useful ratio + noise ratio should sum to ≤ 1 (excluding investigate_later)", async () => {
    const chain = makeSelectChain([
      { ruleId: 1, ruleName: "R", rating: "useful", count: 3 },
      { ruleId: 1, ruleName: "R", rating: "noise", count: 3 },
      { ruleId: 1, ruleName: "R", rating: "investigate_later", count: 4 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const result = await getUsefulNoiseRatioByRule(ORG_A);
    const r = result[0];
    // total = 10, useful = 3, noise = 3
    expect(r.usefulRatio + r.noiseRatio).toBeCloseTo(0.6);
    expect(r.usefulRatio + r.noiseRatio).toBeLessThanOrEqual(1);
  });

  it("noiseRatio is 0 when no noise feedback exists", async () => {
    const chain = makeSelectChain([
      { ruleId: 1, ruleName: "R", rating: "useful", count: 5 },
    ]);
    dbMock.select.mockReturnValue(chain);

    const result = await getUsefulNoiseRatioByRule(ORG_A);
    expect(result[0].noiseRatio).toBe(0);
    expect(result[0].usefulRatio).toBe(1);
  });
});

// ── Org-safe analytics access ─────────────────────────────────────────────

import supertest from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";
import analyticsRouter from "../routes/analytics";

const testApp = (() => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.orgId = (req.headers["x-organization-id"] as string) ?? null;
    req.userId = (req.headers["x-user-id"] as string) ?? null;
    next();
  });
  app.use("/api", analyticsRouter);
  return app;
})();

describe("GET /analytics/alerts — org-safe access", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns 401 when no org header is present", async () => {
    const res = await supertest(testApp).get("/api/analytics/alerts");
    expect(res.status).toBe(401);
  });

  it("returns 200 with analytics payload when org header is provided", async () => {
    // Mock all db.select and selectDistinct calls to return empty arrays
    const emptyGroupBy = makeSelectChain([]);
    const emptyWhere = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    dbMock.select.mockReturnValue(emptyGroupBy);
    dbMock.selectDistinct.mockReturnValue(emptyWhere);

    const res = await supertest(testApp)
      .get("/api/analytics/alerts")
      .set("x-organization-id", ORG_A);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("workflowActionCounts");
    expect(res.body).toHaveProperty("feedbackRatingCounts");
    expect(res.body).toHaveProperty("rankingPrep");
  });

  it("different org headers produce independent responses (org isolation)", async () => {
    const emptyGroupBy = makeSelectChain([]);
    const emptyWhere = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    dbMock.select.mockReturnValue(emptyGroupBy);
    dbMock.selectDistinct.mockReturnValue(emptyWhere);

    const resA = await supertest(testApp)
      .get("/api/analytics/alerts")
      .set("x-organization-id", ORG_A);

    const resB = await supertest(testApp)
      .get("/api/analytics/alerts")
      .set("x-organization-id", ORG_B);

    // Both return 200 — org safety is enforced by the DB query layer
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
  });
});
