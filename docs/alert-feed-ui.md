# Alert Feed UI

## Overview

The `/alerts` page has been redesigned as a full institutional-grade Alert Feed, delivering compact, scannable, severity-first alert viewing with filter and bulk-action support.

---

## Components

### `src/components/alerts/AlertFeedFilters.tsx`

Filter bar rendered at the top of the feed. Supports:

| Filter | Control | API param |
|--------|---------|-----------|
| Read / Unread | Select dropdown | `isRead` |
| Severity | Select dropdown | `severity` |
| Portfolio-only | Toggle button | `portfolioLinked` |
| Issuer name | Text input | `issuerName` |
| Event type | Text input | `eventType` |
| Date from | Date picker | `dateFrom` |
| Date to | Date picker | `dateTo` |

A **Clear** button appears automatically when any filter is active. The unread + total count is shown at the right edge.

### `src/components/alerts/AlertFeedRow.tsx`

Individual alert row for the table-like feed. Displays:

- **Checkbox** for bulk selection (only unread alerts are selectable for bulk mark-read)
- **Severity badge** — derived from numeric urgency: `HIGH` (≥ 8), `MED` (5–7), `LOW` (≤ 4). Color-coded: red / amber / green
- **Title** — truncated to two lines; unread alerts use full foreground colour
- **Issuer name** in monospace
- **Event type** badge
- **Urgency score** (N/10)
- **Portfolio exposure** icon (briefcase) when the API includes `portfolioLinked: true`
- **Timestamp** at right edge
- **Mark as read** button (hover-revealed) for unread rows
- Unread rows have a left blue border stripe for instant visual identification

### `src/components/alerts/AlertDetailPanel.tsx`

Right-side `Sheet` panel (Radix UI) that opens when a row is clicked. Shows:

- Severity badge + unread/portfolio badges
- Full title and issuer
- Metadata grid: issuer, event type, urgency, trigger time, read status, alert ID
- Link to the source article (`/article/:id`)
- **Mark as read** button in the footer

### `src/pages/alerts.tsx`

The `/alerts` page. Replaced the previous multi-section alerts management page with:

1. **Header** — "Alert Feed" heading + live unread badge
2. **AlertFeed** component — contains the full filter + bulk-action + list UI

Hooks used:
- `useListAlertEvents` — fetch filtered alert list
- `useMarkAlertRead` — single-alert mark-read mutation
- `useBulkMarkAlertsRead` — bulk mark-read mutation

---

## Auth / Org Context

The `ListAlertEventsParams.organizationId` field is optional in the API. For development, the page works without an explicit org context. A `setBaseUrl` / `setAuthTokenGetter` bridge from `@workspace/api-client-react` is available for production auth wiring.

---

## Tests (`src/components/alerts/AlertFeed.test.tsx`)

26 tests across:

| Suite | Tests |
|-------|-------|
| `urgencyToSeverity` | Maps urgency numbers to severity strings |
| `SeverityBadge` | Renders correct badge label |
| `AlertFeedFilters` | Filter controls render, issuer/event-type typing, portfolio toggle, clear button |
| `AlertFeedRow` | Renders data, severity, click, mark-read, checkbox, read/unread styling |

Run: `pnpm --filter @workspace/credit-dashboard test`

---

## Design Decisions

- **Desktop-first**: The filter bar and table layout are optimised for wide viewports
- **Severity first**: Bold colour-coded severity badge is the leftmost visible column
- **Unread is obvious**: Blue left-border stripe + light blue background row tint + UNREAD badge in detail panel
- **Compact**: Rows are 3-line max (title + issuer/meta + timestamp). No cards or large thumbnails
- **No state management library**: All state is local `useState` + `useCallback` inside the `AlertFeed` component; queries are handled by TanStack Query
