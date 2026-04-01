import { useGetSignals, useListArticles } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Link, useSearch } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArticleCard } from "@/components/article-card";
import { AlertTriangle, BarChart3, ChevronLeft, Filter, TrendingDown } from "lucide-react";
import { useState, useEffect } from "react";

const SECTOR_COLORS: Record<string, string> = {
  "High Yield": "text-red-400",
  "Energy": "text-orange-400",
  "Healthcare": "text-emerald-400",
  "Retail": "text-amber-400",
  "Technology": "text-blue-400",
  "Real Estate": "text-purple-400",
  "Financial": "text-cyan-400",
  "Industrials": "text-yellow-400",
  "Telecom": "text-pink-400",
  "Macro": "text-violet-400",
  "CLO / Structured Credit": "text-primary",
};

function RiskBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const color = pct >= 60 ? "bg-red-500" : pct >= 30 ? "bg-amber-500" : "bg-emerald-600";
  return (
    <div className="w-full bg-secondary rounded-full h-1.5">
      <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SectorCard({ sector, onClick, isSelected }: {
  sector: {
    sector: string; totalArticles: number; negativeCount: number;
    riskScore: number; eventTypes: string[]; creditSignalScore?: number;
  };
  onClick: (s: string) => void;
  isSelected: boolean;
}) {
  const negRatio = sector.totalArticles > 0 ? sector.negativeCount / sector.totalArticles : 0;
  const sectorColor = SECTOR_COLORS[sector.sector] ?? "text-foreground";
  const conditionLabel = negRatio >= 0.5 ? "DETERIORATING" : negRatio >= 0.25 ? "WATCH" : "STABLE";
  const conditionColor = negRatio >= 0.5 ? "text-red-400 border-red-800/50 bg-red-950/20" :
    negRatio >= 0.25 ? "text-amber-400 border-amber-800/40 bg-amber-950/10" :
    "text-emerald-400 border-emerald-800/40 bg-emerald-950/10";

  return (
    <div
      onClick={() => onClick(sector.sector)}
      className={`p-4 bg-card border rounded-lg cursor-pointer transition-all space-y-3 ${
        isSelected ? "border-primary/60 bg-primary/5" : "border-border hover:border-primary/30 hover:bg-card/80"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className={`font-bold font-mono text-sm ${sectorColor}`}>{sector.sector.toUpperCase()}</div>
          <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{sector.totalArticles} articles</div>
        </div>
        <Badge variant="outline" className={`text-[9px] font-mono flex-shrink-0 ${conditionColor}`}>
          {conditionLabel}
        </Badge>
      </div>

      <div>
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground mb-1">
          <span>NEG SIGNAL RATIO</span>
          <span>{sector.negativeCount}/{sector.totalArticles}</span>
        </div>
        <RiskBar value={sector.negativeCount} max={sector.totalArticles} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-[9px] font-mono text-muted-foreground">RISK SCORE</div>
          <div className={`font-bold font-mono text-base ${sector.riskScore >= 6 ? "text-red-400" : sector.riskScore >= 4 ? "text-amber-400" : "text-muted-foreground"}`}>
            {sector.riskScore.toFixed(1)}
          </div>
        </div>
        <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
          {sector.eventTypes.slice(0, 2).map((e, i) => (
            <Badge key={i} variant="secondary" className="text-[8px] font-mono">{e}</Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Sectors() {
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const initialSector = params.get("sector") ?? null;

  const [selectedSector, setSelectedSector] = useState<string | null>(initialSector);

  const { data: signals, isLoading: signalsLoading } = useGetSignals();
  const { data: articlesData, isLoading: articlesLoading } = useListArticles(
    selectedSector ? { sector: selectedSector, limit: 30 } : { limit: 0 },
    { query: { enabled: !!selectedSector } }
  );

  const handleSectorClick = (sector: string) => {
    setSelectedSector(prev => prev === sector ? null : sector);
  };

  const sectors = signals?.bySector ?? [];
  const maxArticles = Math.max(...sectors.map(s => s.totalArticles), 1);

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-screen-xl mx-auto">

        <div className="flex items-center gap-3">
          <Link href="/">
            <span className="text-xs font-mono text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer">
              <ChevronLeft className="h-3 w-3" /> MARKET OVERVIEW
            </span>
          </Link>
          <span className="text-muted-foreground text-xs font-mono">/</span>
          <span className="text-xs font-mono text-foreground font-bold">SECTOR ANALYSIS</span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono tracking-tight">SECTOR SIGNALS</h1>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {selectedSector
                ? `Showing articles for: ${selectedSector}`
                : "Click a sector to drill into its article feed"}
            </p>
          </div>
          {selectedSector && (
            <button
              onClick={() => setSelectedSector(null)}
              className="text-xs font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <Filter className="h-3 w-3" /> CLEAR FILTER
            </button>
          )}
        </div>

        {signalsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}
          </div>
        ) : sectors.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm font-mono py-16 border border-border rounded-lg">
            No sector data available — trigger a refresh to ingest articles.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {sectors
              .sort((a, b) => b.negativeCount - a.negativeCount || b.totalArticles - a.totalArticles)
              .map((sector) => (
                <SectorCard
                  key={sector.sector}
                  sector={sector}
                  onClick={handleSectorClick}
                  isSelected={selectedSector === sector.sector}
                />
              ))}
          </div>
        )}

        {/* Article feed for selected sector */}
        {selectedSector && (
          <div className="space-y-4 border-t border-border pt-6">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold font-mono">
                ARTICLES — <span className="text-primary">{selectedSector.toUpperCase()}</span>
              </h2>
              <span className="text-xs font-mono text-muted-foreground ml-1">
                ({articlesData?.articles?.length ?? 0} found)
              </span>
            </div>

            {articlesLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
              </div>
            ) : articlesData?.articles?.length === 0 ? (
              <div className="text-center text-muted-foreground text-xs font-mono py-8 border border-border rounded-lg">
                No articles found for {selectedSector}.
              </div>
            ) : (
              <div className="space-y-3">
                {(articlesData?.articles ?? []).map((article) => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
