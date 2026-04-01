import { Article } from "@workspace/api-client-react/src/generated/api.schemas";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Link } from "wouter";
import { Clock, AlertTriangle } from "lucide-react";
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

  return (
    <Link href={`/article/${article.id}`} className="block transition-all hover:-translate-y-0.5 no-default-hover-elevate">
      <Card className="bg-card border-border hover:border-primary/50 transition-colors h-full">
        <CardHeader className="p-4 pb-2">
          <div className="flex justify-between items-start gap-2 mb-2">
            <div className="flex flex-wrap gap-1.5">
              {article.cloImpact && (
                <Badge variant="outline" className="bg-primary/20 text-primary border-primary font-bold">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  CLO IMPACT
                </Badge>
              )}
              {article.sentiment && (
                <Badge className={`font-semibold ${getSentimentColor(article.sentiment)}`}>
                  {article.sentiment.toUpperCase()}
                </Badge>
              )}
              {article.sector && (
                <Badge variant="secondary" className="bg-secondary">
                  {article.sector.toUpperCase()}
                </Badge>
              )}
              {article.eventType && (
                <Badge variant="outline" className="border-border">
                  {article.eventType.toUpperCase()}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground font-mono flex items-center shrink-0">
              <Clock className="h-3 w-3 mr-1" />
              {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}
            </div>
          </div>
          <h3 className="font-semibold text-lg leading-tight text-card-foreground line-clamp-2">
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
