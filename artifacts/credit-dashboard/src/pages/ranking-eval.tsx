/**
 * pages/ranking-eval.tsx
 *
 * Phase 10: Internal ranking evaluation page.
 *
 * Compares baseline vs analytics-informed scores for all loaded alerts,
 * showing which alerts moved up or down and aggregate adjustment metrics.
 * This is an admin/internal page — not linked in the main navigation.
 */

import { useMemo } from "react";
import { useListAlertEvents, useGetAlertAnalytics } from "@workspace/api-client-react";
import type { AlertEvent } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  buildAnalyticsIndex,
  buildRankingContext,
  RANKING_MODE,
} from "@/lib/alertPriority";
import {
  compareAlertRankings,
  computeRankingMetrics,
  type AlertRankingComparison,
} from "@/lib/rankingEvaluation";
import { TrendingUp, TrendingDown, Minus, BarChart2, AlertCircle } from "lucide-react";

// ─── helpers ─────────────────────────────────────────────────────────────────

function deltaColor(delta: number): string {
  if (delta > 0) return "text-green-400";
  if (delta < 0) return "text-destructive";
  return "text-muted-foreground";
}

function DeltaIcon({ delta }: { delta: number }) {
  if (delta > 0)
    return <TrendingUp className="h-3.5 w-3.5 text-green-400 shrink-0" />;
  if (delta < 0)
    return <TrendingDown className="h-3.5 w-3.5 text-destructive shrink-0" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ─── sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-secondary/20 px-3 py-2.5 flex flex-col gap-0.5">
      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <p className="text-lg font-bold font-mono text-foreground">{value}</p>
      {sub && (
        <p className="text-[11px] font-mono text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

function ComparisonRow({ c }: { c: AlertRankingComparison }) {
  return (
    <tr className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
      <td className="py-2 px-3 text-xs font-mono text-foreground max-w-[180px] truncate">
        <span title={c.title}>{c.title}</span>
      </td>
      <td className="py-2 px-3 text-xs font-mono text-muted-foreground">{c.issuerName}</td>
      <td className="py-2 px-3 text-right text-xs font-mono text-muted-foreground">{c.baselineScore}</td>
      <td className="py-2 px-3 text-right text-xs font-mono text-foreground font-medium">{c.analyticsScore}</td>
      <td className="py-2 px-3 text-right">
        <span className={`inline-flex items-center gap-1 text-xs font-mono font-bold ${deltaColor(c.scoreDelta)}`}>
          <DeltaIcon delta={c.scoreDelta} />
          {c.scoreDelta > 0 ? `+${c.scoreDelta}` : c.scoreDelta}
        </span>
      </td>
      <td className="py-2 px-3 text-xs font-mono text-muted-foreground">
        <div className="flex flex-wrap gap-1">
          {c.breakdown.eventTypeBoost > 0 && (
            <span className="rounded px-1 py-0.5 text-[10px] bg-green-950/50 text-green-400 border border-green-800/50">
              +{c.breakdown.eventTypeBoost} ET
            </span>
          )}
          {c.breakdown.issuerBoost > 0 && (
            <span className="rounded px-1 py-0.5 text-[10px] bg-green-950/50 text-green-400 border border-green-800/50">
              +{c.breakdown.issuerBoost} issuer
            </span>
          )}
          {c.breakdown.ruleNoisePenalty > 0 && (
            <span className="rounded px-1 py-0.5 text-[10px] bg-red-950/50 text-destructive border border-red-800/50">
              −{c.breakdown.ruleNoisePenalty} noise
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function RankingEvalPage() {
  const { data: alertsData, isLoading: alertsLoading } = useListAlertEvents({ limit: 500 });
  const { data: analyticsData, isLoading: analyticsLoading } =
    useGetAlertAnalytics();

  const alerts: AlertEvent[] = useMemo(
    () => alertsData?.alerts ?? [],
    [alertsData],
  );

  const analyticsIndex = useMemo(() => {
    const rp = analyticsData?.rankingPrep;
    if (!rp) return null;
    return buildAnalyticsIndex(rp);
  }, [analyticsData]);

  const getCtx = useMemo(() => {
    if (!analyticsIndex) return undefined;
    return (alert: AlertEvent) =>
      buildRankingContext(alert as AlertEvent & { ruleName?: string | null }, analyticsIndex);
  }, [analyticsIndex]);

  const comparisons = useMemo(
    () => compareAlertRankings(alerts, getCtx),
    [alerts, getCtx],
  );

  const metrics = useMemo(
    () => computeRankingMetrics(comparisons, alerts),
    [comparisons, alerts],
  );

  const movedUp = comparisons.filter((c) => c.scoreDelta > 0);
  const movedDown = comparisons.filter((c) => c.scoreDelta < 0);
  const unchanged = comparisons.filter((c) => c.scoreDelta === 0);

  const isLoading = alertsLoading || analyticsLoading;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart2 className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold font-mono">Ranking Evaluation</h1>
            <Badge
              variant="outline"
              className="text-[10px] font-mono text-amber-400 border-amber-500/50"
            >
              Internal
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground font-mono">
            Baseline vs analytics-informed score comparison ·{" "}
            <span className="text-primary">
              {RANKING_MODE === "analytics-informed"
                ? "Analytics-informed mode active"
                : "Baseline mode active"}
            </span>
          </p>
        </div>

        <Separator />

        {isLoading && (
          <p className="text-sm font-mono text-muted-foreground animate-pulse">
            Loading alert and analytics data…
          </p>
        )}

        {!isLoading && alerts.length === 0 && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm font-mono">No alerts found.</p>
          </div>
        )}

        {!isLoading && alerts.length > 0 && (
          <>
            {/* Aggregate metrics */}
            <div>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide mb-2">
                Aggregate metrics
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard
                  label="Alerts evaluated"
                  value={metrics.totalAlerts}
                />
                <MetricCard
                  label="Adjusted"
                  value={metrics.adjustedCount}
                  sub={pct(metrics.adjustedFraction) + " of total"}
                />
                <MetricCard
                  label="Avg positive Δ"
                  value={
                    metrics.averagePositiveAdjustment > 0
                      ? `+${metrics.averagePositiveAdjustment.toFixed(1)}`
                      : "–"
                  }
                  sub={`${metrics.boostedCount} boosted`}
                />
                <MetricCard
                  label="Avg negative Δ"
                  value={
                    metrics.averageNegativeAdjustment < 0
                      ? metrics.averageNegativeAdjustment.toFixed(1)
                      : "–"
                  }
                  sub={`${metrics.penalisedCount} penalised`}
                />
              </div>
            </div>

            {/* Top boosted event types + top penalised rules */}
            {(metrics.topBoostedEventTypes.length > 0 ||
              metrics.topPenalisedRules.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {metrics.topBoostedEventTypes.length > 0 && (
                  <div>
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide mb-2">
                      Top boosted event types
                    </p>
                    <div className="space-y-1">
                      {metrics.topBoostedEventTypes.slice(0, 5).map((et) => (
                        <div
                          key={et.eventType}
                          className="flex items-center justify-between text-xs font-mono"
                        >
                          <span className="text-foreground capitalize">
                            {et.eventType.replace(/_/g, " ")}
                          </span>
                          <span className="text-green-400 font-medium">
                            +{et.totalBoost} pts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {metrics.topPenalisedRules.length > 0 && (
                  <div>
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide mb-2">
                      Top penalised rules
                    </p>
                    <div className="space-y-1">
                      {metrics.topPenalisedRules.slice(0, 5).map((r) => (
                        <div
                          key={r.ruleName}
                          className="flex items-center justify-between text-xs font-mono"
                        >
                          <span className="text-foreground">{r.ruleName}</span>
                          <span className="text-destructive font-medium">
                            −{r.totalPenalty} pts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Summary counts */}
            <div className="flex gap-4 text-xs font-mono">
              <span className="text-green-400">▲ {movedUp.length} moved up</span>
              <span className="text-destructive">▼ {movedDown.length} moved down</span>
              <span className="text-muted-foreground">= {unchanged.length} unchanged</span>
            </div>

            {/* Comparison table */}
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="py-2 px-3 text-left text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                      Alert
                    </th>
                    <th className="py-2 px-3 text-left text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                      Issuer
                    </th>
                    <th className="py-2 px-3 text-right text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                      Baseline
                    </th>
                    <th className="py-2 px-3 text-right text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                      Analytics
                    </th>
                    <th className="py-2 px-3 text-right text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                      Δ
                    </th>
                    <th className="py-2 px-3 text-left text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                      Factors
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* Moved up */}
                  {movedUp.length > 0 && (
                    <>
                      <tr>
                        <td
                          colSpan={6}
                          className="py-1.5 px-3 text-[10px] font-mono text-green-400/70 uppercase tracking-wide bg-green-950/10"
                        >
                          ▲ Moved Up
                        </td>
                      </tr>
                      {movedUp.map((c) => (
                        <ComparisonRow key={c.alertId} c={c} />
                      ))}
                    </>
                  )}
                  {/* Moved down */}
                  {movedDown.length > 0 && (
                    <>
                      <tr>
                        <td
                          colSpan={6}
                          className="py-1.5 px-3 text-[10px] font-mono text-destructive/70 uppercase tracking-wide bg-red-950/10"
                        >
                          ▼ Moved Down
                        </td>
                      </tr>
                      {movedDown.map((c) => (
                        <ComparisonRow key={c.alertId} c={c} />
                      ))}
                    </>
                  )}
                  {/* Unchanged */}
                  {unchanged.length > 0 && (
                    <>
                      <tr>
                        <td
                          colSpan={6}
                          className="py-1.5 px-3 text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wide bg-secondary/10"
                        >
                          = Unchanged
                        </td>
                      </tr>
                      {unchanged.map((c) => (
                        <ComparisonRow key={c.alertId} c={c} />
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
