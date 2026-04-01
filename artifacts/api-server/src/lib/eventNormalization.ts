// Canonical event type names (must match AI_PROCESSING EVENT_TYPES list)
const EVENT_MAP: Record<string, string> = {
  // Downgrade variants
  "downgraded": "downgrade",
  "rating cut": "downgrade",
  "cut to junk": "downgrade",
  "lowered rating": "downgrade",
  "credit downgrade": "downgrade",
  "rating action": "downgrade",
  "rating review": "downgrade",
  "negative outlook": "downgrade",

  // Earnings miss
  "missed earnings": "earnings",
  "weak earnings": "earnings",
  "earnings miss": "earnings",
  "below expectations": "earnings",
  "revenue miss": "earnings",

  // Liquidity stress
  "liquidity concerns": "default risk",
  "liquidity crunch": "default risk",
  "cash burn": "default risk",
  "liquidity stress": "default risk",

  // Refinancing risk
  "refinancing pressure": "refinancing",
  "maturity wall": "refinancing",
  "debt maturity": "refinancing",
  "refinancing risk": "refinancing",

  // Distress / default
  "default risk": "default risk",
  "distressed": "default risk",
  "near default": "default risk",
  "restructuring": "restructuring",
  "debt restructuring": "restructuring",
  "distressed exchange": "restructuring",
  "amend and extend": "refinancing",

  // Bankruptcy
  "chapter 11": "bankruptcy",
  "insolvency": "bankruptcy",
  "liquidation": "bankruptcy",
  "creditor protection": "bankruptcy",

  // Spread
  "spread widening": "spread widening",
  "credit spread": "spread widening",
  "cds widening": "spread widening",
};

/**
 * Normalize an event type string to a canonical form.
 * Performs case-insensitive substring matching against the event map.
 * Returns the original if no match found.
 */
export function normalizeEventType(input: string | null | undefined): string | null {
  if (!input) return null;
  const lower = input.toLowerCase().trim();

  // Direct match first
  if (EVENT_MAP[lower]) return EVENT_MAP[lower];

  // Substring match
  for (const [pattern, canonical] of Object.entries(EVENT_MAP)) {
    if (lower.includes(pattern)) return canonical;
  }

  return input;
}
