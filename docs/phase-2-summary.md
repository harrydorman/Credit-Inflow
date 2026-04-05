# Phase 2 – Stage-Based Article Processing and AI Pipeline Hardening

## Overview

Phase 2 introduces a structured, stage-based processing pipeline for articles ingested by the Credit Inflow platform. Every article now moves through a defined sequence of processing stages, with each stage persisted to the database independently. This makes failures observable, partial completions recoverable, and AI output auditable.

Phase 2 does **not** change ingestion API responses — all existing fields and response shapes are preserved. It adds new fields to the articles table and introduces new services that can be used to process or re-process articles independently.

---

## What Changed

### 1. Schema — `lib/db/src/schema/articles.ts`

#### New columns

**Pipeline stages and timing:**

| Column | Type | Description |
|---|---|---|
| `processing_stage` | text | Current stage the article has reached (see stage model below) |
| `processing_started_at` | timestamptz | When the current pipeline run began |
| `processing_completed_at` | timestamptz | When the pipeline run finished (null if failed or in-progress) |

**AI traceability:**

| Column | Type | Description |
|---|---|---|
| `prompt_version` | text | Version of the prompt used (e.g. `"v1.1"`) |
| `model_version` | text | OpenAI model identifier (e.g. `"gpt-4o-mini"`) |
| `pipeline_version` | text | Version of the pipeline logic (e.g. `"pipeline-v2"`) |

**Quality and trust:**

| Column | Type | Description |
|---|---|---|
| `classification_confidence` | real (0–1) | Combined confidence from LLM output, rule matches, issuer resolution, and market validation |
| `needs_review` | boolean | True when confidence is below threshold or signals conflict |
| `review_reason` | text | Human-readable reason(s) for the review flag (comma-separated) |

**Explainability:**

| Column | Type | Description |
|---|---|---|
| `processing_metadata` | json | Per-stage outputs, rule overrides, timing, and failure details |

#### Backward compatibility

- `processing_status` is unchanged. The existing values (`pending`, `processing`, `processed`, `failed`, `filtered`) are preserved. The new pipeline uses `"success"` for completed articles; `"processed"` remains valid for Phase 1b-era data.
- All existing columns are untouched.

---

### 2. Stage Model — `services/pipeline/types.ts`

Articles progress through the following stages:

```
raw → enriched → issuer_identified → classified → scored → validated
              ↓
           filtered  (if ineligible at any stage)
```

| Stage | Meaning |
|---|---|
| `raw` | Article has been inserted but not yet pipeline-processed |
| `filtered` | Article failed eligibility or noise check; no further processing |
| `enriched` | Full article content has been fetched (or confirmed as RSS snippet) |
| `issuer_identified` | Issuer name has been resolved and canonicalised |
| `classified` | AI analysis complete; deterministic rules applied and merged |
| `scored` | Classification confidence computed; `needsReview` flag set |
| `validated` | Market data validation complete; final confidence refined |

---

### 3. Traceability Constants — `services/pipeline/traceability.ts`

Three centrally-defined constants are stored against every article that passes through the pipeline:

```ts
PROMPT_VERSION    = "v1.1"          // bump when the AI prompt changes
MODEL_VERSION     = "gpt-4o-mini"   // bump when the OpenAI model changes
PIPELINE_VERSION  = "pipeline-v2"   // bump when stage sequence or logic changes
```

These constants appear in every `processingMetadata` record and are written to the `prompt_version`, `model_version`, and `pipeline_version` columns on every pipeline run. This allows data analysts to correlate output quality changes to specific versions.

---

### 4. Deterministic Rule Engine — `services/pipeline/deterministicRules.ts`

`applyDeterministicRules(text, currentEventType)` runs a keyword-based rule set over the combined title + content text. Rules **supplement** LLM output; they never fully replace it.

**Current rules (examples):**

