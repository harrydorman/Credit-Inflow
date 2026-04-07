import type { AlertEvent } from "@workspace/api-client-react";

// ─── types ────────────────────────────────────────────────────────────────────

export type PriorityLabel = "Critical" | "High" | "Medium" | "Low";

export type AnalystAction = "investigate" | "monitor" | "ignore" | null;

export interface AlertPriority {
  score: number;
  label: PriorityLabel;
  explanation: string;
}

// ─── scoring weights ─────────────────────────────────────────────────────────

const SEVERITY_SCORE: Record<string, number> = {
  high: 40,
  medium: 25,
  low: 10,
};

const PORTFOLIO_BONUS = 20;
const MAX_CONFIDENCE_SCORE = 30;
const MAX_URGENCY_SCORE = 10;

// ─── helpers ──────────────────────────────────────────────────────────────────

function deriveSeverity(alert: AlertEvent): "high" | "medium" | "low" | null {
  if (alert.severity) return alert.severity;
  const u = alert.urgency ?? null;
  if (u == null) return null;
  if (u >= 8) return "high";
  if (u >= 5) return "medium";
  return "low";
}

// ─── computePriorityScore ─────────────────────────────────────────────────────

/**
 * Compute a 0-100 priority score for an alert.
 *
 * Components:
 *   - Severity  : high=40, medium=25, low=10
 *   - Confidence: confidence * 30  (0–30)
 *   - Portfolio : portfolioLinked  → +20
 *   - Urgency   : (urgency/10) * 10 (0–10)
 */
export function computePriorityScore(alert: AlertEvent): number {
  const severity = deriveSeverity(alert);
  const severityScore = severity ? (SEVERITY_SCORE[severity] ?? 0) : 0;
  const confidenceScore = (alert.confidence ?? 0) * MAX_CONFIDENCE_SCORE;
  const portfolioScore = alert.portfolioLinked ? PORTFOLIO_BONUS : 0;
  const urgencyScore = ((alert.urgency ?? 0) / 10) * MAX_URGENCY_SCORE;

  return Math.round(severityScore + confidenceScore + portfolioScore + urgencyScore);
}

// ─── getPriorityLabel ─────────────────────────────────────────────────────────

export function getPriorityLabel(score: number): PriorityLabel {
  if (score >= 75) return "Critical";
  if (score >= 50) return "High";
  if (score >= 25) return "Medium";
  return "Low";
}

// ─── getPriorityExplanation ───────────────────────────────────────────────────

export function getPriorityExplanation(alert: AlertEvent): string {
  const severity = deriveSeverity(alert);
  const parts: string[] = [];

  if (severity === "high") parts.push("high severity");
  else if (severity === "medium") parts.push("medium severity");
  else if (severity === "low") parts.push("low severity");

  if (alert.portfolioLinked) parts.push("portfolio exposure");

  const conf = alert.confidence ?? 0;
  if (conf >= 0.8) parts.push("high confidence");
  else if (conf >= 0.5) parts.push("moderate confidence");

  if (parts.length === 0) return "Insufficient signal data to determine priority.";

  const score = computePriorityScore(alert);
  const label = getPriorityLabel(score);
  return `${label} priority because: ${parts.join(" + ")}.`;
}

// ─── getAlertPriority ─────────────────────────────────────────────────────────

export function getAlertPriority(alert: AlertEvent): AlertPriority {
  const score = computePriorityScore(alert);
  return {
    score,
    label: getPriorityLabel(score),
    explanation: getPriorityExplanation(alert),
  };
}

// ─── sortAlertsByPriority ─────────────────────────────────────────────────────

export function sortAlertsByPriority(alerts: AlertEvent[]): AlertEvent[] {
  return [...alerts].sort(
    (a, b) => computePriorityScore(b) - computePriorityScore(a),
  );
}

// ─── priority badge styles ────────────────────────────────────────────────────

export const PRIORITY_BADGE_STYLES: Record<PriorityLabel, string> = {
  Critical: "bg-red-700 text-white border-red-700",
  High: "bg-orange-500 text-white border-orange-500",
  Medium: "bg-yellow-500 text-black border-yellow-500",
  Low: "bg-slate-500 text-white border-slate-500",
};

// ─── action helpers ───────────────────────────────────────────────────────────

export const ANALYST_ACTION_LABELS: Record<NonNullable<AnalystAction>, string> = {
  investigate: "Investigating",
  monitor: "Monitoring",
  ignore: "Ignored",
};

export const ANALYST_ACTION_STYLES: Record<NonNullable<AnalystAction>, string> = {
  investigate: "bg-blue-600 text-white border-blue-600",
  monitor: "bg-teal-600 text-white border-teal-600",
  ignore: "bg-secondary text-muted-foreground border-border",
};
