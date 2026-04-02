import { useGetSignals } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertOctagon, ShieldCheck, Radar, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

export default function Signals() {
  const { data, isLoading } = useGetSignals();
  const signals = data as typeof data & {
    creditPulse?: {
      riskTone: string;
      totalSignals: number;
      negativeSignals: number;
      highTrustSignals: number;
      corroboratedSignals: number;
      primarySourceSignals: number;
    };
    topSignals?: Array<{
      articleId: number;
      issuerName?: string | null;
      sector?: string | null;
      signalLabel: string;
      whyNow: string;
      confidence: string;
      trustScore: number;
      sourceTier: string;
      evidenceCount: number;
      corroboratingArticleCount?: number;
      primarySourcePresent?: boolean;
      keyEvidence: string[];
      creditImplications: string[];
      riskFlags: string[];
      decisionUse?: string;
      signalStrength?: number;
    }>;
    issuerRadar?: Array<{
      issuerName: string;
      sector?: string | null;
      dominantSignal: string;
      trustLabel: string;
      trend: string;
      riskLevel: string;
      negativeSignalRatio: number;
      summary: string;
      keyDrivers: string[];
      keyRisks: string[];
    }>;
  };

  const getRiskColor = (score: number) => {
    if (score >= 0.8) return "text-destructive font-bold";
    if (score >= 0.5) return "text-primary font-bold";
    return "text-green-500";
  };

  const getRiskToneClass = (tone?: string) => tone === "Risk Off" ? "text-red-400" : tone === "Cautious" ? "text-amber-400" : "text-emerald-400";

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">CREDIT SIGNALS</h1>
          <p className="text-muted-foreground font-mono text-sm mt-2">EVIDENCE-WEIGHTED CREDIT INTELLIGENCE, RANKED FOR DECISION USE</p>
        </header>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-[220px] w-full rounded-xl" />
            <Skeleton className="h-[400px] w-full rounded-xl" />
          </div>
        ) : signals ? (
          <div className="space-y-8">
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              <MetricCard title="RISK TONE" value={signals.creditPulse?.riskTone ?? "Balanced"} className={getRiskToneClass(signals.creditPulse?.riskTone)} />
              <MetricCard title="TOTAL SIGNALS" value={String(signals.creditPulse?.totalSignals ?? signals.totalArticles)} mono />
              <MetricCard title="NEGATIVE" value={String(signals.creditPulse?.negativeSignals ?? 0)} mono />
              <MetricCard title="HIGH TRUST" value={String(signals.creditPulse?.highTrustSignals ?? 0)} mono />
              <MetricCard title="CORROBORATED" value={String(signals.creditPulse?.corroboratedSignals ?? 0)} mono />
              <MetricCard title="PRIMARY SRC" value={String(signals.creditPulse?.primarySourceSignals ?? 0)} mono />
            </div>

            <Card>
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="flex items-center text-lg">
                  <ShieldCheck className="h-5 w-5 mr-2 text-primary" />
                  TOP VALIDATED SIGNALS
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
                {(signals.topSignals ?? []).map((signal) => (
                  <Link key={signal.articleId} href={`/article/${signal.articleId}`}>
                    <div className="rounded-xl border border-border p-4 space-y-3 bg-card hover:border-primary/40 transition-colors cursor-pointer h-full">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap gap-2 mb-2">
                            <Badge>{signal.signalLabel}</Badge>
                            <Badge variant="outline">{signal.sourceTier.toUpperCase()}</Badge>
                            <Badge variant="secondary">TRUST {signal.trustScore}</Badge>
                            {signal.primarySourcePresent && <Badge variant="outline" className="text-emerald-400 border-emerald-800/40">PRIMARY</Badge>}
                            {signal.issuerName && <Badge variant="outline">{signal.issuerName}</Badge>}
                          </div>
                          <p className="font-semibold leading-snug">{signal.whyNow}</p>
                        </div>
                        <div className="text-right text-xs font-mono text-muted-foreground shrink-0">
                          <div>{signal.confidence.toUpperCase()}</div>
                          <div>STR {signal.signalStrength?.toFixed(1) ?? "-"}</div>
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-mono text-muted-foreground mb-1">KEY EVIDENCE</p>
                        <ul className="text-sm space-y-1 list-disc ml-5">
                          {signal.keyEvidence.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                      </div>
                      <div>
                        <p className="text-[11px] font-mono text-muted-foreground mb-1">HOW TO USE IT</p>
                        <p className="text-sm text-primary/90">{signal.decisionUse ?? "Review for issuer and sector impact."}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-mono text-muted-foreground mb-1">CREDIT IMPLICATIONS</p>
                        <ul className="text-sm space-y-1 list-disc ml-5">
                          {signal.creditImplications.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        {signal.riskFlags.map((flag, i) => <Badge key={i} variant="outline" className="text-destructive border-destructive/30">{flag}</Badge>)}
                        <span className="text-[11px] font-mono text-muted-foreground">EV {signal.evidenceCount}{(signal.corroboratingArticleCount ?? 0) > 0 ? ` +${signal.corroboratingArticleCount} corroborating` : ""}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
              <Card className="xl:col-span-2">
                <CardHeader className="border-b border-border pb-4">
                  <CardTitle className="flex items-center text-lg">
                    <Activity className="h-5 w-5 mr-2 text-primary" />
                    SECTOR RISK MATRIX
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent bg-secondary/50">
                        <TableHead className="font-mono text-xs">SECTOR</TableHead>
                        <TableHead className="font-mono text-xs text-right">RISK SCORE</TableHead>
                        <TableHead className="font-mono text-xs text-right">AVG SIGNAL</TableHead>
                        <TableHead className="font-mono text-xs text-right">NEGATIVE</TableHead>
                        <TableHead className="font-mono text-xs">KEY EVENTS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {signals.bySector.sort((a, b) => b.riskScore - a.riskScore).map((sector: any) => (
                        <TableRow key={sector.sector} className="border-border">
                          <TableCell className="font-medium">{sector.sector.toUpperCase()}</TableCell>
                          <TableCell className={`text-right font-mono ${getRiskColor(sector.riskScore)}`}>{sector.riskScore.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono">{sector.creditSignalScore?.toFixed?.(2) ?? sector.creditSignalScore}</TableCell>
                          <TableCell className="text-right font-mono text-destructive">{sector.negativeCount}</TableCell>
                          <TableCell><div className="flex flex-wrap gap-1">{sector.eventTypes.slice(0, 3).map((event: string) => <Badge key={event} variant="outline" className="text-[10px] py-0 h-5">{event}</Badge>)}</div></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b border-border pb-4">
                  <CardTitle className="flex items-center text-lg">
                    <Radar className="h-5 w-5 mr-2 text-primary" />
                    ISSUER RADAR
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {(signals.issuerRadar ?? []).map((issuer) => (
                    <div key={issuer.issuerName} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />{issuer.issuerName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{issuer.sector ?? "UNSPECIFIED"}</div>
                        </div>
                        <Badge variant="outline" className={issuer.riskLevel === "high" ? "text-red-400 border-red-800/40" : issuer.riskLevel === "medium" ? "text-amber-400 border-amber-800/40" : "text-emerald-400 border-emerald-800/40"}>{issuer.riskLevel.toUpperCase()}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] font-mono text-muted-foreground">
                        <span>{issuer.dominantSignal}</span>
                        <span>•</span>
                        <span>{issuer.trend}</span>
                        <span>•</span>
                        <span>NEG {Math.round(issuer.negativeSignalRatio * 100)}%</span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-3">{issuer.summary}</p>
                      <div className="flex flex-wrap gap-1">
                        {issuer.keyRisks.slice(0, 2).map((risk, idx) => <Badge key={idx} variant="outline" className="text-[10px] border-destructive/30 text-destructive">{risk}</Badge>)}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="flex items-center text-lg">
                  <AlertOctagon className="h-5 w-5 mr-2 text-destructive" />
                  EVENT TYPE DISTRIBUTION
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-secondary/50">
                      <TableHead className="font-mono text-xs">EVENT TYPE</TableHead>
                      <TableHead className="font-mono text-xs text-right">OCCURRENCES</TableHead>
                      <TableHead className="font-mono text-xs text-right">NEGATIVE IMPACT</TableHead>
                      <TableHead className="font-mono text-xs">IMPACTED SECTORS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signals.byEventType.sort((a, b) => b.count - a.count).map((event) => (
                      <TableRow key={event.eventType} className="border-border">
                        <TableCell className="font-medium">{event.eventType.toUpperCase()}</TableCell>
                        <TableCell className="text-right font-mono">{event.count}</TableCell>
                        <TableCell className="text-right font-mono text-destructive">{event.negativeCount}</TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate max-w-[300px]">{event.sectors.join(", ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">No signals data available.</div>
        )}
      </div>
    </Layout>
  );
}

function MetricCard({ title, value, mono, className }: { title: string; value: string; mono?: boolean; className?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-mono text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent><div className={`${mono ? "font-mono" : ""} text-3xl font-bold ${className ?? ""}`}>{value}</div></CardContent>
    </Card>
  );
}
