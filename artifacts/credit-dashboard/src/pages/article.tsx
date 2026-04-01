import { useGetArticle } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { useParams } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, ArrowLeft, Calendar, ExternalLink, Target, Users,
  TrendingDown, TrendingUp, Minus, Zap, Activity, AlertOctagon, BarChart3,
  CheckCircle, AlertCircle, BarChart2
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function UrgencyMeter({ score }: { score: number }) {
  const segments = Array.from({ length: 10 }, (_, i) => i + 1);
  const color = score >= 8 ? "bg-red-500" : score >= 6 ? "bg-orange-500" : score >= 4 ? "bg-amber-500" : "bg-emerald-600";
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {segments.map((s) => (
          <div
            key={s}
            className={`h-3 w-3 rounded-sm transition-all ${s <= score ? color : "bg-secondary"}`}
          />
        ))}
      </div>
      <span className={`font-bold font-mono text-sm ${score >= 8 ? "text-red-400" : score >= 6 ? "text-orange-400" : score >= 4 ? "text-amber-400" : "text-emerald-400"}`}>
        {score}/10
      </span>
    </div>
  );
}

function CreditMetricBadge({ label, active, color = "amber" }: { label: string; active: boolean; color?: string }) {
  const colors: Record<string, string> = {
    red: "bg-red-950/50 border-red-800/50 text-red-400",
    amber: "bg-amber-950/30 border-amber-800/40 text-amber-400",
    orange: "bg-orange-950/30 border-orange-800/40 text-orange-400",
    muted: "bg-secondary border-border text-muted-foreground opacity-40",
  };
  return (
    <div className={`px-2 py-1 rounded border text-[10px] font-mono font-bold flex items-center gap-1 ${active ? (colors[color] ?? colors.amber) : colors.muted}`}>
      <span>{active ? "●" : "○"}</span>
      <span>{label}</span>
    </div>
  );
}

