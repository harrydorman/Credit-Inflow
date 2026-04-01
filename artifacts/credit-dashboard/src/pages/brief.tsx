import { useGetDailyBrief } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock, Target, TrendingDown, TrendingUp } from "lucide-react";
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
                          {event.title}
                        </Link>
                        <div className="flex gap-2 text-xs font-mono text-muted-foreground">
                          <span className="text-destructive">{event.sentiment?.toUpperCase()}</span>
                          <span>|</span>
                          <span>{event.sector?.toUpperCase()}</span>
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
