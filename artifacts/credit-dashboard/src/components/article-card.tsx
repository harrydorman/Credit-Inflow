import { Article } from "@workspace/api-client-react";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Link } from "wouter";
import { Clock, AlertTriangle, AlertOctagon, CheckCircle, AlertCircle, TrendingUp, TrendingDown, Shield, Files } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function ArticleCard({ article }: { article: Article }) {
  const enriched = article as Article & {
    trustProfile?: { trustLabel: string; trustScore: number; sourceTier: string; evidenceCount: number; corroboratingArticleCount?: number; primarySourcePresent?: boolean };
    signalCard?: { signalLabel: string; whyNow: string; confidence: string; decisionUse?: string; creditImplications?: string[] };
    sourceProfile?: { displayName?: string };
  };

  const getSentimentColor = (sentiment?: string | null) => {
    switch (sentiment?.toLowerCase()) {
      case "negative": return "bg-destructive text-destructive-foreground hover:bg-destructive";
      case "positive": return "bg-green-600 text-white hover:bg-green-600";
      case "neutral": return "bg-muted text-muted-foreground hover:bg-muted";
      default: return "bg-secondary text-secondary-foreground hover:bg-secondary";
    }
  };

  const getUrgencyProps = (score?: number | null) => {
    if ((score ?? 0) >= 8) return { label: "CRITICAL", color: "bg-red-600 text-white border-red-600" };
    if ((score ?? 0) >= 6) return { label: "HIGH", color: "bg-orange-500 text-white border-orange-500" };
    if ((score ?? 0) >= 4) return { label: "ELEVATED", color: "bg-amber-500 text-black border-amber-500" };
    if ((score ?? 0) >= 2) return { label: "WATCH", color: "bg-blue-500 text-white border-blue-500" };
    return { label: "INFO", color: "bg-gray-500 text-white border-gray-500" };
  };

  const urgency = getUrgencyProps(article.finalUrgencyScore ?? article.urgencyScore);

  return (
    <Link href={`/article/${article.id}`} className="block transition-all hover:-translate-y-0.5 no-default-hover-elevate">
      <Card className={`bg-card border-border hover:border-primary/50 transition-colors h-full ${article.covenantFlag ? "border-red-600/50 hover:border-red-600" : ""}`}>
        <CardHeader className="p-4 pb-2">
          <div className="flex justify-between items-start gap-2 mb-2">
            <div className="flex flex-wrap gap-1.5">
              {article.covenantFlag && (
                <Badge className="bg-red-600 text-white hover:bg-red-600 font-bold border-red-600 animate-pulse">
                  <AlertOctagon className="h-3 w-3 mr-1" />
                  COVENANT
                </Badge>
              )}
              <Badge className={`${urgency.color} font-bold text-[0.65rem]`}>{urgency.label}</Badge>
              {enriched.signalCard?.signalLabel && (
                <Badge variant="outline" className="text-[0.65rem] border-primary/30 text-primary">
                  {enriched.signalCard.signalLabel.toUpperCase()}
                </Badge>
              )}
              {article.issuerName && (
                <Badge variant="outline" className="font-mono bg-card text-card-foreground border-border text-[0.7rem] uppercase">
                  {article.issuerName}
                </Badge>
              )}
              {article.ratingMentioned && (
                <Badge className="bg-purple-900/40 text-purple-200 hover:bg-purple-900/60 border-purple-700 font-mono text-[0.65rem]">
                  {article.ratingAgency ? `${article.ratingAgency}: ` : ""}{article.ratingMentioned}
                </Badge>
              )}
              {article.sentiment && (
                <Badge className={`font-semibold text-[0.65rem] ${getSentimentColor(article.sentiment)}`}>
                  {article.sentiment.toUpperCase()}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground font-mono flex items-center shrink-0">
              <Clock className="h-3 w-3 mr-1" />
              {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}
            </div>
          </div>
          <h3 className="font-semibold text-lg leading-tight text-card-foreground line-clamp-2 mt-1">{article.title}</h3>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <p className="text-sm text-muted-foreground line-clamp-3">
            {enriched.signalCard?.whyNow || article.summary || "No summary available."}
          </p>

          {enriched.signalCard?.creditImplications && enriched.signalCard.creditImplications.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {enriched.signalCard.creditImplications.slice(0, 2).map((implication, idx) => (
                <Badge key={idx} variant="outline" className="text-[10px] border-border text-muted-foreground">
                  {implication}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground font-mono gap-2">
            <span className="truncate">SRC: {article.source} {enriched.trustProfile ? `· ${enriched.trustProfile.sourceTier.toUpperCase()}` : ""}</span>
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {enriched.trustProfile?.primarySourcePresent && (
                <span className="flex items-center gap-0.5 text-emerald-400 bg-emerald-950/30 border border-emerald-800/40 px-1.5 py-0.5 rounded text-[10px] font-bold">
                  <Shield className="h-2.5 w-2.5" /> PRIMARY
                </span>
              )}
              {(enriched.trustProfile?.trustLabel === "high" || article.confidenceScore === "high") && (
                <span className="flex items-center gap-0.5 text-emerald-400 bg-emerald-950/30 border border-emerald-800/40 px-1.5 py-0.5 rounded text-[10px] font-bold">
                  <CheckCircle className="h-2.5 w-2.5" /> TRUST {enriched.trustProfile?.trustScore ?? "HI"}
                </span>
              )}
              {(enriched.trustProfile?.trustLabel === "medium" || article.confidenceScore === "medium") && (
                <span className="flex items-center gap-0.5 text-amber-400 bg-amber-950/20 border border-amber-800/30 px-1.5 py-0.5 rounded text-[10px]">
                  TRUST {enriched.trustProfile?.trustScore ?? "MED"}
                </span>
              )}
              {article.marketValidationSignal === "confirmed" && (
                <span className="flex items-center gap-0.5 text-emerald-400 text-[10px] font-bold">
                  <CheckCircle className="h-2.5 w-2.5" /> MKT
                </span>
              )}
              {article.marketValidationSignal === "mixed" && (
                <span className="flex items-center gap-0.5 text-yellow-500 text-[10px] font-bold">
                  <AlertCircle className="h-2.5 w-2.5" /> MIXED
                </span>
              )}
              {article.stockMove1D !== null && article.stockMove1D !== undefined && (
                <span className={`flex items-center gap-0.5 text-[10px] font-mono ${article.stockMove1D < 0 ? "text-red-400" : "text-emerald-400"}`}>
                  {article.stockMove1D < 0 ? <TrendingDown className="h-2.5 w-2.5" /> : <TrendingUp className="h-2.5 w-2.5" />}
                  {article.stockMove1D.toFixed(2)}%
                </span>
              )}
              {enriched.trustProfile && (
                <span className="flex items-center gap-0.5 text-[10px]">
                  <Files className="h-2.5 w-2.5" />
                  EV {enriched.trustProfile.evidenceCount}{(enriched.trustProfile.corroboratingArticleCount ?? 0) > 0 ? ` +${enriched.trustProfile.corroboratingArticleCount}X` : ""}
                </span>
              )}
            </div>
          </div>

          {enriched.signalCard?.decisionUse && (
            <div className="text-[11px] text-primary/90 border-t border-border pt-2">
              <span className="font-mono mr-2 text-muted-foreground">NEXT:</span>
              {enriched.signalCard.decisionUse}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