export default function ArticleDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);

  const { data: article, isLoading } = useGetArticle(id, { query: { enabled: !!id } });

  const getSentimentColor = (sentiment?: string | null) => {
    switch (sentiment?.toLowerCase()) {
      case "negative": return "bg-destructive text-destructive-foreground";
      case "positive": return "bg-green-600 text-white";
      case "neutral": return "bg-muted text-muted-foreground";
      default: return "bg-secondary text-secondary-foreground";
    }
  };

  const tradeDirectionIcon = (dir?: string | null) => {
    switch (dir) {
      case "negative": return <TrendingDown className="h-4 w-4 text-red-400" />;
      case "positive": return <TrendingUp className="h-4 w-4 text-green-400" />;
      default: return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const tradeDirectionStyle = (dir?: string | null) => {
    switch (dir) {
      case "negative": return "border-red-700/60 bg-red-950/20";
      case "positive": return "border-green-700/60 bg-green-950/20";
      default: return "border-border bg-card";
    }
  };

  const cloRelevanceColor = (rel?: string | null) => {
    switch (rel) {
      case "high": return "text-red-400 bg-red-950/30 border-red-800/50";
      case "medium": return "text-amber-400 bg-amber-950/20 border-amber-800/40";
      default: return "text-muted-foreground bg-secondary border-border";
    }
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto p-6 lg:p-8">
        <div className="mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm" className="font-mono text-xs text-muted-foreground hover:text-foreground -ml-3">
              <ArrowLeft className="h-3 w-3 mr-2" />
              BACK TO FEED
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-8 w-3/4" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
            <Skeleton className="h-32 w-full mt-8" />
            <Skeleton className="h-32 w-full mt-4" />
          </div>
        ) : article ? (
          <div className="space-y-8">
            <header>
              <div className="flex flex-wrap gap-2 mb-4">
                {article.covenantFlag && (
                  <Badge variant="outline" className="bg-red-950/40 text-red-400 border-red-800 font-bold px-3 py-1 animate-pulse">
                    <AlertOctagon className="h-4 w-4 mr-2" />
                    COVENANT FLAG
                    {article.covenantType && <span className="ml-1 opacity-80">· {article.covenantType}</span>}
                  </Badge>
                )}
                {article.cloImpact && (
                  <Badge variant="outline" className="bg-primary/20 text-primary border-primary font-bold px-3 py-1">
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    CLO IMPACT
                    {article.cloRelevance && <span className="ml-1 opacity-80">· {article.cloRelevance.toUpperCase()}</span>}
                  </Badge>
                )}
                {article.sentiment && (
                  <Badge className={`font-bold px-3 py-1 ${getSentimentColor(article.sentiment)}`}>
                    {article.sentiment.toUpperCase()}
                  </Badge>
                )}
                {article.sector && (
                  <Badge variant="secondary" className="bg-secondary px-3 py-1">
                    {article.sector.toUpperCase()}
                  </Badge>
                )}
                {article.eventType && (
                  <Badge variant="outline" className="border-border px-3 py-1">
                    {article.eventType.toUpperCase()}
                  </Badge>
                )}
                {article.ratingMentioned && (
                  <Badge variant="outline" className={`font-bold px-3 py-1 ${article.ratingIsDowngrade ? "text-red-400 border-red-800 bg-red-950/30" : article.ratingIsUpgrade ? "text-green-400 border-green-800 bg-green-950/30" : "text-purple-400 border-purple-800/40 bg-purple-950/20"}`}>
                    {article.ratingAgency && <span className="mr-1">{article.ratingAgency}</span>}
                    {article.ratingMentioned}
                    {article.ratingIsDowngrade && " ↓"}
                    {article.ratingIsUpgrade && " ↑"}
                    {article.ratingIsCCCThreshold && " ⚠ CCC"}
                  </Badge>
                )}
              </div>

              <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-tight mb-4 text-foreground">
                {article.issuerName && <span className="text-primary">{article.issuerName}: </span>}
                {article.title}
              </h1>

              {/* Urgency Meter */}
              {(article.finalUrgencyScore ?? article.urgencyScore) && (
                <div className="flex items-center gap-4 mb-4 p-3 bg-card/60 border border-border rounded-lg">
                  <div>
                    <p className="text-[10px] font-mono text-muted-foreground mb-1">URGENCY SCORE</p>
                    <UrgencyMeter score={article.finalUrgencyScore ?? article.urgencyScore ?? 0} />
                  </div>
                  {article.creditSignalScore != null && (
                    <div className="border-l border-border pl-4">
                      <p className="text-[10px] font-mono text-muted-foreground mb-1">CREDIT SIGNAL</p>
                      <span className={`font-mono font-bold text-sm ${article.creditSignalScore >= 6 ? "text-red-400" : article.creditSignalScore >= 3 ? "text-amber-400" : "text-muted-foreground"}`}>
                        {article.creditSignalScore > 0 ? "+" : ""}{article.creditSignalScore}
                      </span>
                    </div>
                  )}
                  {article.marketImpact && (
                    <div className="border-l border-border pl-4">
                      <p className="text-[10px] font-mono text-muted-foreground mb-1">MKT IMPACT</p>
                      <span className={`font-mono font-bold text-xs ${article.marketImpact === "high" ? "text-red-400" : article.marketImpact === "medium" ? "text-amber-400" : "text-emerald-400"}`}>
                        {article.marketImpact.toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 text-sm font-mono text-muted-foreground border-b border-border pb-6">
                <div className="flex items-center">
                  <span className="font-semibold mr-2">SRC:</span>
                  {article.source}
                </div>
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-2" />
                  {new Date(article.publishedAt).toLocaleString()}
                </div>
                <a href={article.url} target="_blank" rel="noopener noreferrer" className="flex items-center text-primary hover:underline">
                  <ExternalLink className="h-4 w-4 mr-1" />
                  ORIGINAL
                </a>
              </div>
            </header>

            <main className="space-y-8">
              {article.summary && (
                <section>
                  <h2 className="text-sm font-bold text-muted-foreground font-mono mb-3">AI SUMMARY</h2>
                  <div className="prose prose-invert max-w-none text-lg leading-relaxed text-foreground/90">
                    <p>{article.summary}</p>
                  </div>
                </section>
              )}

              {/* Credit Metric Flags */}
              {(article.leverageMentioned || article.liquidityConcern || article.refinancingRisk ||
                article.earningsMiss || article.spreadWideningRisk || article.forcedSellingRisk || article.distressedRisk) && (
                <section>
                  <h2 className="text-sm font-bold text-muted-foreground font-mono flex items-center mb-3">
                    <BarChart3 className="h-4 w-4 mr-2" />
                    CREDIT SIGNAL FLAGS
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    <CreditMetricBadge label="LEVERAGE" active={!!article.leverageMentioned} color="amber" />
                    <CreditMetricBadge label="LIQUIDITY CONCERN" active={!!article.liquidityConcern} color="orange" />
                    <CreditMetricBadge label="REFI RISK" active={!!article.refinancingRisk} color="orange" />
                    <CreditMetricBadge label="EARNINGS MISS" active={!!article.earningsMiss} color="amber" />
                    <CreditMetricBadge label="SPREAD WIDENING" active={!!article.spreadWideningRisk} color="red" />
                    <CreditMetricBadge label="FORCED SELLING" active={!!article.forcedSellingRisk} color="red" />
                    <CreditMetricBadge label="DISTRESSED" active={!!article.distressedRisk} color="red" />
                  </div>
                </section>
              )}

              {/* Market Validation Section */}
              {(article.marketValidationSignal || article.confidenceScore || article.hyETFMove !== null) && (
                <section>
                  <h2 className="text-sm font-bold text-muted-foreground font-mono flex items-center mb-3">
                    <BarChart2 className="h-4 w-4 mr-2" />
                    MARKET VALIDATION
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {/* Validation Signal */}
                    <div className={`p-3 rounded-lg border text-center ${
                      article.marketValidationSignal === "confirmed" ? "bg-emerald-950/20 border-emerald-800/40" :
                      article.marketValidationSignal === "mixed" ? "bg-yellow-950/20 border-yellow-800/40" :
                      "bg-secondary/30 border-border"
                    }`}>
                      <div className="text-[10px] font-mono text-muted-foreground mb-1">SIGNAL</div>
                      {article.marketValidationSignal === "confirmed" && (
                        <div className="flex items-center justify-center gap-1 text-emerald-400 font-bold text-xs">
                          <CheckCircle className="h-3 w-3" /> CONFIRMED
                        </div>
                      )}
                      {article.marketValidationSignal === "mixed" && (
                        <div className="flex items-center justify-center gap-1 text-yellow-500 font-bold text-xs">
                          <AlertCircle className="h-3 w-3" /> DIVERGENCE
                        </div>
                      )}
                      {article.marketValidationSignal === "unconfirmed" && (
                        <div className="text-muted-foreground text-xs">UNCONFIRMED</div>
                      )}
                      {!article.marketValidationSignal && (
                        <div className="text-muted-foreground text-xs">N/A</div>
                      )}
                    </div>

                    {/* Confidence Score */}
                    <div className={`p-3 rounded-lg border text-center ${
                      article.confidenceScore === "high" ? "bg-emerald-950/20 border-emerald-800/40" :
                      article.confidenceScore === "medium" ? "bg-amber-950/20 border-amber-800/40" :
                      "bg-secondary/30 border-border"
                    }`}>
                      <div className="text-[10px] font-mono text-muted-foreground mb-1">CONFIDENCE</div>
                      <div className={`font-bold text-xs uppercase ${
                        article.confidenceScore === "high" ? "text-emerald-400" :
                        article.confidenceScore === "medium" ? "text-amber-400" :
                        "text-muted-foreground"
                      }`}>{article.confidenceScore ?? "N/A"}</div>
                    </div>

                    {/* Stock Move 1D */}
                    <div className="p-3 rounded-lg border border-border bg-secondary/30 text-center">
                      <div className="text-[10px] font-mono text-muted-foreground mb-1">STOCK 1D</div>
                      {article.stockMove1D !== null && article.stockMove1D !== undefined ? (
                        <div className={`flex items-center justify-center gap-1 font-bold text-xs ${article.stockMove1D < 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {article.stockMove1D < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                          {article.stockMove1D.toFixed(2)}%
                        </div>
                      ) : <div className="text-muted-foreground text-xs">N/A</div>}
                    </div>

                    {/* HYG ETF Move */}
                    <div className="p-3 rounded-lg border border-border bg-secondary/30 text-center">
                      <div className="text-[10px] font-mono text-muted-foreground mb-1">HYG 1D</div>
                      {article.hyETFMove !== null && article.hyETFMove !== undefined ? (
                        <div className={`flex items-center justify-center gap-1 font-bold text-xs ${article.hyETFMove < 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {article.hyETFMove < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                          {article.hyETFMove.toFixed(2)}%
                        </div>
                      ) : <div className="text-muted-foreground text-xs">N/A</div>}
                    </div>
                  </div>

                  {/* Divergence explanation */}
                  {article.marketValidationSignal === "mixed" && (
                    <div className="mt-3 p-3 rounded-lg border border-yellow-800/40 bg-yellow-950/10 text-xs text-yellow-500">
                      <AlertCircle className="h-3 w-3 inline mr-1" />
                      <span className="font-bold">Divergence Detected:</span> Market price action does not confirm the news sentiment. Treat signal with caution — could indicate the market has priced in the news, or the credit market is lagging equity moves.
                    </div>
                  )}
                </section>
              )}

              <Separator className="bg-border" />

              {/* Trade Implications */}
              {(article.tradeDirection || article.tradeRationale || (article.potentialTrades && article.potentialTrades.length > 0)) && (
                <section>
                  <h2 className="text-sm font-bold text-primary font-mono flex items-center mb-3">
                    <Zap className="h-4 w-4 mr-2" />
                    TRADE IMPLICATIONS
                  </h2>
                  <Card className={`border ${tradeDirectionStyle(article.tradeDirection)}`}>
                    <CardContent className="p-4 space-y-4">
                      <div className="flex items-center gap-3">
                        {tradeDirectionIcon(article.tradeDirection)}
                        <span className={`font-bold font-mono text-sm ${article.tradeDirection === "negative" ? "text-red-400" : article.tradeDirection === "positive" ? "text-green-400" : "text-muted-foreground"}`}>
                          {article.tradeDirection ? article.tradeDirection.toUpperCase() : "NEUTRAL"} SIGNAL
                        </span>
                        {article.marketsImpacted && article.marketsImpacted.length > 0 && (
                          <div className="flex flex-wrap gap-1 ml-auto">
                            {article.marketsImpacted.map((m, i) => (
                              <Badge key={i} variant="secondary" className="text-[10px] font-mono">{m}</Badge>
                            ))}
                          </div>
                        )}
                      </div>

                      {article.tradeRationale && (
                        <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-3">
                          {article.tradeRationale}
                        </p>
                      )}

                      {article.potentialTrades && article.potentialTrades.length > 0 && (
                        <div>
                          <p className="text-[10px] font-mono text-muted-foreground mb-2">POTENTIAL TRADES:</p>
                          <ul className="space-y-1.5">
                            {article.potentialTrades.map((trade, i) => (
                              <li key={i} className="flex items-start text-sm">
                                <span className="text-primary font-mono mr-2 text-xs">→</span>
                                <span className="text-foreground/90">{trade}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </section>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {article.whyItMatters && (
                  <section className="bg-card p-6 rounded-lg border border-border">
                    <h2 className="text-sm font-bold text-primary font-mono flex items-center mb-3">
                      <Target className="h-4 w-4 mr-2" />
                      WHY IT MATTERS
                    </h2>
                    <p className="text-muted-foreground leading-relaxed">
                      {article.whyItMatters}
                    </p>
                  </section>
                )}

                {article.whoCares && (
                  <section className="bg-card p-6 rounded-lg border border-border">
                    <h2 className="text-sm font-bold text-primary font-mono flex items-center mb-3">
                      <Users className="h-4 w-4 mr-2" />
                      WHO CARES
                    </h2>
                    <p className="text-muted-foreground leading-relaxed">
                      {article.whoCares}
                    </p>
                  </section>
                )}
              </div>

              {/* CLO Deep Analysis */}
              {(article.cloImpact || (article.cloRelevance && article.cloRelevance !== "low")) && (
                <section>
                  <h2 className="text-sm font-bold text-primary font-mono flex items-center mb-3">
                    <Activity className="h-4 w-4 mr-2" />
                    CLO STRUCTURAL ANALYSIS
                  </h2>
                  <Card className="border-primary/30 bg-primary/5">
                    <CardContent className="p-4 space-y-4">
                      <div className="flex flex-wrap gap-3">
                        {article.cloRelevance && (
                          <div>
                            <p className="text-[10px] font-mono text-muted-foreground mb-1">RELEVANCE</p>
                            <Badge variant="outline" className={`font-mono text-xs ${cloRelevanceColor(article.cloRelevance)}`}>
                              {article.cloRelevance.toUpperCase()}
                            </Badge>
                          </div>
                        )}
                        {article.cloWarfImpact && article.cloWarfImpact !== "neutral" && (
                          <div>
                            <p className="text-[10px] font-mono text-muted-foreground mb-1">WARF IMPACT</p>
                            <Badge variant="outline" className={`font-mono text-xs ${article.cloWarfImpact === "increase" ? "text-red-400 border-red-800 bg-red-950/30" : "text-green-400 border-green-800 bg-green-950/30"}`}>
                              {article.cloWarfImpact === "increase" ? "↑ INCREASE" : "↓ DECREASE"}
                            </Badge>
                          </div>
                        )}
                        {article.cloLoanVsBond && (
                          <div>
                            <p className="text-[10px] font-mono text-muted-foreground mb-1">INSTRUMENT</p>
                            <Badge variant="secondary" className="font-mono text-xs">
                              {article.cloLoanVsBond.toUpperCase()}
                            </Badge>
                          </div>
                        )}
                        {article.cloCCCBucketRisk && (
                          <div>
                            <p className="text-[10px] font-mono text-muted-foreground mb-1">CCC BUCKET</p>
                            <Badge variant="outline" className="font-mono text-xs text-red-400 border-red-800 bg-red-950/30 animate-pulse">
                              ⚠ AT RISK
                            </Badge>
                          </div>
                        )}
                      </div>

                      {article.cloImpactTypes && article.cloImpactTypes.length > 0 && (
                        <div>
                          <p className="text-[10px] font-mono text-muted-foreground mb-2">IMPACT TYPES:</p>
                          <div className="flex flex-wrap gap-1">
                            {article.cloImpactTypes.map((type, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] font-mono text-amber-400 border-amber-800/40">
                                {type}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {article.cloExplanation && (
                        <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-3">
                          {article.cloExplanation}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </section>
              )}
            </main>

            <footer className="pt-8 border-t border-border text-xs font-mono text-muted-foreground flex justify-between">
              <span>ARTICLE ID: {article.id}</span>
              <span>PROCESSED: {new Date(article.processedAt || article.createdAt).toLocaleString()}</span>
            </footer>
          </div>
        ) : (
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold">Article Not Found</h2>
          </div>
        )}
      </div>
    </Layout>
  );
}
