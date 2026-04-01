import { pgTable, text, serial, timestamp, boolean, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const articlesTable = pgTable("articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  source: text("source").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  url: text("url").notNull().unique(),
  rawContent: text("raw_content"),

  // Core AI fields
  summary: text("summary"),
  sector: text("sector"),
  eventType: text("event_type"),
  sentiment: text("sentiment"),
  whyItMatters: text("why_it_matters"),
  whoCares: text("who_cares"),

  // Legacy CLO field kept for backward compat
  cloImpact: boolean("clo_impact").notNull().default(false),

  // Issuer
  issuerName: text("issuer_name"),

  // Phase 1 scoring (kept for compat)
  urgencyScore: integer("urgency_score"),
  covenantFlag: boolean("covenant_flag").notNull().default(false),
  ratingMentioned: text("rating_mentioned"),
  ratingAgency: text("rating_agency"),
  marketImpact: text("market_impact"),

  // Phase 2: Hybrid scoring
  finalUrgencyScore: integer("final_urgency_score"),     // 1-10 hybrid AI + rules
  creditSignalScore: integer("credit_signal_score"),     // global ranking score

  // Trade implication
  tradeDirection: text("trade_direction"),               // positive/negative/neutral
  tradeRationale: text("trade_rationale"),
  potentialTrades: json("potential_trades").$type<string[]>(),
  marketsImpacted: json("markets_impacted").$type<string[]>(),

  // Credit metrics
  leverageMentioned: boolean("leverage_mentioned").notNull().default(false),
  liquidityConcern: boolean("liquidity_concern").notNull().default(false),
  refinancingRisk: boolean("refinancing_risk").notNull().default(false),
  earningsMiss: boolean("earnings_miss").notNull().default(false),

  // Enhanced rating analysis
  ratingIsDowngrade: boolean("rating_is_downgrade").notNull().default(false),
  ratingIsUpgrade: boolean("rating_is_upgrade").notNull().default(false),
  ratingIsCCCThreshold: boolean("rating_is_ccc_threshold").notNull().default(false),

  // Covenant detail
  covenantType: text("covenant_type"),                   // e.g. "financial covenant", "restricted payments"

  // CLO deep analysis
  cloRelevance: text("clo_relevance"),                   // high/medium/low
  cloLoanVsBond: text("clo_loan_vs_bond"),               // loan/bond/mixed
  cloWarfImpact: text("clo_warf_impact"),                // increase/decrease/neutral
  cloCCCBucketRisk: boolean("clo_ccc_bucket_risk").notNull().default(false),
  cloExplanation: text("clo_explanation"),
  cloImpactTypes: json("clo_impact_types").$type<string[]>(),

  // Market technical signals
  spreadWideningRisk: boolean("spread_widening_risk").notNull().default(false),
  forcedSellingRisk: boolean("forced_selling_risk").notNull().default(false),
  distressedRisk: boolean("distressed_risk").notNull().default(false),

  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertArticleSchema = createInsertSchema(articlesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Article = typeof articlesTable.$inferSelect;
