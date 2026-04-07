/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertFeedFilters, DEFAULT_FILTERS, type AlertFilters } from "./AlertFeedFilters";
import { AlertFeedRow, urgencyToSeverity, SeverityBadge, PriorityBadge, ActionBadge } from "./AlertFeedRow";
import type { AlertEvent } from "@workspace/api-client-react";

// ─── helpers ────────────────────────────────────────────────────────────────

const makeAlert = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 1,
  alertRuleId: 10,
  watchlistId: 5,
  articleId: 42,
  issuerName: "Acme Corp",
  title: "Acme Corp downgrade warning",
  urgency: 7,
  eventType: "downgrade",
  triggeredAt: new Date("2024-01-15T10:30:00Z").toISOString(),
  isRead: false,
  ...overrides,
});

// ─── urgencyToSeverity ───────────────────────────────────────────────────────

describe("urgencyToSeverity", () => {
  it("returns high for urgency >= 8", () => {
    expect(urgencyToSeverity(8)).toBe("high");
    expect(urgencyToSeverity(10)).toBe("high");
  });

  it("returns medium for urgency 5-7", () => {
    expect(urgencyToSeverity(5)).toBe("medium");
    expect(urgencyToSeverity(7)).toBe("medium");
  });

  it("returns low for urgency < 5", () => {
    expect(urgencyToSeverity(1)).toBe("low");
    expect(urgencyToSeverity(4)).toBe("low");
  });

  it("returns null for null/undefined urgency", () => {
    expect(urgencyToSeverity(null)).toBeNull();
    expect(urgencyToSeverity(undefined)).toBeNull();
  });
});

// ─── SeverityBadge ───────────────────────────────────────────────────────────

describe("SeverityBadge", () => {
  it("renders HIGH for urgency 8+", () => {
    render(<SeverityBadge urgency={9} />);
    expect(screen.getByText("HIGH")).toBeInTheDocument();
  });

  it("renders MED for urgency 5-7", () => {
    render(<SeverityBadge urgency={6} />);
    expect(screen.getByText("MED")).toBeInTheDocument();
  });

  it("renders LOW for urgency < 5", () => {
    render(<SeverityBadge urgency={3} />);
    expect(screen.getByText("LOW")).toBeInTheDocument();
  });

  it("renders dash for null urgency", () => {
    render(<SeverityBadge urgency={null} />);
    expect(screen.getByText("–")).toBeInTheDocument();
  });
});

// ─── AlertFeedFilters ────────────────────────────────────────────────────────

