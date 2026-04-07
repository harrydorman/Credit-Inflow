# Phase 12: Ranking Calibration Recommendations + Historical Evaluation Snapshots

## Overview

Phase 12 extends the analytics-informed ranking system with:

1. **Historical evaluation snapshots** — persist ranking evaluation summaries for a given model version and time window
2. **REST API** for creating and listing snapshots (org-scoped)
3. **Calibration recommendation engine** — pure, advisory hints derived from aggregate metrics
4. **Snapshot comparison utilities** — compare two metric sets to determine if a new model version improved or worsened ranking quality
5. **Enhanced /ranking-eval page** — save snapshot button, recommendations panel, recent snapshots panel, and side-by-side comparison against the most recent snapshot

All recommendations are **advisory only** — they are never auto-applied. Any change to ranking parameters must be made manually by bumping `RANKING_CALIBRATION_CONFIG` and `RANKING_MODEL_VERSION`.

---

## 1. Snapshot Model

### Table: `ranking_eval_snapshots`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | Auto-incrementing |
| `organizationId` | uuid | FK → organizations.id, NOT NULL |
| `rankingModelVersion` | text | e.g. `"v1.1.0"` |
| `timeWindow` | text | `"7d"` \| `"30d"` \| `"all"` |
| `snapshotType` | text | `"manual"` \| `"scheduled"` |
| `metricsJson` | json | `RankingSnapshotMetrics` object |
| `createdAt` | timestamp tz | defaultNow() |

Snapshots are **immutable** once created. To update the record, create a new snapshot — do not update an existing one.

### `RankingSnapshotMetrics` shape

```ts
{
  totalAlerts: number;
  adjustedFraction: number;
  averagePositiveAdjustment: number;
  averageNegativeAdjustment: number;
  usefulFeedbackRateAmongBoosted: number;
  noiseRateAmongPenalised: number;
  investigateRateAmongPortfolioLinkedBoosted: number;
  topBoostedEventTypes: { eventType: string; totalBoost: number }[];
  topPenalisedRules:    { ruleName: string; totalPenalty: number }[];
}
```

---

## 2. Snapshot API

### `POST /api/analytics/ranking-eval/snapshots`

Creates a snapshot for the authenticated org.

**Request body:**
```json
{
  "rankingModelVersion": "v1.1.0",
  "timeWindow": "30d",
  "snapshotType": "manual",
  "metrics": { /* RankingSnapshotMetrics */ }
}
```

**Responses:**
- `201` — snapshot created (returns the full snapshot row)
- `400` — missing / invalid fields
- `401` — missing org context

### `GET /api/analytics/ranking-eval/snapshots`

Lists recent snapshots for the authenticated org, newest first.

**Query parameters:**
| Param | Description |
|---|---|
| `timeWindow` | Filter to `7d`, `30d`, or `all` |
| `modelVersion` | Filter to a specific model version string |
| `limit` | Max rows to return (default 20, cap 100) |

**Response:**
```json
{ "snapshots": [ /* RankingEvalSnapshot[] */ ] }
```

---

## 3. Recommendation Logic

Located in: `artifacts/credit-dashboard/src/lib/rankingRecommendations.ts`

The recommendation engine is a **pure function** — it takes metrics objects and returns human-readable advisory hints. It never auto-applies any changes.

### Recommendation triggers

| Condition | Severity | Suggestion |
|---|---|---|
| `adjustedFraction < 5%` | warning | Lower one or more boost/penalty thresholds |
| `adjustedFraction > 60%` | warning | Raise thresholds or lower max caps |
| Boosted event types exist | info | Review feedback on boosted event types |
| Only 1–2 rules are penalised | action | Review those specific rules rather than changing global thresholds |
| `usefulFeedbackRateAmongBoosted < 40%` (trend) | action | Raise `eventTypeBoost.threshold` |
| `noiseRateAmongPenalised < 40%` (trend) | action | Raise `ruleNoisePenalty.threshold` or lower `ruleNoisePenalty.max` |
| `investigateRateAmongPortfolioLinkedBoosted < 30%` (trend) | warning | Review portfolio issuer coverage or raise `issuerBoost.max` |

All recommendations include:
- A human-readable title
- Full detail with the cited metric value
- A specific suggestion for what to adjust
- A `basedOn` array of metric keys

### Usage

