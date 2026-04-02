import { useGetSignals } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertOctagon, ShieldCheck, Radar, Building2, Database, TrendingDown, TrendingUp, AlertCircle } from "lucide-react";
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

  const getRiskToneClass = (tone?: string) =>
    tone === "Risk Off" ? "text-red-400" : tone === "Cautious" ? "text-amber-400" : "text-emerald-400";

  const getSignalCardBorder = (confidence: string, trustScore: number) => {
    if (confidence === "high" || trustScore >= 70) return "border-l-[3px] border-l-emerald-500 border-border";
    if (confidence === "medium" || trustScore >= 50) return "border-l-[3px] border-l-amber-400 border-border";
    return "border-l-[3px] border-l-red-700/50 border-border";
  };

  const getSourceTierBadgeClass = (tier: string) => {
    if (tier === "primary") return "text-emerald-400 border-emerald-800/40 bg-emerald-950/20";
    if (tier === "secondary") return "text-sky-400 border-sky-800/40 bg-sky-950/20";
    return "text-amber-500/80 border-amber-800/30 bg-amber-950/10";
  };

  const getTrustBadgeClass = (score: number) => {
    if (score >= 70) return "bg-emerald-950/30 text-emerald-400 border-emerald-800/40";
    if (score >= 50) return "bg-amber-950/20 text-amber-400 border-amber-800/30";
    return "bg-red-950/20 text-red-400/70 border-red-800/20";
  };

  const total = signals?.creditPulse?.totalSignals ?? 0;
  const primary = signals?.creditPulse?.primarySourceSignals ?? 0;
  const highTrust = signals?.creditPulse?.highTrustSignals ?? 0;
  const corroborated = signals?.creditPulse?.corroboratedSignals ?? 0;

  const secondaryApprox = Math.max(0, corroborated - primary);
  const tertiaryApprox = Math.max(0, total - primary - secondaryApprox);

  const confirmedSignals = (signals?.topSignals ?? []).filter(
    s => s.confidence === "high" || s.trustScore >= 70
  );
  const emergingSignals = (signals?.topSignals ?? []).filter(
    s => s.confidence !== "high" && s.trustScore < 70
  );

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
              <MetricCard title="NEGATIVE" value={String(signals.creditPulse?.negativeSignals ?? 0)} mono className="text-red-400" />
              <MetricCard title="HIGH TRUST" value={String(signals.creditPulse?.highTrustSignals ?? 0)} mono className="text-emerald-400" />
              <MetricCard title="CORROBORATED" value={String(signals.creditPulse?.corroboratedSignals ?? 0)} mono className="text-sky-400" />
              <MetricCard title="PRIMARY SRC" value={String(signals.creditPulse?.primarySourceSignals ?? 0)} mono className="text-primary" />
            </div>

            <Card>
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="flex items-center text-lg">
                  <Database className="h-5 w-5 mr-2 text-primary" />
                  SOURCE QUALITY BREAKDOWN
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <p className="text-xs font-mono text-muted-foreground mb-3">SIGNAL SOURCE TIER DISTRIBUTION</p>
                    {[
                      { label: "PRIMARY", count: primary, color: "bg-emerald-500", textColor: "text-emerald-400", desc: "Wire services, central banks, regulatory filings" },
                      { label: "SECONDARY", count: secondaryApprox, color: "bg-sky-500", textColor: "text-sky-400", desc: "Financial press, institutional research" },
                      { label: "TERTIARY", count: tertiaryApprox, color: "bg-amber-500/70", textColor: "text-amber-500", desc: "Commentary, opinion, aggregators" },
                    ].map(({ label, count, color, textColor, desc }) => {
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={label} className="space-y-1">
                          <div className="flex justify-between text-xs font-mono">
                            <span className={textColor}>{label}</span>
                            <span className="text-muted-foreground">{count} signals · {pct}%</span>
                          </div>
                          <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-[10px] text-muted-foreground">{desc}</p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="space-y-3">
                    <p className="text-xs font-mono text-muted-foreground mb-3">EVIDENCE QUALITY SUMMARY</p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "HIGH TRUST", value: highTrust, total, color: "text-emerald-400", bg: "bg-emerald-950/20 border-emerald-800/30", icon: <ShieldCheck className="h-4 w-4 text-emerald-400" />, desc: "Trust score ≥ 70" },
                        { label: "CORROBORATED", value: corroborated, total, color: "text-sky-400", bg: "bg-sky-950/20 border-sky-800/30", icon: <Activity className="h-4 w-4 text-sky-400" />, desc: "Multiple sources confirm" },
                      ].map(({ label, value, color, bg, icon, desc }) => (
                        <div key={label} className={`rounded-lg border p-3 space-y-1 ${bg}`}>
                          <div className="flex items-center gap-1.5">{icon}<span className="text-[10px] font-mono text-muted-foreground">{label}</span></div>
                          <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
                          <div className="text-[10px] text-muted-foreground">{desc}</div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2 mt-2">
                      <p className="text-[10px] font-mono text-muted-foreground">RELIABILITY READING</p>
                      <div className="flex items-center gap-2">
                        {primary >= 5 ? (
                          <><ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" /><span className="text-sm text-emerald-400">Strong primary sourcing — signals have high reliability</span></>
                        ) : primary >= 2 ? (
                          <><AlertCircle className="h-4 w-4 text-amber-400 shrink-0" /><span className="text-sm text-amber-400">Moderate primary sourcing — treat inferences cautiously</span></>
                        ) : (
                          <><AlertOctagon className="h-4 w-4 text-red-400 shrink-0" /><span className="text-sm text-red-400">Low primary sourcing — validate before trading</span></>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="flex items-center text-lg">
                  <ShieldCheck className="h-5 w-5 mr-2 text-primary" />
                  TOP VALIDATED SIGNALS
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {confirmedSignals.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-400" />
                      <span className="text-[11px] font-mono text-emerald-400 font-bold tracking-widest">CONFIRMED · HIGH CONFIDENCE</span>
                      <span className="text-[11px] font-mono text-muted-foreground">({confirmedSignals.length})</span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {confirmedSignals.map((signal) => (
                        <SignalCard key={signal.articleId} signal={signal} borderClass={getSignalCardBorder(signal.confidence, signal.trustScore)} sourceTierClass={getSourceTierBadgeClass(signal.sourceTier)} trustBadgeClass={getTrustBadgeClass(signal.trustScore)} />
                      ))}
                    </div>
                  </div>
                )}

                {emergingSignals.length > 0 && (
                  <div className="space-y-3">
                    {confirmedSignals.length > 0 && <div className="border-t border-border pt-4" />}
                    <div className="flex items-center gap-2">
                      <TrendingDown className="h-4 w-4 text-amber-400" />
                      <span className="text-[11px] font-mono text-amber-400 font-bold tracking-widest">EMERGING · WATCH</span>
                      <span className="text-[11px] font-mono text-muted-foreground">({emergingSignals.length})</span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {emergingSignals.map((signal) => (
                        <SignalCard key={signal.articleId} signal={signal} borderClass={getSignalCardBorder(signal.confidence, signal.trustScore)} sourceTierClass={getSourceTierBadgeClass(signal.sourceTier)} trustBadgeClass={getTrustBadgeClass(signal.trustScore)} />
                      ))}
                    </div>
                  </div>
                )}
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
                        <TableRow key={sector.sector} className={`border-border ${sector.riskScore >= 0.7 ? "bg-red-950/10" : ""}`}>
                          <TableCell className="font-medium">{sector.sector.toUpperCase()}</TableCell>
                          <TableCell className={`text-right font-mono ${getRiskColor(sector.riskScore)}`}>{sector.riskScore.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono">{sector.creditSignalScore?.toFixed?.(2) ?? sector.creditSignalScore}</TableCell>
                          <TableCell className={`text-right font-mono ${sector.negativeCount > 0 ? "text-destructive font-bold" : ""}`}>{sector.negativeCount}</TableCell>
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
                    <div key={issuer.issuerName} className={`rounded-lg border p-3 space-y-2 ${issuer.riskLevel === "high" ? "border-red-800/40 bg-red-950/10" : issuer.riskLevel === "medium" ? "border-amber-800/30 bg-amber-950/10" : "border-border"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />{issuer.issuerName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{issuer.sector ?? "UNSPECIFIED"}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="outline" className={issuer.riskLevel === "high" ? "text-red-400 border-red-800/40" : issuer.riskLevel === "medium" ? "text-amber-400 border-amber-800/40" : "text-emerald-400 border-emerald-800/40"}>{issuer.riskLevel.toUpperCase()}</Badge>
                          <span className={`text-[10px] font-mono ${issuer.trend === "deteriorating" ? "text-red-400 flex items-center gap-0.5" : issuer.trend === "improving" ? "text-green-400 flex items-center gap-0.5" : "text-muted-foreground"}`}>
                            {issuer.trend === "deteriorating" ? <><TrendingDown className="h-2.5 w-2.5" />DETER</> : issuer.trend === "improving" ? <><TrendingUp className="h-2.5 w-2.5" />IMPRO</> : "STABLE"}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] font-mono text-muted-foreground">
                        <span>{issuer.dominantSignal}</span>
                        <span>·</span>
                        <span className={`font-bold ${issuer.trustLabel === "high" ? "text-emerald-400" : issuer.trustLabel === "medium" ? "text-amber-400" : "text-red-400"}`}>TRUST {issuer.trustLabel?.toUpperCase()}</span>
                        <span>·</span>
                        <span>NEG {Math.round(issuer.negativeSignalRatio * 100)}%</span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{issuer.summary}</p>
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
                        <TableCell className={`text-right font-mono ${event.negativeCount > 0 ? "text-destructive" : ""}`}>{event.negativeCount}</TableCell>
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

function SignalCard({ signal, borderClass, sourceTierClass, trustBadgeClass }: {
  signal: any;
  borderClass: string;
  sourceTierClass: string;
  trustBadgeClass: string;
}) {
  return (
    <Link href={`/article/${signal.articleId}`}>
      <div className={`rounded-xl border p-4 space-y-3 bg-card hover:border-primary/40 transition-colors cursor-pointer h-full ${borderClass}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge>{signal.signalLabel}</Badge>
              <Badge variant="outline" className={`text-[10px] ${sourceTierClass}`}>{signal.sourceTier.toUpperCase()}</Badge>
              <Badge variant="secondary" className={`text-[10px] border ${trustBadgeClass}`}>TRUST {signal.trustScore}</Badge>
              {signal.primarySourcePresent && <Badge variant="outline" className="text-emerald-400 border-emerald-800/40 text-[10px]">PRIMARY</Badge>}
              {signal.issuerName && <Badge variant="outline" className="text-[10px]">{signal.issuerName}</Badge>}
            </div>
            <p className="font-semibold leading-snug text-sm">{signal.whyNow}</p>
          </div>
          <div className="text-right text-xs font-mono text-muted-foreground shrink-0">
            <div className={signal.confidence === "high" ? "text-emerald-400 font-bold" : signal.confidence === "medium" ? "text-amber-400" : "text-muted-foreground"}>
              {signal.confidence.toUpperCase()}
            </div>
            <div>STR {signal.signalStrength?.toFixed(1) ?? "-"}</div>
          </div>
        </div>
        <div>
          <p className="text-[11px] font-mono text-muted-foreground mb-1">KEY EVIDENCE</p>
          <ul className="text-sm space-y-1 list-disc ml-5">
            {signal.keyEvidence.map((item: string, i: number) => <li key={i}>{item}</li>)}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-mono text-muted-foreground mb-1">HOW TO USE IT</p>
          <p className="text-sm text-primary/90">{signal.decisionUse ?? "Review for issuer and sector impact."}</p>
        </div>
        <div>
          <p className="text-[11px] font-mono text-muted-foreground mb-1">CREDIT IMPLICATIONS</p>
          <ul className="text-sm space-y-1 list-disc ml-5">
            {signal.creditImplications.map((item: string, i: number) => <li key={i}>{item}</li>)}
          </ul>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {signal.riskFlags.map((flag: string, i: number) => <Badge key={i} variant="outline" className="text-destructive border-destructive/30 text-[10px]">{flag}</Badge>)}
          <span className="text-[11px] font-mono text-muted-foreground">EV {signal.evidenceCount}{(signal.corroboratingArticleCount ?? 0) > 0 ? ` +${signal.corroboratingArticleCount} corroborating` : ""}</span>
        </div>
      </div>
    </Link>
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