| Rule | Keyword | eventType override | urgencyBoost | Flag |
|---|---|---|---|---|
| `keyword_downgrade` | `"downgrade"` | `"downgrade"` | +2 | `ratingIsDowngrade` |
| `keyword_bankruptcy` | `"bankruptcy"` | `"bankruptcy"` | +5 | `distressedRisk` |
| `keyword_chapter_11` | `"chapter 11"` | `"bankruptcy"` | +5 | `distressedRisk` |
| `keyword_restructuring` | `"restructuring"` | `"restructuring"` | +3 | — |
| `keyword_covenant_breach` | `"covenant breach"` | `"covenant breach"` | +3 | `covenantFlag` |
| `keyword_near_default` | `"near default"` | `"default risk"` | +4 | `distressedRisk` |

**Override logic:**
- `eventType` is only overridden when the LLM returned `"other"`, OR when the best-matching rule has `urgencyBoost >= 3`.
- All matched rules are recorded in `processingMetadata.ruleOverrides` for full auditability.

---

### 5. Confidence Scoring — `services/pipeline/confidenceScoring.ts`

`computeClassificationConfidence(input)` combines four signals into a 0.0–1.0 score:

| Component | Weight | Source |
|---|---|---|
| LLM urgency | 35% | `urgencyScoreAI` (1–5 normalised to 0–1) |
| Rule matches | 25% | Rule match count + total `confidenceBoost` from all matches |
| Data completeness | 20% | Issuer found + enrichment success + content depth score |
| Market validation | 20% | `"confirmed"` = 1.0, `"mixed"` = 0.3, `"unconfirmed"` = 0.5 |

**Review threshold:** `0.45`. Articles below this threshold have `needsReview = true`.

**Additional review triggers** (independent of threshold):
- `missing_issuer` — issuer not found for a non-macro event
- `conflicting_market_signals` — market validation returned `"mixed"`
- `ai_unavailable` — LLM call failed or was not configured
- `rule_llm_disagreement` — strong keyword rules fired but LLM urgency was ≤ 2

When multiple reasons apply, `reviewReason` is a comma-separated list (e.g. `"missing_issuer, conflicting_market_signals"`).

---

### 6. Stage Functions — `services/pipeline/stages.ts`

Six independent, typed functions. Each accepts a typed input, records its own timing, and returns a `StageResult<T>`. Failures throw a `PipelineStageError`.

| Function | Stage | Input | Notes |
|---|---|---|---|
| `processEligibility(input)` | → enriched / filtered | `{ title, rawContent }` | Checks noise filter + content presence |
| `processEnrichment(input)` | enriched | `{ url, source, rawSnippet }` | Falls back to snippet on any fetch error |
| `extractIssuer(input)` | issuer_identified | `{ title, rawContent, aiIssuerName? }` | Canonicalises via `canonicalIssuers.ts` |
| `classifyEvent(input)` | classified | `{ title, rawContent }` | Calls `analyzeArticle` + deterministic rules |
| `scoreSignal(input)` | scored | Scoring inputs | Wraps `computeClassificationConfidence` |
| `validateAgainstMarket(input)` | validated | `{ issuerName, sentiment, scores }` | Market data failure is non-fatal |

---

### 7. Pipeline Runner — `services/pipeline/pipelineRunner.ts`

`processArticlePipeline(articleId, jobId, log?)` is the top-level orchestrator.

**Execution sequence:**
1. Load article from DB (throws if not found)
2. Set `processingStatus = "processing"`, `processingStartedAt = now`, write traceability versions
3. **Eligibility** — filter immediately if content is absent and no title override
4. **Enrichment** — fetch full article content; fall back to snippet on error
5. Re-check eligibility after enrichment
6. **Classification** — call AI + run deterministic rules; also runs issuer identification
7. **Scoring** — compute `classificationConfidence` using pre-market signals
8. **Market validation** — fetch stock/ETF moves; refine confidence score with market signal
9. Set `processingStatus = "success"`, `processingCompletedAt = now`

**Failure isolation:**
- If any stage throws `PipelineStageError` or any other error: `processingStatus = "failed"`, `processingError = message`, pipeline stops.
- Previous stages' DB updates are retained (partial completion). A backfill job can resume from the failed stage.
- Enrichment and market validation failures are **non-fatal** — they fall back gracefully.

