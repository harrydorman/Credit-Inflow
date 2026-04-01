import { useGetArticle } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { useParams } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowLeft, Calendar, ExternalLink, Target, Users } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

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
                {article.cloImpact && (
                  <Badge variant="outline" className="bg-primary/20 text-primary border-primary font-bold px-3 py-1">
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    CLO IMPACT DETECTED
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
              </div>
              
              <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-tight mb-4 text-foreground">
                {article.title}
              </h1>
              
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

              {(article.whyItMatters || article.whoCares) && <Separator className="bg-border" />}

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
