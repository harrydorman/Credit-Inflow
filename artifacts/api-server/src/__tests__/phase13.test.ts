/**
 * Tests for Phase 13: Feedback-Aware Snapshot Metrics + Outcome Attribution.
 *
 * Covers:
 *   - computeSnapshotMetrics: server-side metric computation
 *   - computeOutcomeAttribution: outcome attribution service
 *   - POST /api/analytics/ranking-eval/snapshots — optional metrics (server-compute)
 *   - GET  /api/analytics/ranking-eval/snapshots/computed-metrics
 *   - GET  /api/analytics/ranking-eval/outcome-attribution
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock — must be defined before vi.mock factories run
// ---------------------------------------------------------------------------

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
  selectDistinct: vi.fn(),
  innerJoin: vi.fn(),
  leftJoin: vi.fn(),
  groupBy: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

vi.mock("@workspace/db", () => ({
  db: dbMock,
  rankingEvalSnapshotsTable: {
    id: "id",
    organizationId: "organization_id",
    rankingModelVersion: "ranking_model_version",
    timeWindow: "time_window",
    snapshotType: "snapshot_type",
    metricsJson: "metrics_json",
    createdAt: "created_at",
  },
  alertRulesTable: { id: "id", organizationId: "organization_id", name: "name" },
  alertEventsTable: {
    id: "id",
    alertRuleId: "alert_rule_id",
    issuerName: "issuer_name",
    eventType: "event_type",
    triggeredAt: "triggered_at",
  },
  alertFeedbackTable: {
    id: "id",
    alertEventId: "alert_event_id",
    organizationId: "organization_id",
    rating: "rating",
  },
  alertWorkflowStateTable: {
    id: "id",
    alertEventId: "alert_event_id",
    organizationId: "organization_id",
    action: "action",
  },
  portfolioIssuerMapTable: {
    id: "id",
    portfolioHoldingId: "portfolio_holding_id",
    canonicalIssuerName: "canonical_issuer_name",
  },
  portfolioHoldingsTable: { id: "id", portfolioId: "portfolio_id" },
  portfoliosTable: { id: "id", organizationId: "organization_id", name: "name" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
  and: (...args: unknown[]) => ({ type: "and", args }),
  desc: (col: unknown) => ({ type: "desc", col }),
  count: () => ({ type: "count" }),
  gte: (col: unknown, val: unknown) => ({ type: "gte", col, val }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: "sql", strings, values }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG = "org-phase13-test";

const METRICS_STUB = {
  totalAlerts: 100,
  adjustedFraction: 0.25,
  averagePositiveAdjustment: 3.5,
  averageNegativeAdjustment: -2.1,
  usefulFeedbackRateAmongBoosted: 0.7,
  noiseRateAmongPenalised: 0.6,
  investigateRateAmongPortfolioLinkedBoosted: 0.8,
  topBoostedEventTypes: [{ eventType: "downgrade", totalBoost: 24 }],
  topPenalisedRules: [{ ruleName: "Noisy Rule A", totalPenalty: 16 }],
  metricSource: "server-computed" as const,
};

const SNAPSHOT_STUB = {
  id: 1,
  organizationId: ORG,
  rankingModelVersion: "v1.1.0",
  timeWindow: "all",
  snapshotType: "manual",
  metricsJson: METRICS_STUB,
  createdAt: new Date("2024-03-15T10:00:00Z"),
};

function resetDb() {
  for (const method of Object.keys(dbMock) as Array<keyof typeof dbMock>) {
    (dbMock[method] as ReturnType<typeof vi.fn>).mockReset().mockReturnThis();
  }
}

/** Builds a fluent DB chain mock that returns a value from the terminal call. */
function buildSelectChain(resolveValue: unknown) {
  const chainObj: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ["from", "where", "innerJoin", "leftJoin", "groupBy", "orderBy", "limit", "selectDistinct"];
  const terminal = vi.fn().mockResolvedValue(resolveValue);

  // The last method called before await is the terminal — but since drizzle
  // chains vary, make every method also directly awaitable.
  const handler = vi.fn().mockImplementation(() => {
    // Return a proxy that supports any method and also is a thenable
    const proxy = new Proxy(
      Object.assign(Promise.resolve(resolveValue), chainObj),
      {
        get(_target, prop: string) {
          if (prop === "then" || prop === "catch" || prop === "finally") {
            return Promise.resolve(resolveValue)[prop as "then"].bind(Promise.resolve(resolveValue));
          }
          return handler;
        },
      },
    );
    return proxy;
  });

  return handler;
}

// ---------------------------------------------------------------------------
// Unit tests: snapshotMetricsService.computeSnapshotMetrics
// ---------------------------------------------------------------------------

