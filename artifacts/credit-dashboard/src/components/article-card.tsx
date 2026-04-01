import { Article } from "@workspace/api-client-react";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Link } from "wouter";
import { Clock, AlertTriangle, AlertOctagon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function ArticleCard({ article }: { article: Article }) {
  const getSentimentColor = (sentiment?: string | null) => {
    switch (sentiment?.toLowerCase()) {
      case "negative": return "bg-destructive text-destructive-foreground hover:bg-destructive";
      case "positive": return "bg-green-600 text-white hover:bg-green-600";
      case "neutral": return "bg-muted text-muted-foreground hover:bg-muted";
      default: return "bg-secondary text-secondary-foreground hover:bg-secondary";
    }
  };

  const getUrgencyProps = (score?: number | null) => {
    switch(score) {
      case 5: return { label: "CRITICAL", color: "bg-red-600 text-white border-red-600" };
      case 4: return { label: "HIGH", color: "bg-orange-500 text-white border-orange-500" };
      case 3: return { label: "ELEVATED", color: "bg-amber-500 text-black border-amber-500" };
      case 2: return { label: "MOD", color: "bg-blue-500 text-white border-blue-500" };
      case 1: return { label: "INFO", color: "bg-gray-500 text-white border-gray-500" };
      default: return null;
    }
  };
  
  const urgency = getUrgencyProps(article.urgencyScore);

  return (
    <Link href={`/article/${article.id}`} className="block transition-all hover:-translate-y-0.5 no-default-hover-elevate">
      <Card className={`bg-card border-border hover:border-primary/50 transition-colors h-full ${article.covenantFlag ? 'border-red-600/50 hover:border-red-600' : ''}`}>
        <CardHeader className="p-4 pb-2">
          <div className="flex justify-between items-start gap-2 mb-2">
            <div className="flex flex-wrap gap-1.5">
              {article.covenantFlag && (
                <Badge className="bg-red-600 text-white hover:bg-red-600 font-bold border-red-600 animate-pulse">
                  <AlertOctagon className="h-3 w-3 mr-1" />
                  ⚠ COVENANT
                </Badge>
              )}
              {urgency && (
                <Badge className={`${urgency.color} font-bold text-[0.65rem]`}>
                  {urgency.label}
                </Badge>
              )}
              {article.issuerName && (
                <Badge variant="outline" className="font-mono bg-card text-card-foreground border-border text-[0.7rem] uppercase">
                  {article.issuerName}
                </Badge>
              )}
              {article.cloImpact && (
                <Badge variant="outline" className="bg-primary/20 text-primary border-primary font-bold">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  CLO IMPACT
                </Badge>
              )}
              {article.ratingMentioned && (
                <Badge className="bg-purple-900/40 text-purple-200 hover:bg-purple-900/60 border-purple-700 font-mono text-[0.65rem]">
                  {article.ratingAgency ? `${article.ratingAgency === "Moody's" ? 'MDY' : article.ratingAgency === 'S&P' ? 'S&P' : 'FIT'}: ` : ''}{article.ratingMentioned}
                </Badge>
              )}
              {article.sentiment && (
                <Badge className={`font-semibold text-[0.65rem] ${getSentimentColor(article.sentiment)}`}>
                  {article.sentiment.toUpperCase()}
                </Badge>
              )}
              {article.sector && (
                <Badge variant="secondary" className="bg-secondary text-[0.65rem]">
                  {article.sector.toUpperCase()}
                </Badge>
              )}
              {article.eventType && (
                <Badge variant="outline" className="border-border text-[0.65rem]">
                  {article.eventType.toUpperCase()}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground font-mono flex items-center shrink-0">
              <Clock className="h-3 w-3 mr-1" />
              {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}
            </div>
          </div>
          <h3 className="font-semibold text-lg leading-tight text-card-foreground line-clamp-2 mt-1">
            {article.title}
          </h3>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {article.summary || "No summary available."}
          </p>
          <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
            <span>SRC: {article.source}</span>
            <span>ID: {article.id}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
