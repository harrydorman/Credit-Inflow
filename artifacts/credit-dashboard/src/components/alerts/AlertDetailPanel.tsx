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
import { SeverityBadge } from "./AlertFeedRow";
import { Link } from "wouter";
import { CheckCheck, Briefcase, ExternalLink } from "lucide-react";

interface AlertDetailPanelProps {
  alert: AlertEvent | null;
  open: boolean;
  onClose: () => void;
  onMarkRead: (id: number) => void;
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

export function AlertDetailPanel({
  alert,
  open,
  onClose,
  onMarkRead,
  markReadPending,
}: AlertDetailPanelProps) {
  if (!alert) return null;

  const isPortfolioLinked = Boolean(
    (alert as AlertEvent & { portfolioLinked?: boolean }).portfolioLinked,
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-[420px] sm:w-[480px] flex flex-col gap-0 p-0"
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
              >
                <Briefcase className="h-2.5 w-2.5 mr-0.5" />
                Portfolio
              </Badge>
            )}
          </div>
          <SheetTitle className="text-base leading-snug pr-6">
            {alert.title}
          </SheetTitle>
          <SheetDescription className="font-mono text-xs">
            {alert.issuerName}
          </SheetDescription>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs font-mono">
            <div>
              <p className="text-muted-foreground uppercase tracking-wide text-[10px]">
                Issuer
              </p>
              <p className="font-medium">{alert.issuerName}</p>
            </div>

            {alert.eventType && (
              <div>
                <p className="text-muted-foreground uppercase tracking-wide text-[10px]">
                  Event type
                </p>
                <p className="font-medium">{alert.eventType}</p>
              </div>
            )}

            <div>
              <p className="text-muted-foreground uppercase tracking-wide text-[10px]">
                Urgency
              </p>
              <p className="font-medium">
                {alert.urgency != null ? `${alert.urgency}/10` : "–"}
              </p>
            </div>

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

            <div>
              <p className="text-muted-foreground uppercase tracking-wide text-[10px]">
                Alert ID
              </p>
              <p className="font-medium">#{alert.id}</p>
            </div>
          </div>

          <Separator />

          {/* Article link */}
          <div>
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide mb-1">
              Source Article
            </p>
            <Link
              href={`/article/${alert.articleId}`}
              onClick={onClose}
              className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              View article #{alert.articleId}
            </Link>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-border flex gap-2">
          {!alert.isRead && (
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
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs font-mono"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
