# Phase 3: SaaS Layer — Architecture Summary

## Overview

Phase 3 adds multi-tenancy, an alerting system, portfolio ingestion, and notification dispatch on top of the Phase 2.5 pipeline. All new functionality is backward-compatible — existing ingestion and pipeline behaviour is preserved.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Server                               │
│                                                                 │
│  Routes                                                         │
│  ├── /watchlists       (existing, now tenant-scoped)            │
│  ├── /alerts           (existing, extended with confidence)     │
│  ├── /portfolios       (NEW: CRUD + CSV ingestion + exposure)   │
│  └── /notifications    (NEW: channels + dispatch + deliveries)  │
│                                                                 │
│  Services                                                       │
│  ├── alertEvaluationService.ts  (NEW: evaluateAlertsForArticle) │
│  ├── notificationService.ts     (NEW: dispatchNotifications)    │
│  ├── portfolioService.ts        (NEW: ingestPortfolioCSV)       │
│  └── pipeline/pipelineRunner.ts (extended: fires alert eval)    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      Database Schema                            │
│                                                                 │
│  Tenant layer (NEW)                                             │
│  ├── users                                                      │
│  ├── organizations                                              │
│  └── organization_memberships (role: admin | member)           │
│                                                                 │
│  Alert layer (extended)                                         │
│  ├── watchlists          + organizationId                       │
│  ├── alert_rules         + organizationId, conditions,          │
│  │                         severityThreshold, confidenceThreshold│
│  │                         portfolioId                          │
│  └── alert_events        + confidence, severity                 │
│                                                                 │
│  Portfolio layer (NEW)                                          │
│  ├── portfolios          (organizationId-scoped)                │
│  ├── portfolio_holdings  (raw issuer name + position size)      │
│  └── portfolio_issuer_map (canonical name + confidence)         │
│                                                                 │
│  Notification layer (NEW)                                       │
│  ├── notification_channels   (email, slack per org)             │
│  └── notification_deliveries (per-attempt audit trail)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Alert Flow

```
processArticlePipeline(articleId)
    │  (success path only)
    ▼
evaluateAlertsForArticle(articleId)
    │
    ├─ 1. Fetch article (issuerName, urgency, confidence, eventType, sector)
    ├─ 2. Find watchlist items matching the issuer
    ├─ 3. Load active alert_rules for those watchlists
    ├─ 4. Cooldown check: skip rules that fired within 60 min for same issuer+eventType
    ├─ 5. Per-rule filters:
    │      • minimumUrgency / severityThreshold
    │      • confidenceThreshold
    │      • eventTypes allowlist
    │      • covenantFlagOnly
    │      • JSON conditions.sectors
    │      • portfolioId → issuer must be in the portfolio
    ├─ 6. Insert alert_events (ON CONFLICT DO NOTHING for idempotency)
    └─ 7. [Future] dispatchNotifications(alertEventId) per inserted event
```

Failures in `evaluateAlertsForArticle` are caught and logged — the pipeline is never affected.

---

## Portfolio Flow

```
POST /portfolios/:id/holdings/csv   { csv: "issuer_name,position_size\n..." }
    │
    ▼
ingestPortfolioCSV(portfolioId, csvContent)
    │
    ├─ 1. Validate portfolio exists
    ├─ 2. Parse CSV (header validation, CRLF support, blank-row skipping)
    ├─ 3. For each row:
    │      a. Insert portfolio_holding (raw issuer name, position size, metadata)
    │      b. canonicalizeIssuer(rawName) → canonical name
    │      c. Insert portfolio_issuer_map (canonical name, confidence 0.5–1.0)
    └─ 4. Return ingestion summary (rowsProcessed, holdingsCreated, mapped/unmapped)

GET /portfolios/:id/exposure-alerts
    │
    ▼
getPortfolioExposureAlerts(portfolioId)
    │
    ├─ 1. Fetch all canonical issuer names in the portfolio
    ├─ 2. Fetch all alert_events for those issuers
    ├─ 3. Group by issuerName with severity counts
    └─ 4. Sort: most high-severity first, then most recent
```

---

## Notification Flow

```
dispatchNotifications(alertEventId)
    │
    ├─ 1. Fetch alert event + rule (JOIN for organizationId)
    ├─ 2. Fetch all notification_channels for the org
    ├─ 3. For each channel:
    │      a. Insert notification_delivery (status: queued)
    │      b. Call channel adapter (email/slack stub → real provider in prod)
    │      c. Update delivery to "sent" or "failed"
    │      d. Unknown channel type → status: "skipped"
    └─ 4. Return dispatch summary (attempted, sent, failed, skipped)
```

Adapters are thin interfaces — adding a new provider (PagerDuty, Teams) requires only a new case in `ADAPTERS`.

---

## Tenant Isolation

All user-owned resources carry `organizationId` (UUID FK → organizations). The current implementation:

- Schema is correctly structured for tenant isolation
- Routes accept `organizationId` as a query/body parameter and scope all queries
- Auth enforcement is **not yet wired** — this is intentional per Phase 3 constraints

To enforce auth in Phase 4:
1. Add a JWT/session middleware that extracts `organizationId` from the token
2. Replace manual `organizationId` parameters with `req.user.organizationId`
3. No schema migration required

---

## Next Steps for Production (Phase 4)

### Auth + Billing
- Integrate an auth provider (e.g. Clerk or Auth0) to issue JWT tokens
- Add `requireAuth` middleware that validates tokens and injects `req.user`
- Add `billing_subscriptions` table with plan-level feature flags
- Rate-limit pipeline and alert evaluation per tenant

### Alert Notifications
- Replace stub adapters in `notificationService.ts` with real implementations:
  - Email: nodemailer / SendGrid
  - Slack: `fetch` POST to webhook URL
- Add retry logic for failed deliveries (exponential backoff)
- Add opt-out / unsubscribe support

### Portfolio
- Add AI-assisted issuer resolution for unresolved names (`issuersUnmapped`)
- Support bulk portfolio updates (full CSV replacement with diff logging)
- Add portfolio-level credit score aggregation

### Infrastructure
- Move alert evaluation to a background job (event-driven via queue)
- Add webhook endpoints for real-time push to client apps
