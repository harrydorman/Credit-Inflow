import { useGetDailyBrief } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock, Target, TrendingDown, TrendingUp, AlertOctagon, Flame } from "lucide-react";
import { Link } from "wouter";
import { Separator } from "@/components/ui/separator";

export default function Brief() {
  const { data: brief, isLoading } = useGetDailyBrief();

  return (
    <Layout>
      <div className="max-w-5xl mx-auto p-6 lg:p-8 space-y-8">
        <header className="flex justify-between items-end border-b border-border pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center">
              DAILY CREDIT BRIEF
            </h1>
            <p className="text-muted-foreground font-mono mt-2 flex items-center">
              <Clock className="h-4 w-4 mr-2" />
              {brief?.date ? new Date(brief.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Loading...'}
            </p>
          </div>
          {brief && (
            <div className="text-right">
              <div className="text-sm font-mono text-muted-foreground mb-1">ARTICLES ANALYZED</div>
              <div className="text-3xl font-mono font-bold text-primary">{brief.totalArticlesProcessed}</div>
            </div>
          )}
        </header>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-[300px] w-full" />
            <Skeleton className="h-[200px] w-full" />
          </div>
        ) : brief ? (
          <div className="space-y-8">
            
            {/* COVENANT ALERTS SECTION */}
            {brief.covenantAlerts && brief.covenantAlerts.length > 0 && (
              <section>
                <h2 className="text-xl font-bold font-mono text-red-500 flex items-center mb-4 animate-pulse">
                  <AlertOctagon className="h-6 w-6 mr-2" />
                  COVENANT ALERTS
                </h2>
                <div className="grid gap-4">
                  {brief.covenantAlerts.map(alert => (
                    <Card key={alert.articleId} className="bg-red-950/20 border-red-900/50">
                      <CardContent className="p-4 flex justify-between items-start gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            {alert.issuerName && <span className="font-mono text-xs font-bold bg-red-900/50 text-red-200 px-2 py-0.5 rounded">{alert.issuerName}</span>}
                            {alert.urgencyScore && <span className="font-mono text-xs font-bold text-red-400">URGENCY: {alert.urgencyScore}/5</span>}
                          </div>
                          <Link href={`/article/${alert.articleId}`} className="text-lg font-bold hover:text-red-400 transition-colors">
                            {alert.title}
                          </Link>
                          <p className="text-muted-foreground text-sm mt-2 line-clamp-2">{alert.summary}</p>
                        </div>
                        <div className="shrink-0 text-right font-mono text-xs space-y-1">
                          <div className="text-red-500 font-bold">⚠ COVENANT</div>
                          <div className="text-muted-foreground">{alert.sector?.toUpperCase()}</div>
                          {alert.ratingMentioned && <div className="text-purple-400">{alert.ratingAgency ? `${alert.ratingAgency}: ` : ''}{alert.ratingMentioned}</div>}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* CRITICAL ALERTS SECTION */}
            {brief.criticalAlerts && brief.criticalAlerts.length > 0 && (
              <section>
                <h2 className="text-xl font-bold font-mono text-orange-500 flex items-center mb-4">
                  <Flame className="h-6 w-6 mr-2" />
                  CRITICAL EVENTS (URGENCY 4-5)
                </h2>
                <div className="grid gap-4">
                  {brief.criticalAlerts.map(alert => (
                    <Card key={alert.articleId} className="bg-orange-950/10 border-orange-900/30">
                      <CardContent className="p-4 flex justify-between items-start gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            {alert.issuerName && <span className="font-mono text-xs font-bold bg-orange-900/30 text-orange-200 px-2 py-0.5 rounded">{alert.issuerName}</span>}
                            {alert.urgencyScore && <span className="font-mono text-xs font-bold text-orange-400">URGENCY: {alert.urgencyScore}/5</span>}
                          </div>
                          <Link href={`/article/${alert.articleId}`} className="text-lg font-bold hover:text-orange-400 transition-colors">
                            {alert.title}
                          </Link>
                          <p className="text-muted-foreground text-sm mt-2 line-clamp-2">{alert.summary}</p>
                        </div>
                        <div className="shrink-0 text-right font-mono text-xs space-y-1">
                          <div className="text-orange-500 font-bold">{alert.sentiment?.toUpperCase()}</div>
                          <div className="text-muted-foreground">{alert.sector?.toUpperCase()}</div>
                          {alert.marketImpact && <div className="text-orange-300">IMPACT: {alert.marketImpact.toUpperCase()}</div>}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* CLO ALERTS SECTION */}
            {brief.cloAlerts.length > 0 && (
              <section>
                <h2 className="text-lg font-bold font-mono text-destructive flex items-center mb-4">
                  <AlertTriangle className="h-5 w-5 mr-2" />
                  CRITICAL CLO ALERTS
                </h2>
                <div className="grid gap-4">
                  {brief.cloAlerts.map(alert => (
                    <Card key={alert.articleId} className="bg-destructive/5 border-destructive/20">
                      <CardContent className="p-4 flex justify-between items-start gap-4">
                        <div>
                          <Link href={`/article/${alert.articleId}`} className="text-lg font-bold hover:text-primary transition-colors">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* NEGATIVE EVENTS */}
              <section>
                <h2 className="text-lg font-bold font-mono flex items-center mb-4 text-card-foreground">
                  <TrendingDown className="h-5 w-5 mr-2 text-destructive" />
                  TOP NEGATIVE EVENTS
                </h2>
                <Card>
                  <CardContent className="p-0 divide-y divide-border">
                    {brief.mostNegativeEvents.map(event => (
                      <div key={event.articleId} className="p-4">
                        <Link href={`/article/${event.articleId}`} className="font-semibold hover:text-primary block mb-1">
                          {event.issuerName ? <span className="font-bold mr-1">{event.issuerName}:</span> : null}
                          {event.title}
                        </Link>
                        <div className="flex gap-2 text-xs font-mono text-muted-foreground">
                          {event.urgencyScore && <span className="text-orange-400">U{event.urgencyScore}</span>}
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

              {/* IMPACTED SECTORS */}
              <section>
                <h2 className="text-lg font-bold font-mono flex items-center mb-4 text-card-foreground">
                  <Target className="h-5 w-5 mr-2 text-primary" />
                  MOST IMPACTED SECTORS
                </h2>
                <Card>
                  <CardContent className="p-0 divide-y divide-border">
                    {brief.mostImpactedSectors.map(sector => (
                      <div key={sector.sector} className="p-4 flex justify-between items-center">
                        <div>
                          <div className="font-bold">{sector.sector.toUpperCase()}</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {sector.negativeCount} negative events detected
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-mono text-muted-foreground mb-1">RISK SCORE</div>
                          <div className={`font-mono text-xl font-bold ${sector.riskScore >= 50 ? 'text-destructive' : 'text-primary'}`}>
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

            {/* KEY TRENDS */}
            <section>
              <h2 className="text-lg font-bold font-mono flex items-center mb-4 text-card-foreground">
                <TrendingUp className="h-5 w-5 mr-2" />
                EMERGING MACRO TRENDS
              </h2>
              <div className="bg-card border border-border rounded-lg p-6">
                <ul className="space-y-4">
                  {brief.keyTrends.map((trend, i) => (
                    <li key={i} className="flex items-start">
                      <span className="text-primary font-mono mr-4 mt-0.5 text-lg">0{i + 1}</span>
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
