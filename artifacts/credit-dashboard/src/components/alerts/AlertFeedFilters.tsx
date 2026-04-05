import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ListAlertEventsSeverity } from "@workspace/api-client-react";
import { X } from "lucide-react";

export interface AlertFilters {
  severity: ListAlertEventsSeverity | "";
  isRead: "" | "unread" | "read";
  issuerName: string;
  eventType: string;
  portfolioLinked: boolean | null;
  dateFrom: string;
  dateTo: string;
}

export const DEFAULT_FILTERS: AlertFilters = {
  severity: "",
  isRead: "",
  issuerName: "",
  eventType: "",
  portfolioLinked: null,
  dateFrom: "",
  dateTo: "",
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
    filters.dateTo !== "";

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
          className="h-7 text-xs font-mono w-34"
          title="From date"
          data-testid="filter-date-from"
        />

        {/* Date to */}
        <Input
          type="date"
          value={filters.dateTo}
          onChange={(e) => set("dateTo", e.target.value)}
          className="h-7 text-xs font-mono w-34"
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
