/**
 * pipeline/traceability.ts
 *
 * Centralized versioning constants for AI traceability.
 *
 * Every article processed by the pipeline has these versions stored against it
 * so that changes in output can be attributed to prompt, model, or pipeline
 * changes rather than appearing as unexplained data drift.
 *
 * Bump:
 *  - PROMPT_VERSION when the system prompt in aiProcessing.ts changes.
 *  - MODEL_VERSION when the OpenAI model identifier changes.
 *  - PIPELINE_VERSION when the stage sequence or logic changes materially.
 *  - RULE_SET_VERSION when the deterministic rule definitions change.
 *  - CONFIDENCE_VERSION when the confidence scoring weights/logic changes.
 */

/** Version of the AI prompt used to classify articles. */
export const PROMPT_VERSION = "v1.1" as const;

/** OpenAI model used for article classification. */
export const MODEL_VERSION = "gpt-4o-mini" as const;

/** Version of the processing pipeline (stage sequence + business rules). */
export const PIPELINE_VERSION = "pipeline-v2.5" as const;

/** Version of the deterministic rule set. Bump when rules are added/modified. */
export const RULE_SET_VERSION = "rules-v1" as const;

/** Version of the confidence scoring algorithm. Bump when weights or logic change. */
export const CONFIDENCE_VERSION = "confidence-v1" as const;