describe("AlertFeedFilters", () => {
  let filters: AlertFilters;
  const onChange = vi.fn((f: AlertFilters) => {
    filters = f;
  });

  beforeEach(() => {
    filters = { ...DEFAULT_FILTERS };
    onChange.mockClear();
  });

  it("renders filter controls", () => {
    render(
      <AlertFeedFilters filters={DEFAULT_FILTERS} onChange={onChange} />,
    );
    expect(screen.getByTestId("alert-feed-filters")).toBeInTheDocument();
    expect(screen.getByTestId("filter-issuer")).toBeInTheDocument();
    expect(screen.getByTestId("filter-event-type")).toBeInTheDocument();
    expect(screen.getByTestId("filter-portfolio")).toBeInTheDocument();
  });

  it("shows total and unread count", () => {
    render(
      <AlertFeedFilters
        filters={DEFAULT_FILTERS}
        onChange={onChange}
        totalCount={25}
        unreadCount={5}
      />,
    );
    expect(screen.getByText(/25 alerts/)).toBeInTheDocument();
    expect(screen.getByText(/5 unread/)).toBeInTheDocument();
  });

  it("calls onChange when issuer input changes", async () => {
    const Wrapper = () => {
      const [f, setF] = useState<AlertFilters>({ ...DEFAULT_FILTERS });
      return <AlertFeedFilters filters={f} onChange={setF} />;
    };
    render(<Wrapper />);
    const input = screen.getByTestId("filter-issuer");
    await userEvent.type(input, "Acme");
    expect(input).toHaveValue("Acme");
  });

  it("calls onChange when event type input changes", async () => {
    const Wrapper = () => {
      const [f, setF] = useState<AlertFilters>({ ...DEFAULT_FILTERS });
      return <AlertFeedFilters filters={f} onChange={setF} />;
    };
    render(<Wrapper />);
    const input = screen.getByTestId("filter-event-type");
    await userEvent.type(input, "downgrade");
    expect(input).toHaveValue("downgrade");
  });

  it("toggles portfolio-linked filter on button click", async () => {
    render(
      <AlertFeedFilters filters={DEFAULT_FILTERS} onChange={onChange} />,
    );
    const btn = screen.getByTestId("filter-portfolio");
    await userEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ portfolioLinked: true }),
    );
  });

  it("clears portfolio filter when already active", async () => {
    render(
      <AlertFeedFilters
        filters={{ ...DEFAULT_FILTERS, portfolioLinked: true }}
        onChange={onChange}
      />,
    );
    const btn = screen.getByTestId("filter-portfolio");
    await userEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ portfolioLinked: null }),
    );
  });

  it("shows clear button when filters are active", () => {
    render(
      <AlertFeedFilters
        filters={{ ...DEFAULT_FILTERS, issuerName: "Acme" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("filter-clear")).toBeInTheDocument();
  });

  it("clears all filters on clear button click", async () => {
    render(
      <AlertFeedFilters
        filters={{ ...DEFAULT_FILTERS, issuerName: "Acme", severity: "high" }}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("filter-clear"));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_FILTERS);
  });

  it("does not show clear button when no filters active", () => {
    render(
      <AlertFeedFilters filters={DEFAULT_FILTERS} onChange={onChange} />,
    );
    expect(screen.queryByTestId("filter-clear")).not.toBeInTheDocument();
  });
});

// ─── AlertFeedRow ─────────────────────────────────────────────────────────────

