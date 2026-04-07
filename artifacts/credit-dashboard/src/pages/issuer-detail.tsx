import { useParams, Link } from "wouter";
import { decodeHtml } from "@/lib/decode-html";
import { useQuery } from "@tanstack/react-query";
import { useListAlertEvents } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Building,
  TrendingDown,
  TrendingUp,
  Minus,
  AlertTriangle,
  AlertOctagon,
  ChevronLeft,
  FileText,
  Target,
  Zap,
  Shield,
  Clock,
  ShieldAlert,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { SeverityBadge, PriorityBadge } from "@/components/alerts";
import { getAlertPriority } from "@/lib/alertPriority";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SignalTimePoint {
  date: string;
  signalCount: number;
  avgUrgency: number;
}

interface IssuerDetailData {
  issuerName: string;
  snapshot: {
    issuerName: string;
    sector: string | null;
    trend: "deteriorating" | "stable" | "improving";
    riskLevel: "high" | "medium" | "low";
    negativeSignalRatio: number;
    dominantSignal: string;
    trustLabel: "high" | "medium" | "low";
    summary: string;
    keyDrivers: string[];
    keyRisks: string[];
    signalTimeSeries?: SignalTimePoint[];
  };
  totalArticles: number;
  negativeCount: number;
  covenantFlag: boolean;
  maxUrgency: number;
  articles: {
    id: number;
    title: string;
    source: string;
    publishedAt: string;
    url: string;
    summary: string | null;
    sector: string | null;
    eventType: string | null;
    sentiment: string | null;
    urgencyScore: number | null;
    finalUrgencyScore: number | null;
    covenantFlag: boolean;
    ratingMentioned: string | null;
    ratingAgency: string | null;
    marketImpact: string | null;
    tradeDirection: string | null;
    signalStrength: number;
    trustProfile: { trustScore: number; trustLabel: string; sourceTier: string };
    signalCard: { signalType: string; signalLabel: string; confidence: string };
    creditSummaryJson: {
      situation: string;
      creditDrivers: string[];
      riskFactors: string[];
      keyMetricsMentioned: string[];
      bottomLine: string;
    } | null;
  }[];
  tradeImplications: {
    articleId: number;
    title: string;
    publishedAt: string;
    tradeDirection: string | null;
    tradeRationale: string | null;
    potentialTrades: string[];
    marketsImpacted: string[];
    finalUrgencyScore: number | null;
  }[];
  creditSummaries: {
    articleId: number;
    title: string;
    publishedAt: string;
    creditSummary: {
      situation: string;
      creditDrivers: string[];
      riskFactors: string[];
      keyMetricsMentioned: string[];
      bottomLine: string;
    } | null;
    scoreExplanation: { creditRisk: string; marketSignal: string; cloImpact: string } | null;
    signalCard: { signalType: string; signalLabel: string; whyNow: string; confidence: string; creditImplications: string } | null;
    urgency: number | null;
  }[];
}

function useIssuerDetail(name: string) {
  return useQuery<IssuerDetailData>({
    queryKey: ["issuer-detail", name],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/issuers/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error("Issuer not found");
      return res.json();
    },
    enabled: !!name,
  });
}

function getRiskLevelColor(level: string) {
  if (level === "high") return "text-destructive";
  if (level === "medium") return "text-amber-500";
  return "text-green-500";
}

function getRiskLevelBg(level: string) {
  if (level === "high") return "bg-red-950/30 border-red-800/50";
  if (level === "medium") return "bg-orange-950/20 border-orange-800/30";
  return "bg-green-950/10 border-green-800/20";
}

function getTrendIcon(trend: string) {
  if (trend === "deteriorating") return <TrendingDown className="h-5 w-5 text-red-400" />;
  if (trend === "improving") return <TrendingUp className="h-5 w-5 text-green-400" />;
  return <Minus className="h-5 w-5 text-muted-foreground" />;
}

