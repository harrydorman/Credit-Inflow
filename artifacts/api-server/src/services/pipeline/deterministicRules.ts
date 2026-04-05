/**
 * pipeline/deterministicRules.ts
 *
 * Rule-based overrides for key credit events.
 *
 * These rules supplement LLM output — they never fully replace it.
 * When a strong keyword match fires, the rule:
 *   1. May override `eventType` if the LLM classified it as "other"
 *   2. Boosts `classificationConfidence` by the rule's `confidenceBoost`
 *   3. Boosts `urgencyScore` by the rule's `urgencyBoost` (capped downstream)
 *   4. Records itself in `processingMetadata.ruleOverrides` for auditability
 *
 * Rules are defined as a typed configuration array (RULE_DEFINITIONS).
 * Add new rules to that array — no other code needs to change.
 */
import { RULE_SET_VERSION } from "./traceability";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuleDefinition {
  /** Unique identifier for this rule (used in audit logs). */
  ruleName: string;
  /** Keyword to search for in article text (case-insensitive). */
  keyword: string;
  /** Override eventType when the LLM returned "other" (or a weaker match). */
  eventTypeOverride?: string;
  /** How much to add to the urgency score (subject to cap of 10). */
  urgencyBoost: number;
  /** How much to add to the classification confidence (0.0 – 1.0, capped at 1.0). */
  confidenceBoost: number;
  /** Optional: flag to set on the article (e.g. covenantFlag). */
  flagOverride?: "covenantFlag" | "distressedRisk" | "ratingIsDowngrade";
}

export interface RuleMatch {
  ruleName: string;
  keyword: string;
  eventTypeOverride?: string;
  urgencyBoost: number;
  confidenceBoost: number;
  flagOverride?: "covenantFlag" | "distressedRisk" | "ratingIsDowngrade";
}

export interface DeterministicRuleResult {
  /** All rules that matched in this article's text. */
  matches: RuleMatch[];
  /** Overridden eventType (or original if no override applies). */
  eventType: string;
  /** Total urgency boost from all matched rules. */
  urgencyBoost: number;
  /** Total confidence boost from all matched rules. */
  confidenceBoost: number;
  /** Combined flag overrides from all matched rules. */
  flagOverrides: {
    covenantFlag?: true;
    distressedRisk?: true;
    ratingIsDowngrade?: true;
  };
  /** Version of the rule set that was evaluated. */
  ruleSetVersion: string;
  /** Total number of rules that matched. */
  rulesMatchedCount: number;
}

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

