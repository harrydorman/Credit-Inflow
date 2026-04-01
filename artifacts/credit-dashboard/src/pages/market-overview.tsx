import { useGetMarketOverview, useGetTrends, useListArticles } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TrendingDown, TrendingUp, Minus, AlertTriangle, AlertOctagon,
  Shield, Activity, BarChart3, ChevronRight, Zap, Building,
  ArrowRight, AlertCircle
} from "lucide-react";

function MarketDirectionBanner({ direction, hygMove, lqdMove }: {
  direction: string;
  hygMove: number | null | undefined;
  lqdMove: number | null | undefined;
}) {
  const directionConfig: Record<string, { label: string; color: string; bg: string; icon: JSX.Element }> = {
    "risk-off": {
      label: "RISK-OFF",
      color: "text-red-400",
      bg: "bg-red-950/30 border-red-800/50",
      icon: <TrendingDown className="h-5 w-5 text-red-400" />,
    },
    "risk-on": {
      label: "RISK-ON",
      color: "text-emerald-400",
      bg: "bg-emerald-950/20 border-emerald-800/40",
      icon: <TrendingUp className="h-5 w-5 text-emerald-400" />,
    },
    "cautious": {
      label: "CAUTIOUS",
      color: "text-amber-400",
      bg: "bg-amber-950/20 border-amber-800/40",
      icon: <AlertCircle className="h-5 w-5 text-amber-400" />,
    },
    "stable": {
      label: "STABLE",
      color: "text-muted-foreground",
      bg: "bg-secondary/50 border-border",
      icon: <Minus className="h-5 w-5 text-muted-foreground" />,
    },
    "neutral": {
      label: "NEUTRAL",
      color: "text-muted-foreground",
      bg: "bg-secondary/50 border-border",
      icon: <Minus className="h-5 w-5 text-muted-foreground" />,
    },
  };

  const cfg = directionConfig[direction] ?? directionConfig.neutral;

  const MoveCell = ({ label, move }: { label: string; move: number | null | undefined }) => (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-muted-foreground">{label}</span>
      {move != null ? (
        <span className={`font-mono font-bold text-sm ${move < 0 ? "text-red-400" : move > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
          {move > 0 ? "+" : ""}{move.toFixed(2)}%
        </span>
      ) : (
        <span className="text-muted-foreground text-xs font-mono">N/A</span>
      )}
    </div>
  );

  return (
    <div className={`flex items-center justify-between p-4 rounded-lg border ${cfg.bg}`}>
      <div className="flex items-center gap-3">
        {cfg.icon}
        <div>
          <div className="text-[10px] font-mono text-muted-foreground">MARKET REGIME</div>
          <div className={`font-bold font-mono text-lg tracking-widest ${cfg.color}`}>{cfg.label}</div>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <MoveCell label="HYG" move={hygMove} />
        <div className="w-px h-6 bg-border" />
        <MoveCell label="LQD" move={lqdMove} />
      </div>
    </div>
  );
}

function RiskTile({ label, value, sublabel, color }: {
  label: string; value: string | number; sublabel?: string; color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col">
      <div className="text-[10px] font-mono text-muted-foreground mb-1">{label}</div>
      <div className={`font-bold font-mono text-2xl ${color ?? "text-foreground"}`}>{value}</div>
      {sublabel && <div className="text-[10px] font-mono text-muted-foreground mt-1">{sublabel}</div>}
    </div>
  );
}

function ConditionBadge({ condition }: { condition: string }) {
  if (condition === "deteriorating") {
    return (
      <div className="flex items-center gap-2 bg-red-950/30 border border-red-800/50 rounded-lg px-4 py-3">
        <AlertTriangle className="h-5 w-5 text-red-400" />
        <div>
          <div className="text-[10px] font-mono text-muted-foreground">MARKET CONDITION</div>
          <div className="font-bold font-mono text-red-400 tracking-wider">DETERIORATING</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 bg-emerald-950/20 border border-emerald-800/40 rounded-lg px-4 py-3">
      <Shield className="h-5 w-5 text-emerald-400" />
      <div>
        <div className="text-[10px] font-mono text-muted-foreground">MARKET CONDITION</div>
        <div className="font-bold font-mono text-emerald-400 tracking-wider">STABLE</div>
      </div>
    </div>
  );
}

function TopRiskCard({ risk, rank }: {
  risk: {
    sector: string; negativeCount: number; articleCount: number;
    avgUrgency: number; hasDowngrade: boolean; hasCovenant: boolean; reason: string;
  };
  rank: number;
}) {
  const urgencyColor = risk.avgUrgency >= 7 ? "text-red-400" : risk.avgUrgency >= 5 ? "text-amber-400" : "text-muted-foreground";
  return (
    <Link href={`/sectors?sector=${encodeURIComponent(risk.sector)}`}>
      <div className="flex items-start gap-4 p-4 bg-card border border-border rounded-lg hover:border-primary/40 hover:bg-card/80 transition-all cursor-pointer group">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-secondary flex items-center justify-center font-bold font-mono text-sm text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
          {rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold font-mono text-sm text-foreground">{risk.sector.toUpperCase()}</span>
            {risk.hasCovenant && (
              <Badge variant="outline" className="text-[9px] font-mono text-red-400 border-red-800/50 bg-red-950/20 px-1 py-0">
                COVENANT
              </Badge>
            )}
            {risk.hasDowngrade && (
              <Badge variant="outline" className="text-[9px] font-mono text-orange-400 border-orange-800/50 bg-orange-950/20 px-1 py-0">
                DOWNGRADE
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed truncate">{risk.reason}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className={`font-bold font-mono text-lg ${urgencyColor}`}>{risk.avgUrgency}</div>
          <div className="text-[9px] font-mono text-muted-foreground">AVG RISK</div>
          <div className="text-[9px] font-mono text-muted-foreground mt-0.5">{risk.negativeCount}/{risk.articleCount} neg</div>
        </div>
      </div>
    </Link>
  );
}

function TrendHighlightCard({ trend }: {
  trend: { type: string; sector?: string | null; issuer?: string | null; signal: string; severity: string; trendStrength: string };
}) {
  const severityStyles: Record<string, string> = {
    critical: "border-red-700/60 bg-red-950/20",
    high: "border-amber-700/60 bg-amber-950/10",
    moderate: "border-border bg-card",
    watch: "border-yellow-800/40 bg-yellow-950/10",
  };
  const typeIcons: Record<string, string> = {
    sector_cluster: "⚡", issuer_deterioration: "⬇", refinancing_wave: "↺", downgrade_wave: "▼", emerging: "◎",
  };
  return (
    <div className={`p-3 rounded-lg border text-xs ${severityStyles[trend.severity] ?? severityStyles.moderate}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono">{typeIcons[trend.type] ?? "•"}</span>
        <span className="font-bold font-mono uppercase text-foreground">{trend.type.replace(/_/g, " ")}</span>
        {(trend.sector || trend.issuer) && (
          <span className="text-muted-foreground">— {trend.issuer ?? trend.sector}</span>
        )}
        <Badge variant="outline" className={`ml-auto text-[9px] font-mono ${trend.severity === "critical" ? "text-red-400 border-red-800/50" : trend.severity === "high" ? "text-amber-400 border-amber-800/50" : "text-muted-foreground border-border"}`}>
          {trend.severity.toUpperCase()}
        </Badge>
      </div>
      <p className="text-muted-foreground leading-relaxed">{trend.signal}</p>
    </div>
  );
}

function SectorHeatBar({ sector, negCount, total, avgUrgency }: {
  sector: string; negCount: number; total: number; avgUrgency: number;
}) {
  const ratio = total > 0 ? negCount / total : 0;
  const barColor = ratio >= 0.5 ? "bg-red-500" : ratio >= 0.3 ? "bg-amber-500" : "bg-emerald-600";
  return (
    <Link href={`/sectors?sector=${encodeURIComponent(sector)}`}>
      <div className="flex items-center gap-3 group cursor-pointer hover:bg-secondary/30 px-2 py-1.5 rounded transition-colors">
        <div className="w-28 text-[10px] font-mono text-muted-foreground truncate group-hover:text-foreground transition-colors">{sector}</div>
        <div className="flex-1 bg-secondary rounded-full h-1.5">
          <div className={`${barColor} h-1.5 rounded-full transition-all`} style={{ width: `${Math.max(5, ratio * 100)}%` }} />
        </div>
        <div className="w-10 text-right text-[10px] font-mono text-muted-foreground">{negCount}/{total}</div>
        <div className={`w-6 text-right text-[10px] font-mono font-bold ${avgUrgency >= 6 ? "text-red-400" : avgUrgency >= 4 ? "text-amber-400" : "text-muted-foreground"}`}>{avgUrgency}</div>
      </div>
    </Link>
  );
}

export default function MarketOverview() {
  const { data, isLoading } = useGetMarketOverview();

  if (isLoading) {
    return (
      <Layout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-16 w-full" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </Layout>
    );
  }

  if (!data) {
    return (
      <Layout>
        <div className="p-6 text-center text-muted-foreground font-mono text-sm">
          Market overview unavailable. Trigger a refresh to load data.
        </div>
      </Layout>
    );
  }

  const { macro, riskSummary, topRisks, trendHighlights, sectorSignals } = data;

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-screen-xl mx-auto">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono tracking-tight">MARKET OVERVIEW</h1>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Top-down credit intelligence · {riskSummary.totalArticles72h} articles · 72h window
            </p>
          </div>
          <div className="text-xs font-mono text-muted-foreground">
            {new Date().toLocaleString()} UTC
          </div>
        </div>

        {/* Market direction banner */}
        <MarketDirectionBanner
          direction={macro.marketDirection}
          hygMove={macro.hyETF}
          lqdMove={macro.igETF}
        />

        {/* Risk summary row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="md:col-span-1">
            <ConditionBadge condition={riskSummary.overallCondition} />
          </div>
          <RiskTile
            label="NEGATIVE SIGNALS"
            value={riskSummary.negativeSignals}
            sublabel={`of ${riskSummary.processedArticles} processed`}
            color={riskSummary.negativeSignals >= 10 ? "text-red-400" : riskSummary.negativeSignals >= 5 ? "text-amber-400" : "text-foreground"}
          />
          <RiskTile
            label="DOWNGRADES"
            value={riskSummary.downgrades}
            sublabel="rating actions"
            color={riskSummary.downgrades >= 2 ? "text-red-400" : riskSummary.downgrades >= 1 ? "text-amber-400" : "text-foreground"}
          />
          <RiskTile
            label="COVENANT FLAGS"
            value={riskSummary.covenantFlags}
            sublabel="breach signals"
            color={riskSummary.covenantFlags >= 1 ? "text-red-400 animate-pulse" : "text-foreground"}
          />
          <RiskTile
            label="HIGH URGENCY"
            value={riskSummary.urgentArticles}
            sublabel="score ≥ 7/10"
            color={riskSummary.urgentArticles >= 3 ? "text-orange-400" : "text-foreground"}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Top Risks by Sector */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold font-mono text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                TOP RISKS BY SECTOR
              </h2>
              <Link href="/sectors">
                <span className="text-[10px] font-mono text-primary hover:underline flex items-center gap-1 cursor-pointer">
                  VIEW ALL <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
            {topRisks.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-xs font-mono border border-border rounded-lg">
                No elevated sector risks detected in the 72h window.
              </div>
            ) : (
              <div className="space-y-2">
                {topRisks.map((risk, i) => (
                  <TopRiskCard key={risk.sector} risk={risk} rank={i + 1} />
                ))}
              </div>
            )}

            {/* Trend Highlights */}
            {trendHighlights.length > 0 && (
              <>
                <div className="flex items-center justify-between pt-2">
                  <h2 className="text-sm font-bold font-mono text-muted-foreground flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    ACTIVE TREND SIGNALS
                  </h2>
                  <Link href="/signals">
                    <span className="text-[10px] font-mono text-primary hover:underline flex items-center gap-1 cursor-pointer">
                      FULL ANALYSIS <ArrowRight className="h-3 w-3" />
                    </span>
                  </Link>
                </div>
                <div className="space-y-2">
                  {trendHighlights.map((trend, i) => (
                    <TrendHighlightCard key={i} trend={trend} />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Right: Sector heatmap + quick nav */}
          <div className="space-y-4">

            {/* Sector heatmap */}
            <Card className="border-border">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-mono text-muted-foreground flex items-center gap-2">
                  <BarChart3 className="h-3 w-3" />
                  SECTOR RISK HEATMAP
                  <span className="text-[9px] ml-auto">neg/total · score</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-3">
                {sectorSignals
                  .filter((s) => s.totalArticles > 0)
                  .sort((a, b) => b.negativeCount - a.negativeCount)
                  .slice(0, 12)
                  .map((s) => (
                    <SectorHeatBar
                      key={s.sector}
                      sector={s.sector}
                      negCount={s.negativeCount}
                      total={s.totalArticles}
                      avgUrgency={Math.round(s.avgUrgency)}
                    />
                  ))}
                {sectorSignals.every((s) => s.totalArticles === 0) && (
                  <div className="text-center text-xs text-muted-foreground font-mono py-4">
                    No data yet — trigger a refresh
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick navigation */}
            <div className="grid grid-cols-1 gap-2">
              <Link href="/feed">
                <div className="flex items-center justify-between p-3 bg-card border border-border rounded-lg hover:border-primary/40 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    <span className="text-sm font-mono font-bold text-foreground">Live Feed</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
              <Link href="/issuers">
                <div className="flex items-center justify-between p-3 bg-card border border-border rounded-lg hover:border-primary/40 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-primary" />
                    <span className="text-sm font-mono font-bold text-foreground">Issuer Intelligence</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
              <Link href="/sectors">
                <div className="flex items-center justify-between p-3 bg-card border border-border rounded-lg hover:border-primary/40 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    <span className="text-sm font-mono font-bold text-foreground">Sector Analysis</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
              <Link href="/brief">
                <div className="flex items-center justify-between p-3 bg-card border border-border rounded-lg hover:border-primary/40 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    <span className="text-sm font-mono font-bold text-foreground">Daily Brief</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
