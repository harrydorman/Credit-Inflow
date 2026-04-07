import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ListAlertEventsSeverity, AlertWorkflowAction } from "@workspace/api-client-react";
import type { PriorityLabel } from "@/lib/alertPriority";
import { X } from "lucide-react";

export interface AlertFilters {
  severity: ListAlertEventsSeverity | "";
  isRead: "" | "unread" | "read";
  issuerName: string;
  eventType: string;
  portfolioLinked: boolean | null;
  dateFrom: string;
  dateTo: string;
  /** Client-side: filter by computed priority label */
  priority: PriorityLabel | "";
  /** Client-side: show only unread alerts with High or Critical priority */
  unreadHighPriority: boolean;
  /** Filter by analyst workflow action. "unassigned" for alerts with no action. */
  action: AlertWorkflowAction | "unassigned" | "";
}

export const DEFAULT_FILTERS: AlertFilters = {
  severity: "",
  isRead: "",
  issuerName: "",
  eventType: "",
  portfolioLinked: null,
  dateFrom: "",
  dateTo: "",
  priority: "",
  unreadHighPriority: false,
  action: "",
};

interface AlertFeedFiltersProps {
  filters: AlertFilters;
  onChange: (filters: AlertFilters) => void;
  totalCount?: number;
  unreadCount?: number;
}

export function AlertFeedFilters({
  filters,
  onChange,
  totalCount,
  unreadCount,
}: AlertFeedFiltersProps) {
  const set = <K extends keyof AlertFilters>(key: K, val: AlertFilters[K]) =>
    onChange({ ...filters, [key]: val });

  const hasActiveFilters =
    filters.severity !== "" ||
    filters.isRead !== "" ||
    filters.issuerName !== "" ||
    filters.eventType !== "" ||
    filters.portfolioLinked !== null ||
    filters.dateFrom !== "" ||
    filters.dateTo !== "" ||
    filters.priority !== "" ||
    filters.unreadHighPriority ||
    filters.action !== "";

  return (
    <div className="space-y-2" data-testid="alert-feed-filters">
      <div className="flex flex-wrap items-center gap-2">
        {/* Read/Unread toggle */}
        <Select
          value={filters.isRead || "all"}
          onValueChange={(v) =>
            set("isRead", v === "all" ? "" : (v as AlertFilters["isRead"]))
          }
        >
          <SelectTrigger
            className="h-7 text-xs font-mono w-28"
            data-testid="filter-read-state"
          >
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
            <SelectItem value="read">Read</SelectItem>
          </SelectContent>
        </Select>

        {/* Severity */}
        <Select
          value={filters.severity || "all"}
          onValueChange={(v) =>
            set("severity", v === "all" ? "" : (v as AlertFilters["severity"]))
          }
        >
          <SelectTrigger
            className="h-7 text-xs font-mono w-28"
            data-testid="filter-severity"
          >
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severity</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        {/* Portfolio-linked */}
        <Button
          size="sm"
          variant={filters.portfolioLinked === true ? "default" : "outline"}
          className="h-7 text-xs font-mono"
          onClick={() =>
            set(
              "portfolioLinked",
              filters.portfolioLinked === true ? null : true,
            )
          }
          data-testid="filter-portfolio"
        >
          Portfolio only
        </Button>

        {/* Priority */}
        <Select
          value={filters.priority || "all"}
          onValueChange={(v) =>
            set("priority", v === "all" ? "" : (v as AlertFilters["priority"]))
          }
        >
          <SelectTrigger
            className="h-7 text-xs font-mono w-32"
            data-testid="filter-priority"
          >
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priority</SelectItem>
            <SelectItem value="Critical">Critical</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
          </SelectContent>
        </Select>

        {/* Unread + high priority */}
        <Button
          size="sm"
          variant={filters.unreadHighPriority ? "default" : "outline"}
          className="h-7 text-xs font-mono"
          onClick={() => set("unreadHighPriority", !filters.unreadHighPriority)}
          data-testid="filter-unread-high-priority"
        >
          Unread + High
        </Button>

        {/* Analyst action */}
        <Select
          value={filters.action || "all"}
          onValueChange={(v) =>
            set("action", v === "all" ? "" : (v as AlertFilters["action"]))
          }
        >
          <SelectTrigger
            className="h-7 text-xs font-mono w-36"
            data-testid="filter-action"
          >
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="investigate">Investigate</SelectItem>
            <SelectItem value="monitor">Monitor</SelectItem>
            <SelectItem value="ignore">Ignore</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
          </SelectContent>
        </Select>

        {/* Issuer */}
        <Input
          value={filters.issuerName}
          onChange={(e) => set("issuerName", e.target.value)}
          placeholder="Issuer…"
          className="h-7 text-xs font-mono w-36"
          data-testid="filter-issuer"
        />

        {/* Event type */}
        <Input
          value={filters.eventType}
          onChange={(e) => set("eventType", e.target.value)}
          placeholder="Event type…"
          className="h-7 text-xs font-mono w-36"
          data-testid="filter-event-type"
        />

        {/* Date from */}
        <Input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => set("dateFrom", e.target.value)}
          className="h-7 text-xs font-mono w-36"
          title="From date"
          data-testid="filter-date-from"
        />

        {/* Date to */}
        <Input
          type="date"
          value={filters.dateTo}
          onChange={(e) => set("dateTo", e.target.value)}
          className="h-7 text-xs font-mono w-36"
          title="To date"
          data-testid="filter-date-to"
        />

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs font-mono text-muted-foreground"
            onClick={() => onChange(DEFAULT_FILTERS)}
            data-testid="filter-clear"
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}

        {/* Count */}
        {totalCount !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground font-mono">
            {unreadCount !== undefined && unreadCount > 0 && (
              <span className="text-primary font-bold">{unreadCount} unread · </span>
            )}
            {totalCount} alert{totalCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
