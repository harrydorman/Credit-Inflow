# Alert Prioritization + Analyst Workflow

## Overview

This document describes the alert prioritization system and analyst workflow tools built into the Credit Inflow dashboard. These features help analysts quickly identify what matters most and take lightweight workflow actions directly in the alert feed.

---

## Priority Model

### How Priority Scores Are Calculated

Each alert is assigned a **priority score** (0–100) computed from four components:

| Component | Max Points | Formula |
|-----------|-----------|---------|
| Severity | 40 | `high=40`, `medium=25`, `low=10`, `null=0` |
| Confidence | 30 | `confidence × 30` |
| Portfolio exposure | 20 | `portfolioLinked ? 20 : 0` |
| Urgency | 10 | `(urgency / 10) × 10` |

**Maximum score: 100** (high severity + 100% confidence + portfolio linked + urgency 10/10)

The severity component uses either the explicit `severity` field, or derives it from the `urgency` score:
- `urgency ≥ 8` → high
- `urgency 5–7` → medium
- `urgency < 5` → low

### Priority Labels

Scores are mapped to labels used throughout the UI:

| Score | Label |
|-------|-------|
| ≥ 75 | **Critical** |
| 50–74 | **High** |
| 25–49 | **Medium** |
| < 25 | **Low** |

### Priority Explanation

Each alert generates a human-readable explanation of its priority, for example:

> "Critical priority because: high severity + portfolio exposure + high confidence."

This text appears in the **Alert Detail Panel** under the "Priority" section.

### Implementation

All priority logic lives in `src/lib/alertPriority.ts` as pure functions with no side effects:

```typescript
computePriorityScore(alert: AlertEvent): number
getPriorityLabel(score: number): PriorityLabel
getPriorityExplanation(alert: AlertEvent): string
getAlertPriority(alert: AlertEvent): AlertPriority
sortAlertsByPriority(alerts: AlertEvent[]): AlertEvent[]
```

---

## Alert Feed Behaviour

### Default Sort Order

Alerts are sorted by **priority score (descending)** before display. Highest-priority alerts always appear at the top of the feed, regardless of timestamp.

### Critical Alert Highlighting

Unread alerts with a **Critical** priority score receive a distinct red left-border styling (`border-l-red-600`) in the feed row, making them visually prominent.

### Priority Badge

Every alert row shows a compact priority badge (Critical / High / Medium / Low) alongside the severity badge.

---

## Filters

New client-side filters have been added to the alert feed:

| Filter | Description |
|--------|-------------|
| **Priority** | Filter by computed priority label (Critical / High / Medium / Low) |
| **Unread + High** | Show only unread alerts with Critical or High priority |

These filters are applied **client-side** after fetching, since priority is computed on the frontend.

Existing server-side filters (severity, read state, issuer name, event type, portfolio linked, date range) continue to work as before.

---

## Workflow Design

### Analyst Actions

Analysts can tag each alert with one of three workflow states:

| Action | Meaning |
|--------|---------|
| **Investigate** | This alert warrants active investigation |
| **Monitor** | Keep watching but no immediate action needed |
| **Ignore** | Acknowledged and dismissed as not relevant |

Actions are persisted in **frontend state** (in-memory, per session). This is intentional for the current phase — backend persistence can be added later when a workflow API is available.

### Action State Display

- **Alert feed row**: Shows an action badge (e.g., "Investigating", "Monitoring", "Ignored") below the alert metadata
- **Alert detail panel**: Shows the action badge in the header; action buttons appear in the body with toggle behavior (clicking an active action deselects it)

### Action Toggle Behavior

Clicking an action button that is already active **clears** the action (sets it to null). This allows analysts to undo accidental tagging.

---

## How Alerts Become Decisions

The system is designed as a **decision funnel**:

```
Raw alert feed (sorted by priority)
    ↓
Filter by priority / portfolio / read state
    ↓
Open alert detail → read priority explanation
    ↓
Review explainability (why triggered) + confidence
    ↓
Take action: Investigate / Monitor / Ignore
    ↓
Navigate to Issuer Intelligence or Source Article
```

### Priority as the Decision Gate

Before this system, all alerts were treated equally. Now:
1. **Critical** alerts demand immediate attention (high severity + portfolio exposure)
2. **High** alerts are important but may not require same-day action
3. **Medium/Low** alerts can be batch-reviewed or filtered out

### Portfolio Exposure as a Force Multiplier

Portfolio-linked alerts receive a +20 point bonus. This ensures that even a medium-severity event gets elevated priority if the issuer is held in your portfolios — because P&L impact is direct.

---

## Issuer Alert Timeline

The **Issuer Detail** page now includes a "Recent Alerts" section showing the most recent alerts for that issuer. This provides context when reviewing issuer intelligence:

- Priority badge + severity badge per alert
- Portfolio exposure indicator
- Unread status indicator
- Link to the full alert feed

---

## Testing

Tests are located at:

- `src/lib/alertPriority.test.ts` — Unit tests for priority calculation, label derivation, explanation generation, and sort order
- `src/components/alerts/AlertFeed.test.tsx` — Tests for priority badge, action badge, new filter controls, and filter behavior
- `src/components/alerts/AlertDetailPanel.test.tsx` — Tests for priority section rendering, analyst action buttons, action state badge, and toggle behavior

Run with:

```bash
cd artifacts/credit-dashboard && npx pnpm test
```

---

## Constraints and Design Decisions

- **No breaking changes**: All existing alert and portfolio flows are unchanged
- **Priority logic is modular**: `alertPriority.ts` has zero UI dependencies — it can be unit-tested and reused anywhere
- **Client-side filtering for priority**: Since priority is computed on the frontend, priority and `unreadHighPriority` filters are applied after the API response
- **Action state is ephemeral**: Stored in React state only — refreshing the page clears it. Backend persistence is a future enhancement
- **Sort is always by priority**: The feed always shows highest-priority alerts first, regardless of other active filters
