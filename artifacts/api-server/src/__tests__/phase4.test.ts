/**
 * Tests for Phase 4: route layer wiring.
 *
 * Covers:
 * - requireOrgId middleware helper (org-scoped access, missing org → 401)
 * - getAlertsForOrganization: org isolation, filter forwarding
 * - getPortfolioDetails: cross-org access blocked, own-org access allowed
 * - getPortfoliosForOrganization: org scoping
 * - getPortfolioExposureAlerts: grouping and sorting
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted DB mock
// ---------------------------------------------------------------------------

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  selectDistinct: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  offset: vi.fn(),
  orderBy: vi.fn(),
  innerJoin: vi.fn(),
  leftJoin: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  onConflictDoNothing: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  returning: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
}));

vi.mock("@workspace/db", () => ({
  db: dbMock,
  articlesTable: { id: "id", issuerName: "issuer_name", title: "title", finalUrgencyScore: "final_urgency_score", eventType: "event_type", sector: "sector", covenantFlag: "covenant_flag", classificationConfidence: "classification_confidence" },
  alertRulesTable: { id: "id", watchlistId: "watchlist_id", organizationId: "organization_id", isActive: "is_active", name: "name", minimumUrgency: "minimum_urgency", eventTypes: "event_types", covenantFlagOnly: "covenant_flag_only", conditions: "conditions", severityThreshold: "severity_threshold", confidenceThreshold: "confidence_threshold", portfolioId: "portfolio_id" },
  alertEventsTable: { id: "id", alertRuleId: "alert_rule_id", watchlistId: "watchlist_id", articleId: "article_id", issuerName: "issuer_name", title: "title", urgency: "urgency", eventType: "event_type", triggeredAt: "triggered_at", severity: "severity", confidence: "confidence", isRead: "is_read" },
  alertFeedbackTable: { id: "id", alertEventId: "alert_event_id", organizationId: "organization_id", userId: "user_id", rating: "rating", note: "note", createdAt: "created_at", updatedAt: "updated_at" },
  watchlistItemsTable: { watchlistId: "watchlist_id", normalizedIssuerName: "normalized_issuer_name", issuerName: "issuer_name" },
  portfolioIssuerMapTable: { id: "id", portfolioHoldingId: "portfolio_holding_id", canonicalIssuerName: "canonical_issuer_name", confidence: "confidence", source: "source" },
  portfolioHoldingsTable: { id: "id", portfolioId: "portfolio_id", issuerName: "issuer_name", positionSize: "position_size", metadata: "metadata" },
  portfoliosTable: { id: "id", organizationId: "organization_id", name: "name", description: "description", createdAt: "created_at", updatedAt: "updated_at" },
  notificationChannelsTable: { id: "id", organizationId: "organization_id", name: "name", type: "type", config: "config", createdAt: "created_at" },
  notificationDeliveriesTable: { id: "id", alertEventId: "alert_event_id", channelId: "channel_id", status: "status", sentAt: "sent_at", error: "error", createdAt: "created_at" },
  usersTable: { id: "id", email: "email", name: "name", createdAt: "created_at" },
  organizationsTable: { id: "id", name: "name", createdAt: "created_at" },
  organizationMembershipsTable: { id: "id", userId: "user_id", organizationId: "organization_id", role: "role", createdAt: "created_at" },
  watchlistsTable: { id: "id", organizationId: "organization_id", name: "name" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
  and: (...args: unknown[]) => ({ type: "and", args }),
  or: (...args: unknown[]) => ({ type: "or", args }),
  inArray: (col: unknown, vals: unknown) => ({ type: "inArray", col, vals }),
  gte: (col: unknown, val: unknown) => ({ type: "gte", col, val }),
  lte: (col: unknown, val: unknown) => ({ type: "lte", col, val }),
  desc: (col: unknown) => ({ type: "desc", col }),
  count: () => ({ type: "count" }),
  isNull: (col: unknown) => ({ type: "isNull", col }),
  isNotNull: (col: unknown) => ({ type: "isNotNull", col }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset all DB mock methods to chainable no-ops. */
