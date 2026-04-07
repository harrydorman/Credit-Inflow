import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { AlertEvent } from "@workspace/api-client-react";
import { SeverityBadge, urgencyToSeverity } from "./AlertFeedRow";
import { Link } from "wouter";
import {
  CheckCheck,
  Briefcase,
  ExternalLink,
  Building,
  ChevronDown,
  ChevronRight,
  Info,
  MailOpen,
} from "lucide-react";

interface AlertDetailPanelProps {
  alert: AlertEvent | null;
  open: boolean;
  onClose: () => void;
  onMarkRead: (id: number) => void;
  onMarkUnread?: (id: number) => void;
  markReadPending: boolean;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEventType(eventType: string): string {
  return eventType.replace(/_/g, " ");
}

function confidenceLabel(c: number): string {
  if (c >= 0.8) return "High";
  if (c >= 0.5) return "Medium";
  return "Low";
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return "text-green-400";
  if (c >= 0.5) return "text-amber-400";
  return "text-muted-foreground";
}

function severityColor(s: string): string {
  if (s === "high") return "text-destructive";
  if (s === "medium") return "text-amber-500";
  return "text-green-500";
}

function buildTriggerReason(alert: AlertEvent): string {
  const parts: string[] = [];
  const urgencyNum = alert.urgency ?? 0;
  const confNum = alert.confidence ?? 0;

  if (alert.eventType) {
    parts.push(
      `A ${formatEventType(alert.eventType)} event was detected for ${alert.issuerName}.`,
    );
  } else {
    parts.push(`A credit signal was detected for ${alert.issuerName}.`);
  }

  if (urgencyNum >= 8) {
    parts.push(`Urgency score is critically high at ${urgencyNum}/10.`);
  } else if (urgencyNum >= 5) {
    parts.push(`Urgency score of ${urgencyNum}/10 indicates elevated concern.`);
  } else if (urgencyNum > 0) {
    parts.push(`Urgency score is ${urgencyNum}/10.`);
  }

  if (confNum >= 0.8) {
    parts.push(`Classification confidence is high (${Math.round(confNum * 100)}%), meaning this signal is likely accurate.`);
  } else if (confNum >= 0.5) {
    parts.push(`Classification confidence is moderate (${Math.round(confNum * 100)}%) — review the source article for context.`);
  } else if (confNum > 0) {
    parts.push(`Classification confidence is low (${Math.round(confNum * 100)}%) — treat this signal cautiously.`);
  }

  return parts.join(" ");
}

export function AlertDetailPanel({
  alert,
  open,
  onClose,
  onMarkRead,
  onMarkUnread,
  markReadPending,
}: AlertDetailPanelProps) {
  const [debugExpanded, setDebugExpanded] = useState(false);

  if (!alert) return null;

  const isPortfolioLinked = Boolean(alert.portfolioLinked);
  const derivedSeverity =
    alert.severity ?? urgencyToSeverity(alert.urgency ?? null);
  const triggerReason = buildTriggerReason(alert);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-[440px] sm:w-[500px] flex flex-col gap-0 p-0"
        data-testid="alert-detail-panel"
      >
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2 mb-1">
            <SeverityBadge urgency={alert.urgency} />
            {!alert.isRead && (
              <Badge
                variant="default"
                className="text-[10px] h-4 px-1.5 font-mono"
              >
                UNREAD
              </Badge>
            )}
            {isPortfolioLinked && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 font-mono text-amber-500 border-amber-500/50"
                data-testid="portfolio-impact-badge"
              >
                <Briefcase className="h-2.5 w-2.5 mr-0.5" />
                Portfolio
              </Badge>
            )}
          </div>
          <SheetTitle className="text-base leading-snug pr-6">
            {alert.title}
          </SheetTitle>
          <SheetDescription asChild>
            <Link
              href={`/issuer/${encodeURIComponent(alert.issuerName)}`}
              onClick={onClose}
              className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline w-fit"
              data-testid="issuer-link"
            >
              <Building className="h-3 w-3" />
              {alert.issuerName}
            </Link>
          </SheetDescription>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs font-mono">
            {alert.eventType && (
              <div>
                <p className="text-muted-foreground uppercase tracking-wide text-[10px]">
                  Event type
                </p>
                <p className="font-medium capitalize">
                  {formatEventType(alert.eventType)}
                </p>
              </div>
            )}

            <div>
              <p className="text-muted-foreground uppercase tracking-wide text-[10px]">
                Severity
              </p>
              <p
                className={`font-bold uppercase ${derivedSeverity ? severityColor(derivedSeverity) : "text-muted-foreground"}`}
                data-testid="severity-display"
              >
                {derivedSeverity ?? "–"}
              </p>
            </div>

            <div>
              <p className="text-muted-foreground uppercase tracking-wide text-[10px]">
                Urgency
              </p>
              <p className="font-medium">
                {alert.urgency != null ? `${alert.urgency}/10` : "–"}
              </p>
            </div>

