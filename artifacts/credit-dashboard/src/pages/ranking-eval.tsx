/**
 * pages/ranking-eval.tsx
 *
 * Phase 10: Internal ranking evaluation page.
 * Phase 11: Ranking Calibration + Time-Windowed Evaluation.
 * Phase 12: Ranking Calibration Recommendations + Historical Evaluation Snapshots.
 * Phase 13: Feedback-Aware Snapshot Metrics + Outcome Attribution.
 *
 * Compares baseline vs analytics-informed scores for alerts in the selected
 * time window, showing aggregate calibration metrics, recommendations, snapshot
 * history, and per-alert breakdowns.
 * This is an admin/internal page — not linked in the main navigation.
 */

import { useMemo, useState, useCallback } from "react";
import {
  useListAlertEvents,
  useGetAlertAnalytics,
  useCreateRankingEvalSnapshot,
  useListRankingEvalSnapshots,
} from "@workspace/api-client-react";
import type { AlertEvent, RankingEvalSnapshot } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  buildAnalyticsIndex,
  buildRankingContext,
  RANKING_MODE,
  RANKING_MODEL_VERSION,
  RANKING_CALIBRATION_CONFIG,
} from "@/lib/alertPriority";
import {
  compareAlertRankings,
  computeRankingMetrics,
  filterAlertsByTimeWindow,
  type AlertRankingComparison,
  type RankingAggregateMetrics,
  type TrendMetrics,
  type TimeWindow,
  TIME_WINDOW_LABELS,
} from "@/lib/rankingEvaluation";
import { getAllRecommendations } from "@/lib/rankingRecommendations";
import { compareSnapshots } from "@/lib/snapshotComparison";
import { computeOutcomeAttribution, type OutcomeAttributionSummary } from "@/lib/outcomeAttribution";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart2,
  AlertCircle,
  Settings2,
  Camera,
  History,
  Lightbulb,
  ArrowRightLeft,
  Target,
  ChevronDown,
  ChevronUp,
  Server,
  Layers,
} from "lucide-react";

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

/**
 * Build snapshot metrics from aggregate metrics and optional trend metrics.
 *
 * The three feedback-rate fields (usefulFeedbackRateAmongBoosted,
 * noiseRateAmongPenalised, investigateRateAmongPortfolioLinkedBoosted) come
 * from TrendMetrics, which requires feedback predicate functions not available
 * in the page at this stage.  When no trend is provided they default to 0 to
 * indicate "not measured", which the snapshot comparison surface correctly as
 * "unchanged" rather than worsened.
 */

