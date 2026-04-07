# Phase 4 — Alert Detail + Issuer Intelligence

## Overview

This document covers the analyst-facing improvements introduced in the Alert Detail + Issuer Intelligence phase:

- Improved `AlertDetailPanel` with explainability, confidence breakdown, portfolio impact, and navigation
- `confidence`, `severity`, and `portfolioLinked` fields added to the `AlertEvent` type
- Mark-unread support for alert events
- Issuer detail links wired from alert panels and portfolio exposure groups
- New frontend tests

---

## 1. Alert Detail Architecture

### Component: `AlertDetailPanel`

Located at `artifacts/credit-dashboard/src/components/alerts/AlertDetailPanel.tsx`.

**Props:**
```ts
interface AlertDetailPanelProps {
  alert: AlertEvent | null;
  open: boolean;
  onClose: () => void;
  onMarkRead: (id: number) => void;
  onMarkUnread?: (id: number) => void;  // new optional
  markReadPending: boolean;
}
```

**Sections rendered:**

| Section | Description |
|---------|-------------|
| Header | Severity badge, UNREAD badge, portfolio badge, title, issuer link |
| Metadata grid | Event type, severity, urgency, confidence, triggered, status |
| Why this triggered | Human-readable explanation of why the alert fired |
| Confidence breakdown | Visual bar + tier label (High/Medium/Low) |
| Portfolio exposure | Amber callout if issuer is held in any portfolio |
| Navigate to | Links to issuer intelligence page and source article |
| Details (collapsed) | Alert ID, rule ID, article ID, watchlist ID |
| Footer | Mark as read / Mark unread / Close |

**Explainability logic** (`buildTriggerReason`):

The function constructs a plain-English explanation from:
1. Event type — what type of credit event was detected
2. Urgency score — severity tier (critically high / elevated / normal)
3. Confidence — accuracy tier (high / moderate / low) with analyst guidance

No raw `processingMetadata` JSON is ever exposed in the normal view.

---

## 2. AlertEvent Type Extensions

The following fields were added to the `AlertEvent` type in `lib/api-zod/src/generated/types/alertEvent.ts` and the corresponding OpenAPI spec (`lib/api-spec/openapi.yaml`):

| Field | Type | Description |
|-------|------|-------------|
| `confidence` | `number \| null` | Classification confidence 0.0–1.0 |
| `severity` | `"high" \| "medium" \| "low" \| null` | Derived from urgency + confidence |
| `portfolioLinked` | `boolean` | True if issuer is held in any org portfolio |

The backend already populated these fields; they were simply missing from the spec and types. The `ListAlertEventsResponse` Zod schema was also updated to parse and pass them through.

---

## 3. Issuer Page Architecture

The issuer detail page at `artifacts/credit-dashboard/src/pages/issuer-detail.tsx` was already comprehensive. It provides:

- **Header** — Issuer name, risk level badge, trend icon, signal counts, sparkline
- **Analyst Snapshot** — Summary paragraph, key credit drivers, key risks, trust level
- **Top Credit Signals** — Top 3 articles with structured credit summaries (situation, drivers, risk factors, bottom line)
- **Trade Implications** — Articles with actionable trade ideas (direction, rationale, potential trades)
- **Article Timeline** — Reverse-chronological list of all issuer articles with urgency scores, sentiment, and event types

**Data fetching**: Custom `useIssuerDetail(name)` hook via `GET /api/issuers/:name`.

---

## 4. Alert → Issuer / Portfolio Linking

### From AlertDetailPanel
- The issuer name in the header is now a clickable link to `/issuer/:name`
- A separate "Navigate to" section provides links to both the issuer page and the source article
- The portfolio exposure callout appears when `portfolioLinked === true` and links to `/portfolios`

### From ExposureAlertGroup (portfolio exposure tab)
- The issuer name in each exposure group header is now a clickable link to `/issuer/:name`
- Links use `e.stopPropagation()` so clicking the name doesn't toggle the group expand state

---

## 5. How Explainability is Presented

The principle is **analyst-first, not data-dump**:

1. "Why this triggered" — one or two plain sentences derived from structured signal fields (event type, urgency, confidence). Never shows raw JSON.
2. "Confidence breakdown" — visual progress bar + plain-language tier label ("well-supported", "corroborate with source", "preliminary only").
3. "Portfolio exposure" — contextual callout only shown when relevant, with P&L framing.
4. Debug details (alert ID, rule ID, etc.) hidden behind a collapsible "DETAILS" toggle — visible to developers but not primary in the UX.

The issuer page extends this by surfacing AI-generated credit summaries ("Bottom Line: ...") and structured trade implications — an analyst can form a view within 10 seconds.

---

## 6. Mark Unread Support

- `useMarkAlertUnread` hook is now wired up in `alerts.tsx`
- `AlertDetailPanel` accepts an optional `onMarkUnread` prop
- When viewing a read alert with `onMarkUnread` provided, a "Mark unread" button appears
- The local alert state is updated optimistically so the panel reflects the new status immediately

---

## 7. What Remains for a Polished Analyst Workflow

| Item | Status | Notes |
|------|--------|-------|
| Alert feedback (useful/noise/investigate) | Backend complete | No UI surface yet |
| Portfolio name lookup from alert | Partial | Shows badge + link to /portfolios, not specific portfolio names |
| Rule match details | Not surfaced | AlertRule fields available but not shown in panel |
| Issuer page: alert events timeline | Not added | Could add `GET /alerts?issuerName=X` to issuer page |
| Issuer page: portfolio holdings context | Not added | Could add portfolio exposure section to issuer page |
| Alert snooze / escalation actions | Not implemented | Useful for workflow triage |
| Keyboard navigation in alert feed | Partial | Row clicks work; no arrow-key nav |

---

## 8. Testing

New test file: `artifacts/credit-dashboard/src/components/alerts/AlertDetailPanel.test.tsx`

Covers:
- Null alert renders nothing
- Alert title, severity, confidence display
- Severity derived from urgency when `severity` field absent
- Explainability section with event type and urgency
- Confidence breakdown: presence/absence and tier labels
- Portfolio impact badge and section
- Navigation links (issuer page, article)
- `onClose` called on issuer link click
- Mark-as-read and mark-unread button states
- Debug section toggle (hidden by default, expand/collapse)

Updated `Portfolio.test.tsx` to verify the new issuer link in `ExposureAlertGroup`.
