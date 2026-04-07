# Phase 11: Ranking Calibration + Time-Windowed Evaluation

## Overview

Phase 11 builds on the analytics-informed ranking introduced in Phase 9 and the evaluation tooling from Phase 10. It adds versioning, a centralised calibration config, time-windowed evaluation, trend metrics, and an extended internal calibration view — all designed to make ranking improvements safe, measurable, and reversible.

---

## 1. Ranking Model Versioning

### Constant

```ts
// artifacts/credit-dashboard/src/lib/alertPriority.ts
export const RANKING_MODEL_VERSION = "v1.1.0";
```

### What it does

- A single, easily discoverable string that identifies the scoring model in effect.
- Included in every `RankingBreakdown` object (via the `modelVersion` field).
- Surfaced on the calibration view so operators know exactly which model produced the metrics they are reading.

### How to bump

1. Edit `RANKING_MODEL_VERSION` in `alertPriority.ts`.
2. Edit `RANKING_CALIBRATION_CONFIG` if any thresholds or weights changed.
3. Run `pnpm test` — score-consistency tests will either confirm unchanged behaviour or highlight the intended change.
4. Commit with a message that references the version bump (e.g. `feat(ranking): bump model to v1.2.0`).

---

## 2. Calibration Config Structure

All ranking thresholds and caps are co-located in a single immutable config object:

```ts
export const RANKING_CALIBRATION_CONFIG = {
  eventTypeBoost:    { threshold: 0.7, max: 8 },
  issuerBoost:       { threshold: 0.6, max: 8 },
  ruleNoisePenalty:  { threshold: 0.5, max: 8 },
  totalAdjustmentCap: 15,
} as const;
```

### Design decisions

- `as const` prevents accidental mutation and preserves literal types for TypeScript narrowing.
- `computeAnalyticsAdjustment` reads from this object via local aliases so the hot path is unchanged.
- `MAX_TOTAL_ADJUSTMENT` is re-exported as an alias for backwards compatibility.

### Safe tuning workflow

1. Identify a metric that needs improvement (e.g. boost threshold is too low → too many low-signal alerts are being boosted).
2. Change the relevant value in `RANKING_CALIBRATION_CONFIG`.
3. Bump `RANKING_MODEL_VERSION`.
4. Run the test suite. The config-consistency tests will verify that max boosts/penalties still equal config values.
5. Deploy and compare "last 7 days" trend metrics against the previous model's "last 30 days" baseline.

---

## 3. Time-Windowed Evaluation

### `TimeWindow` type

```ts
export type TimeWindow = "7d" | "30d" | "all";
```

### `filterAlertsByTimeWindow(alerts, window, now?)`

Filters an alert list to those whose `triggeredAt` timestamp falls within the specified rolling window. Alerts with no `triggeredAt` are excluded from `7d` and `30d` but included in `all`.

### `computeWindowedMetrics(alerts, getCtx, window, now?)`

Convenience wrapper: filters by time window, then runs `compareAlertRankings` + `computeRankingMetrics`. Returns a `RankingAggregateMetrics` object scoped to the window.

---

## 4. Trend Metrics

### `TrendMetrics` interface

```ts
interface TrendMetrics {
  window: TimeWindow;
  alertCount: number;
  usefulFeedbackRateAmongBoosted: number;       // 0–1
  noiseRateAmongPenalised: number;              // 0–1
  investigateRateAmongPortfolioLinkedBoosted: number; // 0–1
}
```

### `computeTrendMetrics(alerts, getCtx, window, isUsefulOrInvestigated, isNoisyOrIgnored, now?)`

Computes the three trend signal rates for a single window.

### `computeMultiWindowTrends(alerts, getCtx, windows, ...)`

Calls `computeTrendMetrics` for each window in `windows`. Use this to produce side-by-side comparisons:

```ts
const [w7, w30, wAll] = computeMultiWindowTrends(
  alerts,
  getCtx,
  ["7d", "30d", "all"],
  isUsefulOrInvestigated,
  isNoisyOrIgnored,
);
```

### Interpreting trend metrics

| Metric | Good signal | Concern |
|---|---|---|
| `usefulFeedbackRateAmongBoosted` | Rising over time | Falling — boosting the wrong alerts |
| `noiseRateAmongPenalised` | Rising over time | Falling — penalising useful alerts |
| `investigateRateAmongPortfolioLinkedBoosted` | High — model surfacing portfolio risk | Low — portfolio alerts not benefiting from analytics |

---

## 5. Calibration View

The internal `/ranking-eval` page now includes:

| Element | Purpose |
|---|---|
| Model version badge | Shows which ranking model is active |
| Time window selector | Filter metrics to Last 7 days / Last 30 days / All time |
| Calibration config panel | Shows current thresholds and max weights at a glance |
| Aggregate metrics | Adjusted fraction, avg positive/negative delta — scoped to selected window |
| Top boosted event types | Which event types receive the most cumulative boost in the window |
| Top penalised rules | Which rules receive the most cumulative penalty in the window |
| Comparison table | Per-alert baseline vs analytics scores, filtered by window |

### Accessing the page

Navigate to `/ranking-eval` on the dashboard. The page is internal and not linked in the main navigation.

---

## 6. How to Perform Calibration Safely

### Principle: small changes, measured outcomes

1. **Establish a baseline.** Record "All time" trend metrics before any change.
2. **Change one parameter at a time.** Edit a single field in `RANKING_CALIBRATION_CONFIG`, bump `RANKING_MODEL_VERSION`.
3. **Deploy and wait.** Let the new model run for at least 7 days.
4. **Compare windows.** Use the calibration view to compare "Last 7 days" under the new model against the "Last 30 days" baseline. Key signals:
   - Did `adjustedFraction` change as expected?
   - Did `usefulFeedbackRateAmongBoosted` improve?
   - Did the `averagePositiveAdjustment` stay within a reasonable range?
5. **Roll back if needed.** Revert `RANKING_CALIBRATION_CONFIG` and `RANKING_MODEL_VERSION`, redeploy.

### Parameters and their effects

| Parameter | Raise threshold | Lower threshold |
|---|---|---|
| `eventTypeBoost.threshold` | Fewer alerts boosted (more selective) | More alerts boosted (may include noise) |
| `issuerBoost.threshold` | Fewer issuers boosted | More issuers boosted |
| `ruleNoisePenalty.threshold` | Fewer rules penalised | More rules penalised |
| `totalAdjustmentCap` | Reduces extreme moves | Allows larger score swings |

| Parameter | Raise max | Lower max |
|---|---|---|
| `eventTypeBoost.max` | Larger boosts for highly useful types | Smaller boosts |
| `ruleNoisePenalty.max` | Larger penalties for noisy rules | Smaller penalties |
| `totalAdjustmentCap` | See above | See above |

---

## 7. Test Coverage

| Test area | Location | Count |
|---|---|---|
| `RANKING_MODEL_VERSION` presence | `alertPriority.test.ts` | 5 |
| Config-driven score consistency | `alertPriority.test.ts` | 8 |
| `filterAlertsByTimeWindow` | `rankingEvaluation.test.ts` | 10 |
| `computeWindowedMetrics` | `rankingEvaluation.test.ts` | 3 |
| `computeTrendMetrics` | `rankingEvaluation.test.ts` | 7 |
| `computeMultiWindowTrends` | `rankingEvaluation.test.ts` | 3 |
| Calibration view rendering | `ranking-eval.test.tsx` | 16 |

Total: **274 tests passing** (up from 223 in Phase 10).
