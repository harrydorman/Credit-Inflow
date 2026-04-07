# Phase 9 – Ranking Feedback Integration

## Overview

Phase 9 layers analytics-informed adjustments on top of the existing base priority
model.  Analyst behaviour (feedback ratings, workflow actions) collected in
Phases 7–8 is now used to fine-tune alert ranking in a controlled, explainable
way.

---

## Ranking formula

```
adjustedScore = clamp(baseScore + Δ, 0, 100)
```

### Base score (unchanged from Phase 6)

| Component   | Formula                        | Max  |
|-------------|--------------------------------|------|
| Severity    | high=40 / medium=25 / low=10   | 40   |
| Confidence  | confidence × 30                | 30   |
| Portfolio   | portfolioLinked → +20          | 20   |
| Urgency     | (urgency / 10) × 10            | 10   |
| **Total**   |                                | 100  |

### Analytics adjustment (Δ)

Each adjustment is linearly scaled from its threshold to 1.0 and then
hard-capped as a group.

| Signal                       | Direction | Threshold | Max pts |
|------------------------------|-----------|-----------|---------|
| Event-type usefulness score  | boost     | 0.70      | +8      |
| Issuer investigate rate      | boost     | 0.60      | +8      |
| Rule noise rate              | penalty   | 0.50      | −8      |

```
rawBoost   = eventTypeBoost + issuerBoost
rawPenalty = ruleNoisePenalty
Δ          = clamp(rawBoost − rawPenalty, −15, +15)
```

**`MAX_TOTAL_ADJUSTMENT = 15`** — analytics can never move a score by more
than 15 points in either direction, ensuring the base score always dominates.

---

## Rollout safety

A single constant controls whether adjustments are active:

```ts
// artifacts/credit-dashboard/src/lib/alertPriority.ts
export const RANKING_MODE: "baseline" | "analytics-informed" =
  "analytics-informed";
```

| Value                  | Behaviour                                              |
|------------------------|--------------------------------------------------------|
| `"baseline"`           | No adjustments. Identical to pre-Phase 9 behaviour.    |
| `"analytics-informed"` | Base score + capped analytics adjustment.              |

To roll back at any time, set `RANKING_MODE = "baseline"`.  No other code
changes are required.

---

## Explainability

Every `AlertPriority` object now includes an `analyticsAdjusted` boolean flag.
When true, the priority explanation includes short, human-readable reasons:

| Trigger                            | Explanation text appended                                 |
|------------------------------------|-----------------------------------------------------------|
| Useful event-type boost            | *boosted because this event type is historically useful*  |
| High-investigate-rate issuer boost | *boosted because this issuer often requires investigation* |
| High-noise rule penalty            | *reduced because this rule has a high noise ratio*        |

The full explanation is surfaced in the `AlertDetailPanel` priority section,
alongside a `· analytics-informed` label when adjustments are active.

---

## Analytics index

The analytics data from `GET /analytics/alerts` is indexed once per page
load using two new helpers:

```ts
const index = buildAnalyticsIndex(analyticsData.rankingPrep);
// → { eventTypeUsefulness: Map, issuerInvestigate: Map, ruleNoise: Map }

const ctx = buildRankingContext(alert, index);
// → { eventTypeUsefulnessScore?, issuerInvestigateScore?, ruleNoiseScore? }
```

The per-alert context is then forwarded to `computePriorityScore`,
`getPriorityExplanation`, `getAlertPriority`, and `sortAlertsByPriority`.

---

## UI changes

| Component                | Change                                                           |
|--------------------------|------------------------------------------------------------------|
| `alerts.tsx`             | Fetches analytics, builds index, passes `rankingContext` to rows and detail panel |
| `AlertFeedRow`           | Accepts optional `rankingContext`, forwards to `getAlertPriority` |
| `AlertDetailPanel`       | Accepts `rankingContext`, shows `· analytics-informed` label     |
| `issuer-detail.tsx`      | Fetches analytics, passes `rankingContext` to timeline badges    |

---

## Tests

New test suites in `alertPriority.test.ts`:

- `computeAnalyticsAdjustment` — delta math, individual thresholds, cap at ±15
- `computePriorityScore with RankingContext` — boost / penalty / clamp to [0,100]
- `getPriorityExplanation with RankingContext` — explanation text
- `getAlertPriority – analyticsAdjusted flag`
- `sortAlertsByPriority with getCtx` — analytics can change sort order
- `buildAnalyticsIndex` — index construction
- `buildRankingContext` — per-alert context lookup

Run:

```sh
cd artifacts/credit-dashboard && pnpm test
```