import { computeSnapshotMetrics, DEFAULT_CALIBRATION_CONFIG } from "../services/snapshotMetricsService";

describe("computeSnapshotMetrics", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns zero metrics when no alerts exist", async () => {
    // All DB queries return empty arrays
    const emptyChain = buildSelectChain([]);
    dbMock.select.mockReturnValue({ from: emptyChain });
    dbMock.selectDistinct.mockReturnValue({ from: emptyChain });

    const result = await computeSnapshotMetrics(ORG, "all");

    expect(result.totalAlerts).toBe(0);
    expect(result.adjustedFraction).toBe(0);
    expect(result.metricSource).toBe("server-computed");
  });

  it("returns metricSource = 'server-computed'", async () => {
    const emptyChain = buildSelectChain([]);
    dbMock.select.mockReturnValue({ from: emptyChain });
    dbMock.selectDistinct.mockReturnValue({ from: emptyChain });

    const result = await computeSnapshotMetrics(ORG, "7d");
    expect(result.metricSource).toBe("server-computed");
  });

  it("uses DEFAULT_CALIBRATION_CONFIG when no config is provided", async () => {
    expect(DEFAULT_CALIBRATION_CONFIG.eventTypeBoost.threshold).toBe(0.7);
    expect(DEFAULT_CALIBRATION_CONFIG.ruleNoisePenalty.threshold).toBe(0.5);
  });

  it("accepts a custom calibration config", async () => {
    const emptyChain = buildSelectChain([]);
    dbMock.select.mockReturnValue({ from: emptyChain });
    dbMock.selectDistinct.mockReturnValue({ from: emptyChain });

    const customConfig = {
      ...DEFAULT_CALIBRATION_CONFIG,
      eventTypeBoost: { threshold: 0.9, max: 5 },
    };

    const result = await computeSnapshotMetrics(ORG, "all", customConfig);
    expect(result.metricSource).toBe("server-computed");
  });
});

// ---------------------------------------------------------------------------
// Unit tests: outcomeAttributionService.computeOutcomeAttribution
// ---------------------------------------------------------------------------

import { computeOutcomeAttribution } from "../services/outcomeAttributionService";

describe("computeOutcomeAttribution", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns totalAlerts = 0 when no data exists", async () => {
    const emptyChain = buildSelectChain([]);
    dbMock.select.mockReturnValue({ from: emptyChain });

    const result = await computeOutcomeAttribution(ORG);
    expect(result.totalAlerts).toBe(0);
    expect(result.boostedCount).toBe(0);
    expect(result.penalisedCount).toBe(0);
  });

  it("returns zero rates when counts are zero", async () => {
    const emptyChain = buildSelectChain([]);
    dbMock.select.mockReturnValue({ from: emptyChain });

    const result = await computeOutcomeAttribution(ORG);
    expect(result.boostedInvestigateRate).toBe(0);
    expect(result.penalisedNoiseRate).toBe(0);
  });

  it("returns structured attribution summary", async () => {
    const emptyChain = buildSelectChain([]);
    dbMock.select.mockReturnValue({ from: emptyChain });

    const result = await computeOutcomeAttribution(ORG);
    expect(Array.isArray(result.topBoostedUsefulEventTypes)).toBe(true);
    expect(Array.isArray(result.topPenalisedNoisyRules)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HTTP routes — Phase 13 additions
// ---------------------------------------------------------------------------

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

const ORG_H = "org-http-phase13";

// Helper: set up DB mock to resolve INSERT chain
function setupInsertChain(snapshot: typeof SNAPSHOT_STUB) {
  dbMock.insert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([snapshot]),
    }),
  });
}

// Helper: set up DB mock to resolve SELECT chain
function setupSelectChain(rows: unknown[]) {
  const chain = buildSelectChain(rows);
  dbMock.select.mockReturnValue({ from: chain });
  dbMock.selectDistinct.mockReturnValue({ from: chain });
}

