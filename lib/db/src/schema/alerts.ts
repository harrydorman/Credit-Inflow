import { pgTable, serial, text, integer, boolean, json, real, timestamp, uniqueIndex, uuid, index } from "drizzle-orm/pg-core";
import { watchlistsTable } from "./watchlists";
import { articlesTable } from "./articles";
import { organizationsTable } from "./tenants";
import { portfoliosTable } from "./portfolios";
import { usersTable } from "./tenants";

export const alertRulesTable = pgTable("alert_rules", {
  id: serial("id").primaryKey(),
  watchlistId: integer("watchlist_id")
    .notNull()
    .references(() => watchlistsTable.id, { onDelete: "cascade" }),
  /** Owning organization (denormalized from the watchlist for fast query scoping). */
  organizationId: uuid("organization_id")
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  minimumUrgency: integer("minimum_urgency"),
  eventTypes: json("event_types").$type<string[]>(),
  covenantFlagOnly: boolean("covenant_flag_only").notNull().default(false),
  /**
   * Flexible JSON conditions that extend the scalar filters.
   * Example: { sectors: ["Energy"], keywords: ["leverage"] }
   */
  conditions: json("conditions").$type<Record<string, unknown>>(),
  /** Minimum severity level (1-10) to trigger this rule. */
  severityThreshold: integer("severity_threshold"),
  /** Minimum confidence (0.0–1.0) required to trigger this rule. */
  confidenceThreshold: real("confidence_threshold"),
  /**
   * Optional portfolio scope: when set, the rule only fires if the article's
   * issuer exists within this portfolio.
   */
  portfolioId: integer("portfolio_id")
    .references(() => portfoliosTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
},
(t) => [
  index("alert_rules_org_idx").on(t.organizationId),
  index("alert_rules_portfolio_idx").on(t.portfolioId),
]);

export type AlertRule = typeof alertRulesTable.$inferSelect;
export type NewAlertRule = typeof alertRulesTable.$inferInsert;

export const alertEventsTable = pgTable(
  "alert_events",
  {
    id: serial("id").primaryKey(),
    alertRuleId: integer("alert_rule_id")
      .notNull()
      .references(() => alertRulesTable.id, { onDelete: "cascade" }),
    watchlistId: integer("watchlist_id")
      .notNull()
      .references(() => watchlistsTable.id, { onDelete: "cascade" }),
    articleId: integer("article_id")
      .notNull()
      .references(() => articlesTable.id, { onDelete: "cascade" }),
    issuerName: text("issuer_name").notNull(),
    title: text("title").notNull(),
    urgency: integer("urgency"),
    eventType: text("event_type"),
    /** Classification confidence at the time the alert was triggered (0.0–1.0). */
    confidence: real("confidence"),
    /** Severity label derived from urgency + confidence (high/medium/low). */
    severity: text("severity").$type<"high" | "medium" | "low">(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    isRead: boolean("is_read").notNull().default(false),
  },
  (table) => [
    uniqueIndex("uq_alert_event").on(table.alertRuleId, table.articleId),
    index("alert_events_issuer_idx").on(table.issuerName),
    index("alert_events_triggered_at_idx").on(table.triggeredAt),
  ],
);

export type AlertEvent = typeof alertEventsTable.$inferSelect;
export type NewAlertEvent = typeof alertEventsTable.$inferInsert;

// ---------------------------------------------------------------------------
// alert_feedback
// ---------------------------------------------------------------------------

export type AlertFeedbackRating = "useful" | "noise" | "investigate_later";

export const alertFeedbackTable = pgTable(
  "alert_feedback",
  {
    id: serial("id").primaryKey(),
    alertEventId: integer("alert_event_id")
      .notNull()
      .references(() => alertEventsTable.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => usersTable.id, { onDelete: "set null" }),
    rating: text("rating").$type<AlertFeedbackRating>().notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_alert_feedback").on(t.alertEventId, t.organizationId, t.userId),
    index("alert_feedback_alert_event_idx").on(t.alertEventId),
    index("alert_feedback_org_idx").on(t.organizationId),
  ]
);

export type AlertFeedback = typeof alertFeedbackTable.$inferSelect;
export type NewAlertFeedback = typeof alertFeedbackTable.$inferInsert;