describe("AlertFeedRow", () => {
  const defaultProps = {
    selected: false,
    onSelect: vi.fn(),
    onMarkRead: vi.fn(),
    onClick: vi.fn(),
    markReadPending: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders alert title and issuer", () => {
    render(<AlertFeedRow alert={makeAlert()} {...defaultProps} />);
    expect(screen.getByText("Acme Corp downgrade warning")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });

  it("renders event type badge", () => {
    render(<AlertFeedRow alert={makeAlert()} {...defaultProps} />);
    expect(screen.getByText("downgrade")).toBeInTheDocument();
  });

  it("renders severity badge for urgency", () => {
    render(<AlertFeedRow alert={makeAlert({ urgency: 8 })} {...defaultProps} />);
    expect(screen.getByText("HIGH")).toBeInTheDocument();
  });

  it("calls onClick when row clicked", async () => {
    const onClick = vi.fn();
    render(
      <AlertFeedRow alert={makeAlert()} {...defaultProps} onClick={onClick} />,
    );
    await userEvent.click(screen.getByRole("row"));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("calls onMarkRead when mark read button clicked", async () => {
    const onMarkRead = vi.fn();
    render(
      <AlertFeedRow
        alert={makeAlert({ isRead: false })}
        {...defaultProps}
        onMarkRead={onMarkRead}
      />,
    );
    // Hover to reveal buttons
    const row = screen.getByTestId("alert-row-1");
    fireEvent.mouseOver(row);
    const btn = screen.getByTestId("mark-read-1");
    fireEvent.click(btn);
    expect(onMarkRead).toHaveBeenCalledWith(1);
  });

  it("does not show mark-read button for read alerts", () => {
    render(<AlertFeedRow alert={makeAlert({ isRead: true })} {...defaultProps} />);
    expect(screen.queryByTestId("mark-read-1")).not.toBeInTheDocument();
  });

  it("calls onSelect when checkbox clicked", async () => {
    const onSelect = vi.fn();
    render(
      <AlertFeedRow
        alert={makeAlert()}
        {...defaultProps}
        onSelect={onSelect}
      />,
    );
    const checkbox = screen.getByTestId("alert-checkbox-1");
    await userEvent.click(checkbox);
    expect(onSelect).toHaveBeenCalledWith(1, true);
  });

  it("applies unread styling when isRead is false", () => {
    render(<AlertFeedRow alert={makeAlert({ isRead: false })} {...defaultProps} />);
    const row = screen.getByTestId("alert-row-1");
    expect(row.className).toContain("border-l-primary");
  });

  it("applies read styling when isRead is true", () => {
    render(<AlertFeedRow alert={makeAlert({ isRead: true })} {...defaultProps} />);
    const row = screen.getByTestId("alert-row-1");
    expect(row.className).toContain("text-muted-foreground");
  });

  it("renders priority badge", () => {
    render(<AlertFeedRow alert={makeAlert({ urgency: 9, severity: "high" })} {...defaultProps} />);
    expect(screen.getByTestId("priority-badge")).toBeInTheDocument();
  });

  it("applies critical row highlight for critical priority alerts", () => {
    const criticalAlert = makeAlert({
      urgency: 10,
      severity: "high",
      confidence: 1.0,
      portfolioLinked: true,
      isRead: false,
    });
    render(<AlertFeedRow alert={criticalAlert} {...defaultProps} />);
    const row = screen.getByTestId("alert-row-1");
    expect(row.className).toContain("border-l-red-600");
  });

  it("renders action badge when action is provided", () => {
    render(
      <AlertFeedRow
        alert={makeAlert()}
        {...defaultProps}
        action="investigate"
      />,
    );
    expect(screen.getByTestId("action-badge")).toBeInTheDocument();
    expect(screen.getByTestId("action-badge").textContent).toContain("Investigating");
  });

  it("does not render action badge when action is null", () => {
    render(<AlertFeedRow alert={makeAlert()} {...defaultProps} action={null} />);
    expect(screen.queryByTestId("action-badge")).not.toBeInTheDocument();
  });
});

// ─── AlertFeedFilters — new filters ──────────────────────────────────────────

describe("AlertFeedFilters — priority and unread+high filters", () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
  });

  it("renders priority filter dropdown", () => {
    render(<AlertFeedFilters filters={DEFAULT_FILTERS} onChange={onChange} />);
    expect(screen.getByTestId("filter-priority")).toBeInTheDocument();
  });

  it("renders unread+high priority filter button", () => {
    render(<AlertFeedFilters filters={DEFAULT_FILTERS} onChange={onChange} />);
    expect(screen.getByTestId("filter-unread-high-priority")).toBeInTheDocument();
  });

  it("calls onChange with unreadHighPriority true when button clicked", async () => {
    render(<AlertFeedFilters filters={DEFAULT_FILTERS} onChange={onChange} />);
    await userEvent.click(screen.getByTestId("filter-unread-high-priority"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ unreadHighPriority: true }),
    );
  });

  it("calls onChange with unreadHighPriority false when toggled off", async () => {
    render(
      <AlertFeedFilters
        filters={{ ...DEFAULT_FILTERS, unreadHighPriority: true }}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("filter-unread-high-priority"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ unreadHighPriority: false }),
    );
  });

  it("shows clear button when priority filter is active", () => {
    render(
      <AlertFeedFilters
        filters={{ ...DEFAULT_FILTERS, priority: "High" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("filter-clear")).toBeInTheDocument();
  });

  it("shows clear button when unreadHighPriority is active", () => {
    render(
      <AlertFeedFilters
        filters={{ ...DEFAULT_FILTERS, unreadHighPriority: true }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("filter-clear")).toBeInTheDocument();
  });

  it("clears priority and unreadHighPriority on clear", async () => {
    render(
      <AlertFeedFilters
        filters={{ ...DEFAULT_FILTERS, priority: "Critical", unreadHighPriority: true }}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("filter-clear"));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_FILTERS);
  });
});

// ─── ActionBadge ──────────────────────────────────────────────────────────────

