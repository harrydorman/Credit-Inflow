# Phase 7 — Persistent Analyst Workflow + Feedback Loop

## Overview

Phase 7 introduces persistent analyst workflow state and a feedback loop for credit alert signals. Analyst actions and signal usefulness ratings are now stored in the database, surfaced in the alert feed, and available for future ranking improvements.

---

## Workflow State Model

### Table: `alert_workflow_state`

Stores the analyst's decision for a given alert, scoped per organization.

| Column           | Type      | Description                                       |
|-----------------|-----------|---------------------------------------------------|
| `id`            | serial    | Primary key                                       |
| `alertEventId`  | integer   | FK → `alert_events.id` (cascade delete)           |
| `organizationId`| uuid      | FK → `organizations.id` (cascade delete)          |
| `userId`        | uuid      | FK → `users.id` (nullable, for future multi-user) |
| `action`        | text      | One of: `investigate`, `monitor`, `ignore`        |
| `createdAt`     | timestamp | When first set                                    |
| `updatedAt`     | timestamp | When last updated                                 |

**Unique constraint:** `(alertEventId, organizationId)` — one action per alert per org.

**Supported actions:**

- `investigate` — analyst is actively looking into this alert
- `monitor` — alert is noted but not yet actioned
- `ignore` — alert is dismissed as irrelevant

---

## Feedback Model

### Table: `alert_feedback`

Stores analyst signal usefulness feedback per alert, scoped per organization.

| Column           | Type      | Description                                        |
|-----------------|-----------|----------------------------------------------------|
| `id`            | serial    | Primary key                                        |
| `alertEventId`  | integer   | FK → `alert_events.id`                             |
| `organizationId`| uuid      | FK → `organizations.id`                            |
| `userId`        | uuid      | FK → `users.id` (nullable)                         |
| `rating`        | text      | One of: `useful`, `noise`, `investigate_later`     |
| `note`          | text      | Optional free-text annotation                      |
| `createdAt`     | timestamp | When first submitted                               |
| `updatedAt`     | timestamp | When last updated                                  |

**Ratings:**

- `useful` — signal was relevant and actionable
- `noise` — signal was irrelevant or low quality
- `investigate_later` — signal is noted for future review

---

## API Endpoints

### `PUT /api/alerts/:id/workflow`

Upsert analyst workflow action for an alert.

**Body:**
```json
{ "action": "investigate" | "monitor" | "ignore", "userId": "<optional uuid>" }
```

**Response:** The persisted `AlertWorkflowState` object.

**Auth:** Requires `X-Organization-Id` header. Alert must belong to the org.

---

### `DELETE /api/alerts/:id/workflow`

Clear the analyst workflow action for an alert.

**Auth:** Requires `X-Organization-Id` header. Alert must belong to the org.

**Response:** `204 No Content`

---

### `POST /api/alerts/:id/feedback`

Submit or update signal usefulness feedback (upsert semantics).

**Body:**
```json
{ "rating": "useful" | "noise" | "investigate_later", "organizationId": "<uuid>", "userId": "<optional uuid>", "note": "<optional string>" }
```

**Response:** The persisted feedback object.

---

### `GET /api/alerts` — Extended

The alert list now includes:
- `workflowAction` (`investigate` | `monitor` | `ignore` | `null`) — current analyst action for the org
- `feedbackRating` (`useful` | `noise` | `investigate_later` | `null`) — current feedback for the org

New filter parameter:
- `action=investigate|monitor|ignore|unassigned` — filter by workflow state (`unassigned` = no action set)

---

## Frontend Changes

### Alert Feed Filters

Added **Action** dropdown to filter alerts by workflow state:
- All actions (default)
- Investigate
- Monitor
- Ignore
- Unassigned

### Alert Feed Rows

Alert rows now display the `workflowAction` badge from the API response (persisted server state), with an optimistic local fallback for pending updates.

### Alert Detail Panel

The detail panel now:
1. **Analyst Action section** — buttons (`Investigate` / `Monitor` / `Ignore`) persist to the backend via `PUT /alerts/:id/workflow` and `DELETE /alerts/:id/workflow`. Optimistic updates provide instant feedback.
2. **Signal Feedback section** — buttons (`Useful` / `Noise` / `Later`) call `POST /alerts/:id/feedback` to persist usefulness signals.
3. **Persisted state** — on open, the panel reflects the current `workflowAction` and `feedbackRating` from the server, with active state shown on the relevant buttons.

---

## Ranking Improvement Loop Preparation

The data model is designed to support future ranking improvements:

### Questions the system can now answer:

| Question | How |
|----------|-----|
| Did high-priority alerts get marked useful? | Join `alert_events` (severity/confidence) with `alert_feedback` (rating=useful) |
| Did ignored alerts cluster in certain event types? | Group `alert_workflow_state` (action=ignore) by `alert_events.eventType` |
| Are portfolio-linked alerts more often investigated? | Join workflow state with `portfolio_issuer_map` and `alert_events` |
| Which alert rules produce the most noise? | Join `alert_feedback` (rating=noise) with `alert_events.alertRuleId` |
| What is the investigate/ignore ratio by issuer? | Group workflow state by issuerName from alert_events |

### Suggested next steps for ranking:

1. **Feedback signal integration**: Weight alert priority scores using historical feedback ratios (e.g., boost event types that frequently get `useful` ratings)
2. **Noise suppression**: De-emphasize or flag rules that frequently generate `noise`-rated events
3. **Portfolio correlation**: Increase priority boost for portfolio-linked issuers where `investigate` actions are common
4. **Analyst pattern detection**: Surface patterns across `ignored` alerts to suggest watchlist cleanup

These improvements can be implemented as a `getWorkflowFeedbackSummary(orgId)` service method without changing existing alert evaluation logic.

---

## Multi-Tenant Safety

All workflow state and feedback data is scoped by `organizationId`:
- `PUT/DELETE /alerts/:id/workflow` verifies alert ownership via `alertEventsTable → alertRulesTable.organizationId` before any write
- `GET /alerts` left-joins workflow/feedback tables using both `alertEventId` AND `organizationId`
- Org B cannot read or write workflow state for org A's alerts