function getSentimentColor(sentiment: string | null) {
  if (sentiment === "negative") return "text-destructive";
  if (sentiment === "positive") return "text-green-400";
  return "text-muted-foreground";
}

function getUrgencyColor(score: number) {
  if (score >= 8) return "bg-red-600 text-white";
  if (score >= 6) return "bg-orange-500 text-white";
  if (score >= 4) return "bg-amber-500 text-black";
  return "bg-secondary text-muted-foreground";
}

function SignalSparkline({ series }: { series: SignalTimePoint[] }) {
  if (!series || series.length === 0) return null;
  const W = 280;
  const H = 44;
  const PAD = 4;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  const maxUrgency = Math.max(...series.map((p) => p.avgUrgency), 1);
  const maxCount = Math.max(...series.map((p) => p.signalCount), 1);
  const n = series.length;

  const barW = innerW / n - 1;
  const urgencyPoints = series
    .map((p, i) => {
      const x = PAD + i * (innerW / n) + barW / 2;
      const y = PAD + innerH - (p.avgUrgency / maxUrgency) * innerH;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div>
      <p className="text-[10px] font-mono text-muted-foreground mb-1">SIGNAL ACTIVITY · 14D</p>
      <svg width={W} height={H} className="overflow-visible">
        {series.map((p, i) => {
          const x = PAD + i * (innerW / n);
          const barH = (p.signalCount / maxCount) * innerH;
          return (
            <rect
              key={p.date}
              x={x + 0.5}
              width={barW}
              y={PAD + innerH - barH}
              height={barH}
              fill={p.signalCount > 0 ? "hsl(var(--primary) / 0.25)" : "transparent"}
              rx={1}
            />
          );
        })}
        {series.some((p) => p.avgUrgency > 0) && (
          <polyline
            points={urgencyPoints}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {series.map((p, i) => {
          if (p.avgUrgency === 0) return null;
          const x = PAD + i * (innerW / n) + barW / 2;
          const y = PAD + innerH - (p.avgUrgency / maxUrgency) * innerH;
          return <circle key={p.date} cx={x} cy={y} r={2} fill="hsl(var(--primary))" />;
        })}
      </svg>
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-0.5 w-[280px]">
        <span>{series[0]?.date?.slice(5)}</span>
        <span className="text-primary/70">AVG URGENCY TREND</span>
        <span>{series[series.length - 1]?.date?.slice(5)}</span>
      </div>
    </div>
  );
}

export default function IssuerDetail() {
  const params = useParams<{ name: string }>();
  const name = decodeURIComponent(params.name ?? "");
  const { data, isLoading, error } = useIssuerDetail(name);

  // Fetch recent alerts for this issuer
  const { data: alertsData } = useListAlertEvents({
    issuerName: name,
    limit: 10,
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-[300px] w-full" />
        </div>
      </Layout>
    );
  }

  if (error || !data) {
    return (
      <Layout>
        <div className="max-w-6xl mx-auto p-6">
          <Link href="/issuers" className="flex items-center text-muted-foreground hover:text-foreground mb-6">
            <ChevronLeft className="h-4 w-4 mr-1" /> Back to Issuers
          </Link>
          <div className="text-center py-12 text-muted-foreground">Issuer not found.</div>
        </div>
      </Layout>
    );
  }

  const { snapshot } = data;

  return (
    <Layout>
      <div className="max-w-6xl mx-auto p-6 lg:p-8 space-y-8">
        <div>
          <Link href="/issuers" className="flex items-center text-xs font-mono text-muted-foreground hover:text-foreground mb-4 w-fit">
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> ISSUER INTELLIGENCE
          </Link>

          <div className="flex flex-wrap justify-between items-start gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <Building className="h-8 w-8 text-primary shrink-0" />
                {data.issuerName}
              </h1>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {snapshot.sector && (
                  <Badge variant="outline" className="font-mono text-xs bg-secondary/50">
                    {snapshot.sector.toUpperCase()}
                  </Badge>
                )}
                <div className={`flex items-center gap-1.5 text-sm font-mono font-bold ${getRiskLevelColor(snapshot.riskLevel)}`}>
                  {getTrendIcon(snapshot.trend)}
                  {snapshot.riskLevel.toUpperCase()} RISK — {snapshot.trend.toUpperCase()}
                </div>
                {data.covenantFlag && (
                  <Badge className="bg-red-600 text-white font-bold animate-pulse text-xs">
                    ⚠ COVENANT FLAG
                  </Badge>
                )}
                <AddToWatchlistButton issuerName={data.issuerName} />
              </div>
            </div>

            <div className="flex flex-wrap gap-6 items-start">
              <div className="flex gap-6 text-right">
                <div>
                  <div className="text-[10px] font-mono text-muted-foreground">ARTICLES</div>
                  <div className="text-2xl font-mono font-bold">{data.totalArticles}</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono text-muted-foreground">NEGATIVE</div>
                  <div className={`text-2xl font-mono font-bold ${data.negativeCount > 0 ? "text-destructive" : "text-green-500"}`}>
                    {data.negativeCount}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono text-muted-foreground">MAX URGENCY</div>
                  <div className={`text-2xl font-mono font-bold ${data.maxUrgency >= 7 ? "text-destructive" : data.maxUrgency >= 4 ? "text-amber-500" : ""}`}>
                    {data.maxUrgency}/10
                  </div>
                </div>
              </div>
              {snapshot.signalTimeSeries && snapshot.signalTimeSeries.length > 0 && (
                <div className="border-l border-border pl-6">
                  <SignalSparkline series={snapshot.signalTimeSeries} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={`rounded-lg border p-5 ${getRiskLevelBg(snapshot.riskLevel)}`}>
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs font-mono font-bold text-muted-foreground">ANALYST SNAPSHOT</span>
          </div>
          <p className="text-foreground leading-relaxed mb-4">{snapshot.summary}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            {snapshot.keyDrivers?.length > 0 && (
              <div>
                <div className="text-xs font-mono text-muted-foreground mb-2">KEY DRIVERS</div>
                <ul className="space-y-1">
                  {snapshot.keyDrivers.map((d, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <span className="text-primary font-mono mt-0.5">→</span>
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {snapshot.keyRisks?.length > 0 && (
              <div>
                <div className="text-xs font-mono text-muted-foreground mb-2">KEY RISKS</div>
                <ul className="space-y-1">
                  {snapshot.keyRisks.map((r, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <span className="text-destructive font-mono mt-0.5">!</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="flex gap-4 mt-4 pt-4 border-t border-border/30">
            <div>
              <span className="text-[10px] font-mono text-muted-foreground">DOMINANT SIGNAL</span>
              <div className="text-sm font-mono text-primary mt-0.5">{snapshot.dominantSignal}</div>
            </div>
            <div>
              <span className="text-[10px] font-mono text-muted-foreground">NEG SIGNAL RATIO</span>
              <div className="text-sm font-mono mt-0.5">{Math.round(snapshot.negativeSignalRatio * 100)}%</div>
            </div>
            <div>
              <span className="text-[10px] font-mono text-muted-foreground">TRUST LEVEL</span>
              <div className={`text-sm font-mono mt-0.5 font-bold ${snapshot.trustLabel === "high" ? "text-green-400" : snapshot.trustLabel === "medium" ? "text-amber-500" : "text-muted-foreground"}`}>
                {snapshot.trustLabel.toUpperCase()}
              </div>
            </div>
          </div>
        </div>

        {data.creditSummaries.length > 0 && (
          <section>
            <h2 className="text-lg font-bold font-mono flex items-center gap-2 mb-4">
              <Zap className="h-5 w-5 text-primary" />
              TOP CREDIT SIGNALS
            </h2>
            <div className="space-y-4">
              {data.creditSummaries.map((cs) => (
                <Card key={cs.articleId} className="bg-card border-border">
                  <CardContent className="p-5">
                    <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
                      <Link href={`/article/${cs.articleId}`} className="font-bold hover:text-primary transition-colors text-base leading-snug max-w-xl">
                        {decodeHtml(cs.title)}
                      </Link>
                      <div className="flex items-center gap-2 shrink-0">
                        {cs.urgency != null && (
                          <Badge className={`${getUrgencyColor(cs.urgency)} font-mono text-xs`}>
                            U{cs.urgency}/10
                          </Badge>
                        )}
                        <span className="text-xs font-mono text-muted-foreground">
                          {formatDistanceToNow(new Date(cs.publishedAt), { addSuffix: true })}
                        </span>
                      </div>
                    </div>

                    {cs.creditSummary && (
                      <div className="space-y-3">
                        <p className="text-sm text-foreground leading-relaxed">{cs.creditSummary.situation}</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {cs.creditSummary.creditDrivers?.length > 0 && (
                            <div>
                              <div className="text-[10px] font-mono text-muted-foreground mb-1.5">CREDIT DRIVERS</div>
                              <ul className="space-y-1">
                                {cs.creditSummary.creditDrivers.slice(0, 3).map((d, i) => (
                                  <li key={i} className="text-xs text-foreground flex items-start gap-1.5">
                                    <span className="text-primary mt-0.5">•</span>{d}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {cs.creditSummary.riskFactors?.length > 0 && (
                            <div>
                              <div className="text-[10px] font-mono text-muted-foreground mb-1.5">RISK FACTORS</div>
                              <ul className="space-y-1">
                                {cs.creditSummary.riskFactors.slice(0, 3).map((r, i) => (
                                  <li key={i} className="text-xs text-foreground flex items-start gap-1.5">
                                    <span className="text-destructive mt-0.5">▲</span>{r}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                        <div className="bg-secondary/20 rounded px-3 py-2 text-xs font-mono text-primary border border-border/40">
                          BOTTOM LINE: {cs.creditSummary.bottomLine}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {data.tradeImplications.length > 0 && (
          <section>
            <h2 className="text-lg font-bold font-mono flex items-center gap-2 mb-4">
              <Target className="h-5 w-5 text-primary" />
              TRADE IMPLICATIONS
            </h2>
            <div className="grid gap-3">
              {data.tradeImplications.map((ti) => (
                <div key={ti.articleId} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                    <Link href={`/article/${ti.articleId}`} className="font-semibold hover:text-primary transition-colors text-sm">
                      {decodeHtml(ti.title)}
                    </Link>
                    <div className="flex items-center gap-2 shrink-0">
                      {ti.tradeDirection && (
                        <Badge className={`text-xs font-mono ${ti.tradeDirection === "negative" ? "bg-red-900/40 text-red-300 border-red-700" : ti.tradeDirection === "positive" ? "bg-green-900/40 text-green-300 border-green-700" : "bg-secondary text-muted-foreground"}`}>
                          {ti.tradeDirection.toUpperCase()}
                        </Badge>
                      )}
                      {ti.finalUrgencyScore && (
                        <span className="text-xs font-mono text-muted-foreground">U{ti.finalUrgencyScore}/10</span>
                      )}
                    </div>
                  </div>
                  {ti.tradeRationale && (
                    <p className="text-xs text-muted-foreground mb-2">{ti.tradeRationale}</p>
                  )}
                  {ti.potentialTrades.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {ti.potentialTrades.map((t, i) => (
                        <span key={i} className="text-xs font-mono bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recent Alerts Timeline */}
        {alertsData && alertsData.alerts.length > 0 && (
          <section data-testid="issuer-alerts-timeline">
            <h2 className="text-lg font-bold font-mono flex items-center gap-2 mb-4">
              <ShieldAlert className="h-5 w-5 text-primary" />
              RECENT ALERTS
              <span className="text-xs text-muted-foreground font-normal ml-2">
                ({alertsData.alerts.length} recent)
              </span>
            </h2>
            <div className="rounded-md border border-border overflow-hidden bg-card divide-y divide-border/50">
              {alertsData.alerts.map((alert) => {
                const priority = getAlertPriority(alert);
                const isHighPriority =
                  priority.label === "Critical" || priority.label === "High";
                return (
                  <div
                    key={alert.id}
                    className={`p-3 flex flex-wrap items-start gap-3 ${isHighPriority ? "bg-red-950/10" : ""}`}
                    data-testid={`issuer-alert-row-${alert.id}`}
                  >
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                      <SeverityBadge urgency={alert.urgency} />
                      <PriorityBadge alert={alert} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug line-clamp-2">
                        {alert.title}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {alert.eventType && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] h-4 px-1.5"
                          >
                            {alert.eventType}
                          </Badge>
                        )}
                        {alert.portfolioLinked && (
                          <span className="text-[10px] font-mono text-amber-500">
                            Portfolio exposure
                          </span>
                        )}
                        {!alert.isRead && (
                          <span className="text-[10px] font-mono text-primary">
                            Unread
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(alert.triggeredAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2">
              <Link
                href="/alerts"
                className="text-xs font-mono text-primary hover:underline"
              >
                View all alerts →
              </Link>
            </div>
          </section>
        )}

        <section>
          <h2 className="text-lg font-bold font-mono flex items-center gap-2 mb-4">
            <FileText className="h-5 w-5 text-muted-foreground" />
            ARTICLE TIMELINE
            <span className="text-xs text-muted-foreground font-normal ml-2">({data.articles.length} total)</span>
          </h2>
          <div className="rounded-md border border-border overflow-hidden bg-card divide-y divide-border/50">
            {data.articles.map((article) => (
              <div key={article.id} className="p-4 hover:bg-secondary/10 transition-colors">
                <div className="flex flex-wrap justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      {article.finalUrgencyScore != null && article.finalUrgencyScore >= 4 && (
                        <Badge className={`text-[10px] font-mono shrink-0 ${getUrgencyColor(article.finalUrgencyScore)}`}>
                          U{article.finalUrgencyScore}
                        </Badge>
                      )}
                      {article.covenantFlag && (
                        <Badge className="text-[10px] bg-red-600 text-white shrink-0">⚠ COVENANT</Badge>
                      )}
                      {article.ratingMentioned && (
                        <Badge className="text-[10px] bg-purple-900/40 text-purple-200 border-purple-700 font-mono shrink-0">
                          {article.ratingAgency && article.ratingAgency !== "null" ? `${article.ratingAgency}: ` : ""}{article.ratingMentioned}
                        </Badge>
                      )}
                    </div>
                    <Link
                      href={`/article/${article.id}`}
                      className="font-semibold hover:text-primary transition-colors block leading-snug"
                    >
                      {decodeHtml(article.title)}
                    </Link>
                    {article.summary && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{article.summary}</p>
                    )}
                  </div>

                  <div className="shrink-0 text-right text-[10px] font-mono space-y-1 min-w-[120px]">
                    <div className="flex items-center justify-end gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}
                    </div>
                    <div className={`font-bold ${getSentimentColor(article.sentiment)}`}>
                      {article.sentiment?.toUpperCase() ?? "—"}
                    </div>
                    {article.eventType && (
                      <div className="text-muted-foreground">{article.eventType.replace(/_/g, " ").toUpperCase()}</div>
                    )}
                    <div className="text-muted-foreground">{article.source}</div>
                  </div>
                </div>
              </div>
            ))}
            {data.articles.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">No articles found for this issuer.</div>
            )}
          </div>
        </section>
      </div>
    </Layout>
  );
}
