# Phase 10 – Ranking Evaluation + Observability

## Overview

Phase 10 extends the analytics-informed ranking system introduced in Phase 9 with structured observability, comparison tooling, aggregate metrics, and evaluation hooks. The goal is to make ranking behaviour inspectable and to create a foundation for future model calibration.

---

## 1. Ranking Breakdown Model

### `RankingBreakdown` (in `alertPriority.ts`)

Every call to `getAlertPriority(alert, ctx)` now returns a `breakdown` object alongside the existing `score`, `label`, and `explanation` fields.

```ts
interface RankingBreakdown {
  // Base components
  severityScore:    number;   // high=40, medium=25, low=10
  confidenceScore:  number;   // confidence × 30 (0–30)
  portfolioScore:   number;   // 0 or 20
  urgencyScore:     number;   // (urgency/10) × 10 (0–10)
  baseScore:        number;   // sum of the four components

  // Analytics adjustment components
  eventTypeBoost:   number;   // 0–8 pts added for a useful event type
  issuerBoost:      number;   // 0–8 pts added for a high-investigate issuer
  ruleNoisePenalty: number;   // 0–8 pts deducted for a noisy rule (stored positive)
  analyticsAdjustment: number; // net delta, capped at ±15

  // Final
  finalScore:       number;   // baseScore + analyticsAdjustment, clamped [0, 100]
  finalLabel:       PriorityLabel;
  analyticsAdjusted: boolean;
}
```

### `computeRankingBreakdown(alert, ctx?)`

A new exported function that is the single source of truth for score computation. `computePriorityScore` delegates to it, and `getAlertPriority` populates the `breakdown` field from it.

### Updated `computeAnalyticsAdjustment`

Now returns individual component values (`eventTypeBoost`, `issuerBoost`, `ruleNoisePenalty`) alongside `delta` and `reasons`, enabling callers to build structured breakdowns without re-computing.

---

## 2. Alert Detail Observability

`AlertDetailPanel` now renders a **Score breakdown** section inside the priority card. It is compact and readable — not a developer console:

| Element | Purpose |
|---|---|
| Base score | Raw score before analytics |
| Analytics adjustment | Delta (green = boost, red = penalty) — only shown in analytics-informed mode |
| Final score | Clamped final score |
| Adjustment badges | Compact badges for each non-zero component: `+N event type`, `+N issuer`, `−N noise` |

Test IDs: `ranking-breakdown`, `breakdown-base-score`, `breakdown-analytics-adjustment`, `breakdown-final-score`, `adjustment-badges`.

---

## 3. Internal Ranking Evaluation Page (`/ranking-eval`)

An internal admin page accessible at `/ranking-eval`. It is **not linked in the main navigation** — navigate to it directly.

### What it shows

**Aggregate metrics** (grid of 4 cards):
- Total alerts evaluated
- Adjusted count + fraction
- Average positive adjustment (boosted alerts)
- Average negative adjustment (penalised alerts)

**Top boosted event types** and **top penalised rules** (up to 5 each).

**Comparison table** grouped into three sections:
- ▲ Moved Up — alerts whose analytics score > baseline score
- ▼ Moved Down — alerts whose analytics score < baseline score
- = Unchanged — alerts with no adjustment

Each row shows: alert title, issuer, baseline score, analytics score, delta (with icon), and factor badges.

---

## 4. Ranking Evaluation Utilities (`lib/rankingEvaluation.ts`)

Pure functions — no side effects, all testable in isolation.

### Per-alert comparison

```ts
compareAlertRanking(alert, ctx?) → AlertRankingComparison
compareAlertRankings(alerts, getCtx?) → AlertRankingComparison[]  // sorted by |delta|
```

`AlertRankingComparison` fields: `alertId`, `issuerName`, `title`, `baselineScore`, `analyticsScore`, `scoreDelta`, `breakdown`.

### Aggregate metrics

```ts
computeRankingMetrics(comparisons, alerts) → RankingAggregateMetrics
```

Returns: `totalAlerts`, `adjustedCount`, `adjustedFraction`, `boostedCount`, `penalisedCount`, `averagePositiveAdjustment`, `averageNegativeAdjustment`, `topBoostedEventTypes`, `topPenalisedRules`.

### Evaluation hooks

```ts
fractionBoostedAndUseful(comparisons, isUsefulOrInvestigated) → number
fractionPenalisedAndNoisy(comparisons, isNoisyOrIgnored) → number
fractionPortfolioLinkedBoosted(comparisons, alerts) → number
```

---

## 5. How Evaluation Works

1. **Load alerts** via the existing `useListAlertEvents` hook.
2. **Load analytics** via `useGetAlertAnalytics`.
3. **Build an analytics index** with `buildAnalyticsIndex(rankingPrep)`.
4. **Map each alert to a RankingContext** with `buildRankingContext(alert, index)`.
5. **Compute comparisons** with `compareAlertRankings(alerts, getCtx)`.
6. **Compute metrics** with `computeRankingMetrics(comparisons, alerts)`.
7. **Answer calibration questions** using the evaluation hooks.

The ranking-eval page performs steps 1–6 automatically when loaded.

---

## 6. Metrics That Indicate Success or Failure

| Metric | Good signal | Concern |
|---|---|---|
| `adjustedFraction` | Moderate (20–60%) | Very low means no analytics signal; very high may mean over-fitting |
| `averagePositiveAdjustment` | 3–10 pts | < 1 pt = negligible boost |
| `averageNegativeAdjustment` | −3 to −10 pts | Close to 0 = noise penalty not working |
| `fractionBoostedAndUseful` | ↑ over time | Low means boosts aren't aligned with analyst judgement |
| `fractionPenalisedAndNoisy` | ↑ over time | Low means noisy rules aren't being caught |
| `fractionPortfolioLinkedBoosted` | High | Portfolio-linked alerts should surface first |

---

## 7. Foundation for Future Calibration

The breakdown model and evaluation utilities are designed to support:

- **Threshold tuning** — `EVENT_TYPE_BOOST_THRESHOLD`, `ISSUER_INVESTIGATE_THRESHOLD`, `RULE_NOISE_THRESHOLD` are constants in `alertPriority.ts`. Adjust them based on `fractionBoostedAndUseful` and `fractionPenalisedAndNoisy` trends.
- **Weight tuning** — `EVENT_TYPE_BOOST_MAX`, `ISSUER_INVESTIGATE_BOOST_MAX`, `RULE_NOISE_PENALTY_MAX` control the maximum contribution of each component.
- **Model versioning** — When thresholds or weights change, bump a `RANKING_MODEL_VERSION` constant (to be added) so historical comparisons remain meaningful.
- **A/B testing** — `RANKING_MODE` already supports `"baseline"` / `"analytics-informed"` rollout control. The evaluation utilities can be used to compare cohorts.
- **ML readiness** — `compareAlertRankings` produces labelled training data: `(alert, context) → scoreDeltas`. Combined with analyst feedback, this is the input for a future gradient boosted or logistic regression model.

---

## 8. Constraints Preserved

- The string `explanation` field in `AlertPriority` is unchanged.
- `computePriorityScore`, `getPriorityLabel`, `getPriorityExplanation`, and all Phase 9 exports remain intact and backward-compatible.
- The `RANKING_MODE` rollout flag continues to work as before.
- The `/alerts` feed and `AlertDetailPanel` flows are not broken.
