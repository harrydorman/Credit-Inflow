import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { AlertEvent } from "@workspace/api-client-react";
import { CheckCheck, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getAlertPriority,
  PRIORITY_BADGE_STYLES,
  ANALYST_ACTION_LABELS,
  ANALYST_ACTION_STYLES,
  type AnalystAction,
  type RankingContext,
} from "@/lib/alertPriority";

// ─── helpers ────────────────────────────────────────────────────────────────

/** Derive a severity label from the numeric urgency score. */
export function urgencyToSeverity(
  urgency: number | null | undefined,
): "high" | "medium" | "low" | null {
  if (urgency == null) return null;
  if (urgency >= 8) return "high";
  if (urgency >= 5) return "medium";
  return "low";
}

const SEVERITY_STYLES: Record<"high" | "medium" | "low", string> = {
  high: "bg-red-600 text-white border-red-600",
  medium: "bg-amber-500 text-black border-amber-500",
  low: "bg-emerald-600 text-white border-emerald-600",
};

const SEVERITY_LABELS: Record<"high" | "medium" | "low", string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
};

export function SeverityBadge({
  urgency,
}: {
  urgency: number | null | undefined;
}) {
  const sev = urgencyToSeverity(urgency);
  if (!sev) {
    return (
      <span className="inline-flex items-center justify-center w-10 text-xs font-mono text-muted-foreground">
        –
      </span>
    );
  }
  return (
    <Badge
      className={cn(
        "text-[10px] font-mono font-bold px-1.5 py-0 h-5 border",
        SEVERITY_STYLES[sev],
      )}
    >
      {SEVERITY_LABELS[sev]}
    </Badge>
  );
}

// ─── PriorityBadge ───────────────────────────────────────────────────────────

export function PriorityBadge({
  alert,
  rankingContext,
}: {
  alert: AlertEvent;
  rankingContext?: RankingContext;
}) {
  const { label } = getAlertPriority(alert, rankingContext);
  return (
    <Badge
      className={cn(
        "text-[9px] font-mono font-bold px-1 py-0 h-4 border uppercase",
        PRIORITY_BADGE_STYLES[label],
      )}
      data-testid="priority-badge"
    >
      {label}
    </Badge>
  );
}

// ─── ActionBadge ─────────────────────────────────────────────────────────────

export function ActionBadge({ action }: { action: AnalystAction }) {
  if (!action) return null;
  return (
    <Badge
      className={cn(
        "text-[9px] font-mono font-bold px-1 py-0 h-4 border uppercase",
        ANALYST_ACTION_STYLES[action],
      )}
      data-testid="action-badge"
    >
      {ANALYST_ACTION_LABELS[action]}
    </Badge>
  );
}

// ─── AlertFeedRow ────────────────────────────────────────────────────────────

interface AlertFeedRowProps {
  alert: AlertEvent;
  selected: boolean;
  onSelect: (id: number, checked: boolean) => void;
  onMarkRead: (id: number) => void;
  onClick: (alert: AlertEvent) => void;
  markReadPending: boolean;
  action?: AnalystAction;
  rankingContext?: RankingContext;
}

export function AlertFeedRow({
  alert,
  selected,
  onSelect,
  onMarkRead,
  onClick,
  markReadPending,
  action,
  rankingContext,
}: AlertFeedRowProps) {
  const isPortfolioLinked = Boolean(
    (alert as AlertEvent & { portfolioLinked?: boolean }).portfolioLinked,
  );

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const { label: priorityLabel } = getAlertPriority(alert, rankingContext);
  const isCritical = priorityLabel === "Critical";

  function rowClassName() {
    if (alert.isRead) return "bg-card hover:bg-secondary/20 text-muted-foreground";
    if (isCritical) return "bg-red-950/20 hover:bg-red-950/30 border-l-2 border-l-red-600";
    return "bg-primary/5 hover:bg-primary/10 border-l-2 border-l-primary";
  }

  return (
    <div
      role="row"
      data-testid={`alert-row-${alert.id}`}
      className={cn(
        "group flex items-start gap-3 px-4 py-3 border-b border-border cursor-pointer transition-colors",
        rowClassName(),
      )}
      onClick={() => onClick(alert)}
    >
      {/* Selection checkbox */}
      <div
        className="shrink-0 mt-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelect(alert.id, Boolean(checked))}
          aria-label={`Select alert ${alert.id}`}
          data-testid={`alert-checkbox-${alert.id}`}
        />
      </div>

      {/* Severity */}
      <div className="shrink-0 mt-0.5 w-10 flex justify-center">
        <SeverityBadge urgency={alert.urgency} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              "text-sm font-medium line-clamp-2 leading-snug",
              !alert.isRead && "text-foreground",
            )}
          >
            {alert.title}
          </span>
          <span className="shrink-0 text-[11px] font-mono text-muted-foreground whitespace-nowrap">
            {fmtDate(alert.triggeredAt)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <span className="text-xs font-mono font-medium">{alert.issuerName}</span>

          {alert.eventType && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
              {alert.eventType}
            </Badge>
          )}

          {alert.urgency != null && (
            <span className="text-[11px] font-mono text-muted-foreground">
              urgency {alert.urgency}/10
            </span>
          )}

          {isPortfolioLinked && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-mono text-amber-500"
              title="Portfolio exposure"
            >
              <Briefcase className="h-3 w-3" />
              Portfolio
            </span>
          )}

          <PriorityBadge alert={alert} rankingContext={rankingContext} />
          <ActionBadge action={action ?? null} />
        </div>
      </div>

      {/* Actions */}
      <div
        className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {!alert.isRead && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] font-mono px-2"
            onClick={() => onMarkRead(alert.id)}
            disabled={markReadPending}
            title="Mark as read"
            data-testid={`mark-read-${alert.id}`}
          >
            <CheckCheck className="h-3 w-3 mr-1" />
            Read
          </Button>
        )}
      </div>
    </div>
  );
}
