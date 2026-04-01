import { useGetSignals } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertOctagon, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Signals() {
  const { data: signals, isLoading } = useGetSignals();

  const getRiskColor = (score: number) => {
    if (score >= 80) return "text-destructive font-bold";
    if (score >= 50) return "text-primary font-bold";
    return "text-green-500";
  };

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">MARKET SIGNALS</h1>
          <p className="text-muted-foreground font-mono text-sm mt-2">
            AGGREGATED RISK METRICS ACROSS SECTORS AND EVENTS
          </p>
        </header>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-[400px] w-full rounded-xl" />
            <Skeleton className="h-[300px] w-full rounded-xl" />
          </div>
        ) : signals ? (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono text-muted-foreground">TOTAL ARTICLES PROCESSED</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold font-mono">{signals.totalArticles}</div>
                </CardContent>
              </Card>
              <Card className="bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono text-muted-foreground">SECTORS TRACKED</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold font-mono">{signals.bySector.length}</div>
                </CardContent>
              </Card>
              <Card className="bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono text-muted-foreground">EVENT TYPES IDENTIFIED</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold font-mono">{signals.byEventType.length}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
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
                      <TableHead className="font-mono text-xs text-right">TOTAL ARTICLES</TableHead>
                      <TableHead className="font-mono text-xs text-right">NEGATIVE COUNT</TableHead>
                      <TableHead className="font-mono text-xs">KEY EVENTS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signals.bySector
                      .sort((a, b) => b.riskScore - a.riskScore)
                      .map((sector) => (
                      <TableRow key={sector.sector} className="border-border">
                        <TableCell className="font-medium">{sector.sector.toUpperCase()}</TableCell>
                        <TableCell className={`text-right font-mono ${getRiskColor(sector.riskScore)}`}>
                          {sector.riskScore}
                        </TableCell>
                        <TableCell className="text-right font-mono">{sector.totalArticles}</TableCell>
                        <TableCell className="text-right font-mono text-destructive">{sector.negativeCount}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {sector.eventTypes.slice(0, 3).map(event => (
                              <Badge key={event} variant="outline" className="text-[10px] py-0 h-5">
                                {event}
                              </Badge>
                            ))}
                            {sector.eventTypes.length > 3 && (
                              <span className="text-xs text-muted-foreground ml-1">+{sector.eventTypes.length - 3}</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

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
                    {signals.byEventType
                      .sort((a, b) => b.count - a.count)
                      .map((event) => (
                      <TableRow key={event.eventType} className="border-border">
                        <TableCell className="font-medium">{event.eventType.toUpperCase()}</TableCell>
                        <TableCell className="text-right font-mono">{event.count}</TableCell>
                        <TableCell className="text-right font-mono text-destructive flex items-center justify-end">
                          {event.negativeCount > 0 && <TrendingDown className="h-3 w-3 mr-1" />}
                          {event.negativeCount}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate max-w-[300px]">
                          {event.sectors.join(", ")}
                        </TableCell>
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
