# Portfolio Dashboard

## Overview

Phase 4 of the Credit Intelligence SaaS platform adds the Portfolio Dashboard — a two-level UI (list + detail) for managing issuer exposure across bond/credit portfolios.

---

## Pages

### `/portfolios` — Portfolio List

Displays all portfolios for the current organization. For each portfolio:

| Field | Source |
|-------|--------|
| Name | `Portfolio.name` |
| Description | `Portfolio.description` |
| Updated date | `Portfolio.updatedAt` |

Click any card to navigate to `/portfolios/:id`.

**States:** loading (Skeleton), empty (instructional message), error (Retry button).

### `/portfolios/:id` — Portfolio Detail

Single-portfolio deep-dive with three sections.

#### A. Summary Banner (`PortfolioSummaryCard` in detail mode)

Shows full metrics from `PortfolioDetail`:

| Metric | Description |
|--------|-------------|
| Holdings | Total positions in the portfolio |
| Mapped | Issuers successfully resolved to canonical names |
| Unresolved | Issuers lacking a canonical mapping (highlighted in amber) |
| High Alerts | Count of `highSeverityAlertCount` (highlighted in red when > 0) |

A `HIGH RISK` badge appears in the page header when `highSeverityAlertCount > 0` — visible within 5 seconds of page load.

#### B. Holdings Tab (`HoldingsTable`)

Table of every `PortfolioHolding` with:

| Column | Detail |
|--------|--------|
| Raw Issuer | Original name as uploaded in the CSV |
| Canonical Mapping | Resolved name from the issuer mapping system |
| Confidence | High / Medium / Low (with % score) — color-coded green/amber/red |
| Position Size | Notional if provided |

Unmapped holdings render an **amber "Unresolved" indicator** with a warning icon. Their rows are tinted amber to surface mapping gaps immediately.

A banner warning is shown above the table whenever `unmappedIssuerCount > 0`, explaining that alerts may be missed for unresolved issuers.

#### C. Exposure Alerts Tab (`ExposureAlertList` / `ExposureAlertGroup`)

Grouped by issuer, sorted by severity (high-severity groups first). Each group:

- Shows issuer name + severity count badges (red HIGH, amber MED, green LOW)
- Shows total alert count + latest trigger time
- Is **auto-expanded** when `highSeverityCount > 0`
- Can be toggled open/closed

Within an expanded group, each `PortfolioExposureAlertEventsItem` shows:
- Severity badge + severity dot
- Event type badge
- Confidence score (%)
- Trigger timestamp
- Link to source article

---

## Components

### `src/components/portfolios/PortfolioSummaryCard.tsx`

Accepts either the basic `Portfolio` type (list view — no metrics row) or a `PortfolioSummaryData` object with detail fields (metrics row visible). Exported type `PortfolioSummaryData` allows partial use.

### `src/components/portfolios/HoldingsTable.tsx`

Pure display table. Accepts `PortfolioHolding[]`. Handles loading, empty, and populated states. Unresolved mappings (`canonicalIssuerName == null`) are highlighted and carry a `data-testid="unresolved-mapping-{id}"` attribute.

### `src/components/portfolios/ExposureAlertGroup.tsx`

Exports two components:

- **`ExposureAlertGroup`** — single collapsible issuer group
- **`ExposureAlertList`** — full list wrapper that sorts groups and renders each `ExposureAlertGroup`

---

## Data Flow

```
useListPortfolios({ organizationId })          → PortfolioList
    │
    └─ /portfolios list page

useGetPortfolioDetails(id, { organizationId }) → PortfolioDetail (includes holdings[])
useGetPortfolioExposureAlerts(id)              → PortfolioExposureAlertList (grouped by issuer)
    │
    └─ /portfolios/:id detail page
```

The `X-Organization-Id` header is injected globally by the org context bridge configured in `App.tsx` via `setOrgIdGetter(getOrgId)`.

---

## Auth / Org Context

A minimal bridge was added:

- **`lib/api-client-react/src/custom-fetch.ts`** — new `setOrgIdGetter` function that injects `X-Organization-Id` into every request header
- **`lib/api-client-react/src/index.ts`** — exports `setOrgIdGetter` and `OrgIdGetter` type
- **`src/lib/org-context.ts`** — `getOrgId()` and `useOrgId()` utility; reads `VITE_ORG_ID` env var or falls back to `"demo-org"`
- **`src/App.tsx`** — calls `setOrgIdGetter(getOrgId)` at module load so all API hooks automatically include the org header

To use a real org in production, replace `getOrgId()` with your auth provider's org ID getter (Clerk, Auth0, Supabase, etc.).

---

## Navigation

A **Portfolios** entry (Briefcase icon) was added to the sidebar navigation between Watchlists and Alerts.

---

## Tests

24 tests in `src/components/portfolios/Portfolio.test.tsx`:

| Suite | Tests |
|-------|-------|
| `PortfolioSummaryCard` | Renders name/description, metrics row, HIGH badge, onClick, unresolved count |
| `HoldingsTable` | Rows, empty state, loading skeleton, canonical mapping, unresolved indicator, confidence labels |
| `ExposureAlertGroup` | Header renders, severity badges, total count, expand/collapse, event items |
| `ExposureAlertList` | All groups rendered, empty state, high-severity sort order |

Total test count across dashboard: **50 tests** (26 alert feed + 24 portfolio).

---

## What Remains for Future Iterations

| Feature | Notes |
|---------|-------|
| Portfolio creation UI | Currently only via API/CSV; add a create-portfolio form on `/portfolios` |
| Holdings CSV upload | A "Upload CSV" button on the detail page wired to `useIngestPortfolioCSV` |
| Issuer mapping resolution | A workflow to manually resolve unresolved issuers |
| Real org context | Replace `getOrgId()` with Clerk/Auth0/session token org ID |
| Portfolio deletion | Delete button on list/detail with confirm dialog |
| Alert read/unread on exposure events | Currently shows `isRead` state; add mark-read action |
| Pagination | For portfolios with > 100 holdings |
| Portfolio comparison | Side-by-side risk comparison across portfolios |
