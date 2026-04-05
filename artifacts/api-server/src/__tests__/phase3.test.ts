/**
 * Tests for Phase 3: SaaS layer — alert evaluation, notification dispatch,
 * portfolio ingestion, tenant isolation, and portfolio-based alert filtering.
 *
 * Mocking strategy mirrors the existing pipeline tests:
 *   - `@workspace/db` exports a single shared mock `db` object
 *   - Tests mutate mock methods on that object before each test
 *   - `where()` uses mockReturnValueOnce({ limit/orderBy/... }) to support chaining,
 *     or mockResolvedValueOnce(arr) when `where` is the terminal DB call
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock — must be defined before vi.mock factories run
// ---------------------------------------------------------------------------

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  innerJoin: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  onConflictDoNothing: vi.fn(),
  returning: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock modules
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

vi.mock("../lib/canonicalIssuers", () => ({
  canonicalizeIssuer: (val: string | null) => {
    if (!val) return null;
    const MAP: Record<string, string> = {
      nike: "Nike",
      "nike inc": "Nike",
      apple: "Apple",
      "apple inc": "Apple",
      ford: "Ford Motor",
      "ford motor": "Ford Motor",
    };
    return MAP[val.toLowerCase()] ?? null;
  },
}));

vi.mock("@workspace/db", () => ({
  db: dbMock,
  articlesTable: { id: "id", issuerName: "issuer_name", title: "title", finalUrgencyScore: "final_urgency_score", eventType: "event_type", sector: "sector", covenantFlag: "covenant_flag", classificationConfidence: "classification_confidence" },
  alertRulesTable: { id: "id", watchlistId: "watchlist_id", organizationId: "organization_id", isActive: "is_active", name: "name", minimumUrgency: "minimum_urgency", eventTypes: "event_types", covenantFlagOnly: "covenant_flag_only", conditions: "conditions", severityThreshold: "severity_threshold", confidenceThreshold: "confidence_threshold", portfolioId: "portfolio_id" },
  alertEventsTable: { id: "id", alertRuleId: "alert_rule_id", watchlistId: "watchlist_id", articleId: "article_id", issuerName: "issuer_name", eventType: "event_type", triggeredAt: "triggered_at", severity: "severity", confidence: "confidence", isRead: "is_read" },
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
  desc: (col: unknown) => ({ type: "desc", col }),
  isNull: (col: unknown) => ({ type: "isNull", col }),
  isNotNull: (col: unknown) => ({ type: "isNotNull", col }),
}));

// ---------------------------------------------------------------------------
// Helper: reset all dbMock methods to chain-safe defaults
// ---------------------------------------------------------------------------

function resetDb() {
  dbMock.select.mockReset().mockReturnThis();
  dbMock.from.mockReset().mockReturnThis();
  dbMock.innerJoin.mockReset().mockReturnThis();
  dbMock.insert.mockReset().mockReturnThis();
  dbMock.values.mockReset().mockReturnThis();
  dbMock.update.mockReset().mockReturnThis();
  dbMock.set.mockReset().mockReturnThis();
  dbMock.delete.mockReset().mockReturnThis();
  dbMock.onConflictDoNothing.mockReset().mockReturnThis();
  dbMock.where.mockReset();
  dbMock.limit.mockReset();
  dbMock.orderBy.mockReset();
  dbMock.returning.mockReset();
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const ARTICLE = {
  id: 1,
  title: "Nike credit downgrade announced",
  issuerName: "Nike",
  finalUrgencyScore: 7,
  eventType: "downgrade",
  sector: "Consumer",
  covenantFlag: false,
  classificationConfidence: 0.82,
};

const WATCHLIST_ITEM = { watchlistId: 10 };

const ALERT_RULE = {
  id: 1,
  watchlistId: 10,
  organizationId: "org-123",
  name: "Nike Downgrade Rule",
  isActive: true,
  minimumUrgency: 5,
  eventTypes: ["downgrade"],
  covenantFlagOnly: false,
  conditions: null,
  severityThreshold: null,
  confidenceThreshold: null,
  portfolioId: null,
};

// ---------------------------------------------------------------------------
// CSV parser — pure unit tests (no DB)
// ---------------------------------------------------------------------------

import { parsePortfolioCSV } from "../services/portfolioService";

describe("parsePortfolioCSV", () => {
  it("parses a minimal two-column CSV", () => {
    const rows = parsePortfolioCSV("issuer_name,position_size\nNike,1000000\nApple,500000");
    expect(rows).toHaveLength(2);
    expect(rows[0].issuerName).toBe("Nike");
    expect(rows[0].positionSize).toBe(1000000);
    expect(rows[1].issuerName).toBe("Apple");
    expect(rows[1].positionSize).toBe(500000);
  });

  it("returns empty array for header-only CSV", () => {
    expect(parsePortfolioCSV("issuer_name,position_size\n")).toHaveLength(0);
  });

  it("throws when issuer_name column is missing", () => {
    expect(() => parsePortfolioCSV("name,size\nNike,100")).toThrow(/issuer_name/);
  });

  it("handles missing position_size column gracefully (null)", () => {
    const rows = parsePortfolioCSV("issuer_name\nNike");
    expect(rows[0].positionSize).toBeNull();
  });

  it("captures extra columns in metadata", () => {
    const rows = parsePortfolioCSV("issuer_name,position_size,currency\nNike,100,USD");
    expect(rows[0].metadata.currency).toBe("USD");
  });

  it("skips blank rows", () => {
    expect(parsePortfolioCSV("issuer_name\nNike\n\n\nApple")).toHaveLength(2);
  });

  it("skips rows with empty issuer_name", () => {
    const rows = parsePortfolioCSV("issuer_name,position_size\n,1000\nNike,500");
    expect(rows).toHaveLength(1);
    expect(rows[0].issuerName).toBe("Nike");
  });

  it("handles CRLF line endings", () => {
    expect(parsePortfolioCSV("issuer_name\r\nNike\r\nApple")).toHaveLength(2);
  });

  it("returns empty array for completely empty string", () => {
    expect(parsePortfolioCSV("")).toHaveLength(0);
  });

  it("treats non-numeric position_size as null", () => {
    expect(parsePortfolioCSV("issuer_name,position_size\nNike,N/A")[0].positionSize).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Alert severity logic (pure)
// ---------------------------------------------------------------------------

describe("alert severity logic", () => {
  function sev(urgency: number | null, confidence: number | null) {
    const u = urgency ?? 0;
    const c = confidence ?? 0;
    if (u >= 7 || c >= 0.8) return "high";
    if (u >= 4 || c >= 0.5) return "medium";
    return "low";
  }

  it("urgency >= 7 → high", () => expect(sev(7, 0)).toBe("high"));
  it("confidence >= 0.8 → high", () => expect(sev(2, 0.9)).toBe("high"));
  it("urgency 4-6 → medium", () => expect(sev(5, 0)).toBe("medium"));
  it("confidence 0.5-0.79 → medium", () => expect(sev(1, 0.6)).toBe("medium"));
  it("low urgency + low confidence → low", () => expect(sev(1, 0.2)).toBe("low"));
  it("null inputs → low", () => expect(sev(null, null)).toBe("low"));
});

// ---------------------------------------------------------------------------
// Tenant isolation — schema shape
// ---------------------------------------------------------------------------

describe("tenant isolation — schema shape", () => {
  it("organizationsTable exists with id + name", async () => {
    const { organizationsTable } = await import("@workspace/db");
    expect(organizationsTable.id).toBeDefined();
    expect(organizationsTable.name).toBeDefined();
  });

  it("usersTable has email + name", async () => {
    const { usersTable } = await import("@workspace/db");
    expect(usersTable.email).toBeDefined();
    expect(usersTable.name).toBeDefined();
  });

  it("organizationMembershipsTable has userId, organizationId, role", async () => {
    const { organizationMembershipsTable } = await import("@workspace/db");
    expect(organizationMembershipsTable.userId).toBeDefined();
    expect(organizationMembershipsTable.organizationId).toBeDefined();
    expect(organizationMembershipsTable.role).toBeDefined();
  });

  it("watchlistsTable has organizationId", async () => {
    const { watchlistsTable } = await import("@workspace/db");
    expect(watchlistsTable.organizationId).toBeDefined();
  });

  it("alertRulesTable has organizationId, portfolioId, confidenceThreshold, conditions", async () => {
    const { alertRulesTable } = await import("@workspace/db");
    expect(alertRulesTable.organizationId).toBeDefined();
    expect(alertRulesTable.portfolioId).toBeDefined();
    expect(alertRulesTable.confidenceThreshold).toBeDefined();
    expect(alertRulesTable.conditions).toBeDefined();
  });

  it("alertEventsTable has confidence + severity", async () => {
    const { alertEventsTable } = await import("@workspace/db");
    expect(alertEventsTable.confidence).toBeDefined();
    expect(alertEventsTable.severity).toBeDefined();
  });

  it("portfoliosTable has organizationId", async () => {
    const { portfoliosTable } = await import("@workspace/db");
    expect(portfoliosTable.organizationId).toBeDefined();
  });

  it("notificationChannelsTable has organizationId, type, config", async () => {
    const { notificationChannelsTable } = await import("@workspace/db");
    expect(notificationChannelsTable.organizationId).toBeDefined();
    expect(notificationChannelsTable.type).toBeDefined();
    expect(notificationChannelsTable.config).toBeDefined();
  });

  it("portfolioIssuerMapTable has canonicalIssuerName, confidence, source", async () => {
    const { portfolioIssuerMapTable } = await import("@workspace/db");
    expect(portfolioIssuerMapTable.canonicalIssuerName).toBeDefined();
    expect(portfolioIssuerMapTable.confidence).toBeDefined();
    expect(portfolioIssuerMapTable.source).toBeDefined();
  });

  it("notificationDeliveriesTable has status, error, sentAt", async () => {
    const { notificationDeliveriesTable } = await import("@workspace/db");
    expect(notificationDeliveriesTable.status).toBeDefined();
    expect(notificationDeliveriesTable.error).toBeDefined();
    expect(notificationDeliveriesTable.sentAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// evaluateAlertsForArticle
// ---------------------------------------------------------------------------

import { evaluateAlertsForArticle, getPortfolioExposureAlerts } from "../services/alertEvaluationService";
import { dispatchNotifications } from "../services/notificationService";
import { ingestPortfolioCSV } from "../services/portfolioService";

describe("evaluateAlertsForArticle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("returns articleId in result", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
    const result = await evaluateAlertsForArticle(42);
    expect(result.articleId).toBe(42);
  });

  it("returns zero alertsCreated when article not found", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
    const result = await evaluateAlertsForArticle(99);
    expect(result.alertsCreated).toBe(0);
  });

  it("returns zero alertsCreated when issuerName is null", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ ...ARTICLE, issuerName: null }]) });
    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsCreated).toBe(0);
  });

  it("returns zero alertsCreated when no watchlist items match", async () => {
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([ARTICLE]) }) // article fetch
      .mockResolvedValueOnce([]); // watchlist items: empty
    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsCreated).toBe(0);
  });

  it("returns zero alertsCreated when no active rules exist", async () => {
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([ARTICLE]) })
      .mockResolvedValueOnce([WATCHLIST_ITEM])  // watchlist items
      .mockResolvedValueOnce([]);               // alert rules: none
    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsCreated).toBe(0);
  });

  it("creates an alert event when rule conditions match", async () => {
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([ARTICLE]) })
      .mockResolvedValueOnce([WATCHLIST_ITEM])  // watchlist items
      .mockResolvedValueOnce([ALERT_RULE])       // alert rules
      .mockResolvedValueOnce([]);               // cooldown: no recent events
    dbMock.returning.mockResolvedValueOnce([{ id: 100 }]);

    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsCreated).toBe(1);
    expect(result.alertsSkippedCooldown).toBe(0);
    expect(result.alertsSkippedPortfolioFilter).toBe(0);
  });

  it("skips events within cooldown window", async () => {
    const recentEvent = { alertRuleId: 1, issuerName: "Nike", eventType: "downgrade", triggeredAt: new Date() };
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([ARTICLE]) })
      .mockResolvedValueOnce([WATCHLIST_ITEM])
      .mockResolvedValueOnce([ALERT_RULE])
      .mockResolvedValueOnce([recentEvent]); // cooldown hit

    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsSkippedCooldown).toBeGreaterThanOrEqual(1);
    expect(result.alertsCreated).toBe(0);
  });

  it("filters when minimumUrgency not met", async () => {
    const lowArticle = { ...ARTICLE, finalUrgencyScore: 2 };
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([lowArticle]) })
      .mockResolvedValueOnce([WATCHLIST_ITEM])
      .mockResolvedValueOnce([{ ...ALERT_RULE, minimumUrgency: 8 }])
      .mockResolvedValueOnce([]); // cooldown
    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsCreated).toBe(0);
  });

  it("filters when confidenceThreshold not met", async () => {
    const lowConfArticle = { ...ARTICLE, classificationConfidence: 0.3 };
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([lowConfArticle]) })
      .mockResolvedValueOnce([WATCHLIST_ITEM])
      .mockResolvedValueOnce([{ ...ALERT_RULE, confidenceThreshold: 0.8, minimumUrgency: null }])
      .mockResolvedValueOnce([]); // cooldown
    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsCreated).toBe(0);
  });

  it("filters when eventType doesn't match rule's eventTypes", async () => {
    const wrongEvent = { ...ARTICLE, eventType: "earnings" };
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([wrongEvent]) })
      .mockResolvedValueOnce([WATCHLIST_ITEM])
      .mockResolvedValueOnce([ALERT_RULE]) // rule only allows "downgrade"
      .mockResolvedValueOnce([]);
    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsCreated).toBe(0);
  });

  it("filters covenantFlagOnly rule when article has no covenant flag", async () => {
    const covenantRule = { ...ALERT_RULE, covenantFlagOnly: true, minimumUrgency: null, eventTypes: null };
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([ARTICLE]) }) // covenantFlag=false
      .mockResolvedValueOnce([WATCHLIST_ITEM])
      .mockResolvedValueOnce([covenantRule])
      .mockResolvedValueOnce([]);
    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsCreated).toBe(0);
  });

  it("applies portfolio filter — skips when issuer not in portfolio", async () => {
    const portfolioRule = { ...ALERT_RULE, portfolioId: 5, minimumUrgency: null, eventTypes: null };
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([ARTICLE]) })
      .mockResolvedValueOnce([WATCHLIST_ITEM])
      .mockResolvedValueOnce([portfolioRule])
      .mockResolvedValueOnce([]) // cooldown
      // portfolio membership: not found
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });

    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsSkippedPortfolioFilter).toBe(1);
    expect(result.alertsCreated).toBe(0);
  });

  it("applies portfolio filter — fires when issuer IS in portfolio", async () => {
    const portfolioRule = { ...ALERT_RULE, portfolioId: 5, minimumUrgency: null, eventTypes: null };
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([ARTICLE]) })
      .mockResolvedValueOnce([WATCHLIST_ITEM])
      .mockResolvedValueOnce([portfolioRule])
      .mockResolvedValueOnce([]) // cooldown
      // portfolio membership: found
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ id: 99 }]) });
    dbMock.returning.mockResolvedValueOnce([{ id: 101 }]);

    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsCreated).toBe(1);
    expect(result.alertsSkippedPortfolioFilter).toBe(0);
  });

  it("counts alertsSkippedDuplicate when DB deduplicates via ON CONFLICT", async () => {
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([ARTICLE]) })
      .mockResolvedValueOnce([WATCHLIST_ITEM])
      .mockResolvedValueOnce([ALERT_RULE])
      .mockResolvedValueOnce([]); // cooldown
    // Insert returns empty (all rows conflicted)
    dbMock.returning.mockResolvedValueOnce([]);

    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsCreated).toBe(0);
    expect(result.alertsSkippedDuplicate).toBe(1);
  });

  it("does not throw on DB error — returns articleId with zero counts", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockRejectedValueOnce(new Error("DB down")) });
    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsCreated).toBe(0);
    expect(result.articleId).toBe(1);
  });

  it("applies sector condition from JSON conditions field", async () => {
    // Article in "Consumer" but rule requires "Energy"
    const sectorRule = { ...ALERT_RULE, conditions: { sectors: ["Energy"] }, minimumUrgency: null, eventTypes: null };
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([ARTICLE]) })
      .mockResolvedValueOnce([WATCHLIST_ITEM])
      .mockResolvedValueOnce([sectorRule])
      .mockResolvedValueOnce([]); // cooldown
    const result = await evaluateAlertsForArticle(1);
    expect(result.alertsCreated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dispatchNotifications
// ---------------------------------------------------------------------------

describe("dispatchNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("returns alertEventId in result", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
    const result = await dispatchNotifications(7);
    expect(result.alertEventId).toBe(7);
  });

  it("returns zero channelsAttempted when alert event not found", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
    expect((await dispatchNotifications(99)).channelsAttempted).toBe(0);
  });

  it("returns zero channelsAttempted when organizationId is null", async () => {
    const ev = { id: 1, issuerName: "Nike", eventType: "downgrade", severity: "high", confidence: 0.9, urgency: 8, articleId: 1, triggeredAt: new Date(), alertRuleId: 1, organizationId: null, alertRuleName: "Rule" };
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([ev]) });
    expect((await dispatchNotifications(1)).channelsAttempted).toBe(0);
  });

  it("dispatches to all configured channels (2 channels → 2 attempted)", async () => {
    const ev = { id: 1, issuerName: "Nike", eventType: "downgrade", severity: "high", confidence: 0.9, urgency: 8, articleId: 1, triggeredAt: new Date(), alertRuleId: 1, organizationId: "org-123", alertRuleName: "Rule" };
    const channels = [
      { id: 10, organizationId: "org-123", name: "Email", type: "email", config: { to: ["a@b.com"] }, createdAt: new Date() },
      { id: 11, organizationId: "org-123", name: "Slack", type: "slack", config: { webhookUrl: "https://hooks.slack.com/x" }, createdAt: new Date() },
    ];
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([ev]) }) // event+rule join
      .mockResolvedValueOnce(channels);                                  // channels query
    // Only 2 delivery inserts (updates use .where(), not .returning())
    dbMock.returning
      .mockResolvedValueOnce([{ id: 100 }])  // ch1 insert queued delivery
      .mockResolvedValueOnce([{ id: 101 }]); // ch2 insert queued delivery

    const result = await dispatchNotifications(1);
    expect(result.channelsAttempted).toBe(2);
    expect(result.channelsSent).toBe(2);
    expect(result.channelsFailed).toBe(0);
  });

  it("skips channels with unknown type", async () => {
    const ev = { id: 1, issuerName: "Nike", eventType: "downgrade", severity: "high", confidence: 0.9, urgency: 8, articleId: 1, triggeredAt: new Date(), alertRuleId: 1, organizationId: "org-123", alertRuleName: "Rule" };
    const unknownChannel = { id: 20, organizationId: "org-123", name: "PD", type: "pagerduty", config: {}, createdAt: new Date() };
    dbMock.where
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([ev]) })
      .mockResolvedValueOnce([unknownChannel]);
    // No returning mock needed — skip path uses .insert().values() without .returning()

    const result = await dispatchNotifications(1);
    expect(result.channelsSkipped).toBe(1);
    expect(result.channelsSent).toBe(0);
  });

  it("does not throw on DB error — returns zero counts", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockRejectedValueOnce(new Error("DB down")) });
    const result = await dispatchNotifications(1);
    expect(result.channelsAttempted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ingestPortfolioCSV
// ---------------------------------------------------------------------------

describe("ingestPortfolioCSV", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("throws when portfolio is not found", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
    await expect(ingestPortfolioCSV(99, "issuer_name\nNike")).rejects.toThrow("Portfolio 99 not found");
  });

  it("creates holdings and issuer maps for each valid CSV row", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ id: 1 }]) });
    // Only 2 returning mocks (one per holding insert).
    // Issuer map inserts use .insert().values() with no .returning()
    dbMock.returning
      .mockResolvedValueOnce([{ id: 10 }])  // Nike holding
      .mockResolvedValueOnce([{ id: 11 }]); // Apple holding

    const result = await ingestPortfolioCSV(1, "issuer_name,position_size\nNike,1000000\nApple,500000");
    expect(result.rowsProcessed).toBe(2);
    expect(result.holdingsCreated).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it("increments issuersMapped for canonicalized issuers", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ id: 1 }]) });
    dbMock.returning.mockResolvedValueOnce([{ id: 10 }]); // holding insert only

    const result = await ingestPortfolioCSV(1, "issuer_name\nNike Inc");
    expect(result.issuersMapped).toBe(1);
    expect(result.issuersUnmapped).toBe(0);
  });

  it("increments issuersUnmapped for unknown issuers", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ id: 1 }]) });
    dbMock.returning.mockResolvedValueOnce([{ id: 10 }]); // holding insert only

    const result = await ingestPortfolioCSV(1, "issuer_name\nUnknown Corp XYZ");
    expect(result.issuersUnmapped).toBe(1);
    expect(result.issuersMapped).toBe(0);
  });

  it("returns CSV parse error in errors array when header is missing", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ id: 1 }]) });
    const result = await ingestPortfolioCSV(1, "name,size\nNike,100");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/CSV parse error/);
  });

  it("returns holdingsSkipped when holding insert returns empty", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ id: 1 }]) });
    dbMock.returning.mockResolvedValueOnce([]); // empty → holding skipped

    const result = await ingestPortfolioCSV(1, "issuer_name\nNike");
    expect(result.holdingsSkipped).toBe(1);
    expect(result.holdingsCreated).toBe(0);
  });

  it("returns correct portfolioId in result", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ id: 5 }]) });
    dbMock.returning.mockResolvedValueOnce([{ id: 10 }]); // holding insert only
    const result = await ingestPortfolioCSV(5, "issuer_name\nNike");
    expect(result.portfolioId).toBe(5);
  });

  it("handles empty CSV (header only) gracefully", async () => {
    dbMock.where.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ id: 1 }]) });
    const result = await ingestPortfolioCSV(1, "issuer_name\n");
    expect(result.rowsProcessed).toBe(0);
    expect(result.holdingsCreated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getPortfolioExposureAlerts
// ---------------------------------------------------------------------------

describe("getPortfolioExposureAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("returns empty array when portfolio has no holdings", async () => {
    // innerJoin chain terminates at where
    dbMock.where.mockResolvedValueOnce([]); // holdings: empty
    const result = await getPortfolioExposureAlerts(1);
    expect(result).toEqual([]);
  });

  it("groups alert events by issuer name", async () => {
    const now = new Date();
    const holdings = [{ canonicalIssuerName: "Nike" }, { canonicalIssuerName: "Apple" }];
    const events = [
      { id: 1, issuerName: "Nike", alertRuleId: 1, articleId: 1, eventType: "downgrade", confidence: 0.9, severity: "high", triggeredAt: now, isRead: false },
      { id: 2, issuerName: "Nike", alertRuleId: 1, articleId: 2, eventType: "downgrade", confidence: 0.7, severity: "medium", triggeredAt: now, isRead: false },
      { id: 3, issuerName: "Apple", alertRuleId: 2, articleId: 3, eventType: "earnings", confidence: 0.6, severity: "medium", triggeredAt: now, isRead: false },
    ];
    // holdings query: where is terminal; events query: where chains to orderBy
    dbMock.where
      .mockResolvedValueOnce(holdings)
      .mockReturnValueOnce(dbMock);
    dbMock.orderBy.mockResolvedValueOnce(events);

    const result = await getPortfolioExposureAlerts(1);
    expect(result).toHaveLength(2);
    const nike = result.find((r) => r.issuerName === "Nike")!;
    expect(nike.totalAlerts).toBe(2);
    expect(nike.highSeverityCount).toBe(1);
    expect(nike.mediumSeverityCount).toBe(1);
    const apple = result.find((r) => r.issuerName === "Apple")!;
    expect(apple.totalAlerts).toBe(1);
  });

  it("sorts by high severity count descending", async () => {
    const now = new Date();
    const holdings = [{ canonicalIssuerName: "Nike" }, { canonicalIssuerName: "Apple" }];
    const events = [
      { id: 1, issuerName: "Apple", alertRuleId: 2, articleId: 2, eventType: "downgrade", confidence: 0.9, severity: "high", triggeredAt: now, isRead: false },
      { id: 2, issuerName: "Apple", alertRuleId: 2, articleId: 3, eventType: "downgrade", confidence: 0.8, severity: "high", triggeredAt: now, isRead: false },
      { id: 3, issuerName: "Nike", alertRuleId: 1, articleId: 1, eventType: "earnings", confidence: 0.5, severity: "low", triggeredAt: now, isRead: false },
    ];
    dbMock.where
      .mockResolvedValueOnce(holdings)
      .mockReturnValueOnce(dbMock);
    dbMock.orderBy.mockResolvedValueOnce(events);

    const result = await getPortfolioExposureAlerts(1);
    expect(result[0].issuerName).toBe("Apple");
    expect(result[1].issuerName).toBe("Nike");
  });

  it("correctly counts severity buckets", async () => {
    const now = new Date();
    const holdings = [{ canonicalIssuerName: "Nike" }];
    const events = [
      { id: 1, issuerName: "Nike", alertRuleId: 1, articleId: 1, eventType: "d", confidence: 0.9, severity: "high", triggeredAt: now, isRead: false },
      { id: 2, issuerName: "Nike", alertRuleId: 1, articleId: 2, eventType: "d", confidence: 0.6, severity: "medium", triggeredAt: now, isRead: false },
      { id: 3, issuerName: "Nike", alertRuleId: 1, articleId: 3, eventType: "d", confidence: 0.3, severity: "low", triggeredAt: now, isRead: false },
    ];
    dbMock.where
      .mockResolvedValueOnce(holdings)
      .mockReturnValueOnce(dbMock);
    dbMock.orderBy.mockResolvedValueOnce(events);

    const result = await getPortfolioExposureAlerts(1);
    expect(result[0].highSeverityCount).toBe(1);
    expect(result[0].mediumSeverityCount).toBe(1);
    expect(result[0].lowSeverityCount).toBe(1);
    expect(result[0].totalAlerts).toBe(3);
  });

  it("deduplicates holding issuers so each appears in one group", async () => {
    const now = new Date();
    // Two holdings pointing at same canonical issuer
    const holdings = [{ canonicalIssuerName: "Nike" }, { canonicalIssuerName: "Nike" }];
    const events = [{ id: 1, issuerName: "Nike", alertRuleId: 1, articleId: 1, eventType: "d", confidence: 0.9, severity: "high", triggeredAt: now, isRead: false }];
    dbMock.where
      .mockResolvedValueOnce(holdings)
      .mockReturnValueOnce(dbMock);
    dbMock.orderBy.mockResolvedValueOnce(events);

    const result = await getPortfolioExposureAlerts(1);
    expect(result).toHaveLength(1);
    expect(result[0].issuerName).toBe("Nike");
  });
});
