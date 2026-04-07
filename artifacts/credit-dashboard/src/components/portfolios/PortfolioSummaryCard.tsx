import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Portfolio } from "@workspace/api-client-react";
import { AlertTriangle, Building2, CheckCircle2, ShieldAlert, Layers } from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── MetricCell ──────────────────────────────────────────────────────────────

interface MetricCellProps {
  label: string;
  value: React.ReactNode;
  highlight?: "danger" | "warning" | "ok";
}

function MetricCell({ label, value, highlight }: MetricCellProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-mono font-semibold",
          highlight === "danger" && "text-red-500",
          highlight === "warning" && "text-amber-500",
          highlight === "ok" && "text-emerald-600",
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ─── PortfolioSummaryCard ────────────────────────────────────────────────────

/**
 * Accepts either the basic Portfolio (list view) or PortfolioDetail (detail
 * view). When detail-only fields are absent the metrics row is hidden.
 */
export type PortfolioSummaryData = Pick<Portfolio, "name" | "createdAt" | "updatedAt"> & {
  description?: string | null;
  id?: number;
  holdingsCount?: number;
  mappedIssuerCount?: number;
  unmappedIssuerCount?: number;
  alertCount?: number;
  highSeverityAlertCount?: number;
};

interface PortfolioSummaryCardProps {
  portfolio: PortfolioSummaryData;
  onClick?: () => void;
  className?: string;
  "data-testid"?: string;
}

export function PortfolioSummaryCard({
  portfolio,
  onClick,
  className,
  "data-testid": testId,
}: PortfolioSummaryCardProps) {
  const hasUnresolved = (portfolio.unmappedIssuerCount ?? 0) > 0;
  const hasHighSeverity = (portfolio.highSeverityAlertCount ?? 0) > 0;
  const hasMetrics = portfolio.holdingsCount !== undefined;

  return (
    <div
      className={cn(
        "border border-border rounded-md bg-card px-4 py-3 space-y-3 transition-colors",
        onClick && "cursor-pointer hover:bg-secondary/20",
        className,
      )}
      onClick={onClick}
      data-testid={testId}
      role={onClick ? "button" : undefined}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate leading-tight">
              {portfolio.name}
            </p>
            {portfolio.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {portfolio.description}
              </p>
            )}
          </div>
        </div>

        {/* Alert badges */}
        <div className="flex items-center gap-1.5 shrink-0">
          {hasHighSeverity && (
            <Badge
              className="text-[10px] font-mono px-1.5 h-5 bg-red-600 text-white border-red-600"
              data-testid="high-severity-badge"
            >
              <ShieldAlert className="h-2.5 w-2.5 mr-0.5" />
              {portfolio.highSeverityAlertCount} HIGH
            </Badge>
          )}
          {(portfolio.alertCount ?? 0) > 0 && (
            <Badge variant="outline" className="text-[10px] font-mono px-1.5 h-5">
              {portfolio.alertCount} alert{portfolio.alertCount !== 1 ? "s" : ""}
            </Badge>
          )}
          <span className="text-[11px] font-mono text-muted-foreground">
            {fmtDate(portfolio.updatedAt)}
          </span>
        </div>
      </div>

      {/* Metrics row — only shown when detail data is available */}
      {hasMetrics && (
        <div className="grid grid-cols-4 gap-x-4 gap-y-2 pt-1 border-t border-border">
          <MetricCell label="Holdings" value={portfolio.holdingsCount ?? 0} />
          <MetricCell
            label="Mapped"
            value={
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                {portfolio.mappedIssuerCount ?? 0}
              </span>
            }
            highlight={(portfolio.mappedIssuerCount ?? 0) > 0 ? "ok" : undefined}
          />
          <MetricCell
            label="Unresolved"
            value={
              <span className="flex items-center gap-1">
                {hasUnresolved ? (
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                ) : (
                  <Building2 className="h-3 w-3 text-muted-foreground" />
                )}
                {portfolio.unmappedIssuerCount ?? 0}
              </span>
            }
            highlight={hasUnresolved ? "warning" : undefined}
          />
          <MetricCell
            label="High Alerts"
            value={portfolio.highSeverityAlertCount ?? 0}
            highlight={hasHighSeverity ? "danger" : undefined}
          />
        </div>
      )}
    </div>
  );
}
