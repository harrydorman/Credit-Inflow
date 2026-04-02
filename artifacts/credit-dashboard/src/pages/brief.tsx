import { useGetDailyBrief } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Clock,
  Target,
  TrendingDown,
  TrendingUp,
  AlertOctagon,
  Flame,
  Building,
  Minus,
  FileText,
} from "lucide-react";
import { Link } from "wouter";
import { Separator } from "@/components/ui/separator";

interface IssuerSnapshot {
  issuerName: string;
  sector: string | null;
  riskLevel: "high" | "medium" | "low";
  trend: "deteriorating" | "stable" | "improving";
  dominantSignal: string;
  trustLabel: "high" | "medium" | "low";
  summary: string;
  negativeSignalRatio: number;
  keyDrivers?: string[];
  keyRisks?: string[];
}

function getTrendIcon(trend: string) {
  if (trend === "deteriorating") return <TrendingDown className="h-3.5 w-3.5 text-red-400" />;
  if (trend === "improving") return <TrendingUp className="h-3.5 w-3.5 text-green-400" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function getRiskBadgeClass(level: string) {
  if (level === "high") return "bg-red-600 text-white border-red-700";
  if (level === "medium") return "bg-orange-500/80 text-white border-orange-600";
  return "bg-green-700/60 text-green-100 border-green-600";
}

export default function Brief() {
  const { data: rawBrief, isLoading } = useGetDailyBrief();
  const brief = rawBrief as (typeof rawBrief & { issuerHotspots?: IssuerSnapshot[] }) | undefined;

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Layout>
      <div className="max-w-5xl mx-auto p-6 lg:p-8 space-y-8">
        <header className="border-b border-border pb-6">
          <div className="flex justify-between items-end flex-wrap gap-4">
            <div>
              <div className="text-xs font-mono text-muted-foreground mb-1 tracking-widest">
                CREDIT INTELLIGENCE PLATFORM
              </div>
              <h1 className="text-3xl font-bold tracking-tight">
                DAILY CREDIT BRIEF
              </h1>
              <p className="text-muted-foreground font-mono mt-2 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {brief?.date
                  ? new Date(brief.date).toLocaleDateString("en-US", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : dateStr}
              </p>
            </div>
            {brief && (
              <div className="text-right">
                <div className="text-[10px] font-mono text-muted-foreground mb-1">ARTICLES ANALYZED</div>
                <div className="text-3xl font-mono font-bold text-primary">{brief.totalArticlesProcessed}</div>
              </div>
            )}
          </div>
        </header>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-[300px] w-full" />
            <Skeleton className="h-[200px] w-full" />
          </div>
        ) : brief ? (
          <div className="space-y-8">

            {/* COVENANT ALERTS */}
            {brief.covenantAlerts && brief.covenantAlerts.length > 0 && (
              <section>
                <h2 className="text-xl font-bold font-mono text-red-500 flex items-center gap-2 mb-4 animate-pulse">
                  <AlertOctagon className="h-6 w-6" />
                  COVENANT ALERTS
                </h2>
                <div className="grid gap-4">
                  {brief.covenantAlerts.map((alert) => (
                    <Card key={alert.articleId} className="bg-red-950/20 border-red-900/50">
                      <CardContent className="p-4 flex justify-between items-start gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            {alert.issuerName && (
                              <Link href={`/issuer/${encodeURIComponent(alert.issuerName)}`}>
                                <span className="font-mono text-xs font-bold bg-red-900/50 text-red-200 px-2 py-0.5 rounded hover:bg-red-900/70 transition-colors cursor-pointer">
                                  {alert.issuerName}
                                </span>
                              </Link>
                            )}
                            {alert.urgencyScore && (
                              <span className="font-mono text-xs font-bold text-red-400">
                                URGENCY: {alert.urgencyScore}/5
                              </span>
                            )}
                          </div>
                          <Link
                            href={`/article/${alert.articleId}`}
                            className="text-lg font-bold hover:text-red-400 transition-colors"
                          >
                            {alert.title}
                          </Link>
                          <p className="text-muted-foreground text-sm mt-2 line-clamp-2">{alert.summary}</p>
                        </div>
                        <div className="shrink-0 text-right font-mono text-xs space-y-1">
                          <div className="text-red-500 font-bold">⚠ COVENANT</div>
                          <div className="text-muted-foreground">{alert.sector?.toUpperCase()}</div>
                          {alert.ratingMentioned && (
                            <div className="text-purple-400">
                              {alert.ratingAgency ? `${alert.ratingAgency}: ` : ""}
                              {alert.ratingMentioned}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* CRITICAL ALERTS */}
            {brief.criticalAlerts && brief.criticalAlerts.length > 0 && (
              <section>
                <h2 className="text-xl font-bold font-mono text-orange-500 flex items-center gap-2 mb-4">
                  <Flame className="h-6 w-6" />
                  CRITICAL EVENTS (URGENCY 4-5)
                </h2>
                <div className="grid gap-4">
                  {brief.criticalAlerts.map((alert) => (
                    <Card key={alert.articleId} className="bg-orange-950/10 border-orange-900/30">
                      <CardContent className="p-4 flex justify-between items-start gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            {alert.issuerName && (
                              <Link href={`/issuer/${encodeURIComponent(alert.issuerName)}`}>
                                <span className="font-mono text-xs font-bold bg-orange-900/30 text-orange-200 px-2 py-0.5 rounded hover:bg-orange-900/50 transition-colors cursor-pointer">
                                  {alert.issuerName}
                                </span>
                              </Link>
                            )}
                            {alert.urgencyScore && (
                              <span className="font-mono text-xs font-bold text-orange-400">
                                URGENCY: {alert.urgencyScore}/5
                              </span>
                            )}
                          </div>
                          <Link
                            href={`/article/${alert.articleId}`}
                            className="text-lg font-bold hover:text-orange-400 transition-colors"
                          >
                            {alert.title}
                          </Link>
                          <p className="text-muted-foreground text-sm mt-2 line-clamp-2">{alert.summary}</p>
                        </div>
                        <div className="shrink-0 text-right font-mono text-xs space-y-1">
                          <div className="text-orange-500 font-bold">{alert.sentiment?.toUpperCase()}</div>
                          <div className="text-muted-foreground">{alert.sector?.toUpperCase()}</div>
                          {alert.marketImpact && (
                            <div className="text-orange-300">IMPACT: {alert.marketImpact.toUpperCase()}</div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* CLO ALERTS */}
            {brief.cloAlerts.length > 0 && (
              <section>
                <h2 className="text-lg font-bold font-mono text-destructive flex items-center gap-2 mb-4">
                  <AlertTriangle className="h-5 w-5" />
                  CRITICAL CLO ALERTS
                </h2>
                <div className="grid gap-4">
                  {brief.cloAlerts.map((alert) => (
                    <Card key={alert.articleId} className="bg-destructive/5 border-destructive/20">
                      <CardContent className="p-4 flex justify-between items-start gap-4">
                        <div>
                          <Link
                            href={`/article/${alert.articleId}`}
                            className="text-lg font-bold hover:text-primary transition-colors"
                          >
                            {alert.title}
                          </Link>
                          <p className="text-muted-foreground text-sm mt-2 line-clamp-2">{alert.summary}</p>
                        </div>
                        <div className="shrink-0 text-right font-mono text-xs space-y-1">
                          <div className="text-destructive font-bold">{alert.sentiment?.toUpperCase()}</div>
                          <div className="text-muted-foreground">{alert.sector?.toUpperCase()}</div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* ISSUER HOTSPOTS — PM note style */}
            {brief.issuerHotspots && brief.issuerHotspots.length > 0 && (
              <section>
                <h2 className="text-lg font-bold font-mono flex items-center gap-2 mb-1">
                  <Building className="h-5 w-5 text-primary" />
                  ISSUER HOTSPOTS
                </h2>
                <p className="text-xs font-mono text-muted-foreground mb-4">
                  NAMES GENERATING THE HIGHEST RECENT SIGNAL WEIGHT
                </p>
                <div className="space-y-3">
                  {brief.issuerHotspots.map((iss: IssuerSnapshot) => (
                    <div
                      key={iss.issuerName}
                      className="rounded-lg border border-border bg-card p-4"
                    >
                      <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/issuer/${encodeURIComponent(iss.issuerName)}`}>
                            <span className="font-mono font-bold text-base hover:text-primary transition-colors cursor-pointer">
                              {iss.issuerName}
                            </span>
                          </Link>
                          {iss.sector && (
                            <Badge variant="outline" className="text-[0.65rem] bg-secondary/50 font-mono">
                              {iss.sector.toUpperCase()}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={`text-[0.65rem] font-mono font-bold ${getRiskBadgeClass(iss.riskLevel)}`}>
                            {iss.riskLevel.toUpperCase()} RISK
                          </Badge>
                          <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                            {getTrendIcon(iss.trend)}
                            {iss.trend.toUpperCase()}
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-2">{iss.summary}</p>
                      <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono">
                        <span className="text-muted-foreground">
                          DOMINANT SIGNAL: <span className="text-primary">{iss.dominantSignal}</span>
                        </span>
                        <span className="text-muted-foreground">
                          NEG RATIO: <span className={iss.negativeSignalRatio >= 0.5 ? "text-destructive font-bold" : ""}>{Math.round(iss.negativeSignalRatio * 100)}%</span>
                        </span>
                        <Link href={`/issuer/${encodeURIComponent(iss.issuerName)}`} className="text-primary hover:underline ml-auto">
                          FULL PROFILE →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* NEGATIVE EVENTS */}
              <section>
                <h2 className="text-lg font-bold font-mono flex items-center gap-2 mb-4">
                  <TrendingDown className="h-5 w-5 text-destructive" />
                  TOP NEGATIVE EVENTS
                </h2>
                <Card>
                  <CardContent className="p-0 divide-y divide-border">
                    {brief.mostNegativeEvents.map((event) => (
                      <div key={event.articleId} className="p-4">
                        <Link
                          href={`/article/${event.articleId}`}
                          className="font-semibold hover:text-primary block mb-1"
                        >
                          {event.issuerName ? (
                            <span className="font-bold mr-1">{event.issuerName}:</span>
                          ) : null}
                          {event.title}
                        </Link>
                        <div className="flex flex-wrap gap-2 text-xs font-mono text-muted-foreground">
                          {event.urgencyScore && (
                            <span className="text-orange-400">U{event.urgencyScore}</span>
                          )}
                          <span>|</span>
                          <span className="text-destructive">{event.sentiment?.toUpperCase()}</span>
                          <span>|</span>
                          <span>{event.sector?.toUpperCase()}</span>
                          {event.ratingMentioned && (
                            <>
                              <span>|</span>
                              <span className="text-purple-400">{event.ratingMentioned}</span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>

              {/* MOST IMPACTED SECTORS */}
              <section>
                <h2 className="text-lg font-bold font-mono flex items-center gap-2 mb-4">
                  <Target className="h-5 w-5 text-primary" />
                  MOST IMPACTED SECTORS
                </h2>
                <Card>
                  <CardContent className="p-0 divide-y divide-border">
                    {brief.mostImpactedSectors.map((sector) => (
                      <div key={sector.sector} className="p-4 flex justify-between items-center">
                        <div>
                          <div className="font-bold">{sector.sector.toUpperCase()}</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {sector.negativeCount} negative events
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-mono text-muted-foreground mb-1">RISK SCORE</div>
                          <div
                            className={`font-mono text-xl font-bold ${
                              sector.riskScore >= 50 ? "text-destructive" : "text-primary"
                            }`}
                          >
                            {sector.riskScore}
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>
            </div>

            <Separator className="bg-border" />

            {/* KEY TRENDS — PM note narrative */}
            <section>
              <h2 className="text-lg font-bold font-mono flex items-center gap-2 mb-1">
                <FileText className="h-5 w-5 text-muted-foreground" />
                MACRO TREND SUMMARY
              </h2>
              <p className="text-xs font-mono text-muted-foreground mb-4">
                SIGNAL PATTERN SUMMARY ACROSS ALL PROCESSED ARTICLES
              </p>
              <div className="bg-card border border-border rounded-lg p-6">
                <ul className="space-y-4">
                  {brief.keyTrends.map((trend, i) => (
                    <li key={i} className="flex items-start gap-4">
                      <span className="text-primary font-mono mt-0.5 text-lg shrink-0">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="text-foreground leading-relaxed">{trend}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">No brief data available.</div>
        )}
      </div>
    </Layout>
  );
}
