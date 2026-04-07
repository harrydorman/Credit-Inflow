import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PortfolioHolding } from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────

function confidenceLabel(conf: number | null | undefined): string {
  if (conf == null) return "–";
  if (conf >= 0.85) return "High";
  if (conf >= 0.6) return "Medium";
  return "Low";
}

function confidenceColor(conf: number | null | undefined): string {
  if (conf == null) return "text-muted-foreground";
  if (conf >= 0.85) return "text-emerald-600";
  if (conf >= 0.6) return "text-amber-500";
  return "text-red-500";
}

// ─── HoldingsTable ───────────────────────────────────────────────────────────

interface HoldingsTableProps {
  holdings: PortfolioHolding[];
  isLoading?: boolean;
  "data-testid"?: string;
}

export function HoldingsTable({
  holdings,
  isLoading,
  "data-testid": testId,
}: HoldingsTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-1" data-testid="holdings-table-loading">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (!holdings.length) {
    return (
      <p
        className="text-xs font-mono text-muted-foreground py-4 text-center"
        data-testid="holdings-table-empty"
      >
        No holdings found.
      </p>
    );
  }

  return (
    <div
      className="rounded-md border border-border overflow-hidden"
      data-testid={testId ?? "holdings-table"}
    >
      <Table>
        <TableHeader>
          <TableRow className="bg-secondary/30">
            <TableHead className="text-xs font-mono uppercase tracking-wide h-8">
              Raw Issuer
            </TableHead>
            <TableHead className="text-xs font-mono uppercase tracking-wide h-8">
              Canonical Mapping
            </TableHead>
            <TableHead className="text-xs font-mono uppercase tracking-wide h-8 text-right">
              Confidence
            </TableHead>
            <TableHead className="text-xs font-mono uppercase tracking-wide h-8 text-right">
              Position Size
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {holdings.map((h) => {
            const isMapped = !!h.canonicalIssuerName;
            return (
              <TableRow
                key={h.id}
                className={cn(
                  "text-xs font-mono",
                  !isMapped && "bg-amber-950/10 hover:bg-amber-950/20",
                )}
                data-testid={`holding-row-${h.id}`}
              >
                {/* Raw issuer */}
                <TableCell className="py-2">
                  <span className="font-medium">{h.issuerName}</span>
                </TableCell>

                {/* Canonical mapping */}
                <TableCell className="py-2">
                  {isMapped ? (
                    <span className="flex items-center gap-1 text-foreground">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                      {h.canonicalIssuerName}
                    </span>
                  ) : (
                    <span
                      className="flex items-center gap-1 text-amber-500 font-semibold"
                      data-testid={`unresolved-mapping-${h.id}`}
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Unresolved
                    </span>
                  )}
                </TableCell>

                {/* Confidence */}
                <TableCell className="py-2 text-right">
                  <span className={confidenceColor(h.mappingConfidence)}>
                    {confidenceLabel(h.mappingConfidence)}
                    {h.mappingConfidence != null && (
                      <span className="ml-1 text-muted-foreground">
                        ({Math.round(h.mappingConfidence * 100)}%)
                      </span>
                    )}
                  </span>
                </TableCell>

                {/* Position size */}
                <TableCell className="py-2 text-right text-muted-foreground">
                  {h.positionSize != null
                    ? h.positionSize.toLocaleString()
                    : "–"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