            {alert.confidence != null && (
              <div>
                <p className="text-muted-foreground uppercase tracking-wide text-[10px]">
                  Confidence
                </p>
                <p
                  className={`font-medium ${confidenceColor(alert.confidence)}`}
                  data-testid="confidence-display"
                >
                  {Math.round(alert.confidence * 100)}%{" "}
                  <span className="text-muted-foreground font-normal">
                    ({confidenceLabel(alert.confidence)})
                  </span>
                </p>
              </div>
            )}

            <div>
              <p className="text-muted-foreground uppercase tracking-wide text-[10px]">
                Triggered
              </p>
              <p className="font-medium">{fmtDateTime(alert.triggeredAt)}</p>
            </div>

            <div>
              <p className="text-muted-foreground uppercase tracking-wide text-[10px]">
                Status
              </p>
              <p className="font-medium">
                {alert.isRead ? "Read" : "Unread"}
              </p>
            </div>
          </div>

          <Separator />

          {/* Why this triggered */}
          <div data-testid="explainability-section">
            <div className="flex items-center gap-1.5 mb-2">
              <Info className="h-3.5 w-3.5 text-primary" />
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                Why this triggered
              </p>
            </div>
            <p className="text-xs leading-relaxed text-foreground">
              {triggerReason}
            </p>
          </div>

          {/* Confidence breakdown */}
          {alert.confidence != null && (
            <div data-testid="confidence-breakdown">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide mb-2">
                Confidence breakdown
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${alert.confidence >= 0.8 ? "bg-green-500" : alert.confidence >= 0.5 ? "bg-amber-500" : "bg-muted-foreground"}`}
                      style={{ width: `${Math.round(alert.confidence * 100)}%` }}
                    />
                  </div>
                  <span
                    className={`text-[11px] font-mono font-bold w-10 text-right ${confidenceColor(alert.confidence)}`}
                  >
                    {Math.round(alert.confidence * 100)}%
                  </span>
                </div>
                <p className="text-[11px] font-mono text-muted-foreground">
                  {alert.confidence >= 0.8
                    ? "High confidence — signal is well-supported by source content."
                    : alert.confidence >= 0.5
                      ? "Moderate confidence — corroborate with source article."
                      : "Low confidence — treat as preliminary signal only."}
                </p>
              </div>
            </div>
          )}

          {/* Portfolio impact */}
          {isPortfolioLinked && (
            <div
              className="rounded-md border border-amber-500/30 bg-amber-950/20 px-3 py-2.5"
              data-testid="portfolio-impact-section"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Briefcase className="h-3.5 w-3.5 text-amber-500" />
                <p className="text-[10px] font-mono text-amber-400 uppercase tracking-wide font-bold">
                  Portfolio exposure
                </p>
              </div>
              <p className="text-xs text-foreground">
                {alert.issuerName} is held in one or more of your portfolios.
                This alert may have direct P&amp;L or risk implications.
              </p>
              <Link
                href={`/portfolios`}
                onClick={onClose}
                className="inline-flex items-center gap-1 text-xs font-mono text-amber-400 hover:underline mt-1.5"
              >
                <ExternalLink className="h-3 w-3" />
                View portfolios
              </Link>
            </div>
          )}

          <Separator />

          {/* Navigation links */}
          <div className="space-y-2">
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
              Navigate to
            </p>
            <div className="flex flex-col gap-1.5">
              <Link
                href={`/issuer/${encodeURIComponent(alert.issuerName)}`}
                onClick={onClose}
                className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:underline"
                data-testid="issuer-detail-link"
              >
                <Building className="h-3 w-3" />
                {alert.issuerName} — full intelligence
              </Link>
              <Link
                href={`/article/${alert.articleId}`}
                onClick={onClose}
                className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:underline"
                data-testid="article-link"
              >
                <ExternalLink className="h-3 w-3" />
                Source article #{alert.articleId}
              </Link>
            </div>
          </div>

          {/* Debug / details expandable */}
          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setDebugExpanded((v) => !v)}
              data-testid="debug-toggle"
            >
              {debugExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              DETAILS
            </button>
            {debugExpanded && (
              <div
                className="mt-2 rounded-md bg-secondary/30 border border-border p-3 text-[11px] font-mono space-y-1 text-muted-foreground"
                data-testid="debug-section"
              >
                <div>
                  Alert ID: <span className="text-foreground">#{alert.id}</span>
                </div>
                <div>
                  Rule ID:{" "}
                  <span className="text-foreground">#{alert.alertRuleId}</span>
                </div>
                <div>
                  Article ID:{" "}
                  <span className="text-foreground">#{alert.articleId}</span>
                </div>
                <div>
                  Watchlist ID:{" "}
                  <span className="text-foreground">#{alert.watchlistId}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-border flex gap-2 flex-wrap">
          {!alert.isRead ? (
            <Button
              size="sm"
              variant="default"
              className="h-8 text-xs font-mono"
              onClick={() => onMarkRead(alert.id)}
              disabled={markReadPending}
              data-testid="detail-mark-read"
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              Mark as read
            </Button>
          ) : onMarkUnread ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs font-mono"
              onClick={() => onMarkUnread(alert.id)}
              disabled={markReadPending}
              data-testid="detail-mark-unread"
            >
              <MailOpen className="h-3.5 w-3.5 mr-1" />
              Mark unread
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs font-mono"
            onClick={onClose}
            data-testid="footer-close-btn"
          >
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