function resetDb() {
  for (const method of Object.keys(dbMock) as Array<keyof typeof dbMock>) {
    (dbMock[method] as ReturnType<typeof vi.fn>).mockReset().mockReturnThis();
  }
}

/**
 * Set up the DB mock chain for getAlertsForOrganization.
 *
 * Chain shape:
 *   selectDistinct().from().innerJoin(×3).where()          → portfolioIssuers  (terminal)
 *   Promise.all([
 *     select().from().innerJoin().where().orderBy().limit().offset(),  → rows  (terminal at offset)
 *     select().from().innerJoin().where(),                              → count (terminal at where)
 *   ])
 */
function setupAlertsOrgChain(portfolioIssuers: unknown[], rows: unknown[], countVal: number) {
  resetDb();

  // Build a dedicated chain object for the rows query so .orderBy().limit().offset() work.
  const rowsChain = {
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(rows),
  };
  (rowsChain.orderBy as ReturnType<typeof vi.fn>).mockReturnValue(rowsChain);
  (rowsChain.limit as ReturnType<typeof vi.fn>).mockReturnValue(rowsChain);

  // where: call 1 = selectDistinct terminal, call 2 = rows query (returns rowsChain), call 3 = count terminal
  dbMock.where
    .mockResolvedValueOnce(portfolioIssuers)        // call 1: portfolio issuers
    .mockReturnValueOnce(rowsChain)                 // call 2: rows query chain
    .mockResolvedValueOnce([{ value: countVal }]);  // call 3: count
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_A = "org-aaa";
const ORG_B = "org-bbb";

const ALERT_EVENT = {
  id: 1, alertRuleId: 10, watchlistId: 5, articleId: 100,
  issuerName: "Nike", title: "Nike downgrade", urgency: 8,
  eventType: "downgrade", confidence: 0.85, severity: "high",
  triggeredAt: new Date("2024-01-01T00:00:00Z"), isRead: false,
};

const PORTFOLIO = {
  id: 42, organizationId: ORG_A, name: "Test Portfolio",
  description: null, createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

// ---------------------------------------------------------------------------
// Route-level test helpers (supertest + minimal Express app)
// ---------------------------------------------------------------------------

import supertest from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";
import alertsRouter from "../routes/alerts";
import portfoliosRouter from "../routes/portfolios";
import * as alertEvalSvc from "../services/alertEvaluationService";
import * as portfolioSvc from "../services/portfolioService";

/**
 * Minimal Express app for route-level tests.
 * Auth: injects orgId from X-Organization-Id header (mirrors mockAuthResolver).
 * Created once; service functions are spied on per-test.
 */
const testApp = (() => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.orgId = (req.headers["x-organization-id"] as string) ?? null;
    req.userId = (req.headers["x-user-id"] as string) ?? null;
    next();
  });
  app.use("/api", alertsRouter);
  app.use("/api", portfoliosRouter);
  return app;
})();

const PORTFOLIO_DETAILS_RESULT = {
  ...PORTFOLIO,
  holdingsCount: 0,
  mappedIssuerCount: 0,
  unmappedIssuerCount: 0,
  alertCount: 0,
  highSeverityAlertCount: 0,
  holdings: [],
};

// ---------------------------------------------------------------------------
// requireOrgId
// ---------------------------------------------------------------------------

import { requireOrgId } from "../middlewares/auth";