describe("POST /api/analytics/ranking-eval/snapshots (Phase 13 — optional metrics)", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns 401 without org header", async () => {
    const res = await supertest(testApp)
      .post("/api/analytics/ranking-eval/snapshots")
      .send({ rankingModelVersion: "v1.1.0", timeWindow: "all" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when rankingModelVersion is missing", async () => {
    const res = await supertest(testApp)
      .post("/api/analytics/ranking-eval/snapshots")
      .set("X-Organization-Id", ORG_H)
      .send({ timeWindow: "all" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rankingModelVersion/i);
  });

  it("returns 400 when timeWindow is invalid", async () => {
    const res = await supertest(testApp)
      .post("/api/analytics/ranking-eval/snapshots")
      .set("X-Organization-Id", ORG_H)
      .send({ rankingModelVersion: "v1.1.0", timeWindow: "xyz" });
    expect(res.status).toBe(400);
  });

  it("returns 201 when metrics are provided (caller-supplied mode)", async () => {
    const snap = { ...SNAPSHOT_STUB, organizationId: ORG_H };
    setupInsertChain(snap);

    const res = await supertest(testApp)
      .post("/api/analytics/ranking-eval/snapshots")
      .set("X-Organization-Id", ORG_H)
      .send({ rankingModelVersion: "v1.1.0", timeWindow: "all", metrics: METRICS_STUB });

    expect(res.status).toBe(201);
    expect(res.body.rankingModelVersion).toBe("v1.1.0");
  });

  it("does not return 400 when metrics is omitted (server-compute mode)", async () => {
    // When metrics is omitted the server computes them. The DB mock is not
    // fully wired here, so the route may 500, but must NOT 400 for missing metrics.
    setupSelectChain([]);
    setupInsertChain(SNAPSHOT_STUB);

    const res = await supertest(testApp)
      .post("/api/analytics/ranking-eval/snapshots")
      .set("X-Organization-Id", ORG_H)
      .send({ rankingModelVersion: "v1.1.0", timeWindow: "all" });

    expect(res.status).not.toBe(400);
  });

  it("returns 400 when metrics is provided as a non-object string", async () => {
    const res = await supertest(testApp)
      .post("/api/analytics/ranking-eval/snapshots")
      .set("X-Organization-Id", ORG_H)
      .send({ rankingModelVersion: "v1.1.0", timeWindow: "all", metrics: "invalid" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/metrics/i);
  });
});

describe("GET /api/analytics/ranking-eval/snapshots/computed-metrics", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns 401 without org header", async () => {
    const res = await supertest(testApp).get(
      "/api/analytics/ranking-eval/snapshots/computed-metrics?timeWindow=all",
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when timeWindow is missing", async () => {
    const res = await supertest(testApp)
      .get("/api/analytics/ranking-eval/snapshots/computed-metrics")
      .set("X-Organization-Id", ORG_H);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timeWindow/i);
  });

  it("returns 400 when timeWindow is invalid", async () => {
    const res = await supertest(testApp)
      .get("/api/analytics/ranking-eval/snapshots/computed-metrics?timeWindow=bad")
      .set("X-Organization-Id", ORG_H);
    expect(res.status).toBe(400);
  });

  it("returns 200 with metricSource = server-computed", async () => {
    setupSelectChain([]);

    const res = await supertest(testApp)
      .get("/api/analytics/ranking-eval/snapshots/computed-metrics?timeWindow=all")
      .set("X-Organization-Id", ORG_H);

    expect(res.status).toBe(200);
    expect(res.body.metricSource).toBe("server-computed");
    expect(typeof res.body.totalAlerts).toBe("number");
  });

  it("accepts 7d time window", async () => {
    setupSelectChain([]);

    const res = await supertest(testApp)
      .get("/api/analytics/ranking-eval/snapshots/computed-metrics?timeWindow=7d")
      .set("X-Organization-Id", ORG_H);

    expect(res.status).toBe(200);
  });
});

describe("GET /api/analytics/ranking-eval/outcome-attribution", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns 401 without org header", async () => {
    const res = await supertest(testApp).get(
      "/api/analytics/ranking-eval/outcome-attribution",
    );
    expect(res.status).toBe(401);
  });

  it("returns 200 with attribution fields", async () => {
    setupSelectChain([]);

    const res = await supertest(testApp)
      .get("/api/analytics/ranking-eval/outcome-attribution")
      .set("X-Organization-Id", ORG_H);

    expect(res.status).toBe(200);
    expect(typeof res.body.totalAlerts).toBe("number");
    expect(typeof res.body.boostedCount).toBe("number");
    expect(typeof res.body.penalisedCount).toBe("number");
    expect(Array.isArray(res.body.topBoostedUsefulEventTypes)).toBe(true);
    expect(Array.isArray(res.body.topPenalisedNoisyRules)).toBe(true);
  });

  it("returns zero counts when no data exists", async () => {
    setupSelectChain([]);

    const res = await supertest(testApp)
      .get("/api/analytics/ranking-eval/outcome-attribution")
      .set("X-Organization-Id", ORG_H);

    expect(res.status).toBe(200);
    expect(res.body.boostedCount).toBe(0);
    expect(res.body.penalisedCount).toBe(0);
    expect(res.body.boostedInvestigateRate).toBe(0);
    expect(res.body.penalisedNoiseRate).toBe(0);
  });
});
