# Phase 13 – Feedback-Aware Snapshot Metrics + Outcome Attribution

## Overview

Phase 13 improves confidence in ranking model comparisons by:

1. Computing snapshot metrics **server-side** from real analyst outcomes (feedback, workflow state) instead of relying on frontend approximations.
2. Adding **outcome attribution** utilities that answer whether ranking movements correlated with useful analyst actions.
3. Improving **snapshot comparison** judgments with explicit thresholds and human-readable explanations.
4. Updating the `/ranking-eval` page with attribution summary cards, comparison reasoning text, a metric-source badge, and a "save current view vs compute on server" toggle.

---

## 1. How Snapshot Metrics Are Computed

### Frontend-Estimated (previous behaviour, still available)

When a snapshot is saved via "Save current view", the dashboard collects the in-memory score comparisons from `computeRankingMetrics()` and saves the resulting `RankingAggregateMetrics` as `metricsJson`.  These metrics reflect only the alerts loaded in the current browser session and the live analytics data returned by the API — **they are an approximation**.

The resulting snapshot carries:

```json
{ "metricSource": "estimated", ... }
```

### Server-Computed (new in Phase 13)

When the `metrics` field is **omitted** from `POST /api/analytics/ranking-eval/snapshots`, or when "Server-compute" save mode is selected, the server computes metrics by:

1. Fetching all feedback ratings for alert events, grouped by `eventType` → deriving per-event-type usefulness scores.
2. Fetching all feedback ratings grouped by `ruleName` → deriving per-rule noise scores.
3. Fetching all alert events in the time window with left-joined feedback and workflow state.
4. Classifying each alert as **boosted** (`eventTypeUsefulnessScore ≥ eventTypeBoost.threshold`) or **penalised** (`ruleNoiseScore ≥ ruleNoisePenalty.threshold`) using the same calibration config as the frontend (`DEFAULT_CALIBRATION_CONFIG`).
5. Computing proportional adjustments: `(score - threshold) / (1 - threshold) * max`, capped at `max`.
6. Aggregating into rates and top-lists.

The resulting snapshot carries:

```json
{ "metricSource": "server-computed", ... }
```

Server-computed metrics represent **all historical analyst outcomes** for the org, not just the current page session.

---

## 2. Estimated vs Server-Computed — Key Differences

| Aspect | Estimated | Server-Computed |
|---|---|---|
| **Source** | In-memory alerts loaded in browser | All persisted alert events in DB |
| **Feedback rates** | Not included (default to 0) | Computed from `alert_feedback` table |
| **Workflow rates** | Not included (default to 0) | Computed from `alert_workflow_state` table |
| **Time window** | Filtered by `triggeredAt` client-side | Filtered by `triggered_at` in DB query |
| **Adjustment amounts** | Score delta from `computeRankingBreakdown()` | Proportional estimate from feedback-derived scores |
| **Suitable for** | Quick snapshots to track score distribution | Model version comparisons with outcome confidence |

The three **signal metrics** that drive model comparison judgments —`usefulFeedbackRateAmongBoosted`, `noiseRateAmongPenalised`, `investigateRateAmongPortfolioLinkedBoosted` — are only meaningful in **server-computed** snapshots.  Estimated snapshots default these to `0`, which means snapshot comparisons against estimated snapshots will not reflect real analyst outcomes.

---

## 3. Outcome Attribution Metrics

Outcome attribution answers: "Did our ranking decisions lead to better analyst outcomes?"

### Frontend utility (`lib/outcomeAttribution.ts`)

`computeOutcomeAttribution(comparisons, alerts)` takes:
- `comparisons` — output of `compareAlertRankings` (contains `scoreDelta`)
- `alerts` — alert records enriched with `workflowAction` and `feedbackRating`

Returns `OutcomeAttributionSummary`:

| Field | Meaning |
|---|---|
| `boostedCount` | Alerts with `scoreDelta > 0` (moved up) |
| `boostedInvestigatedCount` | Among boosted, how many had `workflowAction = "investigate"` |
| `boostedInvestigateRate` | `boostedInvestigatedCount / boostedWithWorkflow` |
| `penalisedCount` | Alerts with `scoreDelta < 0` (moved down) |
| `penalisedNoiseCount` | Among penalised, how many had `feedbackRating = "noise"` |
| `penalisedNoiseRate` | `penalisedNoiseCount / penalisedWithFeedback` |
| `topBoostedInvestigatedEventTypes` | Top 5 event types where boosted alerts were investigated (sorted by rate desc) |
| `topPenalisedNoisyRules` | Top 5 rules where penalised alerts were marked noise (sorted by rate desc) |

### Backend service (`services/outcomeAttributionService.ts`)

`computeOutcomeAttribution(orgId, config?)` computes the same metrics from the DB using feedback and workflow state tables.

Available via:
```
GET /api/analytics/ranking-eval/outcome-attribution
X-Organization-Id: <org-id>
```

### Interpreting attribution metrics