describe("requireOrgId", () => {
  it("returns orgId when present", () => {
    const req = { orgId: ORG_A } as Parameters<typeof requireOrgId>[0];
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Parameters<typeof requireOrgId>[1];
    expect(requireOrgId(req, res)).toBe(ORG_A);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("sends 401 and returns null when orgId is null", () => {
    const jsonFn = vi.fn();
    const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
    const req = { orgId: null } as Parameters<typeof requireOrgId>[0];
    const res = { status: statusFn, json: vi.fn() } as unknown as Parameters<typeof requireOrgId>[1];
    const result = requireOrgId(req, res);
    expect(result).toBeNull();
    expect(statusFn).toHaveBeenCalledWith(401);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });
});

// ---------------------------------------------------------------------------
// getAlertsForOrganization — org scoping + filters
// ---------------------------------------------------------------------------

import { getAlertsForOrganization, getPortfolioExposureAlerts } from "../services/alertEvaluationService";

describe("getAlertsForOrganization — org-scoped access", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns alerts tagged with portfolioLinked for the correct org", async () => {
    setupAlertsOrgChain([{ issuerName: "Nike" }], [ALERT_EVENT], 1);
    const result = await getAlertsForOrganization(ORG_A);
    expect(result.total).toBe(1);
    expect(result.alerts[0].portfolioLinked).toBe(true);
  });

  it("returns empty result for org with no alerts", async () => {
    setupAlertsOrgChain([], [], 0);
    const result = await getAlertsForOrganization(ORG_B);
    expect(result.alerts).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("tags alert as not portfolioLinked when issuer not in portfolio", async () => {
    setupAlertsOrgChain([], [ALERT_EVENT], 1);
    const result = await getAlertsForOrganization(ORG_A);
    expect(result.alerts[0].portfolioLinked).toBe(false);
  });
});

describe("getAlertsForOrganization — cross-org isolation", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("org B gets no alerts when DB returns empty (org join filters them out)", async () => {
    setupAlertsOrgChain([], [], 0);
    const result = await getAlertsForOrganization(ORG_B);
    expect(result.alerts).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("always performs an innerJoin to enforce org scoping via alertRulesTable", async () => {
    setupAlertsOrgChain([], [], 0);
    await getAlertsForOrganization(ORG_B);
    expect(dbMock.innerJoin).toHaveBeenCalled();
  });
});

describe("getAlertsForOrganization — alert filters", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("applies portfolioLinked=true post-filter, keeping only linked alerts", async () => {
    const nikeAlert = { ...ALERT_EVENT, issuerName: "Nike" };
    const fordAlert = { ...ALERT_EVENT, id: 2, issuerName: "Ford" };
    setupAlertsOrgChain([{ issuerName: "Nike" }], [nikeAlert, fordAlert], 2);
    const result = await getAlertsForOrganization(ORG_A, { portfolioLinked: true });
    expect(result.alerts.every((a) => a.portfolioLinked)).toBe(true);
    expect(result.alerts.some((a) => a.issuerName === "Ford")).toBe(false);
  });

  it("applies portfolioLinked=false post-filter, keeping only unlinked alerts", async () => {
    const nikeAlert = { ...ALERT_EVENT, issuerName: "Nike" };
    const fordAlert = { ...ALERT_EVENT, id: 2, issuerName: "Ford" };
    setupAlertsOrgChain([{ issuerName: "Nike" }], [nikeAlert, fordAlert], 2);
    const result = await getAlertsForOrganization(ORG_A, { portfolioLinked: false });
    expect(result.alerts.every((a) => !a.portfolioLinked)).toBe(true);
    expect(result.alerts.some((a) => a.issuerName === "Nike")).toBe(false);
  });

  it("passes severity filter condition to the where clause", async () => {
    setupAlertsOrgChain([], [], 0);
    await getAlertsForOrganization(ORG_A, { severity: "high" });
    // The where call for the count/rows queries should include an 'and' condition
    const whereCallArgs = dbMock.where.mock.calls.flat();
    const andCalls = whereCallArgs.filter((a) => a?.type === "and");
    expect(andCalls.length).toBeGreaterThan(0);
  });

  it("passes isRead filter condition to the where clause", async () => {
    setupAlertsOrgChain([], [], 0);
    await getAlertsForOrganization(ORG_A, { isRead: false });
    const whereCallArgs = dbMock.where.mock.calls.flat();
    const andCalls = whereCallArgs.filter((a) => a?.type === "and");
    expect(andCalls.length).toBeGreaterThan(0);
  });

  it("passes dateFrom/dateTo filter conditions to the where clause", async () => {
    setupAlertsOrgChain([], [], 0);
    await getAlertsForOrganization(ORG_A, {
      dateFrom: new Date("2024-01-01"),
      dateTo: new Date("2024-12-31"),
    });
    const whereCallArgs = dbMock.where.mock.calls.flat();
    const andCalls = whereCallArgs.filter((a) => a?.type === "and");
    expect(andCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getPortfolioDetails — org ownership validation
// ---------------------------------------------------------------------------

import { getPortfolioDetails, getPortfoliosForOrganization } from "../services/portfolioService";

describe("getPortfolioDetails — org ownership", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns null when portfolio belongs to a different org (cross-org blocked)", async () => {
    resetDb();
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([{ ...PORTFOLIO, organizationId: ORG_A }]);

    const result = await getPortfolioDetails(PORTFOLIO.id, ORG_B);
    expect(result).toBeNull();
  });

  it("returns null when portfolio does not exist", async () => {
    resetDb();
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([]);

    const result = await getPortfolioDetails(9999, ORG_A);
    expect(result).toBeNull();
  });

  it("proceeds past ownership check for matching org", async () => {
    resetDb();
    // First limit: portfolio lookup succeeds
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([PORTFOLIO]);
    // Holdings query: select().from().leftJoin().where().orderBy()
    dbMock.leftJoin.mockReturnThis();
    dbMock.orderBy.mockResolvedValueOnce([]);

    // No alert counts since no issuers
    const result = await getPortfolioDetails(PORTFOLIO.id, ORG_A);
    // If holdings resolves, result will be non-null
    expect(result).not.toBeNull();
    expect(result?.organizationId).toBe(ORG_A);
  });
});

describe("getPortfoliosForOrganization", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns portfolios for the given org", async () => {
    resetDb();
    dbMock.where.mockReturnThis();
    dbMock.orderBy.mockResolvedValueOnce([PORTFOLIO]);

    const result = await getPortfoliosForOrganization(ORG_A);
    expect(result).toHaveLength(1);
    expect(result[0].organizationId).toBe(ORG_A);
  });

  it("returns empty array when org has no portfolios", async () => {
    resetDb();
    dbMock.where.mockReturnThis();
    dbMock.orderBy.mockResolvedValueOnce([]);

    const result = await getPortfoliosForOrganization(ORG_B);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getPortfolioExposureAlerts
// ---------------------------------------------------------------------------

describe("getPortfolioExposureAlerts", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns empty array when portfolio has no holdings", async () => {
    resetDb();
    dbMock.innerJoin.mockReturnThis();
    dbMock.where.mockResolvedValueOnce([]); // no holdings

    const result = await getPortfolioExposureAlerts(PORTFOLIO.id);
    expect(result).toEqual([]);
  });

  it("groups alert events by issuer", async () => {
    const events = [
      { ...ALERT_EVENT, issuerName: "Nike", severity: "high" },
      { ...ALERT_EVENT, id: 2, issuerName: "Nike", severity: "medium" },
    ];

    resetDb();
    dbMock.innerJoin.mockReturnThis();
    dbMock.where
      .mockResolvedValueOnce([{ canonicalIssuerName: "Nike" }]) // holdings
      .mockReturnThis(); // events query chain
    dbMock.orderBy.mockResolvedValueOnce(events);

    const result = await getPortfolioExposureAlerts(PORTFOLIO.id);
    expect(result).toHaveLength(1);
    expect(result[0].issuerName).toBe("Nike");
    expect(result[0].totalAlerts).toBe(2);
    expect(result[0].highSeverityCount).toBe(1);
    expect(result[0].mediumSeverityCount).toBe(1);
  });

  it("sorts groups by high severity count descending", async () => {
    const events = [
      { ...ALERT_EVENT, issuerName: "Nike", severity: "medium" },
      { ...ALERT_EVENT, id: 3, issuerName: "Ford", severity: "high" },
    ];

    resetDb();
    dbMock.innerJoin.mockReturnThis();
    dbMock.where
      .mockResolvedValueOnce([{ canonicalIssuerName: "Nike" }, { canonicalIssuerName: "Ford" }])
      .mockReturnThis();
    dbMock.orderBy.mockResolvedValueOnce(events);

    const result = await getPortfolioExposureAlerts(PORTFOLIO.id);
    expect(result[0].issuerName).toBe("Ford");
    expect(result[1].issuerName).toBe("Nike");
  });
});

// ---------------------------------------------------------------------------
// HTTP route tests — GET /api/alerts
// ---------------------------------------------------------------------------

describe("GET /api/alerts — route layer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 401 when no org context is provided", async () => {
    const res = await supertest(testApp).get("/api/alerts");
    expect(res.status).toBe(401);
  });

  it("returns 200 with alert page for the requesting org", async () => {
    vi.spyOn(alertEvalSvc, "getAlertsForOrganization").mockResolvedValue({
      alerts: [{ ...ALERT_EVENT, portfolioLinked: true }] as never,
      total: 1,
    });
    const res = await supertest(testApp)
      .get("/api/alerts")
      .set("X-Organization-Id", ORG_A);
    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it("passes org id and filters to getAlertsForOrganization", async () => {
    const spy = vi.spyOn(alertEvalSvc, "getAlertsForOrganization").mockResolvedValue({ alerts: [], total: 0 });
    await supertest(testApp)
      .get("/api/alerts?severity=high")
      .set("X-Organization-Id", ORG_A);
    expect(spy).toHaveBeenCalledWith(ORG_A, expect.objectContaining({ severity: "high" }));
  });
});

// ---------------------------------------------------------------------------
// HTTP route tests — POST /api/alerts/bulk-read
// ---------------------------------------------------------------------------

describe("POST /api/alerts/bulk-read — route layer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 401 when no org context is provided", async () => {
    const res = await supertest(testApp)
      .post("/api/alerts/bulk-read")
      .send({ ids: [1] });
    expect(res.status).toBe(401);
  });

  it("only updates alerts belonging to the current org", async () => {
    resetDb();
    // select chain: .select().from().innerJoin().where() → [{ id: 1 }]  (terminal at where)
    dbMock.where.mockResolvedValueOnce([{ id: 1 }]);
    // update chain: .update().set().where().returning() — where chainable, returning terminal
    dbMock.returning.mockResolvedValueOnce([{ id: 1 }]);

    const res = await supertest(testApp)
      .post("/api/alerts/bulk-read")
      .set("X-Organization-Id", ORG_A)
      .send({ ids: [1] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
  });

  it("returns updated:0 when none of the requested ids belong to the current org", async () => {
    resetDb();
    // select chain: .where() → [] (no valid alerts for this org)
    dbMock.where.mockResolvedValueOnce([]);

    const res = await supertest(testApp)
      .post("/api/alerts/bulk-read")
      .set("X-Organization-Id", ORG_B)
      .send({ ids: [999] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// HTTP route tests — POST /api/alerts/:id/unread
// ---------------------------------------------------------------------------

describe("POST /api/alerts/:id/unread — route layer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 401 when no org context is provided", async () => {
    const res = await supertest(testApp).post("/api/alerts/1/unread");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the alert does not belong to the requesting org", async () => {
    resetDb();
    // select chain: .select().from().innerJoin().where().limit() → [] (not found for this org)
    dbMock.limit.mockResolvedValueOnce([]);

    const res = await supertest(testApp)
      .post("/api/alerts/1/unread")
      .set("X-Organization-Id", ORG_B);
    expect(res.status).toBe(404);
  });

  it("marks alert as unread only when the org owns it", async () => {
    resetDb();
    // select chain: .select().from().innerJoin().where().limit() → [{ id: 1 }]
    dbMock.limit.mockResolvedValueOnce([{ id: 1 }]);
    // update chain: .update().set().where().returning() → [updatedAlert]
    dbMock.returning.mockResolvedValueOnce([{ ...ALERT_EVENT, isRead: false }]);

    const res = await supertest(testApp)
      .post("/api/alerts/1/unread")
      .set("X-Organization-Id", ORG_A);
    expect(res.status).toBe(200);
    expect(res.body.isRead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTTP route tests — POST /api/alerts/:id/feedback
// ---------------------------------------------------------------------------

describe("POST /api/alerts/:id/feedback — route layer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 401 when no org context is provided", async () => {
    const res = await supertest(testApp)
      .post("/api/alerts/1/feedback")
      .send({ rating: "helpful" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when alert does not belong to the requesting org", async () => {
    resetDb();
    // select chain: .where().limit() → [] (alert not owned by this org)
    dbMock.limit.mockResolvedValueOnce([]);

    const res = await supertest(testApp)
      .post("/api/alerts/1/feedback")
      .set("X-Organization-Id", ORG_B)
      .send({ organizationId: ORG_B, rating: "useful" });
    expect(res.status).toBe(404);
  });

  it("upserts feedback when the org owns the alert", async () => {
    resetDb();
    // select chain: .where().limit() → [{ id: 1 }]
    dbMock.limit.mockResolvedValueOnce([{ id: 1 }]);
    // insert chain: .insert().values().onConflictDoUpdate().returning() → [feedback]
    const FEEDBACK = {
      id: 99, alertEventId: 1, organizationId: ORG_A, userId: null,
      rating: "useful", note: null, createdAt: new Date(), updatedAt: new Date(),
    };
    dbMock.returning.mockResolvedValueOnce([FEEDBACK]);

    const res = await supertest(testApp)
      .post("/api/alerts/1/feedback")
      .set("X-Organization-Id", ORG_A)
      .send({ organizationId: ORG_A, rating: "useful" });
    expect(res.status).toBe(200);
    expect(res.body.rating).toBe("useful");
  });
});

// ---------------------------------------------------------------------------
// HTTP route tests — GET /api/portfolios
// ---------------------------------------------------------------------------

describe("GET /api/portfolios — route layer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 401 when no org context is provided", async () => {
    const res = await supertest(testApp).get("/api/portfolios");
    expect(res.status).toBe(401);
  });

  it("returns portfolios list for the requesting org", async () => {
    vi.spyOn(portfolioSvc, "getPortfoliosForOrganization").mockResolvedValue([PORTFOLIO] as never);
    const res = await supertest(testApp)
      .get("/api/portfolios")
      .set("X-Organization-Id", ORG_A);
    expect(res.status).toBe(200);
    expect(res.body.portfolios).toHaveLength(1);
    expect(res.body.portfolios[0].organizationId).toBe(ORG_A);
  });
});

// ---------------------------------------------------------------------------
// HTTP route tests — GET /api/portfolios/:id
// ---------------------------------------------------------------------------

describe("GET /api/portfolios/:id — route layer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 401 when no org context is provided", async () => {
    const res = await supertest(testApp).get("/api/portfolios/42");
    expect(res.status).toBe(401);
  });

  it("returns 404 when portfolio belongs to a different org (cross-org blocked)", async () => {
    vi.spyOn(portfolioSvc, "getPortfolioDetails").mockResolvedValue(null);
    const res = await supertest(testApp)
      .get("/api/portfolios/42")
      .set("X-Organization-Id", ORG_B);
    expect(res.status).toBe(404);
  });

  it("returns 200 with details for a portfolio owned by the requesting org", async () => {
    vi.spyOn(portfolioSvc, "getPortfolioDetails").mockResolvedValue(PORTFOLIO_DETAILS_RESULT as never);
    const res = await supertest(testApp)
      .get("/api/portfolios/42")
      .set("X-Organization-Id", ORG_A);
    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe(ORG_A);
  });
});

// ---------------------------------------------------------------------------
// HTTP route tests — GET /api/portfolios/:id/exposure-alerts
// ---------------------------------------------------------------------------

describe("GET /api/portfolios/:id/exposure-alerts — route layer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 401 when no org context is provided", async () => {
    const res = await supertest(testApp).get("/api/portfolios/42/exposure-alerts");
    expect(res.status).toBe(401);
  });

  it("returns 404 when portfolio does not belong to the requesting org", async () => {
    vi.spyOn(portfolioSvc, "getPortfolioDetails").mockResolvedValue(null);
    const res = await supertest(testApp)
      .get("/api/portfolios/42/exposure-alerts")
      .set("X-Organization-Id", ORG_B);
    expect(res.status).toBe(404);
  });

  it("returns exposure alerts for portfolio owned by requesting org", async () => {
    vi.spyOn(portfolioSvc, "getPortfolioDetails").mockResolvedValue(PORTFOLIO_DETAILS_RESULT as never);
    vi.spyOn(alertEvalSvc, "getPortfolioExposureAlerts").mockResolvedValue([]);
    const res = await supertest(testApp)
      .get("/api/portfolios/42/exposure-alerts")
      .set("X-Organization-Id", ORG_A);
    expect(res.status).toBe(200);
    expect(res.body.alerts).toEqual([]);
  });
});