const RULE_DEFINITIONS: RuleDefinition[] = [
  // ── Downgrades ──────────────────────────────────────────────────────────
  {
    ruleName: "keyword_downgrade",
    keyword: "downgrade",
    eventTypeOverride: "downgrade",
    urgencyBoost: 2,
    confidenceBoost: 0.15,
    flagOverride: "ratingIsDowngrade",
  },
  {
    ruleName: "keyword_downgraded",
    keyword: "downgraded",
    eventTypeOverride: "downgrade",
    urgencyBoost: 2,
    confidenceBoost: 0.15,
    flagOverride: "ratingIsDowngrade",
  },
  {
    ruleName: "keyword_rating_cut",
    keyword: "rating cut",
    eventTypeOverride: "rating action",
    urgencyBoost: 2,
    confidenceBoost: 0.12,
    flagOverride: "ratingIsDowngrade",
  },
  {
    ruleName: "keyword_cut_to_junk",
    keyword: "cut to junk",
    eventTypeOverride: "downgrade",
    urgencyBoost: 3,
    confidenceBoost: 0.2,
    flagOverride: "ratingIsDowngrade",
  },
  // ── Bankruptcy / distress ────────────────────────────────────────────────
  {
    ruleName: "keyword_bankruptcy",
    keyword: "bankruptcy",
    eventTypeOverride: "bankruptcy",
    urgencyBoost: 5,
    confidenceBoost: 0.3,
    flagOverride: "distressedRisk",
  },
  {
    ruleName: "keyword_chapter_11",
    keyword: "chapter 11",
    eventTypeOverride: "bankruptcy",
    urgencyBoost: 5,
    confidenceBoost: 0.3,
    flagOverride: "distressedRisk",
  },
  {
    ruleName: "keyword_insolvency",
    keyword: "insolvency",
    eventTypeOverride: "bankruptcy",
    urgencyBoost: 4,
    confidenceBoost: 0.25,
    flagOverride: "distressedRisk",
  },
  {
    ruleName: "keyword_distressed_exchange",
    keyword: "distressed exchange",
    eventTypeOverride: "default risk",
    urgencyBoost: 4,
    confidenceBoost: 0.25,
    flagOverride: "distressedRisk",
  },
  {
    ruleName: "keyword_creditor_protection",
    keyword: "creditor protection",
    eventTypeOverride: "bankruptcy",
    urgencyBoost: 4,
    confidenceBoost: 0.25,
    flagOverride: "distressedRisk",
  },
  // ── Restructuring ────────────────────────────────────────────────────────
  {
    ruleName: "keyword_restructuring",
    keyword: "restructuring",
    eventTypeOverride: "restructuring",
    urgencyBoost: 3,
    confidenceBoost: 0.2,
  },
  {
    ruleName: "keyword_debt_restructuring",
    keyword: "debt restructuring",
    eventTypeOverride: "restructuring",
    urgencyBoost: 3,
    confidenceBoost: 0.2,
  },
  {
    ruleName: "keyword_amend_extend",
    keyword: "amend and extend",
    eventTypeOverride: "restructuring",
    urgencyBoost: 2,
    confidenceBoost: 0.15,
  },
  // ── Covenant breach ──────────────────────────────────────────────────────
  {
    ruleName: "keyword_covenant_breach",
    keyword: "covenant breach",
    eventTypeOverride: "covenant breach",
    urgencyBoost: 3,
    confidenceBoost: 0.2,
    flagOverride: "covenantFlag",
  },
  {
    ruleName: "keyword_covenant_violation",
    keyword: "covenant violation",
    eventTypeOverride: "covenant breach",
    urgencyBoost: 3,
    confidenceBoost: 0.2,
    flagOverride: "covenantFlag",
  },
  {
    ruleName: "keyword_financial_covenant",
    keyword: "financial covenant",
    urgencyBoost: 1,
    confidenceBoost: 0.08,
    flagOverride: "covenantFlag",
  },
  // ── Default risk ────────────────────────────────────────────────────────
  {
    ruleName: "keyword_default",
    keyword: "default",
    urgencyBoost: 2,
    confidenceBoost: 0.12,
    flagOverride: "distressedRisk",
  },
  {
    ruleName: "keyword_near_default",
    keyword: "near default",
    eventTypeOverride: "default risk",
    urgencyBoost: 4,
    confidenceBoost: 0.25,
    flagOverride: "distressedRisk",
  },
];

// ---------------------------------------------------------------------------
// Rule engine
// ---------------------------------------------------------------------------

/**
 * Evaluates deterministic keyword rules against article text.
 *
 * Rules supplement (not replace) LLM output:
 * - eventType is only overridden when the LLM returned "other" OR when the
 *   rule has higher specificity (higher urgencyBoost) than the current type.
 * - All matched rules are recorded in the result for full auditability.
 *
 * @param text Combined title + content (lowercased by this function).
 * @param currentEventType The eventType returned by the LLM (may be overridden).
 */
export function applyDeterministicRules(
  text: string,
  currentEventType: string
): DeterministicRuleResult {
  const lower = text.toLowerCase();
  const matches: RuleMatch[] = [];
  let urgencyBoost = 0;
  let confidenceBoost = 0;
  const flagOverrides: DeterministicRuleResult["flagOverrides"] = {};

  for (const rule of RULE_DEFINITIONS) {
    if (lower.includes(rule.keyword)) {
      matches.push({
        ruleName: rule.ruleName,
        keyword: rule.keyword,
        eventTypeOverride: rule.eventTypeOverride,
        urgencyBoost: rule.urgencyBoost,
        confidenceBoost: rule.confidenceBoost,
        flagOverride: rule.flagOverride,
      });
      urgencyBoost += rule.urgencyBoost;
      confidenceBoost += rule.confidenceBoost;
      if (rule.flagOverride) {
        // Set the corresponding flag
        (flagOverrides as Record<string, true>)[rule.flagOverride] = true;
      }
    }
  }

  // Determine eventType override: pick the rule with the highest urgencyBoost
  // whose keyword matched, but only if it's more specific than the current value.
  let eventType = currentEventType;
  if (matches.length > 0) {
    const bestOverride = matches
      .filter((m) => m.eventTypeOverride)
      .sort((a, b) => b.urgencyBoost - a.urgencyBoost)[0];

    if (bestOverride?.eventTypeOverride) {
      // Override if LLM returned "other", or if the rule is specifically more urgent
      if (currentEventType === "other" || bestOverride.urgencyBoost >= 3) {
        eventType = bestOverride.eventTypeOverride;
      }
    }
  }

  return { matches, eventType, urgencyBoost, confidenceBoost, flagOverrides, ruleSetVersion: RULE_SET_VERSION, rulesMatchedCount: matches.length };
}
