import { pgTable, serial, text, timestamp, real, integer, json } from "drizzle-orm/pg-core";

export const issuerSnapshotsTable = pgTable("issuer_snapshots", {
  id: serial("id").primaryKey(),
  issuerName: text("issuer_name").notNull(),
  sector: text("sector"),
  riskLevel: text("risk_level"),
  trend: text("trend"),
  riskScore: real("risk_score"),
  articleCount: integer("article_count"),
  negativeSignalRatio: real("negative_signal_ratio"),
  dominantSignal: text("dominant_signal"),
  summary: text("summary"),
  keyDrivers: json("key_drivers").$type<string[]>(),
  keyRisks: json("key_risks").$type<string[]>(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IssuerSnapshot = typeof issuerSnapshotsTable.$inferSelect;
