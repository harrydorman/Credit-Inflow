import { useState, useCallback } from "react";
import {
  useListAlertEvents,
  useMarkAlertRead,
  useBulkMarkAlertsRead,
  getListAlertEventsQueryKey,
  type AlertEvent,
  type ListAlertEventsParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, CheckCheck, AlertCircle } from "lucide-react";
import {
  AlertFeedFilters,
  AlertFeedRow,
  AlertDetailPanel,
  DEFAULT_FILTERS,
  type AlertFilters,
} from "@/components/alerts";

// ─── AlertFeed ───────────────────────────────────────────────────────────────

function AlertFeed() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── filter state ──────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<AlertFilters>(DEFAULT_FILTERS);

  // ── selection state ───────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // ── detail panel ──────────────────────────────────────────────────────────
  const [detailAlert, setDetailAlert] = useState<AlertEvent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // ── API hooks ─────────────────────────────────────────────────────────────
  const markRead = useMarkAlertRead();
  const bulkMarkRead = useBulkMarkAlertsRead();

  // Build params from filters
  const params: ListAlertEventsParams = {
    limit: 100,
    ...(filters.isRead === "unread" ? { isRead: false } : {}),
    ...(filters.isRead === "read" ? { isRead: true } : {}),
    ...(filters.severity !== "" ? { severity: filters.severity } : {}),
    ...(filters.issuerName.trim() !== ""
      ? { issuerName: filters.issuerName.trim() }
      : {}),
    ...(filters.eventType.trim() !== ""
      ? { eventType: filters.eventType.trim() }
      : {}),
    ...(filters.portfolioLinked !== null
      ? { portfolioLinked: filters.portfolioLinked }
      : {}),
    ...(filters.dateFrom !== "" ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo !== "" ? { dateTo: filters.dateTo } : {}),
  };

  const { data, isLoading, isError, refetch } = useListAlertEvents(params);

  // Unread count (always fetched regardless of filter)
  const { data: unreadData } = useListAlertEvents({ isRead: false, limit: 1 });
  const unreadCount = unreadData?.total ?? 0;

  // ── handlers ─────────────────────────────────────────────────────────────

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: getListAlertEventsQueryKey() }),
    [queryClient],
  );

  const handleMarkRead = useCallback(
    async (id: number) => {
      try {
        await markRead.mutateAsync({ id });
        await invalidate();
        // If detail is showing this alert, close it or update state
        setDetailAlert((prev: AlertEvent | null) =>
          prev?.id === id ? { ...prev, isRead: true } : prev,
        );
      } catch {
        toast({ title: "Failed to mark alert as read", variant: "destructive" });
      }
    },
    [markRead, invalidate, toast],
  );

  const handleBulkMarkRead = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await bulkMarkRead.mutateAsync({ data: { ids } });
      await invalidate();
      setSelectedIds(new Set());
      toast({ title: `${ids.length} alert${ids.length > 1 ? "s" : ""} marked as read` });
    } catch {
      toast({ title: "Failed to bulk mark alerts", variant: "destructive" });
    }
  }, [selectedIds, bulkMarkRead, invalidate, toast]);

  const handleSelectAll = useCallback(() => {
    if (!data?.alerts) return;
    const unread = data.alerts.filter((a: AlertEvent) => !a.isRead);
    if (selectedIds.size === unread.length && unread.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unread.map((a: AlertEvent) => a.id)));
    }
  }, [data?.alerts, selectedIds.size]);

  const handleSelect = useCallback((id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleRowClick = useCallback((alert: AlertEvent) => {
    setDetailAlert(alert);
    setDetailOpen(true);
  }, []);

  const handleDetailClose = useCallback(() => setDetailOpen(false), []);

  const handleFiltersChange = useCallback((f: AlertFilters) => {
    setFilters(f);
    setSelectedIds(new Set());
  }, []);

  // ── render ────────────────────────────────────────────────────────────────

  const alerts = data?.alerts ?? [];
  const unreadAlerts = alerts.filter((a: AlertEvent) => !a.isRead);
  const allUnreadSelected =
    unreadAlerts.length > 0 && selectedIds.size === unreadAlerts.length;

  return (
    <div className="space-y-4" data-testid="alert-feed">
      {/* Filters */}
      <AlertFeedFilters
        filters={filters}
        onChange={handleFiltersChange}
        totalCount={data?.total}
        unreadCount={unreadCount}
      />

      {/* Bulk actions */}
      {alerts.length > 0 && (
        <div className="flex items-center gap-2 py-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs font-mono"
            onClick={handleSelectAll}
            disabled={unreadAlerts.length === 0}
            data-testid="select-all-unread"
          >
            {allUnreadSelected ? "Deselect all" : "Select unread"}
          </Button>

          {selectedIds.size > 0 && (
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs font-mono"
              onClick={handleBulkMarkRead}
              disabled={bulkMarkRead.isPending}
              data-testid="bulk-mark-read"
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Mark {selectedIds.size} read
            </Button>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-0" data-testid="alert-feed-loading">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 px-4 py-3 border-b border-border"
            >
              <Skeleton className="h-4 w-4 rounded mt-0.5" />
              <Skeleton className="h-5 w-10 rounded" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div
          className="flex flex-col items-center justify-center py-12 gap-2 text-center"
          data-testid="alert-feed-error"
        >
          <AlertCircle className="h-8 w-8 text-destructive opacity-60" />
          <p className="font-mono text-sm text-destructive">
            Failed to load alerts.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs h-7"
            onClick={() => refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && alerts.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-16 gap-2 text-center"
          data-testid="alert-feed-empty"
        >
          <ShieldAlert className="h-10 w-10 opacity-15" />
          <p className="font-mono text-sm text-muted-foreground">
            {filters.isRead === "unread"
              ? "No unread alerts."
              : filters.severity !== "" ||
                  filters.issuerName !== "" ||
                  filters.eventType !== "" ||
                  filters.portfolioLinked !== null
                ? "No alerts match the active filters."
                : "No alerts yet."}
          </p>
        </div>
      )}

      {/* Alert rows */}
      {!isLoading && !isError && alerts.length > 0 && (
        <div
          className="border border-border rounded-md overflow-hidden"
          role="table"
          aria-label="Alert feed"
          data-testid="alert-feed-list"
        >
          {alerts.map((alert: AlertEvent) => (
            <AlertFeedRow
              key={alert.id}
              alert={alert}
              selected={selectedIds.has(alert.id)}
              onSelect={handleSelect}
              onMarkRead={handleMarkRead}
              onClick={handleRowClick}
              markReadPending={markRead.isPending}
            />
          ))}
        </div>
      )}

      {/* Detail panel */}
      <AlertDetailPanel
        alert={detailAlert}
        open={detailOpen}
        onClose={handleDetailClose}
        onMarkRead={handleMarkRead}
        markReadPending={markRead.isPending}
      />
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Alerts() {
  const { data: unreadData } = useListAlertEvents({ isRead: false, limit: 1 });
  const unreadCount = unreadData?.total ?? 0;

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Alert Feed</h1>
          {unreadCount > 0 && (
            <Badge
              className="font-mono text-xs"
              aria-label={`${unreadCount} unread alerts`}
            >
              {unreadCount} unread
            </Badge>
          )}
        </div>

        {/* Alert feed */}
        <AlertFeed />
      </div>
    </Layout>
  );
}
