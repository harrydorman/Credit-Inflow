# Phase 8 — Workflow Analytics + Ranking Feedback Infrastructure

## Overview

Phase 8 turns the workflow state and feedback data that was persisted in Phase 7 into a product-analytics and intelligence layer. It introduces modular analytics services, a new API endpoint, a lightweight internal analytics dashboard, and derived "ranking-prep" outputs that can later be consumed by the priority-scoring model.

No changes were made to the existing alert/feed/detail flows.

---

## Analytics Model

### Data sources

| Table | Role |
|---|---|
| `alert_workflow_state` | Analyst-assigned actions per alert (`investigate`, `monitor`, `ignore`) |
| `alert_feedback` | Analyst ratings per alert (`useful`, `noise`, `investigate_later`) |
| `alert_events` | Event metadata (issuer name, event type, severity) |
| `alert_rules` | Rule metadata (name, org scope) |
| `portfolios` / `portfolio_holdings` / `portfolio_issuer_map` | Portfolio membership for issuer tagging |

All analytics queries are **org-scoped** — they join through `alertRulesTable.organizationId` and `alertFeedbackTable.organizationId` to guarantee that one org never sees another org's data.

### Key entities

- **Workflow action** — an analyst's disposition for a specific alert (investigate / monitor / ignore), stored per `(alertEventId, organizationId)`.
- **Feedback rating** — an analyst's quality judgment for a specific alert (useful / noise / investigate_later), stored per `(alertEventId, organizationId, userId)`.
- **Event type** — the category of the credit event (e.g., `downgrade`, `earnings_miss`).
- **Issuer** — the company name extracted from the article.
- **Rule** — the alert rule that triggered the event.

---

## How Workflow / Feedback Data Is Aggregated

### Count queries

- **`getWorkflowActionCounts(orgId)`** — `GROUP BY action` on `alert_workflow_state` joined to `alert_events → alert_rules` for org scoping.
- **`getFeedbackRatingCounts(orgId)`** — `GROUP BY rating` on `alert_feedback` filtered by `organizationId`.

### Distribution queries

- **`getActionDistributionByEventType(orgId)`** — `GROUP BY eventType, action` then pivoted in memory to a per-event-type object with `{ investigate, monitor, ignore, total }`.
- **`getFeedbackDistributionByEventType(orgId)`** — `GROUP BY eventType, rating` then pivoted to `{ useful, noise, investigate_later, total }`.

### Ratio queries

- **`getInvestigateIgnoreRatioByIssuer(orgId)`** — `GROUP BY issuerName, action`, aggregated to per-issuer `investigateRatio` and `ignoreRatio`.
- **`getUsefulNoiseRatioByRule(orgId)`** — `GROUP BY ruleId, rating`, aggregated to per-rule `noiseRatio` and `usefulRatio`.

### Portfolio comparison

- **`getPortfolioLinkedWorkflowCounts(orgId)`** — Fetches the canonical issuer set for the org's portfolios, then partitions all workflow states into `portfolioLinked` and `nonPortfolioLinked` buckets, enabling comparison of analyst behaviour for in-portfolio vs. out-of-portfolio issuers.

### Aggregator

- **`getAlertAnalytics(orgId)`** — Runs all of the above in parallel via `Promise.all` and returns a single `AlertAnalyticsResponse` object.

---

## Ranking Prep Outputs

These are **derived analytics outputs** only. They are not yet wired into the live `computePriorityScore` function in `alertPriority.ts`.

| Output | Formula | Purpose |
|---|---|---|
| `eventTypeUsefulnessScore` | `usefulCount / totalFeedback` | Which event types generate the most actionable alerts? |
| `issuerInvestigateScore` | `investigateCount / totalWorkflow` | Which issuers most often warrant investigation? |
| `ruleNoiseScore` | `noiseCount / totalFeedback` | Which rules generate the most low-signal alerts? |

These scores are exposed via the `/api/analytics/alerts` endpoint under the `rankingPrep` key. When the team is ready to incorporate real outcomes into ranking, these pre-computed signals can be fed directly into the priority model without requiring a new query layer.

---

## API Endpoint

### `GET /api/analytics/alerts`

- **Auth**: requires `X-Organization-Id` header (same as all other org-scoped endpoints)
- **Response**: `AlertAnalyticsResponse` (see Zod schema `GetAlertAnalyticsResponse` in `lib/api-zod/src/generated/api.ts`)

```json
{
  "workflowActionCounts": [
    { "action": "investigate", "count": 42 },
    { "action": "ignore", "count": 17 }
  ],
  "feedbackRatingCounts": [...],
  "actionByEventType": [...],
  "feedbackByEventType": [...],
  "investigateIgnoreRatioByIssuer": [...],
  "usefulNoiseRatioByRule": [...],
  "portfolioLinkedWorkflowCounts": {
    "portfolioLinked": { "investigate": 10, "monitor": 3, "ignore": 2, "total": 15 },
    "nonPortfolioLinked": { ... }
  },
  "rankingPrep": {
    "eventTypeUsefulnessScores": [...],
    "issuerInvestigateScores": [...],
    "ruleNoiseScores": [...]
  }
}
```

---

## Frontend: Analytics Dashboard (`/analytics`)

A lightweight internal analytics page was added to the dashboard. It is accessible via the sidebar nav item "Analytics" and renders at route `/analytics`.

The page shows:
- Workflow action summary (investigate / monitor / ignore counts)
- Feedback rating summary (useful / noise / investigate_later counts)
- Portfolio-linked vs. non-portfolio comparison table
- Top 10 noisy event types
- Top 10 useful event types
- Top 10 most-investigated issuers
- Top 10 rules by noise ratio
- Ranking-prep tables (event type usefulness, issuer investigate, rule noise scores)

---

## Test Coverage

Tests are in `artifacts/api-server/src/__tests__/phase8.test.ts` (26 tests).

| Area | Tests |
|---|---|
| `getWorkflowActionCounts` | empty result, count coercion, real data |
| `getFeedbackRatingCounts` | empty result, multi-rating counts |
| `getActionDistributionByEventType` | pivot, sort, null eventType handling |
| `getFeedbackDistributionByEventType` | pivot, multi-event data |
| `getInvestigateIgnoreRatioByIssuer` | ratio computation, sort |
| `getUsefulNoiseRatioByRule` | noise/useful ratio computation, sort |
| `getPortfolioLinkedWorkflowCounts` | linked vs. non-linked split |
| `getEventTypeUsefulnessScores` | score computation, sort |
| `getIssuerInvestigateScores` | score computation |
| `getRuleNoiseScores` | score computation |
| `getAlertAnalytics` | response shape |
| `GET /analytics/alerts` | 401 without org, 200 with org, org isolation |
| Useful/noise ratios | edge cases (no noise, investigate_later excluded) |

---

## Future Work

- Feed `eventTypeUsefulnessScores`, `issuerInvestigateScores`, and `ruleNoiseScores` into `computePriorityScore` in `artifacts/credit-dashboard/src/lib/alertPriority.ts`.
- Add date-range filtering to analytics queries (e.g., last 30 days).
- Add per-user analytics breakdowns.
- Expose analytics via a dedicated admin role rather than any org member.
