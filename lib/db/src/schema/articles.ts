import { pgTable, text, serial, timestamp, boolean, integer, json, real, index } from "drizzle-orm/pg-core";
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

  // Market validation layer
  stockMove1D: real("stock_move_1d"),                        // issuer stock 1-day return %
  stockMove5D: real("stock_move_5d"),                        // issuer stock 5-day return %
  hyETFMove: real("hy_etf_move"),                            // HYG ETF 1-day move %
  marketValidationSignal: text("market_validation_signal"),  // confirmed | mixed | unconfirmed
  confidenceScore: text("confidence_score"),                  // high | medium | low

  // Structured AI outputs (new)
  creditSummaryJson: json("credit_summary_json").$type<{
    situation: string;
    creditDrivers: string[];
    riskFactors: string[];
    keyMetricsMentioned: string[];
    bottomLine: string;
  }>(),
  scoreExplanationJson: json("score_explanation_json").$type<{
    creditRisk: string;
    marketSignal: string;
    cloImpact: string;
  }>(),

  // Content depth tracking
  rawSnippet: text("raw_snippet"),                         // original RSS description before enrichment
  contentDepthScore: integer("content_depth_score"),       // 0-100: richer content = higher score
  contentSourceType: text("content_source_type"),          // "rss_snippet" | "expanded_article" | "api_fulltext"

  // Processing outcome tracking
  // Values: "noise_filtered" | "empty_content" | "ai_null" | "ai_error" | "duplicate" | null (= processed OK)
  processFailureReason: text("process_failure_reason"),

  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // Deduplication fingerprints (Phase 1)
  // sha256 hex of normalised title (lowercased, stripped punctuation/whitespace)
  titleFingerprint: text("title_fingerprint"),
  // sha256 hex of first 1,000 chars of normalised content
  contentFingerprint: text("content_fingerprint"),

  // Minimal article-level processing visibility (Phase 1b)
  // Values: "pending" | "processing" | "processed" | "success" | "failed" | "filtered"
  // "processed" is kept for backward compatibility; new pipeline uses "success".
  processingStatus: text("processing_status"),
  // Human-readable error message for the most-recent processing failure.
  processingError: text("processing_error"),
  // Timestamp of the most-recent processing attempt (success or failure).
  lastProcessedAt: timestamp("last_processed_at", { withTimezone: true }),

  // ── Phase 2: Stage-based pipeline ─────────────────────────────────────────
  // Current stage the article has reached in the processing pipeline.
  // Values: "raw" | "filtered" | "enriched" | "issuer_identified" | "classified" | "scored" | "validated"
  processingStage: text("processing_stage"),
  // When the current pipeline run began for this article.
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
  // When the current pipeline run completed (null if still in progress or failed).
  processingCompletedAt: timestamp("processing_completed_at", { withTimezone: true }),

  // ── AI traceability ────────────────────────────────────────────────────────
  // Versions stored so that output changes can be attributed to prompt / model / pipeline changes.
  promptVersion: text("prompt_version"),
  modelVersion: text("model_version"),
  pipelineVersion: text("pipeline_version"),

  // ── Quality + trust ────────────────────────────────────────────────────────
  // Float 0.0 – 1.0: combined confidence from LLM output, rule matches, issuer resolution.
  classificationConfidence: real("classification_confidence"),
  // True when confidence is below threshold or signals are conflicting / incomplete.
  needsReview: boolean("needs_review").notNull().default(false),
  // Human-readable reason explaining why review is needed.
  reviewReason: text("review_reason"),

  // ── Explainability ────────────────────────────────────────────────────────
  // Structured JSON recording rule overrides, per-stage outputs, and timing.
  processingMetadata: json("processing_metadata").$type<Record<string, unknown>>(),
},
(t) => [
  // Fingerprint indexes for fast deduplication lookups
  index("articles_title_fingerprint_idx").on(t.titleFingerprint),
  index("articles_content_fingerprint_idx").on(t.contentFingerprint),
]);

export const insertArticleSchema = createInsertSchema(articlesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Article = typeof articlesTable.$inferSelect;