- **High `boostedInvestigateRate`** (≥ 0.5): The model is correctly promoting alerts that analysts act on. Good signal.
- **Low `boostedInvestigateRate`** (< 0.3): Boosted alerts are not being investigated. The event-type boost thresholds may be too low.
- **High `penalisedNoiseRate`** (≥ 0.5): The model is correctly demoting alerts that analysts rate as noise. Good signal.
- **Low `penalisedNoiseRate`** (< 0.3): Penalised alerts are not being rated noise. The rule noise penalty thresholds may need tuning.

---

## 4. Comparing Model Versions with Confidence

### New threshold-based judgment

The `compareSnapshots()` function now uses explicit thresholds instead of any-nonzero heuristics:

| Threshold | Value | Description |
|---|---|---|
| `MEANINGFUL_DELTA` | 0.01 | Minimum absolute delta to display as a change |
| `MEANINGFUL_SIGNAL_DELTA` | 0.02 | Minimum delta for a signal metric to "vote" (2 pp) |

### Voting logic

The three signal metrics each cast one vote:
- **improved** if delta ≥ +0.02
- **worsened** if delta ≤ −0.02
- **unchanged** otherwise (delta < 2 pp is treated as noise)

| Vote outcome | Assessment |
|---|---|
| All 3 unchanged | `unchanged` |
| ≥ 1 improved, 0 worsened | `improved` |
| ≥ 1 worsened, 0 improved | `worsened` |
| Both improved and worsened votes present | `mixed` |

### Explanations

Every `SnapshotComparison` now includes an `explanations: string[]` array with human-readable text describing:
1. Why the overall label was assigned (vote counts)
2. Specific metric-level changes that exceeded the 2 pp threshold

Example explanations:
```
"2 of 3 signal metrics improved by at least 2 pp, meeting the threshold for a confident 'improved' verdict."
"Useful feedback rate (boosted): 50% → 70% (↑ improved by 20%)."
"Noise rate (penalised): 40% → 55% (↑ improved by 15%)."
```

### Best practice for model version comparisons

1. Save a **server-computed** snapshot with the current model version as baseline.
2. Deploy the new model version (do not auto-apply calibration changes).
3. Allow a week of analyst activity to accumulate feedback and workflow actions.
4. Save a new **server-computed** snapshot for the same time window.
5. Compare the two snapshots on the `/ranking-eval` page — the `explanations` array explains why the comparison received its label.
6. Only promote calibration changes if the `overallAssessment` is `improved` and the explanations confirm at least 2 signal metrics moved in the right direction.

---

## 5. API Reference

### `POST /api/analytics/ranking-eval/snapshots`

Creates a snapshot. When `metrics` is omitted, the server computes them from DB.

```json
// With caller-supplied metrics (estimated mode)
{
  "rankingModelVersion": "v1.1.0",
  "timeWindow": "all",
  "snapshotType": "manual",
  "metrics": { ... }
}

// Without metrics (server-computed mode)
{
  "rankingModelVersion": "v1.1.0",
  "timeWindow": "all"
}
```

### `GET /api/analytics/ranking-eval/snapshots/computed-metrics?timeWindow=all`

Preview server-computed metrics without saving.

### `GET /api/analytics/ranking-eval/outcome-attribution`

Returns `OutcomeAttributionSummary` for the org.

---

## 6. Files Changed / Added

### New

| File | Description |
|---|---|
| `artifacts/api-server/src/services/snapshotMetricsService.ts` | Server-side snapshot metric computation |
| `artifacts/api-server/src/services/outcomeAttributionService.ts` | Backend outcome attribution queries |
| `artifacts/credit-dashboard/src/lib/outcomeAttribution.ts` | Pure frontend outcome attribution utility |
| `artifacts/api-server/src/__tests__/phase13.test.ts` | API tests (21 tests) |
| `artifacts/credit-dashboard/src/lib/outcomeAttribution.test.ts` | Attribution utility tests (13 tests) |
| `artifacts/credit-dashboard/src/lib/snapshotComparison.test.ts` | Comparison threshold/reasoning tests (19 tests) |
| `docs/phase-13-feedback-snapshot-attribution.md` | This document |

### Modified

| File | Changes |
|---|---|
| `artifacts/api-server/src/services/rankingEvalSnapshotService.ts` | Added `computeAndCreateSnapshot()`, `ComputeAndCreateSnapshotInput` |
| `artifacts/api-server/src/routes/analytics.ts` | Optional metrics in POST; new GET computed-metrics and attribution routes |
| `artifacts/credit-dashboard/src/lib/snapshotComparison.ts` | Threshold-based judgment, `explanations` field, stricter `MEANINGFUL_SIGNAL_DELTA` |
| `artifacts/credit-dashboard/src/lib/snapshotTypes.ts` | Added `metricSource` field |
| `artifacts/credit-dashboard/src/pages/ranking-eval.tsx` | Attribution panel, metric source badge, save mode toggle, comparison reasoning |
| `artifacts/credit-dashboard/src/pages/ranking-eval.test.tsx` | New Phase 13 UI tests (11 tests) |
| `artifacts/api-server/src/__tests__/phase12.test.ts` | Updated "metrics required" test → new behavior test |