```ts
import { getAllRecommendations } from "@/lib/rankingRecommendations";

const recs = getAllRecommendations(aggregateMetrics, trendMetrics);
// Returns CalibrationRecommendation[] sorted by severity (action > warning > info)
```

---

## 4. Snapshot Comparison

Located in: `artifacts/credit-dashboard/src/lib/snapshotComparison.ts`

Compares two `RankingSnapshotMetrics` objects and returns:
- Per-metric deltas with direction (`improved` / `worsened` / `unchanged`)
- A summary of the three primary **signal metrics**:
  - `usefulFeedbackRateAmongBoosted`
  - `noiseRateAmongPenalised`
  - `investigateRateAmongPortfolioLinkedBoosted`
- An `overallAssessment`: `improved` | `worsened` | `mixed` | `unchanged`

```ts
import { compareSnapshots } from "@/lib/snapshotComparison";

const result = compareSnapshots(
  baselineMetrics,    // older snapshot
  currentMetrics,     // newer evaluation
  "v1.0.0",           // baseline model version
  "v1.1.0",           // current model version
  "30d",              // shared time window
);

result.overallAssessment; // "improved" | "worsened" | "mixed" | "unchanged"
result.signalDeltas.usefulFeedbackRateAmongBoosted.direction; // "improved"
```

---

## 5. How to Use Snapshots Before Changing Calibration Config

1. **Save a baseline snapshot** — Use the "Save snapshot" button on `/ranking-eval` (or `POST /api/analytics/ranking-eval/snapshots`) before making any changes. Choose the time window that best represents your evaluation period (e.g. `30d`).

2. **Review recommendations** — Read the recommendations panel. Note which thresholds or weights are suggested for change and what metric values triggered the suggestion.

3. **Make a single, small change** — Change only one parameter at a time in `RANKING_CALIBRATION_CONFIG`. Bump `RANKING_MODEL_VERSION` (e.g. `v1.1.0` → `v1.2.0`).

4. **Re-evaluate** — Return to `/ranking-eval` after allowing feedback to accumulate (at minimum 1–2 weeks). The comparison panel will show the new model version's metrics against the saved snapshot.

5. **Interpret the comparison** — If `overallAssessment` is `improved`, the change is working. If `worsened` or `mixed`, consider reverting or making a different adjustment.

6. **Save a new snapshot** — After confirming improvement, save a new snapshot under the new model version as the new baseline.

---

## 6. Constraints

- **Do not auto-change config values.** The recommendation engine is advisory only.
- **Always bump `RANKING_MODEL_VERSION`** when changing `RANKING_CALIBRATION_CONFIG` so snapshots are correctly attributed to the model that generated them.
- **Snapshots are immutable.** Create new ones; do not update existing rows.
- **Org-scoped.** All snapshot reads and writes require the `X-Organization-Id` header.
- **Preserve explainability.** The `breakdown` format on `RankingBreakdown` is backward-compatible.

---

## 7. File Map

| File | Purpose |
|---|---|
| `lib/db/src/schema/rankingEvalSnapshots.ts` | DB table + types |
| `lib/db/src/schema/index.ts` | Exports the new table |
| `artifacts/api-server/src/services/rankingEvalSnapshotService.ts` | Create / list / get most recent |
| `artifacts/api-server/src/routes/analytics.ts` | POST + GET snapshot routes |
| `artifacts/api-server/src/__tests__/phase12.test.ts` | API tests (22 tests) |
| `artifacts/credit-dashboard/src/lib/snapshotTypes.ts` | Shared metric types |
| `artifacts/credit-dashboard/src/lib/rankingRecommendations.ts` | Recommendation engine |
| `artifacts/credit-dashboard/src/lib/snapshotComparison.ts` | Snapshot comparison utilities |
| `artifacts/credit-dashboard/src/lib/rankingRecommendations.test.ts` | Tests for recommendations + comparison (26 tests) |
| `lib/api-client-react/src/generated/api.schemas.ts` | RankingEvalSnapshot types |
| `lib/api-client-react/src/generated/api.ts` | useCreateRankingEvalSnapshot, useListRankingEvalSnapshots hooks |
| `artifacts/credit-dashboard/src/pages/ranking-eval.tsx` | Enhanced /ranking-eval page |
| `artifacts/credit-dashboard/src/pages/ranking-eval.test.tsx` | Extended page tests (6 new tests) |
