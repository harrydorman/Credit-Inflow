import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  PortfolioExposureAlert,
  PortfolioExposureAlertEventsItem,
} from "@workspace/api-client-react";
import {
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Link as LucideLink,
} from "lucide-react";
import { Link } from "wouter";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function severityBadgeClass(severity: string | null | undefined): string {
  switch (severity?.toLowerCase()) {
    case "high":
      return "bg-red-600 text-white border-red-600";
    case "medium":
      return "bg-amber-500 text-black border-amber-500";
    case "low":
      return "bg-emerald-600 text-white border-emerald-600";
    default:
      return "border-border text-muted-foreground";
  }
}

function SeverityDot({ severity }: { severity: string | null | undefined }) {
  const s = severity?.toLowerCase();
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full shrink-0",
        s === "high" && "bg-red-500",
        s === "medium" && "bg-amber-500",
        s === "low" && "bg-emerald-500",
        !s && "bg-muted",
      )}
    />
  );
}

// ─── AlertEventItem ──────────────────────────────────────────────────────────

function AlertEventItem({
  event,
}: {
  event: PortfolioExposureAlertEventsItem;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 px-3 py-2 text-xs font-mono border-b border-border last:border-0",
        event.isRead ? "opacity-60" : "",
      )}
      data-testid={`exposure-event-${event.id}`}
    >
      <SeverityDot severity={event.severity} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {event.severity && (
            <Badge
              className={cn(
                "text-[10px] font-mono h-4 px-1 border",
                severityBadgeClass(event.severity),
              )}
            >
              {event.severity.toUpperCase()}
            </Badge>
          )}
          {event.eventType && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1">
              {event.eventType}
            </Badge>
          )}
          {event.confidence != null && (
            <span className="text-muted-foreground">
              conf {Math.round(event.confidence * 100)}%
            </span>
          )}
          <span className="text-muted-foreground ml-auto">
            {fmtDate(event.triggeredAt)}
          </span>
        </div>
      </div>

      {/* Article link */}
      <Link
        href={`/article/${event.articleId}`}
        className="shrink-0 text-primary hover:opacity-70"
        onClick={(e) => e.stopPropagation()}
        title="View article"
      >
        <LucideLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

// ─── ExposureAlertGroup ──────────────────────────────────────────────────────

interface ExposureAlertGroupProps {
  group: PortfolioExposureAlert;
  defaultExpanded?: boolean;
  "data-testid"?: string;
}

export function ExposureAlertGroup({
  group,
  defaultExpanded = false,
  "data-testid": testId,
}: ExposureAlertGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div
      className="border border-border rounded-md overflow-hidden"
      data-testid={testId ?? `exposure-group-${group.issuerName}`}
    >
      {/* Group header — always visible */}
      <button
        type="button"
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
          "hover:bg-secondary/30",
          expanded ? "bg-secondary/20" : "bg-card",
        )}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-testid={`exposure-group-header-${group.issuerName}`}
      >
        {/* Expand icon */}
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}

        {/* Issuer name */}
        <span className="font-mono font-semibold text-sm truncate flex-1">
          <Link
            href={`/issuer/${encodeURIComponent(group.issuerName)}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-primary hover:underline transition-colors"
            data-testid={`exposure-issuer-link-${group.issuerName}`}
          >
            {group.issuerName}
          </Link>
        </span>

        {/* Severity counts */}
        <div className="flex items-center gap-1.5 shrink-0">
          {group.highSeverityCount > 0 && (
            <Badge
              className="text-[10px] font-mono h-5 px-1.5 bg-red-600 text-white border-red-600"
              data-testid={`high-count-${group.issuerName}`}
            >
              <ShieldAlert className="h-2.5 w-2.5 mr-0.5" />
              {group.highSeverityCount}
            </Badge>
          )}
          {group.mediumSeverityCount > 0 && (
            <Badge className="text-[10px] font-mono h-5 px-1.5 bg-amber-500 text-black border-amber-500">
              {group.mediumSeverityCount}
            </Badge>
          )}
          {group.lowSeverityCount > 0 && (
            <Badge className="text-[10px] font-mono h-5 px-1.5 bg-emerald-600 text-white border-emerald-600">
              {group.lowSeverityCount}
            </Badge>
          )}
          <span className="text-[11px] font-mono text-muted-foreground">
            {group.totalAlerts} alert{group.totalAlerts !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Latest time */}
        <span className="text-[11px] font-mono text-muted-foreground shrink-0">
          latest {fmtDate(group.latestTriggeredAt)}
        </span>
      </button>

      {/* Event items */}
      {expanded && group.events.length > 0 && (
        <div className="bg-secondary/5">
          {group.events.map((event: PortfolioExposureAlertEventsItem) => (
            <AlertEventItem key={event.id} event={event} />
          ))}
        </div>
      )}

      {expanded && group.events.length === 0 && (
        <div className="px-4 py-3 text-xs font-mono text-muted-foreground bg-secondary/5">
          No event details available.
        </div>
      )}
    </div>
  );
}

// ─── ExposureAlertList ────────────────────────────────────────────────────────

interface ExposureAlertListProps {
  groups: PortfolioExposureAlert[];
  "data-testid"?: string;
}

export function ExposureAlertList({
  groups,
  "data-testid": testId,
}: ExposureAlertListProps) {
  if (!groups.length) {
    return (
      <p
        className="text-xs font-mono text-muted-foreground py-4 text-center"
        data-testid="exposure-list-empty"
      >
        No portfolio exposure alerts found.
      </p>
    );
  }

  // Sort: high-severity groups first, then by total alerts desc
  const sorted = [...groups].sort((a, b) => {
    if (b.highSeverityCount !== a.highSeverityCount)
      return b.highSeverityCount - a.highSeverityCount;
    return b.totalAlerts - a.totalAlerts;
  });

  return (
    <div className="space-y-2" data-testid={testId ?? "exposure-alert-list"}>
      {sorted.map((group) => (
        <ExposureAlertGroup
          key={group.issuerName}
          group={group}
          defaultExpanded={group.highSeverityCount > 0}
        />
      ))}
    </div>
  );
}
