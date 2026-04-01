import { useListIssuers } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Building, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { useLocation } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

export default function Issuers() {
  const { data, isLoading } = useListIssuers();
  const [, setLocation] = useLocation();

  const getUrgencyProps = (score: number) => {
    if (score >= 8) return { label: `${score}/10`, color: "bg-red-600 text-white border-red-600" };
    if (score >= 6) return { label: `${score}/10`, color: "bg-orange-500 text-white border-orange-500" };
    if (score >= 4) return { label: `${score}/10`, color: "bg-amber-500 text-black border-amber-500" };
    if (score >= 2) return { label: `${score}/10`, color: "bg-blue-500 text-white border-blue-500" };
    if (score >= 1) return { label: `${score}/10`, color: "bg-gray-500 text-white border-gray-500" };
    return { label: "-", color: "bg-transparent text-muted-foreground border-border" };
  };

  const getRiskTrendIcon = (trend: string) => {
    switch (trend) {
      case "deteriorating": return <TrendingDown className="h-3.5 w-3.5 text-red-400" />;
      case "improving": return <TrendingUp className="h-3.5 w-3.5 text-green-400" />;
      default: return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto p-6 lg:p-8 space-y-6">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center">
              <Building className="mr-3 h-8 w-8 text-primary" />
              ISSUER INTELLIGENCE
            </h1>
            <p className="text-muted-foreground font-mono mt-2">
              AGGREGATED RISK SIGNALS BY COMPANY
            </p>
          </div>
          {data && (
            <div className="text-right">
              <div className="text-sm font-mono text-muted-foreground mb-1">TOTAL ISSUERS</div>
              <div className="text-2xl font-mono font-bold text-primary">{data.total}</div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : data?.issuers ? (
          <div className="rounded-md border border-border overflow-hidden bg-card">
            <Table>
              <TableHeader className="bg-secondary/30">
                <TableRow>
                  <TableHead className="font-mono text-xs w-[250px]">ISSUER</TableHead>
                  <TableHead className="font-mono text-xs">SECTOR</TableHead>
                  <TableHead className="font-mono text-xs">URGENCY</TableHead>
                  <TableHead className="font-mono text-xs text-center">COVENANT</TableHead>
                  <TableHead className="font-mono text-xs text-center">NEG / TOTAL</TableHead>
                  <TableHead className="font-mono text-xs">RATING</TableHead>
                  <TableHead className="font-mono text-xs">LATEST SIGNAL</TableHead>
                  <TableHead className="font-mono text-xs text-center">TREND</TableHead>
                  <TableHead className="font-mono text-xs text-right">RISK SCORE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.issuers.map((issuer) => {
                  const urgency = getUrgencyProps(issuer.maxUrgency);
                  const isHighRisk = issuer.riskScore >= 70;
                  
                  return (
                    <TableRow 
                      key={issuer.issuerName} 
                      className="cursor-pointer hover:bg-secondary/20 transition-colors"
                      onClick={() => setLocation(`/?issuerName=${encodeURIComponent(issuer.issuerName)}`)}
                    >
                      <TableCell className="font-mono font-bold text-base truncate max-w-[250px]" title={issuer.issuerName}>
                        {issuer.issuerName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[0.65rem] bg-secondary/50">
                          {issuer.sector || "UNKNOWN"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${urgency.color} font-bold text-[0.65rem]`}>
                          {urgency.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {issuer.covenantFlag ? (
                          <Badge className="bg-red-600 hover:bg-red-600 text-white font-bold animate-pulse text-[0.65rem]">
                            ⚠ COVENANT
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs">
                        <span className={issuer.negativeCount > 0 ? "text-destructive font-bold" : ""}>
                          {issuer.negativeCount}
                        </span>
                        <span className="text-muted-foreground mx-1">/</span>
                        <span>{issuer.totalArticles}</span>
                      </TableCell>
                      <TableCell>
                        {issuer.ratingMentioned ? (
                          <Badge className="bg-purple-900/40 text-purple-200 border-purple-700 font-mono text-[0.65rem]">
                            {issuer.ratingAgency ? `${issuer.ratingAgency === "Moody's" ? 'MDY' : issuer.ratingAgency === 'S&P' ? 'S&P' : 'FIT'}: ` : ''}{issuer.ratingMentioned}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {formatDistanceToNow(new Date(issuer.latestArticleDate), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          {getRiskTrendIcon(issuer.riskTrend)}
                          <span className={`font-mono text-[10px] ${issuer.riskTrend === "deteriorating" ? "text-red-400" : issuer.riskTrend === "improving" ? "text-green-400" : "text-muted-foreground"}`}>
                            {issuer.riskTrend.toUpperCase().slice(0, 5)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className={`font-mono font-bold ${isHighRisk ? 'text-destructive' : issuer.riskScore >= 40 ? 'text-amber-500' : 'text-green-500'}`}>
                            {Math.round(issuer.riskScore)}
                          </span>
                          <div className="w-16 h-2 bg-secondary rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${isHighRisk ? 'bg-destructive' : issuer.riskScore >= 40 ? 'bg-amber-500' : 'bg-green-500'}`} 
                              style={{ width: `${Math.min(100, Math.max(0, issuer.riskScore))}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {data.issuers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No issuers data available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