describe("ActionBadge", () => {
  it("renders Investigating for investigate action", () => {
    render(<ActionBadge action="investigate" />);
    expect(screen.getByTestId("action-badge")).toBeInTheDocument();
    expect(screen.getByText("Investigating")).toBeInTheDocument();
  });

  it("renders Monitoring for monitor action", () => {
    render(<ActionBadge action="monitor" />);
    expect(screen.getByText("Monitoring")).toBeInTheDocument();
  });

  it("renders Ignored for ignore action", () => {
    render(<ActionBadge action="ignore" />);
    expect(screen.getByText("Ignored")).toBeInTheDocument();
  });

  it("renders nothing for null action", () => {
    const { container } = render(<ActionBadge action={null} />);
    expect(container.firstChild).toBeNull();
  });
});

// ─── PriorityBadge ────────────────────────────────────────────────────────────

describe("PriorityBadge", () => {
  const makeAlertFull = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
    id: 1,
    alertRuleId: 10,
    watchlistId: 5,
    articleId: 42,
    issuerName: "Acme Corp",
    title: "Test",
    urgency: 9,
    confidence: 0.9,
    severity: "high",
    portfolioLinked: true,
    eventType: "downgrade",
    triggeredAt: new Date("2024-01-15T10:30:00Z").toISOString(),
    isRead: false,
    ...overrides,
  });

  it("renders a priority badge for any alert", () => {
    render(<PriorityBadge alert={makeAlertFull()} />);
    expect(screen.getByTestId("priority-badge")).toBeInTheDocument();
  });

  it("shows Critical for max-signal alert", () => {
    render(
      <PriorityBadge
        alert={makeAlertFull({ severity: "high", confidence: 1.0, portfolioLinked: true, urgency: 10 })}
      />,
    );
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  it("shows Low for minimal-signal alert", () => {
    render(
      <PriorityBadge
        alert={makeAlertFull({ severity: "low", confidence: 0.1, portfolioLinked: false, urgency: 1 })}
      />,
    );
    expect(screen.getByText("Low")).toBeInTheDocument();
  });
});


// ─── AlertFeedFilters — action filter ────────────────────────────────────────

describe("AlertFeedFilters — action filter", () => {
  const makeFilters = (overrides = {}) => ({
    severity: "" as const,
    isRead: "" as const,
    issuerName: "",
    eventType: "",
    portfolioLinked: null,
    dateFrom: "",
    dateTo: "",
    priority: "" as const,
    unreadHighPriority: false,
    action: "" as const,
    ...overrides,
  });

  it("renders action filter select", () => {
    const onChange = vi.fn();
    render(
      <AlertFeedFilters
        filters={makeFilters()}
        onChange={onChange}
      />
    );
    expect(screen.getByTestId("filter-action")).toBeInTheDocument();
  });

  it("shows 'All actions' by default", () => {
    const onChange = vi.fn();
    render(
      <AlertFeedFilters
        filters={makeFilters()}
        onChange={onChange}
      />
    );
    expect(screen.getByTestId("filter-action")).toHaveTextContent("All actions");
  });

  it("hasActiveFilters when action is set", () => {
    const onChange = vi.fn();
    render(
      <AlertFeedFilters
        filters={makeFilters({ action: "investigate" })}
        onChange={onChange}
      />
    );
    // Clear button should appear when there are active filters
    expect(screen.getByTestId("filter-clear")).toBeInTheDocument();
  });

  it("does not show clear button when action is empty", () => {
    const onChange = vi.fn();
    render(
      <AlertFeedFilters
        filters={makeFilters()}
        onChange={onChange}
      />
    );
    expect(screen.queryByTestId("filter-clear")).not.toBeInTheDocument();
  });

  it("calls onChange with action cleared when clear button is clicked", async () => {
    const onChange = vi.fn();
    render(
      <AlertFeedFilters
        filters={makeFilters({ action: "monitor" })}
        onChange={onChange}
      />
    );
    await userEvent.click(screen.getByTestId("filter-clear"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: "" })
    );
  });
});