function metricsFromAggregate(
  m: RankingAggregateMetrics,
  trend?: TrendMetrics | null,
) {
  return {
    totalAlerts: m.totalAlerts,
    adjustedFraction: m.adjustedFraction,
    averagePositiveAdjustment: m.averagePositiveAdjustment,
    averageNegativeAdjustment: m.averageNegativeAdjustment,
    // Populated from trend metrics when available; 0 = "not measured"
    usefulFeedbackRateAmongBoosted: trend?.usefulFeedbackRateAmongBoosted ?? 0,
    noiseRateAmongPenalised: trend?.noiseRateAmongPenalised ?? 0,
    investigateRateAmongPortfolioLinkedBoosted:
      trend?.investigateRateAmongPortfolioLinkedBoosted ?? 0,
    topBoostedEventTypes: m.topBoostedEventTypes,
    topPenalisedRules: m.topPenalisedRules,
    metricSource: "estimated" as const,
  };
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

// ─── calibration config panel ─────────────────────────────────────────────────

function CalibrationConfigPanel() {
  const cfg = RANKING_CALIBRATION_CONFIG;
  return (
    <div
      className="rounded-md border border-border bg-secondary/10 px-4 py-3 space-y-2"
      data-testid="calibration-config-panel"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
          Calibration config · model {RANKING_MODEL_VERSION}
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
        <div className="space-y-0.5">
          <p className="text-muted-foreground">Event type boost</p>
          <p className="text-foreground">
            threshold {cfg.eventTypeBoost.threshold} · max +{cfg.eventTypeBoost.max}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-muted-foreground">Issuer boost</p>
          <p className="text-foreground">
            threshold {cfg.issuerBoost.threshold} · max +{cfg.issuerBoost.max}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-muted-foreground">Rule noise penalty</p>
          <p className="text-foreground">
            threshold {cfg.ruleNoisePenalty.threshold} · max −{cfg.ruleNoisePenalty.max}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-muted-foreground">Total adj. cap</p>
          <p className="text-foreground">±{cfg.totalAdjustmentCap} pts</p>
        </div>
      </div>
    </div>
  );
}

// ─── time window selector ─────────────────────────────────────────────────────

function TimeWindowSelector({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: (w: TimeWindow) => void;
}) {
  const windows: TimeWindow[] = ["7d", "30d", "all"];
  return (
    <div className="flex gap-1" data-testid="time-window-selector">
      {windows.map((w) => (
        <button
          key={w}
          onClick={() => onChange(w)}
          className={`px-2.5 py-1 rounded text-[11px] font-mono border transition-colors ${
            value === w
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-secondary/30 text-muted-foreground border-border hover:bg-secondary/50"
          }`}
        >
          {TIME_WINDOW_LABELS[w]}
        </button>
      ))}
    </div>
  );
}

// ─── recommendations panel ────────────────────────────────────────────────────

function RecommendationsPanel({ metrics }: { metrics: RankingAggregateMetrics }) {
  const recs = useMemo(() => getAllRecommendations(metrics), [metrics]);

  if (recs.length === 0) return null;

  const severityStyles: Record<string, string> = {
    action: "border-destructive/50 bg-destructive/5 text-destructive",
    warning: "border-amber-500/50 bg-amber-950/10 text-amber-400",
    info: "border-border bg-secondary/10 text-muted-foreground",
  };

  return (
    <div data-testid="recommendations-panel">
      <div className="flex items-center gap-1.5 mb-2">
        <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
          Calibration recommendations
        </p>
        <span className="text-[10px] font-mono text-muted-foreground">
          ({recs.length})
        </span>
      </div>
      <div className="space-y-2" data-testid="recommendations-list">
        {recs.map((rec, i) => (
          <div
            key={i}
            className={`rounded-md border px-3 py-2.5 space-y-1 ${severityStyles[rec.severity] ?? severityStyles.info}`}
            data-testid={`recommendation-item-${rec.severity}`}
          >
            <p className="text-[11px] font-mono font-semibold">{rec.title}</p>
            <p className="text-[11px] font-mono opacity-80">{rec.detail}</p>
            <p className="text-[11px] font-mono opacity-70">
              <span className="font-semibold">Suggestion:</span> {rec.suggestion}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── outcome attribution panel ────────────────────────────────────────────────

function OutcomeAttributionPanel({
  attribution,
}: {
  attribution: OutcomeAttributionSummary;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-md border border-border bg-secondary/10 px-4 py-3 space-y-3"
      data-testid="outcome-attribution-panel"
    >
      <div className="flex items-center gap-1.5">
        <Target className="h-3.5 w-3.5 text-primary" />
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
          Outcome attribution
        </p>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
          data-testid="attribution-expand-button"
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricCard
          label="Boosted alerts"
          value={attribution.boostedCount}
          sub={`of ${attribution.totalAlerts} total`}
        />
        <MetricCard
          label="Boosted → investigated"
          value={pct(attribution.boostedInvestigateRate)}
          sub={`${attribution.boostedInvestigatedCount} alerts`}
        />
        <MetricCard
          label="Penalised alerts"
          value={attribution.penalisedCount}
          sub={`of ${attribution.totalAlerts} total`}
        />
        <MetricCard
          label="Penalised → noise"
          value={pct(attribution.penalisedNoiseRate)}
          sub={`${attribution.penalisedNoiseCount} alerts`}
        />
      </div>

      {/* Expanded breakdown */}
      {expanded && (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1"
          data-testid="attribution-detail"
        >
          {attribution.topBoostedInvestigatedEventTypes.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide mb-2">
                Top boosted event types → investigated
              </p>
              <div className="space-y-1">
                {attribution.topBoostedInvestigatedEventTypes.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between text-xs font-mono"
                  >
                    <span className="text-foreground capitalize">
                      {row.label.replace(/_/g, " ")}
                    </span>
                    <span className="text-green-400">
                      {pct(row.favourableRate)}{" "}
                      <span className="text-muted-foreground">
                        ({row.favourableCount}/{row.count})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {attribution.topPenalisedNoisyRules.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide mb-2">
                Top penalised rules → noise
              </p>
              <div className="space-y-1">
                {attribution.topPenalisedNoisyRules.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between text-xs font-mono"
                  >
                    <span className="text-foreground">{row.label}</span>
                    <span className="text-destructive">
                      {pct(row.favourableRate)}{" "}
                      <span className="text-muted-foreground">
                        ({row.favourableCount}/{row.count})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {attribution.topBoostedInvestigatedEventTypes.length === 0 &&
            attribution.topPenalisedNoisyRules.length === 0 && (
              <p className="text-[11px] font-mono text-muted-foreground col-span-2">
                No outcome data available — alerts need workflow or feedback actions first.
              </p>
            )}
        </div>
      )}
    </div>
  );
}

// ─── snapshot comparison panel ────────────────────────────────────────────────

function SnapshotComparisonPanel({
  currentMetrics,
  snapshot,
  timeWindow,
}: {
  currentMetrics: RankingAggregateMetrics;
  snapshot: RankingEvalSnapshot;
  timeWindow: TimeWindow;
}) {
  const comparison = useMemo(
    () =>
      compareSnapshots(
        snapshot.metricsJson,
        metricsFromAggregate(currentMetrics),
        snapshot.rankingModelVersion,
        RANKING_MODEL_VERSION,
        TIME_WINDOW_LABELS[timeWindow],
      ),
    [currentMetrics, snapshot, timeWindow],
  );

  const assessmentStyle: Record<string, string> = {
    improved: "text-green-400",
    worsened: "text-destructive",
    mixed: "text-amber-400",
    unchanged: "text-muted-foreground",
  };

  const signalKeys = [
    { key: "usefulFeedbackRateAmongBoosted" as const, label: "Useful feedback rate (boosted)" },
    { key: "noiseRateAmongPenalised" as const, label: "Noise rate (penalised)" },
    { key: "investigateRateAmongPortfolioLinkedBoosted" as const, label: "Investigate rate (portfolio-linked)" },
  ];

  return (
    <div
      className="rounded-md border border-border bg-secondary/10 px-4 py-3 space-y-3"
      data-testid="snapshot-comparison-panel"
    >
      <div className="flex items-center gap-1.5">
        <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
          Comparison vs snapshot {snapshot.id} ({snapshot.rankingModelVersion} ·{" "}
          {new Date(snapshot.createdAt).toLocaleDateString()})
        </p>
        <span
          className={`text-[10px] font-mono font-semibold ml-auto ${assessmentStyle[comparison.overallAssessment]}`}
          data-testid="comparison-overall-assessment"
        >
          {comparison.overallAssessment}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {signalKeys.map(({ key, label }) => {
          const d = comparison.signalDeltas[key];
          return (
            <div key={key} className="space-y-0.5 text-[11px] font-mono">
              <p className="text-muted-foreground">{label}</p>
              <div className="flex items-center gap-1">
                <span className="text-foreground">{pct(d.currentValue)}</span>
                <DeltaIcon delta={d.direction === "improved" ? 1 : d.direction === "worsened" ? -1 : 0} />
                <span
                  className={
                    d.direction === "improved"
                      ? "text-green-400"
                      : d.direction === "worsened"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {d.delta >= 0 ? "+" : ""}
                  {pct(d.delta)} vs snapshot
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Comparison reasoning */}
      <div
        className="space-y-0.5 border-t border-border/30 pt-2"
        data-testid="comparison-explanations"
      >
        {comparison.explanations.map((explanation, i) => (
          <p key={i} className="text-[11px] font-mono text-muted-foreground">
            {explanation}
          </p>
        ))}
      </div>
    </div>
  );
}

// ─── snapshots panel ──────────────────────────────────────────────────────────

function SnapshotsPanel({ timeWindow }: { timeWindow: TimeWindow }) {
  const { data, isLoading, refetch } = useListRankingEvalSnapshots({ timeWindow });
  const snapshots = data?.snapshots ?? [];

  return (
    <div data-testid="snapshots-panel">
      <div className="flex items-center gap-1.5 mb-2">
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
          Recent snapshots · {TIME_WINDOW_LABELS[timeWindow]}
        </p>
        <button
          onClick={() => refetch()}
          className="ml-auto text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
          data-testid="refresh-snapshots-button"
        >
          refresh
        </button>
      </div>
      {isLoading && (
        <p className="text-[11px] font-mono text-muted-foreground animate-pulse">
          Loading snapshots…
        </p>
      )}
      {!isLoading && snapshots.length === 0 && (
        <p className="text-[11px] font-mono text-muted-foreground" data-testid="no-snapshots-message">
          No snapshots saved yet for this window.
        </p>
      )}
      {!isLoading && snapshots.length > 0 && (
        <div className="space-y-1" data-testid="snapshots-list">
          {snapshots.slice(0, 5).map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between text-[11px] font-mono py-1 border-b border-border/30"
              data-testid={`snapshot-row-${s.id}`}
            >
              <span className="text-muted-foreground">
                #{s.id} · {s.rankingModelVersion} · {s.snapshotType}
                {s.metricsJson.metricSource === "server-computed" && (
                  <span className="ml-1 text-primary/70">[server]</span>
                )}
              </span>
              <span className="text-foreground">
                {pct(s.metricsJson.adjustedFraction)} adj ·{" "}
                {s.metricsJson.totalAlerts} alerts ·{" "}
                {new Date(s.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

/** Save mode: frontend-estimated metrics vs server-computed metrics. */
type SaveMode = "estimated" | "server-computed";

export default function RankingEvalPage() {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");
  const [snapshotSaved, setSnapshotSaved] = useState(false);
  const [saveMode, setSaveMode] = useState<SaveMode>("estimated");

  const { data: alertsData, isLoading: alertsLoading } = useListAlertEvents({ limit: 500 });
  const { data: analyticsData, isLoading: analyticsLoading } =
    useGetAlertAnalytics();
  const { data: snapshotsData, refetch: refetchSnapshots } = useListRankingEvalSnapshots(
    { timeWindow },
  );

  const createSnapshot = useCreateRankingEvalSnapshot();

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

  // Apply time-window filter before computing comparisons
  const windowedAlerts = useMemo(
    () => filterAlertsByTimeWindow(alerts, timeWindow),
    [alerts, timeWindow],
  );

  const comparisons = useMemo(
    () => compareAlertRankings(windowedAlerts, getCtx),
    [windowedAlerts, getCtx],
  );

  const metrics = useMemo(
    () => computeRankingMetrics(comparisons, windowedAlerts),
    [comparisons, windowedAlerts],
  );

  // Outcome attribution (pure, from comparisons + alert data)
  const attribution = useMemo(
    () =>
      computeOutcomeAttribution(
        comparisons,
        windowedAlerts as (AlertEvent & { ruleName?: string | null })[],
      ),
    [comparisons, windowedAlerts],
  );

  const movedUp = comparisons.filter((c) => c.scoreDelta > 0);
  const movedDown = comparisons.filter((c) => c.scoreDelta < 0);
  const unchanged = comparisons.filter((c) => c.scoreDelta === 0);

  const isLoading = alertsLoading || analyticsLoading;

  // Most recent snapshot for the current window (for side-by-side comparison)
  const mostRecentSnapshot: RankingEvalSnapshot | null = useMemo(() => {
    const snaps = snapshotsData?.snapshots ?? [];
    return snaps.length > 0 ? snaps[0] : null;
  }, [snapshotsData]);

  const handleSaveSnapshot = useCallback(async () => {
    if (metrics.totalAlerts === 0) return;

    if (saveMode === "server-computed") {
      // Send without metrics — server will compute them from DB
      await createSnapshot.mutateAsync({
        rankingModelVersion: RANKING_MODEL_VERSION,
        timeWindow,
        metrics: undefined,
      });
    } else {
      await createSnapshot.mutateAsync({
        rankingModelVersion: RANKING_MODEL_VERSION,
        timeWindow,
        metrics: metricsFromAggregate(metrics),
      });
    }

    setSnapshotSaved(true);
    refetchSnapshots();
    setTimeout(() => setSnapshotSaved(false), 3000);
  }, [metrics, timeWindow, createSnapshot, refetchSnapshots, saveMode]);

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
            <Badge
              variant="outline"
              className="text-[10px] font-mono text-muted-foreground border-border"
              data-testid="model-version-badge"
            >
              {RANKING_MODEL_VERSION}
            </Badge>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-muted-foreground font-mono">
              Baseline vs analytics-informed score comparison ·{" "}
              <span className="text-primary">
                {RANKING_MODE === "analytics-informed"
                  ? "Analytics-informed mode active"
                  : "Baseline mode active"}
              </span>
            </p>
            <TimeWindowSelector value={timeWindow} onChange={setTimeWindow} />
          </div>
        </div>

        <Separator />

        {/* Calibration config */}
        <CalibrationConfigPanel />

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

        {!isLoading && alerts.length > 0 && windowedAlerts.length === 0 && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm font-mono">
              No alerts in the selected time window ({TIME_WINDOW_LABELS[timeWindow]}).
            </p>
          </div>
        )}

        {!isLoading && windowedAlerts.length > 0 && (
          <>
            {/* Aggregate metrics + save snapshot controls */}
            <div>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                    Aggregate metrics · {TIME_WINDOW_LABELS[timeWindow]}
                  </p>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono text-muted-foreground border-border"
                    data-testid="metric-source-badge"
                  >
                    <Layers className="h-3 w-3 mr-1" />
                    {saveMode === "server-computed" ? "server-computed" : "estimated"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  {/* Save mode toggle */}
                  <div
                    className="flex items-center gap-0.5 rounded border border-border overflow-hidden"
                    data-testid="save-mode-toggle"
                  >
                    <button
                      onClick={() => setSaveMode("estimated")}
                      className={`px-2 py-1 text-[10px] font-mono transition-colors ${
                        saveMode === "estimated"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary/30 text-muted-foreground hover:bg-secondary/50"
                      }`}
                      data-testid="save-mode-estimated"
                    >
                      <Layers className="h-3 w-3 inline mr-0.5" />
                      Current view
                    </button>
                    <button
                      onClick={() => setSaveMode("server-computed")}
                      className={`px-2 py-1 text-[10px] font-mono transition-colors ${
                        saveMode === "server-computed"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary/30 text-muted-foreground hover:bg-secondary/50"
                      }`}
                      data-testid="save-mode-server"
                    >
                      <Server className="h-3 w-3 inline mr-0.5" />
                      Server-compute
                    </button>
                  </div>
                  <button
                    onClick={handleSaveSnapshot}
                    disabled={createSnapshot.isPending}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono border border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors disabled:opacity-50"
                    data-testid="save-snapshot-button"
                  >
                    <Camera className="h-3 w-3" />
                    {snapshotSaved ? "Saved!" : createSnapshot.isPending ? "Saving…" : "Save snapshot"}
                  </button>
                </div>
              </div>
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

            {/* Recommendations */}
            <RecommendationsPanel metrics={metrics} />

            {/* Outcome attribution */}
            <OutcomeAttributionPanel attribution={attribution} />

            {/* Snapshot comparison */}
            {mostRecentSnapshot && (
              <SnapshotComparisonPanel
                currentMetrics={metrics}
                snapshot={mostRecentSnapshot}
                timeWindow={timeWindow}
              />
            )}

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

            {/* Recent snapshots */}
            <SnapshotsPanel timeWindow={timeWindow} />

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
