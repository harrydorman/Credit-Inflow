import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const articlesTable = pgTable("articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  source: text("source").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  url: text("url").notNull().unique(),
  rawContent: text("raw_content"),
  summary: text("summary"),
  sector: text("sector"),
  eventType: text("event_type"),
  sentiment: text("sentiment"),
  whyItMatters: text("why_it_matters"),
  whoCares: text("who_cares"),
  cloImpact: boolean("clo_impact").notNull().default(false),
  // Trader-critical fields
  issuerName: text("issuer_name"),
  urgencyScore: integer("urgency_score"),       // 1-5: 5=Critical (covenant/bankruptcy), 4=High (downgrade/default), 3=Elevated, 2=Moderate, 1=Info
  covenantFlag: boolean("covenant_flag").notNull().default(false), // mentions covenant breach, waiver, amendment, PIK
  ratingMentioned: text("rating_mentioned"),    // specific rating e.g. "B2", "BB+", "Caa1"
  ratingAgency: text("rating_agency"),          // Moody's, S&P, Fitch
  marketImpact: text("market_impact"),          // high / medium / low
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertArticleSchema = createInsertSchema(articlesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Article = typeof articlesTable.$inferSelect;
