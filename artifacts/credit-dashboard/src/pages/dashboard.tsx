import { useGetDailyBrief, useListArticles, useGetTrends } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { ArticleCard } from "@/components/article-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle, TrendingDown, TrendingUp, AlertCircle, FileText,
  AlertOctagon, Filter, Zap, Activity, Shield, BarChart3
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { useState, useEffect } from "react";
import { Toggle } from "@/components/ui/toggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function UrgencyBar({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 8 ? "bg-red-500" : score >= 6 ? "bg-orange-500" : score >= 4 ? "bg-amber-500" : "bg-emerald-600";
  return (
    <div className="w-full bg-secondary rounded-full h-1.5 mt-1">
      <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function TrendAlertCard({ alert }: { alert: {
  type: string; sector?: string | null; issuer?: string | null;
  signal: string; evidence: string; implication: string;
  articleCount: number; severity: string;
}}) {
  const severityStyles: Record<string, string> = {
    critical: "border-red-700/60 bg-red-950/30 text-red-400",
    high: "border-amber-700/60 bg-amber-950/20 text-amber-400",
    moderate: "border-border bg-card text-muted-foreground",
  };
  const typeIcons: Record<string, string> = {
    sector_cluster: "⚡",
    issuer_deterioration: "⬇",
    refinancing_wave: "↺",
    downgrade_wave: "▼",
  };

  const styles = severityStyles[alert.severity] ?? severityStyles.moderate;
  return (
    <div className={`p-3 rounded-lg border ${styles} text-xs space-y-1`}>
      <div className="flex items-center justify-between">
        <span className="font-bold font-mono uppercase tracking-wider">
          {typeIcons[alert.type] ?? "•"} {alert.type.replace(/_/g, " ")}
        </span>
        <Badge variant="outline" className="text-[10px] font-mono">
          {alert.articleCount} articles
        </Badge>
      </div>
      <p className="font-semibold">{alert.signal}</p>
      <p className="opacity-80 leading-snug">{alert.implication}</p>
    </div>
  );
}

export default function Dashboard() {
  const [covenantOnly, setCovenantOnly] = useState(false);
  const [marketImpact, setMarketImpact] = useState<string>("all");
  const [minUrgency, setMinUrgency] = useState<string>("all");
  const [issuerFilter, setIssuerFilter] = useState<string | undefined>();

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const initialIssuer = searchParams.get('issuerName');
    if (initialIssuer) setIssuerFilter(initialIssuer);
  }, []);

  const { data: articlesData, isLoading: isLoadingArticles } = useListArticles({
    limit: 20,
    covenantFlag: covenantOnly ? true : undefined,
    marketImpact: marketImpact !== "all" ? marketImpact : undefined,
    minUrgency: minUrgency !== "all" ? parseInt(minUrgency) : undefined,
    issuerName: issuerFilter,
  });

  const { data: dailyBrief, isLoading: isLoadingBrief } = useGetDailyBrief();
  const { data: trendsData, isLoading: isLoadingTrends } = useGetTrends({ windowHours: 72 });

  // Top Credit Risks: sort articles by finalUrgencyScore desc
  const topCreditRisks = articlesData?.articles
    ? [...articlesData.articles]
        .filter(a => a.processedAt)
        .sort((a, b) =>
          ((b.finalUrgencyScore ?? b.urgencyScore ?? 0) - (a.finalUrgencyScore ?? a.urgencyScore ?? 0)) ||
          (b.creditSignalScore ?? 0) - (a.creditSignalScore ?? 0)
        )
        .slice(0, 5)
    : [];

  return (
    <Layout>
      <div className="flex flex-col lg:flex-row h-full">
        {/* Main Feed */}
        <div className="flex-1 overflow-auto p-6 border-r border-border">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">LIVE FEED</h1>
              <p className="text-muted-foreground text-sm font-mono mt-1">LATEST CREDIT INTELLIGENCE</p>
            </div>
            <div className="text-xs font-mono text-muted-foreground bg-secondary px-2 py-1 rounded">
              SHOWING TOP {articlesData?.articles.length || 0}
            </div>
          </div>

          {/* Top Credit Risks Today */}
          {topCreditRisks.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold font-mono tracking-wider text-primary">TOP CREDIT RISKS TODAY</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
                {topCreditRisks.map((article, i) => {
                  const urgency = article.finalUrgencyScore ?? article.urgencyScore ?? 0;
                  const urgencyColor = urgency >= 8 ? "border-red-700/60 bg-red-950/20" :
                    urgency >= 6 ? "border-amber-700/50 bg-amber-950/20" :
                    urgency >= 4 ? "border-yellow-700/40 bg-yellow-950/10" : "border-border bg-card/60";
                  return (
                    <Link key={article.id} href={`/article/${article.id}`}>
                      <div className={`p-3 rounded-lg border ${urgencyColor} hover:border-primary/50 transition-colors cursor-pointer h-full`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-[10px] text-muted-foreground">#{i + 1}</span>
                          <span className={`font-mono text-xs font-bold ${urgency >= 8 ? "text-red-400" : urgency >= 6 ? "text-amber-400" : "text-yellow-500"}`}>
                            {urgency}/10
                          </span>
                        </div>
                        <UrgencyBar score={urgency} />
                        <p className="text-xs font-semibold mt-2 line-clamp-2 leading-snug">
                          {article.issuerName && <span className="text-primary">{article.issuerName}: </span>}
                          {article.title}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {article.covenantFlag && (
                            <span className="font-mono text-[9px] text-red-400 bg-red-950/40 px-1 rounded">CVT</span>
                          )}
                          {article.tradeDirection && article.tradeDirection !== "neutral" && (
                            <span className={`font-mono text-[9px] px-1 rounded ${article.tradeDirection === "negative" ? "text-red-400 bg-red-950/40" : "text-green-400 bg-green-950/40"}`}>
                              {article.tradeDirection === "negative" ? "SELL" : "BUY"}
                            </span>
                          )}
                          {article.sector && (
                            <span className="font-mono text-[9px] text-muted-foreground">{article.sector.toUpperCase().slice(0, 6)}</span>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-6 p-3 bg-card/50 border border-border rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono mr-2">
              <Filter className="h-4 w-4" /> FILTERS:
            </div>

            {issuerFilter && (
              <div className="flex items-center bg-primary/20 text-primary font-mono text-xs px-3 py-1 rounded-full border border-primary/50">
                <span>ISSUER: {issuerFilter}</span>
                <button onClick={() => setIssuerFilter(undefined)} className="ml-2 hover:text-foreground">×</button>
              </div>
            )}

            <Toggle
              pressed={covenantOnly}
              onPressedChange={setCovenantOnly}
              className="data-[state=on]:bg-red-950 data-[state=on]:text-red-400 data-[state=on]:border-red-900 border border-transparent font-mono text-xs"
              variant="outline"
              size="sm"
            >
              <AlertOctagon className="h-3 w-3 mr-2" />
              COVENANT ONLY
            </Toggle>

            <Select value={minUrgency} onValueChange={setMinUrgency}>
              <SelectTrigger className="w-[150px] h-8 text-xs font-mono bg-transparent">
                <SelectValue placeholder="URGENCY" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ALL URGENCY</SelectItem>
                <SelectItem value="8">CRITICAL (8-10)</SelectItem>
                <SelectItem value="6">HIGH (6-7)</SelectItem>
                <SelectItem value="4">ELEVATED (4-5)</SelectItem>
                <SelectItem value="2">MODERATE (2-3)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={marketImpact} onValueChange={setMarketImpact}>
              <SelectTrigger className="w-[140px] h-8 text-xs font-mono bg-transparent">
                <SelectValue placeholder="MARKET IMPACT" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ALL IMPACT</SelectItem>
                <SelectItem value="high">HIGH IMPACT</SelectItem>
                <SelectItem value="medium">MEDIUM IMPACT</SelectItem>
                <SelectItem value="low">LOW IMPACT</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4">
            {isLoadingArticles ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex flex-col space-y-3">
                  <Skeleton className="h-[125px] w-full rounded-xl" />
                </div>
              ))
            ) : articlesData?.articles && articlesData.articles.length > 0 ? (
              articlesData.articles.map(article => (
                <ArticleCard key={article.id} article={article} />
              ))
            ) : (
              <div className="text-center py-12 border border-dashed border-border rounded-lg bg-secondary/20">
                <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <h3 className="text-lg font-medium">No articles found</h3>
                <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or click REFRESH DATA.</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-96 overflow-auto bg-card/50">
          <div className="p-6 space-y-6">

            {/* Trend Alerts Panel */}
            <div>
              <h2 className="text-xl font-bold tracking-tight mb-4 flex items-center">
                <Activity className="mr-2 h-5 w-5 text-amber-400" />
                TREND ALERTS
                <span className="ml-2 text-xs font-mono text-muted-foreground font-normal">72H WINDOW</span>
              </h2>
              {isLoadingTrends ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : trendsData?.trendAlerts && trendsData.trendAlerts.length > 0 ? (
                <div className="space-y-3">
                  {trendsData.trendAlerts.slice(0, 4).map((alert, i) => (
                    <TrendAlertCard key={i} alert={alert} />
                  ))}
                  {trendsData.trendAlerts.length > 4 && (
                    <p className="text-xs font-mono text-muted-foreground text-center">
                      +{trendsData.trendAlerts.length - 4} more trend alerts
                    </p>
                  )}
                </div>
              ) : (
                <div className="p-4 rounded-lg border border-border bg-card/40 text-center">
                  <Shield className="h-6 w-6 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No trend clusters detected in 72h window.</p>
                </div>
              )}
            </div>

            {/* Daily Brief */}
            <div>
              <h2 className="text-xl font-bold tracking-tight mb-4 flex items-center">
                <FileText className="mr-2 h-5 w-5 text-primary" />
                DAILY BRIEF
              </h2>

              {isLoadingBrief ? (
                <div className="space-y-4">
                  <Skeleton className="h-32 w-full" />
                  <Skeleton className="h-48 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : dailyBrief ? (
                <div className="space-y-5">
                  {dailyBrief.covenantAlerts && dailyBrief.covenantAlerts.length > 0 && (
                    <Card className="bg-red-950/20 border-red-900/50">
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-sm font-bold text-red-500 flex items-center animate-pulse">
                          <AlertOctagon className="h-4 w-4 mr-2" />
                          COVENANT ALERTS ({dailyBrief.covenantAlerts.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-3">
                        {dailyBrief.covenantAlerts.map(alert => (
                          <Link key={alert.articleId} href={`/article/${alert.articleId}`} className="block text-sm hover:underline hover:text-red-400">
                            <span className="font-mono text-xs text-red-500 mr-2">⚠</span>
                            {alert.issuerName ? <span className="font-bold mr-1">{alert.issuerName}:</span> : null}
                            {alert.title}
                          </Link>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  <Card className="bg-destructive/10 border-destructive/20">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-sm font-bold text-destructive flex items-center">
                        <AlertTriangle className="h-4 w-4 mr-2" />
                        CLO ALERTS ({dailyBrief.cloAlerts.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-3">
                      {dailyBrief.cloAlerts.length > 0 ? (
                        dailyBrief.cloAlerts.map(alert => (
                          <Link key={alert.articleId} href={`/article/${alert.articleId}`} className="block text-sm hover:underline hover:text-primary">
                            <span className="font-mono text-xs text-destructive mr-2">!</span>
                            {alert.issuerName ? <span className="font-bold mr-1">{alert.issuerName}:</span> : null}
                            {alert.title}
                          </Link>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">No active CLO alerts today.</span>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-sm font-bold flex items-center">
                        <TrendingDown className="h-4 w-4 mr-2 text-destructive" />
                        TOP NEGATIVE EVENTS
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-3">
                      {dailyBrief.mostNegativeEvents.slice(0, 3).map(event => (
                        <div key={event.articleId} className="border-l-2 border-destructive pl-3 py-1">
                          <Link href={`/article/${event.articleId}`} className="text-sm font-medium hover:text-primary transition-colors line-clamp-2">
                            {event.issuerName ? <span className="font-bold mr-1">{event.issuerName}:</span> : null}
                            {event.title}
                          </Link>
                          <div className="text-xs font-mono text-muted-foreground mt-1 flex gap-2 flex-wrap">
                            {event.sector && <span>{event.sector}</span>}
                            {event.ratingMentioned && <span className="text-purple-400">| {event.ratingMentioned}</span>}
                            {(event.finalUrgencyScore ?? event.urgencyScore) && (
                              <span className="text-amber-500">| U:{event.finalUrgencyScore ?? event.urgencyScore}/10</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-sm font-bold flex items-center">
                        <TrendingUp className="h-4 w-4 mr-2" />
                        KEY TRENDS
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <ul className="space-y-2 text-sm">
                        {dailyBrief.keyTrends.map((trend, i) => (
                          <li key={i} className="flex items-start">
                            <span className="text-primary mr-2 mt-0.5">•</span>
                            <span className="text-muted-foreground">{trend}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No brief available.</div>
              )}
            </div>

          </div>
        </div>
      </div>
    </Layout>
  );
}
