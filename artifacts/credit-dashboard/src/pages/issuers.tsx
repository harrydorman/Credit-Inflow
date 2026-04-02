import { useListIssuers } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Building, TrendingDown, TrendingUp, Minus, AlertTriangle, AlertOctagon } from "lucide-react";
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

  const getRiskRowClass = (riskScore: number, trend: string) => {
    if (riskScore >= 0.8 && trend === "deteriorating") return "bg-red-950/20 hover:bg-red-950/30";
    if (riskScore >= 0.6 && trend === "deteriorating") return "bg-orange-950/10 hover:bg-orange-950/20";
    return "hover:bg-secondary/20";
  };

  const getRiskScoreColor = (riskScore: number) => {
    if (riskScore >= 0.7) return "text-destructive font-bold";
    if (riskScore >= 0.4) return "text-amber-500 font-bold";
    return "text-green-500";
  };

  const getRiskBarColor = (riskScore: number) => {
    if (riskScore >= 0.7) return "bg-destructive";
    if (riskScore >= 0.4) return "bg-amber-500";
    return "bg-green-500";
  };

  const issuers = data?.issuers ?? [];
  const highRiskCount = issuers.filter(i => i.riskScore >= 0.7).length;
  const deterioratingCount = issuers.filter(i => i.riskTrend === "deteriorating").length;
  const covenantCount = issuers.filter(i => i.covenantFlag).length;

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
            <div className="flex items-end gap-6 text-right">
              <div>
                <div className="text-[10px] font-mono text-muted-foreground">TOTAL ISSUERS</div>
                <div className="text-2xl font-mono font-bold text-primary">{data.total}</div>
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : data?.issuers ? (
          <div className="space-y-4">
            {(highRiskCount > 0 || covenantCount > 0) && (
              <div className="flex flex-wrap gap-3">
                {highRiskCount > 0 && (
                  <div className="flex items-center gap-2 bg-red-950/30 border border-red-800/40 rounded-lg px-4 py-2.5">
                    <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                    <span className="text-sm font-mono">
                      <span className="text-red-400 font-bold">{highRiskCount}</span>
                      <span className="text-muted-foreground ml-1.5">high-risk issuer{highRiskCount !== 1 ? "s" : ""}</span>
                    </span>
                  </div>
                )}
                {deterioratingCount > 0 && (
                  <div className="flex items-center gap-2 bg-orange-950/20 border border-orange-800/30 rounded-lg px-4 py-2.5">
                    <TrendingDown className="h-4 w-4 text-orange-400 shrink-0" />
                    <span className="text-sm font-mono">
                      <span className="text-orange-400 font-bold">{deterioratingCount}</span>
                      <span className="text-muted-foreground ml-1.5">deteriorating trend{deterioratingCount !== 1 ? "s" : ""}</span>
                    </span>
                  </div>
                )}
                {covenantCount > 0 && (
                  <div className="flex items-center gap-2 bg-red-950/30 border border-red-800/50 rounded-lg px-4 py-2.5 animate-pulse">
                    <AlertOctagon className="h-4 w-4 text-red-400 shrink-0" />
                    <span className="text-sm font-mono">
                      <span className="text-red-400 font-bold">{covenantCount}</span>
                      <span className="text-muted-foreground ml-1.5">covenant breach flag{covenantCount !== 1 ? "s" : ""}</span>
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-md border border-border overflow-hidden bg-card">
              <Table>
                <TableHeader className="bg-secondary/30">
                  <TableRow>
                    <TableHead className="font-mono text-xs w-[220px]">ISSUER</TableHead>
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
                    const riskPct = Math.round(issuer.riskScore * 100);

                    return (
                      <TableRow
                        key={issuer.issuerName}
                        className={`cursor-pointer transition-colors border-b border-border/50 ${getRiskRowClass(issuer.riskScore, issuer.riskTrend)}`}
                        onClick={() => setLocation(`/?issuerName=${encodeURIComponent(issuer.issuerName)}`)}
                      >
                        <TableCell className="font-mono font-bold text-base truncate max-w-[220px]" title={issuer.issuerName}>
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
                              {issuer.riskTrend === "deteriorating" ? "DETER" : issuer.riskTrend === "improving" ? "IMPRO" : "STABLE"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className={`font-mono font-bold text-sm ${getRiskScoreColor(issuer.riskScore)}`}>
                              {riskPct}
                            </span>
                            <div className="w-16 h-2 bg-secondary rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all ${getRiskBarColor(issuer.riskScore)}`}
                                style={{ width: `${Math.min(100, Math.max(0, riskPct))}%` }}
                              />
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {data.issuers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        No issuers data available.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
