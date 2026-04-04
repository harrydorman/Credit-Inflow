import { useState } from "react";
import {
  useListAlertEvents,
  useListAlertRules,
  useCreateAlertRule,
  useUpdateAlertRule,
  useMarkAlertRead,
  useToggleAlertRule,
  useDeleteAlertRule,
  useListWatchlists,
  getListAlertEventsQueryKey,
  getListAlertRulesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Bell, CheckCheck, ShieldAlert } from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────

function urgencyColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 8) return "text-red-500 font-bold";
  if (score >= 6) return "text-orange-500 font-bold";
  if (score >= 4) return "text-amber-500";
  return "text-emerald-600";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── CreateRuleForm ──────────────────────────────────────────────────────────

function CreateRuleForm() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: watchlistData } = useListWatchlists();
  const createRule = useCreateAlertRule();

  const [watchlistId, setWatchlistId] = useState<string>("");
  const [name, setName] = useState("");
  const [minimumUrgency, setMinimumUrgency] = useState<string>("");
  const [eventTypesRaw, setEventTypesRaw] = useState("");
  const [covenantFlagOnly, setCovenantFlagOnly] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const wid = parseInt(watchlistId, 10);
    if (!wid || !name.trim()) return;

    const rawTypes = eventTypesRaw.trim();
    const eventTypes =
      rawTypes.length > 0
        ? rawTypes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;

    const minUrgency =
      minimumUrgency !== "" ? parseInt(minimumUrgency, 10) : null;

    try {
      await createRule.mutateAsync({
        data: {
          watchlistId: wid,
          name: name.trim(),
          isActive: true,
          minimumUrgency: minUrgency,
          eventTypes: eventTypes && eventTypes.length > 0 ? eventTypes : null,
          covenantFlagOnly,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListAlertRulesQueryKey() });
      setWatchlistId("");
      setName("");
      setMinimumUrgency("");
      setEventTypesRaw("");
      setCovenantFlagOnly(false);
      toast({ title: "Alert rule created" });
    } catch {
      toast({
        title: "Failed to create rule",
        variant: "destructive",
      });
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-border rounded-md p-4 space-y-3 bg-card"
    >
      <h2 className="font-mono text-xs font-bold text-muted-foreground uppercase tracking-wide">
        Create Alert Rule
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Watchlist selector */}
        <div className="space-y-1">
          <label className="text-xs font-mono text-muted-foreground">
            WATCHLIST <span className="text-destructive">*</span>
          </label>
          <Select value={watchlistId} onValueChange={setWatchlistId}>
            <SelectTrigger className="h-8 text-xs font-mono">
              <SelectValue placeholder="Select watchlist" />
            </SelectTrigger>
            <SelectContent>
              {watchlistData?.watchlists.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Rule name */}
        <div className="space-y-1">
          <label className="text-xs font-mono text-muted-foreground">
            NAME <span className="text-destructive">*</span>
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. High urgency downgrade"
            className="h-8 text-xs font-mono"
          />
        </div>

        {/* Minimum urgency */}
        <div className="space-y-1">
          <label className="text-xs font-mono text-muted-foreground">
            MIN URGENCY (1–10)
          </label>
          <Select value={minimumUrgency} onValueChange={setMinimumUrgency}>
            <SelectTrigger className="h-8 text-xs font-mono">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Any</SelectItem>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}+
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Event types */}
        <div className="space-y-1">
          <label className="text-xs font-mono text-muted-foreground">
            EVENT TYPES (comma-separated)
          </label>
          <Input
            value={eventTypesRaw}
            onChange={(e) => setEventTypesRaw(e.target.value)}
            placeholder="e.g. downgrade, default"
            className="h-8 text-xs font-mono"
          />
        </div>
      </div>

      {/* Checkboxes */}
      <div className="flex items-center gap-4 pt-1">
        <label className="flex items-center gap-2 text-xs font-mono cursor-pointer">
          <input
            type="checkbox"
            checked={covenantFlagOnly}
            onChange={(e) => setCovenantFlagOnly(e.target.checked)}
            className="accent-primary"
          />
          COVENANT FLAG ONLY
        </label>
      </div>

      <Button
        type="submit"
        size="sm"
        className="font-mono text-xs h-8"
        disabled={
          !watchlistId || !name.trim() || createRule.isPending
        }
      >
        CREATE RULE
      </Button>
    </form>
  );
}

// ─── RulesList ───────────────────────────────────────────────────────────────

