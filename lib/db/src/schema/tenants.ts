/**
 * schema/tenants.ts
 *
 * Multi-tenant data model for Phase 3: users, organizations, and memberships.
 *
 * Design notes:
 * - UUIDs are used for user/org IDs to support future cross-service portability.
 * - Auth enforcement is NOT wired up yet — the schema is designed correctly so
 *   it can be secured once an auth layer (e.g. Clerk, Auth0) is introduced.
 * - All user-owned resources (watchlists, alert_rules, portfolios, notification
 *   channels) carry an `organizationId` foreign key so queries can be scoped.
 */
import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type NewUser = typeof usersTable.$inferInsert;

// ---------------------------------------------------------------------------
// organizations
// ---------------------------------------------------------------------------

export const organizationsTable = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Organization = typeof organizationsTable.$inferSelect;
export type NewOrganization = typeof organizationsTable.$inferInsert;

// ---------------------------------------------------------------------------
// organization_memberships
// ---------------------------------------------------------------------------

export type OrgRole = "admin" | "member";

export const organizationMembershipsTable = pgTable(
  "organization_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    role: text("role").$type<OrgRole>().notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_org_membership").on(t.userId, t.organizationId),
    index("org_memberships_org_idx").on(t.organizationId),
    index("org_memberships_user_idx").on(t.userId),
  ]
);

export type OrganizationMembership = typeof organizationMembershipsTable.$inferSelect;
export type NewOrganizationMembership = typeof organizationMembershipsTable.$inferInsert;
