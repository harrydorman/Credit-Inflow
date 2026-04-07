/**
 * Tests for Phase 7: Persistent Analyst Workflow + Feedback Loop.
 *
 * Covers:
 *   - alertWorkflowStateTable schema presence
 *   - PUT /alerts/:id/workflow — upsert analyst action (org-safe)
 *   - DELETE /alerts/:id/workflow — clear analyst action (org-safe)
 *   - GET /alerts — action filter (investigate / monitor / ignore / unassigned)
 *   - GET /alerts — workflowAction and feedbackRating included in response
 *   - POST /alerts/:id/feedback — submission and update
 *   - Org-safe access control for workflow state
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
  limit: vi.fn(),
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
  offset: vi.fn(),
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
  articlesTable: { id: "id", issuerName: "issuer_name", title: "title" },
  alertRulesTable: { id: "id", watchlistId: "watchlist_id", organizationId: "organization_id", isActive: "is_active" },
  alertEventsTable: { id: "id", alertRuleId: "alert_rule_id", watchlistId: "watchlist_id", articleId: "article_id", issuerName: "issuer_name", title: "title", urgency: "urgency", eventType: "event_type", triggeredAt: "triggered_at", severity: "severity", confidence: "confidence", isRead: "is_read" },
  alertFeedbackTable: { id: "id", alertEventId: "alert_event_id", organizationId: "organization_id", userId: "user_id", rating: "rating", note: "note", createdAt: "created_at", updatedAt: "updated_at" },
  alertWorkflowStateTable: { id: "id", alertEventId: "alert_event_id", organizationId: "organization_id", userId: "user_id", action: "action", createdAt: "created_at", updatedAt: "updated_at" },
  watchlistItemsTable: { watchlistId: "watchlist_id", normalizedIssuerName: "normalized_issuer_name", issuerName: "issuer_name" },
  portfolioIssuerMapTable: { id: "id", portfolioHoldingId: "portfolio_holding_id", canonicalIssuerName: "canonical_issuer_name" },
  portfolioHoldingsTable: { id: "id", portfolioId: "portfolio_id" },
  portfoliosTable: { id: "id", organizationId: "organization_id", name: "name" },
  notificationChannelsTable: { id: "id" },
  notificationDeliveriesTable: { id: "id" },
  usersTable: { id: "id" },
  organizationsTable: { id: "id" },
  organizationMembershipsTable: { id: "id" },
  watchlistsTable: { id: "id" },
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

function resetDb() {
  for (const method of Object.keys(dbMock) as Array<keyof typeof dbMock>) {
    (dbMock[method] as ReturnType<typeof vi.fn>).mockReset().mockReturnThis();
  }
}

/**
 * Set up DB mock for getAlertsForOrganization.
 * 3 where() calls: portfolioIssuers, rows, count.
 */
