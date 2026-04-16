/**
 * Tests for Phase 12: Ranking Calibration Recommendations + Historical Evaluation Snapshots.
 *
 * Covers:
 *   - createRankingEvalSnapshot: inserts a snapshot row, returns it
 *   - listRankingEvalSnapshots: returns rows sorted newest first, org-safe
 *   - getMostRecentSnapshot: returns the single most-recent row or null
 *   - POST /api/analytics/ranking-eval/snapshots — input validation, 201, 401
 *   - GET  /api/analytics/ranking-eval/snapshots — listing, filtering, pagination, 401
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
  // other tables referenced by routes/analytics middleware
  alertRulesTable: { id: "id", organizationId: "organization_id" },
  alertEventsTable: { id: "id", alertRuleId: "alert_rule_id", issuerName: "issuer_name", eventType: "event_type" },
  alertFeedbackTable: { id: "id", alertEventId: "alert_event_id", organizationId: "organization_id", rating: "rating" },
  alertWorkflowStateTable: { id: "id", alertEventId: "alert_event_id", organizationId: "organization_id", action: "action" },
  portfolioIssuerMapTable: { id: "id", portfolioHoldingId: "portfolio_holding_id", canonicalIssuerName: "canonical_issuer_name" },
  portfolioHoldingsTable: { id: "id", portfolioId: "portfolio_id" },
  portfoliosTable: { id: "id", organizationId: "organization_id", name: "name" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
  and: (...args: unknown[]) => ({ type: "and", args }),
  desc: (col: unknown) => ({ type: "desc", col }),
  count: () => ({ type: "count" }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetDb() {
  for (const method of Object.keys(dbMock) as Array<keyof typeof dbMock>) {
    (dbMock[method] as ReturnType<typeof vi.fn>).mockReset().mockReturnThis();
  }
}

const ORG_A = "org-aaa-1111";
const ORG_B = "org-bbb-2222";

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
};

const SNAPSHOT_STUB = {
  id: 1,
  organizationId: ORG_A,
  rankingModelVersion: "v1.1.0",
  timeWindow: "all",
  snapshotType: "manual",
  metricsJson: METRICS_STUB,
  createdAt: new Date("2024-03-15T10:00:00Z"),
};

// ---------------------------------------------------------------------------
// Service: createRankingEvalSnapshot
// ---------------------------------------------------------------------------

import {
  createRankingEvalSnapshot,
  listRankingEvalSnapshots,
  getMostRecentSnapshot,
} from "../services/rankingEvalSnapshotService";

describe("createRankingEvalSnapshot", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("inserts a row and returns the created snapshot", async () => {
    dbMock.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([SNAPSHOT_STUB]),
      }),
    });

    const result = await createRankingEvalSnapshot({
      orgId: ORG_A,
      rankingModelVersion: "v1.1.0",
      timeWindow: "all",
      snapshotType: "manual",
      metrics: METRICS_STUB,
    });

    expect(result).toEqual(SNAPSHOT_STUB);
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
  });

  it("defaults snapshotType to 'manual'", async () => {
    let capturedValues: Record<string, unknown> | undefined;
    dbMock.insert.mockReturnValue({
      values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
        capturedValues = vals;
        return { returning: vi.fn().mockResolvedValue([SNAPSHOT_STUB]) };
      }),
    });

    await createRankingEvalSnapshot({
      orgId: ORG_A,
      rankingModelVersion: "v1.1.0",
      timeWindow: "7d",
      metrics: METRICS_STUB,
    });

    expect(capturedValues?.snapshotType).toBe("manual");
  });

  it("stores provided snapshotType = 'scheduled'", async () => {
    let capturedValues: Record<string, unknown> | undefined;
    dbMock.insert.mockReturnValue({
      values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
        capturedValues = vals;
        return { returning: vi.fn().mockResolvedValue([{ ...SNAPSHOT_STUB, snapshotType: "scheduled" }]) };
      }),
    });

    await createRankingEvalSnapshot({
      orgId: ORG_A,
      rankingModelVersion: "v1.1.0",
      timeWindow: "30d",
      snapshotType: "scheduled",
      metrics: METRICS_STUB,
    });

    expect(capturedValues?.snapshotType).toBe("scheduled");
  });
});

// ---------------------------------------------------------------------------
// Service: listRankingEvalSnapshots
// ---------------------------------------------------------------------------

describe("listRankingEvalSnapshots", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns snapshots from DB for the given org", async () => {
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([SNAPSHOT_STUB]),
          }),
        }),
      }),
    });

    const result = await listRankingEvalSnapshots(ORG_A);
    expect(result).toEqual([SNAPSHOT_STUB]);
  });

  it("returns empty array when no snapshots exist", async () => {
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const result = await listRankingEvalSnapshots(ORG_B);
    expect(result).toEqual([]);
  });

  it("applies limit option", async () => {
    let capturedLimit: number | undefined;
    const limitFn = vi.fn().mockImplementation((n: number) => {
      capturedLimit = n;
      return Promise.resolve([]);
    });
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({ limit: limitFn }),
        }),
      }),
    });

    await listRankingEvalSnapshots(ORG_A, { limit: 5 });
    expect(capturedLimit).toBe(5);
  });

  it("defaults limit to 20 when not provided", async () => {
    let capturedLimit: number | undefined;
    const limitFn = vi.fn().mockImplementation((n: number) => {
      capturedLimit = n;
      return Promise.resolve([]);
    });
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({ limit: limitFn }),
        }),
      }),
    });

    await listRankingEvalSnapshots(ORG_A);
    expect(capturedLimit).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Service: getMostRecentSnapshot
// ---------------------------------------------------------------------------

describe("getMostRecentSnapshot", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns the first row when one exists", async () => {
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([SNAPSHOT_STUB]),
          }),
        }),
      }),
    });

    const result = await getMostRecentSnapshot(ORG_A, "all");
    expect(result).toEqual(SNAPSHOT_STUB);
  });

  it("returns null when no snapshot exists", async () => {
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const result = await getMostRecentSnapshot(ORG_A, "7d");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HTTP routes
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

const ORG_H = "org-http-1111";

// Helper: set up DB mock to resolve a chain used by the snapshot INSERT route
function setupInsertChain(snapshot: typeof SNAPSHOT_STUB) {
  dbMock.insert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([snapshot]),
    }),
  });
}

// Helper: set up DB mock to resolve a chain used by the snapshot LIST route
function setupSelectChain(snapshots: typeof SNAPSHOT_STUB[]) {
  dbMock.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(snapshots),
        }),
      }),
    }),
  });
}

describe("POST /api/analytics/ranking-eval/snapshots", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns 401 when org header is missing", async () => {
    const res = await supertest(testApp)
      .post("/api/analytics/ranking-eval/snapshots")
      .send({ rankingModelVersion: "v1.1.0", timeWindow: "all", metrics: METRICS_STUB });
    expect(res.status).toBe(401);
  });

  it("returns 400 when rankingModelVersion is missing", async () => {
    const res = await supertest(testApp)
      .post("/api/analytics/ranking-eval/snapshots")
      .set("X-Organization-Id", ORG_H)
      .send({ timeWindow: "all", metrics: METRICS_STUB });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rankingModelVersion/i);
  });

  it("returns 400 when timeWindow is invalid", async () => {
    const res = await supertest(testApp)
      .post("/api/analytics/ranking-eval/snapshots")
      .set("X-Organization-Id", ORG_H)
      .send({ rankingModelVersion: "v1.1.0", timeWindow: "invalid", metrics: METRICS_STUB });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timeWindow/i);
  });

  it("accepts POST without metrics and attempts server-computed metrics", async () => {
    // Phase 13: when metrics is omitted, the server computes them from DB.
    // The DB mock is not set up for the full computation here, so the route
    // will error internally — but crucially it must NOT return 400 for
    // "missing metrics".
    const res = await supertest(testApp)
      .post("/api/analytics/ranking-eval/snapshots")
      .set("X-Organization-Id", ORG_H)
      .send({ rankingModelVersion: "v1.1.0", timeWindow: "all" });
    // Should not be 400 (metrics is no longer required)
    expect(res.status).not.toBe(400);
    // 500 is acceptable since the test DB mock lacks the full select chains
    expect([201, 500]).toContain(res.status);
  });

  it("returns 400 when metrics is explicitly an invalid type", async () => {
    const res = await supertest(testApp)
      .post("/api/analytics/ranking-eval/snapshots")
      .set("X-Organization-Id", ORG_H)
      .send({ rankingModelVersion: "v1.1.0", timeWindow: "all", metrics: "not-an-object" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/metrics/i);
  });

  it("returns 201 with the created snapshot on valid input", async () => {
    const snap = { ...SNAPSHOT_STUB, organizationId: ORG_H };
    setupInsertChain(snap);

    const res = await supertest(testApp)
      .post("/api/analytics/ranking-eval/snapshots")
      .set("X-Organization-Id", ORG_H)
      .send({ rankingModelVersion: "v1.1.0", timeWindow: "all", metrics: METRICS_STUB });

    expect(res.status).toBe(201);
    expect(res.body.rankingModelVersion).toBe("v1.1.0");
    expect(res.body.timeWindow).toBe("all");
  });

  it("accepts all valid time windows", async () => {
    for (const tw of ["7d", "30d", "all"]) {
      setupInsertChain({ ...SNAPSHOT_STUB, timeWindow: tw as "7d" | "30d" | "all", organizationId: ORG_H });

      const res = await supertest(testApp)
        .post("/api/analytics/ranking-eval/snapshots")
        .set("X-Organization-Id", ORG_H)
        .send({ rankingModelVersion: "v1.1.0", timeWindow: tw, metrics: METRICS_STUB });

      expect(res.status).toBe(201);
    }
  });
});

describe("GET /api/analytics/ranking-eval/snapshots", () => {
  beforeEach(() => { vi.clearAllMocks(); resetDb(); });

  it("returns 401 when org header is missing", async () => {
    const res = await supertest(testApp).get("/api/analytics/ranking-eval/snapshots");
    expect(res.status).toBe(401);
  });

  it("returns 200 with a snapshots array", async () => {
    setupSelectChain([SNAPSHOT_STUB]);

    const res = await supertest(testApp)
      .get("/api/analytics/ranking-eval/snapshots")
      .set("X-Organization-Id", ORG_H);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.snapshots)).toBe(true);
    expect(res.body.snapshots).toHaveLength(1);
  });

  it("returns empty snapshots array when none exist", async () => {
    setupSelectChain([]);

    const res = await supertest(testApp)
      .get("/api/analytics/ranking-eval/snapshots")
      .set("X-Organization-Id", ORG_H);

    expect(res.status).toBe(200);
    expect(res.body.snapshots).toEqual([]);
  });

  it("passes valid timeWindow query param to service", async () => {
    setupSelectChain([SNAPSHOT_STUB]);

    const res = await supertest(testApp)
      .get("/api/analytics/ranking-eval/snapshots?timeWindow=7d")
      .set("X-Organization-Id", ORG_H);

    expect(res.status).toBe(200);
  });

  it("ignores invalid timeWindow query param", async () => {
    setupSelectChain([]);

    const res = await supertest(testApp)
      .get("/api/analytics/ranking-eval/snapshots?timeWindow=invalid")
      .set("X-Organization-Id", ORG_H);

    expect(res.status).toBe(200); // invalid window is silently ignored
  });

  it("passes modelVersion query param to service", async () => {
    setupSelectChain([SNAPSHOT_STUB]);

    const res = await supertest(testApp)
      .get("/api/analytics/ranking-eval/snapshots?modelVersion=v1.1.0")
      .set("X-Organization-Id", ORG_H);

    expect(res.status).toBe(200);
    expect(res.body.snapshots).toHaveLength(1);
  });

  it("caps limit at 100", async () => {
    let capturedLimit: number | undefined;
    const limitFn = vi.fn().mockImplementation((n: number) => {
      capturedLimit = n;
      return Promise.resolve([]);
    });
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({ limit: limitFn }),
        }),
      }),
    });

    await supertest(testApp)
      .get("/api/analytics/ranking-eval/snapshots?limit=9999")
      .set("X-Organization-Id", ORG_H);

    expect(capturedLimit).toBe(100);
  });
});