function RulesList() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useListAlertRules();
  const { data: watchlistData } = useListWatchlists();
  const toggleRule = useToggleAlertRule();
  const deleteRule = useDeleteAlertRule();
  const updateRule = useUpdateAlertRule();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editMinUrgency, setEditMinUrgency] = useState<string>("");
  const [editEventTypesRaw, setEditEventTypesRaw] = useState("");
  const [editCovenantFlagOnly, setEditCovenantFlagOnly] = useState(false);

  const watchlistName = (id: number) =>
    watchlistData?.watchlists.find((w) => w.id === id)?.name ?? `#${id}`;

  const startEdit = (rule: NonNullable<typeof data>["rules"][number]) => {
    setEditingId(rule.id);
    setEditName(rule.name);
    setEditMinUrgency(rule.minimumUrgency != null ? String(rule.minimumUrgency) : "");
    setEditEventTypesRaw(rule.eventTypes ? rule.eventTypes.join(", ") : "");
    setEditCovenantFlagOnly(rule.covenantFlagOnly);
  };

  const cancelEdit = () => setEditingId(null);

  const handleSave = async (id: number) => {
    const rawTypes = editEventTypesRaw.trim();
    const parsedTypes =
      rawTypes.length > 0
        ? rawTypes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;

    const minUrgency = editMinUrgency !== "" ? parseInt(editMinUrgency, 10) : null;

    try {
      await updateRule.mutateAsync({
        id,
        data: {
          name: editName.trim() || undefined,
          minimumUrgency: minUrgency,
          eventTypes: parsedTypes && parsedTypes.length > 0 ? parsedTypes : null,
          covenantFlagOnly: editCovenantFlagOnly,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListAlertRulesQueryKey() });
      setEditingId(null);
      toast({ title: "Alert rule updated" });
    } catch {
      toast({ title: "Failed to update rule", variant: "destructive" });
    }
  };

  const handleToggle = async (id: number) => {
    try {
      await toggleRule.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListAlertRulesQueryKey() });
    } catch {
      toast({ title: "Failed to update rule", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this alert rule? This cannot be undone.")) return;
    try {
      await deleteRule.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListAlertRulesQueryKey() });
    } catch {
      toast({ title: "Failed to delete rule", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!data?.rules.length) {
    return (
      <p className="text-xs font-mono text-muted-foreground py-3">
        No alert rules yet. Create one above.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {data.rules.map((rule) =>
        editingId === rule.id ? (
          <div
            key={rule.id}
            className="border border-primary/40 rounded-md px-4 py-3 bg-card space-y-3 text-xs font-mono"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-mono text-muted-foreground">NAME</label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-muted-foreground">
                  MIN URGENCY (1–10)
                </label>
                <Select value={editMinUrgency} onValueChange={setEditMinUrgency}>
                  <SelectTrigger className="h-8 text-xs font-mono">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Any</SelectItem>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}+
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-muted-foreground">
                  EVENT TYPES (comma-separated)
                </label>
                <Input
                  value={editEventTypesRaw}
                  onChange={(e) => setEditEventTypesRaw(e.target.value)}
                  placeholder="e.g. downgrade, default"
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-mono cursor-pointer">
                <input
                  type="checkbox"
                  checked={editCovenantFlagOnly}
                  onChange={(e) => setEditCovenantFlagOnly(e.target.checked)}
                  className="accent-primary"
                />
                COVENANT FLAG ONLY
              </label>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs font-mono"
                onClick={() => handleSave(rule.id)}
                disabled={!editName.trim() || updateRule.isPending}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs font-mono"
                onClick={cancelEdit}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div
            key={rule.id}
            className="border border-border rounded-md px-4 py-3 bg-card flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono"
          >
            <span className="font-bold text-sm truncate max-w-[200px]">
              {rule.name}
            </span>

            <span className="text-muted-foreground truncate">
              {watchlistName(rule.watchlistId)}
            </span>

            {rule.minimumUrgency != null && (
              <Badge variant="outline" className="text-xs">
                urgency ≥ {rule.minimumUrgency}
              </Badge>
            )}

            {rule.eventTypes?.map((et) => (
              <Badge key={et} variant="secondary" className="text-xs">
                {et}
              </Badge>
            ))}

            {rule.covenantFlagOnly && (
              <Badge variant="outline" className="text-xs border-amber-500 text-amber-500">
                covenant only
              </Badge>
            )}

            <Badge
              variant={rule.isActive ? "default" : "secondary"}
              className="ml-auto text-xs"
            >
              {rule.isActive ? "ACTIVE" : "INACTIVE"}
            </Badge>

            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs font-mono"
              onClick={() => startEdit(rule)}
            >
              Edit
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs font-mono"
              onClick={() => handleToggle(rule.id)}
              disabled={toggleRule.isPending}
            >
              {rule.isActive ? "Disable" : "Enable"}
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs font-mono text-destructive hover:text-destructive"
              onClick={() => handleDelete(rule.id)}
              disabled={deleteRule.isPending}
            >
              Delete
            </Button>
          </div>
        )
      )}
    </div>
  );
}

// ─── AlertEventsList ─────────────────────────────────────────────────────────

function AlertEventsList() {
  const queryClient = useQueryClient();
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [watchlistFilter, setWatchlistFilter] = useState<string>("");
  const markRead = useMarkAlertRead();
  const { data: watchlistData } = useListWatchlists();

  const params: Parameters<typeof useListAlertEvents>[0] = {
    limit: 100,
    ...(showUnreadOnly ? { isRead: false } : {}),
    ...(watchlistFilter !== "" ? { watchlistId: Number(watchlistFilter) } : {}),
  };
  const { data, isLoading } = useListAlertEvents(params);

  const handleMarkRead = async (id: number) => {
    await markRead.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListAlertEventsQueryKey() });
  };

  const emptyMessage = () => {
    if (watchlistFilter !== "" && showUnreadOnly) return "No unread alerts for this watchlist.";
    if (watchlistFilter !== "") return "No alerts for this watchlist.";
    if (showUnreadOnly) return "No unread alerts.";
    return "No alerts yet.";
  };

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={showUnreadOnly ? "default" : "outline"}
          className="h-7 text-xs font-mono"
          onClick={() => setShowUnreadOnly((v) => !v)}
        >
          {showUnreadOnly ? "UNREAD ONLY" : "ALL"}
        </Button>

        <Select value={watchlistFilter} onValueChange={setWatchlistFilter}>
          <SelectTrigger className="h-7 text-xs font-mono w-44">
            <SelectValue placeholder="All watchlists" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All watchlists</SelectItem>
            {watchlistData?.watchlists.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {data && (
          <span className="text-xs text-muted-foreground font-mono">
            {data.total} alert{data.total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !data?.alerts.length ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-2">
          <Bell className="h-8 w-8 opacity-20" />
          <p className="font-mono text-sm">{emptyMessage()}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.alerts.map((alert) => (
            <div
              key={alert.id}
              className={`border rounded-md px-4 py-3 flex items-start gap-3 transition-colors ${
                alert.isRead
                  ? "border-border bg-card text-muted-foreground"
                  : "border-primary/40 bg-primary/5"
              }`}
            >
              {/* Urgency */}
              <div className="shrink-0 text-right w-8 mt-0.5">
                <span
                  className={`text-sm font-mono font-bold ${urgencyColor(alert.urgency)}`}
                >
                  {alert.urgency ?? "–"}
                </span>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <Link
                  href={`/article/${alert.articleId}`}
                  className={`text-sm font-medium truncate hover:text-primary transition-colors block ${
                    alert.isRead ? "" : "text-foreground"
                  }`}
                >
                  {alert.title}
                </Link>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="text-xs font-mono">{alert.issuerName}</span>
                  {alert.eventType && (
                    <Badge variant="secondary" className="text-xs">
                      {alert.eventType}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(alert.triggeredAt)}
                  </span>
                </div>
              </div>

              {/* Mark read */}
              {!alert.isRead && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs font-mono shrink-0"
                  onClick={() => handleMarkRead(alert.id)}
                  disabled={markRead.isPending}
                >
                  <CheckCheck className="h-3.5 w-3.5 mr-1" />
                  Mark read
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Alerts() {
  return (
    <Layout>
      <div className="p-6 space-y-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
        </div>

        {/* Create rule */}
        <CreateRuleForm />

        {/* Rules list */}
        <section className="space-y-3">
          <h2 className="font-mono text-xs font-bold text-muted-foreground uppercase tracking-wide">
            Alert Rules
          </h2>
          <RulesList />
        </section>

        {/* Events list */}
        <section className="space-y-3">
          <h2 className="font-mono text-xs font-bold text-muted-foreground uppercase tracking-wide">
            Alert Events
          </h2>
          <AlertEventsList />
        </section>
      </div>
    </Layout>
  );
}