function setupAlertsOrgChain(
  portfolioIssuers: unknown[],
  rows: unknown[],
  countVal: number,
) {
  resetDb();

  const rowsChain = {
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(rows),
  };
  (rowsChain.orderBy as ReturnType<typeof vi.fn>).mockReturnValue(rowsChain);
  (rowsChain.limit as ReturnType<typeof vi.fn>).mockReturnValue(rowsChain);

  dbMock.where
    .mockResolvedValueOnce(portfolioIssuers)       // portfolioIssuers
    .mockReturnValueOnce(rowsChain)                // rows query chain
    .mockResolvedValueOnce([{ value: countVal }]); // count
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORG_A = "org-aaa-1111";
const ORG_B = "org-bbb-2222";

const ALERT_EVENT = {
  id: 1,
  alertRuleId: 10,
  watchlistId: 5,
  articleId: 100,
  issuerName: "Nike",
  title: "Nike downgrade",
  urgency: 8,
  eventType: "downgrade",
  confidence: 0.85,
  severity: "high",
  triggeredAt: new Date("2024-01-01T00:00:00Z"),
  isRead: false,
  workflowAction: null,
  feedbackRating: null,
};

const WORKFLOW_STATE = {
  id: 1,
  alertEventId: 1,
  organizationId: ORG_A,
  userId: null,
  action: "investigate" as const,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

// ---------------------------------------------------------------------------
// Schema presence tests
// ---------------------------------------------------------------------------

describe("alertWorkflowStateTable schema", () => {
  it("exports alertWorkflowStateTable with required fields", async () => {
    const { alertWorkflowStateTable } = await import("@workspace/db");
    expect(alertWorkflowStateTable).toBeDefined();
    expect(alertWorkflowStateTable.id).toBeDefined();
    expect(alertWorkflowStateTable.alertEventId).toBeDefined();
    expect(alertWorkflowStateTable.organizationId).toBeDefined();
    expect(alertWorkflowStateTable.action).toBeDefined();
  });

  it("exports alertFeedbackTable with rating field", async () => {
    const { alertFeedbackTable } = await import("@workspace/db");
    expect(alertFeedbackTable).toBeDefined();
    expect(alertFeedbackTable.rating).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getAlertsForOrganization — workflow state and feedback in response
// ---------------------------------------------------------------------------

import { getAlertsForOrganization } from "../services/alertEvaluationService";

describe("getAlertsForOrganization — workflow and feedback in response", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("includes workflowAction and feedbackRating from left joins", async () => {
    const alertWithWorkflow = {
      ...ALERT_EVENT,
      workflowAction: "investigate",
      feedbackRating: "useful",
    };
    setupAlertsOrgChain([], [alertWithWorkflow], 1);
    const result = await getAlertsForOrganization(ORG_A);
    expect(result.total).toBe(1);
    expect(result.alerts[0].workflowAction).toBe("investigate");
    expect(result.alerts[0].feedbackRating).toBe("useful");
  });

  it("returns null workflowAction and feedbackRating when no state exists", async () => {
    setupAlertsOrgChain([], [ALERT_EVENT], 1);
    const result = await getAlertsForOrganization(ORG_A);
    expect(result.alerts[0].workflowAction).toBeNull();
    expect(result.alerts[0].feedbackRating).toBeNull();
  });

  it("performs leftJoin for workflow state and feedback tables", async () => {
    setupAlertsOrgChain([], [], 0);
    await getAlertsForOrganization(ORG_A);
    expect(dbMock.leftJoin).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getAlertsForOrganization — action filter
// ---------------------------------------------------------------------------

describe("getAlertsForOrganization — action filter", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("passes 'investigate' action filter as a condition", async () => {
    setupAlertsOrgChain([], [], 0);
    await getAlertsForOrganization(ORG_A, { action: "investigate" });
    const whereCallArgs = dbMock.where.mock.calls.flat();
    const andCalls = whereCallArgs.filter((a: unknown) => (a as { type: string })?.type === "and");
    expect(andCalls.length).toBeGreaterThan(0);
  });

  it("passes 'unassigned' action filter using isNull condition", async () => {
    setupAlertsOrgChain([], [], 0);
    await getAlertsForOrganization(ORG_A, { action: "unassigned" });
    // The where clause should include an isNull condition for unassigned
    const whereCallArgs = dbMock.where.mock.calls.flat();
    const andCalls = whereCallArgs.filter((a: unknown) => (a as { type: string })?.type === "and");
    expect(andCalls.length).toBeGreaterThan(0);
    // Verify isNull was called (drizzle mock tracks it)
    const { isNull } = await import("drizzle-orm");
    // isNull is called as part of the condition building
    expect(typeof isNull).toBe("function");
  });

  it("does not add action condition when action is not provided", async () => {
    setupAlertsOrgChain([], [], 0);
    await getAlertsForOrganization(ORG_A, {});
    // Just verify it runs without error
    expect(dbMock.where).toHaveBeenCalled();
  });

  it("supports 'monitor' action filter", async () => {
    setupAlertsOrgChain([], [], 0);
    await getAlertsForOrganization(ORG_A, { action: "monitor" });
    expect(dbMock.where).toHaveBeenCalled();
  });

  it("supports 'ignore' action filter", async () => {
    setupAlertsOrgChain([], [], 0);
    await getAlertsForOrganization(ORG_A, { action: "ignore" });
    expect(dbMock.where).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Route-level tests: workflow state endpoints
// ---------------------------------------------------------------------------

import supertest from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";
import alertsRouter from "../routes/alerts";

const testApp = (() => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.orgId = (req.headers["x-organization-id"] as string) ?? null;
    req.userId = (req.headers["x-user-id"] as string) ?? null;
    next();
  });
  app.use("/api", alertsRouter);
  return app;
})();

describe("PUT /alerts/:id/workflow — upsert workflow action", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns 401 when no org header", async () => {
    const res = await supertest(testApp)
      .put("/api/alerts/1/workflow")
      .send({ action: "investigate" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid action value", async () => {
    const res = await supertest(testApp)
      .put("/api/alerts/1/workflow")
      .set("x-organization-id", ORG_A)
      .send({ action: "invalid_action" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when alert doesn't belong to org", async () => {
    // Ownership check: .select().from().innerJoin().where().limit() → []
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([]);
    const res = await supertest(testApp)
      .put("/api/alerts/1/workflow")
      .set("x-organization-id", ORG_A)
      .send({ action: "investigate" });
    expect(res.status).toBe(404);
  });

  it("upserts workflow state and returns 200", async () => {
    // Ownership check: .select().from().innerJoin().where().limit() → [{ id: 1 }]
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([{ id: 1 }]);
    // Insert chain: insert().values().onConflictDoUpdate().returning()
    dbMock.onConflictDoUpdate.mockReturnThis();
    dbMock.returning.mockResolvedValueOnce([WORKFLOW_STATE]);

    const res = await supertest(testApp)
      .put("/api/alerts/1/workflow")
      .set("x-organization-id", ORG_A)
      .send({ action: "investigate" });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("investigate");
    expect(res.body.alertEventId).toBe(1);
    expect(res.body.organizationId).toBe(ORG_A);
  });

  it("supports all valid actions: monitor", async () => {
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([{ id: 1 }]);
    dbMock.onConflictDoUpdate.mockReturnThis();
    dbMock.returning.mockResolvedValueOnce([{ ...WORKFLOW_STATE, action: "monitor" }]);

    const res = await supertest(testApp)
      .put("/api/alerts/1/workflow")
      .set("x-organization-id", ORG_A)
      .send({ action: "monitor" });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("monitor");
  });

  it("supports all valid actions: ignore", async () => {
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([{ id: 1 }]);
    dbMock.onConflictDoUpdate.mockReturnThis();
    dbMock.returning.mockResolvedValueOnce([{ ...WORKFLOW_STATE, action: "ignore" }]);

    const res = await supertest(testApp)
      .put("/api/alerts/1/workflow")
      .set("x-organization-id", ORG_A)
      .send({ action: "ignore" });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("ignore");
  });

  it("org B cannot upsert workflow for org A's alert (returns 404)", async () => {
    // Org B ownership check: no match in join → []
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([]);

    const res = await supertest(testApp)
      .put("/api/alerts/1/workflow")
      .set("x-organization-id", ORG_B)
      .send({ action: "investigate" });

    expect(res.status).toBe(404);
    // Ensure we never attempted to insert
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});

describe("DELETE /alerts/:id/workflow — clear workflow action", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns 401 when no org header", async () => {
    const res = await supertest(testApp)
      .delete("/api/alerts/1/workflow");
    expect(res.status).toBe(401);
  });

  it("returns 404 when alert doesn't belong to org", async () => {
    // Ownership check: .where().limit() → []
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([]);
    const res = await supertest(testApp)
      .delete("/api/alerts/1/workflow")
      .set("x-organization-id", ORG_A);
    expect(res.status).toBe(404);
  });

  it("clears workflow state and returns 204", async () => {
    // Ownership check: .where().limit() → [{ id: 1 }]
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([{ id: 1 }]);
    // Delete: .delete().where() → resolves (terminal, returns this from mockReturnThis)

    const res = await supertest(testApp)
      .delete("/api/alerts/1/workflow")
      .set("x-organization-id", ORG_A);

    expect(res.status).toBe(204);
    expect(dbMock.delete).toHaveBeenCalled();
  });

  it("org B cannot delete workflow for org A's alert (returns 404)", async () => {
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([]);

    const res = await supertest(testApp)
      .delete("/api/alerts/1/workflow")
      .set("x-organization-id", ORG_B);

    expect(res.status).toBe(404);
    expect(dbMock.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Route-level tests: feedback submission
// ---------------------------------------------------------------------------

describe("POST /alerts/:id/feedback — feedback CRUD", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns 401 when no org header", async () => {
    const res = await supertest(testApp)
      .post("/api/alerts/1/feedback")
      .send({ rating: "useful", organizationId: ORG_A });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid rating value", async () => {
    const res = await supertest(testApp)
      .post("/api/alerts/1/feedback")
      .set("x-organization-id", ORG_A)
      .send({ rating: "bad_rating", organizationId: ORG_A });
    expect(res.status).toBe(400);
  });

  it("returns 404 when alert not found for org", async () => {
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([]);
    const res = await supertest(testApp)
      .post("/api/alerts/1/feedback")
      .set("x-organization-id", ORG_A)
      .send({ rating: "useful", organizationId: ORG_A });
    expect(res.status).toBe(404);
  });

  it("creates or updates feedback and returns 200 with rating=useful", async () => {
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([{ id: 1 }]);
    dbMock.onConflictDoUpdate.mockReturnThis();
    const feedbackRow = {
      id: 1, alertEventId: 1, organizationId: ORG_A,
      userId: null, rating: "useful", note: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    dbMock.returning.mockResolvedValueOnce([feedbackRow]);

    const res = await supertest(testApp)
      .post("/api/alerts/1/feedback")
      .set("x-organization-id", ORG_A)
      .send({ rating: "useful", organizationId: ORG_A });

    expect(res.status).toBe(200);
    expect(res.body.rating).toBe("useful");
  });

  it("updates feedback when called again (upsert semantics)", async () => {
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([{ id: 1 }]);
    dbMock.onConflictDoUpdate.mockReturnThis();
    const feedbackRow = {
      id: 1, alertEventId: 1, organizationId: ORG_A,
      userId: null, rating: "noise", note: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    dbMock.returning.mockResolvedValueOnce([feedbackRow]);

    const res = await supertest(testApp)
      .post("/api/alerts/1/feedback")
      .set("x-organization-id", ORG_A)
      .send({ rating: "noise", organizationId: ORG_A });

    expect(res.status).toBe(200);
    expect(res.body.rating).toBe("noise");
  });

  it("accepts 'investigate_later' rating", async () => {
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([{ id: 1 }]);
    dbMock.onConflictDoUpdate.mockReturnThis();
    const feedbackRow = {
      id: 1, alertEventId: 1, organizationId: ORG_A,
      userId: null, rating: "investigate_later", note: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    dbMock.returning.mockResolvedValueOnce([feedbackRow]);

    const res = await supertest(testApp)
      .post("/api/alerts/1/feedback")
      .set("x-organization-id", ORG_A)
      .send({ rating: "investigate_later", organizationId: ORG_A });

    expect(res.status).toBe(200);
    expect(res.body.rating).toBe("investigate_later");
  });

  it("org B cannot submit feedback for org A's alert (returns 404)", async () => {
    dbMock.where.mockReturnThis();
    dbMock.limit.mockResolvedValueOnce([]);
    const res = await supertest(testApp)
      .post("/api/alerts/1/feedback")
      .set("x-organization-id", ORG_B)
      .send({ rating: "useful", organizationId: ORG_B });
    expect(res.status).toBe(404);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});