**`processingMetadata` structure (JSON):**
```json
{
  "pipelineVersion": "pipeline-v2",
  "stageOutputs": [
    { "stage": "enriched", "durationMs": 340, "success": true, "data": { ... } },
    { "stage": "classified", "durationMs": 820, "success": true, "data": { "rulesMatched": 2, ... } },
    ...
  ]
}
```

**Idempotency:** Running the pipeline twice on the same article is safe — each run overwrites the previous stage data.

---

### 8. Ingestion Service — `services/ingestionService.ts`

Minimal changes to preserve backward compatibility:

- `ArticleProcessingStatus` type extended with `"success"` (existing `"processed"` retained).
- `processingStage` is now set on all article inserts:
  - Filtered articles (empty content, noise-filtered) → `processingStage = "filtered"`
  - Articles processed inline with AI → `processingStage = "validated"`
  - Articles where AI returned null → `processingStage = "raw"`
- All existing API response fields are unchanged.

---

### 9. Tests — `src/__tests__/pipeline.test.ts`

37 new tests across 6 test suites covering:

| Suite | Tests |
|---|---|
| `applyDeterministicRules` | 10 — downgrade, bankruptcy, restructuring, covenant, chapter 11, accumulation, case-insensitivity, override logic, auditability |
| `computeClassificationConfidence` | 8 — high/low confidence, needsReview triggers, breakdown structure, threshold |
| `processEligibility` | 5 — empty content, title override, noise-filtered, eligible content, durationMs |
| `extractIssuer` | 3 — null result, AI name canonicalization, empty string guard |
| `scoreSignal` | 2 — confidence range, needsReview propagation |
| `processArticlePipeline` | 6 — not found error, filtered article, AI null stops at classification, full success, stageOutputs array, idempotency |
| `traceability constants` | 3 — PROMPT_VERSION, MODEL_VERSION, PIPELINE_VERSION |

**Total: 78 tests, all passing** (41 existing Phase 1/1b + 37 new).

---

## Architecture Summary

```
ingestionService.ts
  └── inserts article with processingStage = "raw"|"filtered"|"validated"

processArticlePipeline(articleId, jobId)          ← new Phase 2 entry point
  ├── processEligibility()                         ← stages.ts
  ├── processEnrichment()                          ← stages.ts → contentEnricher.ts
  ├── classifyEvent()                              ← stages.ts → aiProcessing.ts
  │     └── applyDeterministicRules()             ← deterministicRules.ts
  ├── extractIssuer()                              ← stages.ts → canonicalIssuers.ts
  ├── scoreSignal()                                ← stages.ts → confidenceScoring.ts
  └── validateAgainstMarket()                      ← stages.ts → marketData.ts

After each stage:
  DB.update(articlesTable).set({ processingStage, processingMetadata, ... })
```

---

## What Was Intentionally Deferred to Phase 3

| Deferred item | Rationale |
|---|---|
| **Resume-from-stage backfill** | The schema is ready (`processingStage` persisted after each step). A dedicated backfill worker that picks up `processingStatus = "failed"` articles and resumes from `processingStage` is a Phase 3 deliverable. |
| **Calling `processArticlePipeline` from ingestion inline** | Currently the ingestion service runs AI processing inline and sets `processingStage = "validated"` directly. A full refactor to insert raw stubs and call the pipeline is safe but deferred to avoid disrupting the stable ingestion path. |
| **Per-stage retry logic** | The job retry system (Phase 1b) operates at the job level. Stage-level retry (e.g. retrying only market validation) requires a richer state machine and is deferred. |
| **Analyst review workflow** | `needsReview = true` and `reviewReason` are now stored. The UI surface (review queue, analyst interface) is a frontend / product concern for Phase 3. |
| **Rule registry management** | Rules are currently hardcoded in `deterministicRules.ts`. A DB-backed rule registry with admin UI is Phase 3. |
| **Multi-tenant pipeline routing** | The `scope_key` field is ready; per-tenant pipeline configuration (different thresholds, prompt versions) is Phase 3. |
| **LLM-native confidence output** | The AI prompt currently does not ask for a self-reported confidence score. Adding this and using it as a first-class input to `computeClassificationConfidence` is Phase 3. |
