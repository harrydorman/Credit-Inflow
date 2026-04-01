import { useGetDailyBrief, useListArticles } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { ArticleCard } from "@/components/article-card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, TrendingDown, TrendingUp, AlertCircle, FileText, AlertOctagon, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { useState, useEffect } from "react";
import { Toggle } from "@/components/ui/toggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const [covenantOnly, setCovenantOnly] = useState(false);
  const [marketImpact, setMarketImpact] = useState<string>("all");
  const [minUrgency, setMinUrgency] = useState<string>("all");
  const [issuerFilter, setIssuerFilter] = useState<string | undefined>();

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const initialIssuer = searchParams.get('issuerName');
    if (initialIssuer) {
      setIssuerFilter(initialIssuer);
    }
  }, []);

  const { data: articlesData, isLoading: isLoadingArticles } = useListArticles({ 
    limit: 20,
    covenantFlag: covenantOnly ? true : undefined,
    marketImpact: marketImpact !== "all" ? marketImpact : undefined,
    minUrgency: minUrgency !== "all" ? parseInt(minUrgency) : undefined,
    issuerName: issuerFilter,
  });
  
  const { data: dailyBrief, isLoading: isLoadingBrief } = useGetDailyBrief();

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
              <SelectTrigger className="w-[140px] h-8 text-xs font-mono bg-transparent">
                <SelectValue placeholder="URGENCY" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ALL URGENCY</SelectItem>
                <SelectItem value="5">CRITICAL ONLY</SelectItem>
                <SelectItem value="4">HIGH & ABOVE</SelectItem>
                <SelectItem value="3">ELEVATED+</SelectItem>
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

        {/* Sidebar Brief */}
        <div className="w-full lg:w-96 overflow-auto bg-card/50">
          <div className="p-6">
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
              <div className="space-y-6">
                
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
                        <div className="text-xs font-mono text-muted-foreground mt-1 flex gap-2">
                          <span>{event.sector}</span>
                          {event.ratingMentioned && <span className="text-purple-400">| {event.ratingMentioned}</span>}
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
    </Layout>
  );
}
