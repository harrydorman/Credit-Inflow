/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertDetailPanel } from "./AlertDetailPanel";
import type { AlertEvent } from "@workspace/api-client-react";

// ─── mock wouter ─────────────────────────────────────────────────────────────

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    onClick,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: React.MouseEventHandler;
    [k: string]: unknown;
  }) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  ),
  useLocation: () => ["/alerts", vi.fn()],
  useParams: () => ({}),
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeAlert = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 42,
  alertRuleId: 5,
  watchlistId: 3,
  articleId: 100,
  issuerName: "Acme Corp",
  title: "Acme Corp credit downgrade warning",
  urgency: 8,
  eventType: "downgrade",
  confidence: 0.87,
  severity: "high",
  portfolioLinked: false,
  triggeredAt: new Date("2024-06-15T10:30:00Z").toISOString(),
  isRead: false,
  ...overrides,
});

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onMarkRead: vi.fn(),
  onMarkUnread: vi.fn(),
  markReadPending: false,
};

// ─── AlertDetailPanel ─────────────────────────────────────────────────────────

describe("AlertDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when alert is null", () => {
    const { container } = render(
      <AlertDetailPanel {...defaultProps} alert={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders alert title", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert()} />);
    expect(
      screen.getByText("Acme Corp credit downgrade warning"),
    ).toBeInTheDocument();
  });

  it("renders severity display", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert()} />);
    expect(screen.getByTestId("severity-display")).toBeInTheDocument();
    expect(screen.getByTestId("severity-display").textContent).toContain(
      "high",
    );
  });

  it("derives severity from urgency when severity field is absent", () => {
    const alert = makeAlert({ severity: null, urgency: 9 });
    render(<AlertDetailPanel {...defaultProps} alert={alert} />);
    expect(screen.getByTestId("severity-display").textContent).toContain(
      "high",
    );
  });

  it("renders UNREAD badge for unread alerts", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ isRead: false })} />);
    expect(screen.getByText("UNREAD")).toBeInTheDocument();
  });

  it("does not render UNREAD badge for read alerts", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ isRead: true })} />);
    expect(screen.queryByText("UNREAD")).not.toBeInTheDocument();
  });

  // ─── explainability section ────────────────────────────────────────────────

  it("renders explainability section", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert()} />);
    expect(screen.getByTestId("explainability-section")).toBeInTheDocument();
    expect(screen.getByText(/Why this triggered/i)).toBeInTheDocument();
  });

  it("explains trigger reason with event type and urgency", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ urgency: 8, eventType: "downgrade" })} />);
    const section = screen.getByTestId("explainability-section");
    expect(section.textContent).toContain("downgrade");
    expect(section.textContent).toContain("8/10");
  });

  it("explains trigger reason without event type gracefully", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ eventType: null })} />);
    const section = screen.getByTestId("explainability-section");
    expect(section.textContent).toContain("credit signal");
  });

  // ─── confidence breakdown ──────────────────────────────────────────────────

  it("renders confidence breakdown when confidence is present", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ confidence: 0.87 })} />);
    expect(screen.getByTestId("confidence-breakdown")).toBeInTheDocument();
    expect(screen.getByTestId("confidence-display")).toBeInTheDocument();
    expect(screen.getByTestId("confidence-display").textContent).toContain("87%");
  });

  it("does not render confidence breakdown when confidence is null", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ confidence: null })} />);
    expect(screen.queryByTestId("confidence-breakdown")).not.toBeInTheDocument();
    expect(screen.queryByTestId("confidence-display")).not.toBeInTheDocument();
  });

  it("shows High label for confidence >= 0.8", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ confidence: 0.92 })} />);
    expect(screen.getByTestId("confidence-display").textContent).toContain("High");
  });

  it("shows Medium label for confidence 0.5–0.79", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ confidence: 0.65 })} />);
    expect(screen.getByTestId("confidence-display").textContent).toContain("Medium");
  });

  it("shows Low label for confidence < 0.5", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ confidence: 0.3 })} />);
    expect(screen.getByTestId("confidence-display").textContent).toContain("Low");
  });

  // ─── portfolio impact ──────────────────────────────────────────────────────

  it("renders portfolio impact badge when portfolioLinked is true", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ portfolioLinked: true })} />);
    expect(screen.getByTestId("portfolio-impact-badge")).toBeInTheDocument();
  });

  it("renders portfolio impact section when portfolioLinked is true", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ portfolioLinked: true })} />);
    expect(screen.getByTestId("portfolio-impact-section")).toBeInTheDocument();
    expect(screen.getByText(/Portfolio exposure/i)).toBeInTheDocument();
  });

  it("does not render portfolio impact section when portfolioLinked is false", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ portfolioLinked: false })} />);
    expect(screen.queryByTestId("portfolio-impact-section")).not.toBeInTheDocument();
  });

  // ─── navigation links ──────────────────────────────────────────────────────

  it("renders issuer detail link", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert()} />);
    const links = screen.getAllByTestId("issuer-detail-link");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute(
      "href",
      "/issuer/Acme%20Corp",
    );
  });

  it("renders issuer link in panel header", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert()} />);
    expect(screen.getByTestId("issuer-link")).toBeInTheDocument();
    expect(screen.getByTestId("issuer-link")).toHaveAttribute(
      "href",
      "/issuer/Acme%20Corp",
    );
  });

  it("renders article link", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ articleId: 100 })} />);
    expect(screen.getByTestId("article-link")).toBeInTheDocument();
    expect(screen.getByTestId("article-link")).toHaveAttribute(
      "href",
      "/article/100",
    );
  });

  it("calls onClose when issuer link is clicked", async () => {
    const onClose = vi.fn();
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert()} onClose={onClose} />);
    await userEvent.click(screen.getByTestId("issuer-detail-link"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ─── mark read / unread ────────────────────────────────────────────────────

  it("shows mark-as-read button for unread alert", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ isRead: false })} />);
    expect(screen.getByTestId("detail-mark-read")).toBeInTheDocument();
  });

  it("does not show mark-as-read button for read alert", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert({ isRead: true })} />);
    expect(screen.queryByTestId("detail-mark-read")).not.toBeInTheDocument();
  });

  it("calls onMarkRead when mark-as-read button clicked", async () => {
    const onMarkRead = vi.fn();
    render(
      <AlertDetailPanel
        {...defaultProps}
        alert={makeAlert({ isRead: false })}
        onMarkRead={onMarkRead}
      />,
    );
    await userEvent.click(screen.getByTestId("detail-mark-read"));
    expect(onMarkRead).toHaveBeenCalledWith(42);
  });

  it("shows mark-unread button for read alert when onMarkUnread provided", () => {
    render(
      <AlertDetailPanel
        {...defaultProps}
        alert={makeAlert({ isRead: true })}
        onMarkUnread={vi.fn()}
      />,
    );
    expect(screen.getByTestId("detail-mark-unread")).toBeInTheDocument();
  });

  it("calls onMarkUnread when mark-unread button clicked", async () => {
    const onMarkUnread = vi.fn();
    render(
      <AlertDetailPanel
        {...defaultProps}
        alert={makeAlert({ isRead: true })}
        onMarkUnread={onMarkUnread}
      />,
    );
    await userEvent.click(screen.getByTestId("detail-mark-unread"));
    expect(onMarkUnread).toHaveBeenCalledWith(42);
  });

  it("does not show mark-unread button when onMarkUnread not provided", () => {
    render(
      <AlertDetailPanel
        {...defaultProps}
        alert={makeAlert({ isRead: true })}
        onMarkUnread={undefined}
      />,
    );
    expect(screen.queryByTestId("detail-mark-unread")).not.toBeInTheDocument();
  });

  it("disables mark-read button when markReadPending is true", () => {
    render(
      <AlertDetailPanel
        {...defaultProps}
        alert={makeAlert({ isRead: false })}
        markReadPending={true}
      />,
    );
    expect(screen.getByTestId("detail-mark-read")).toBeDisabled();
  });

  // ─── debug section ────────────────────────────────────────────────────────

  it("debug section is hidden by default", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert()} />);
    expect(screen.queryByTestId("debug-section")).not.toBeInTheDocument();
  });

  it("reveals debug section on toggle click", async () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert()} />);
    await userEvent.click(screen.getByTestId("debug-toggle"));
    expect(screen.getByTestId("debug-section")).toBeInTheDocument();
    expect(screen.getByText(/Alert ID/)).toBeInTheDocument();
  });

  it("collapses debug section on second toggle click", async () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert()} />);
    await userEvent.click(screen.getByTestId("debug-toggle"));
    expect(screen.getByTestId("debug-section")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("debug-toggle"));
    expect(screen.queryByTestId("debug-section")).not.toBeInTheDocument();
  });

  // ─── close ────────────────────────────────────────────────────────────────

  it("calls onClose when Close button clicked", async () => {
    const onClose = vi.fn();
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert()} onClose={onClose} />);
    await userEvent.click(screen.getByTestId("footer-close-btn"));
    expect(onClose).toHaveBeenCalled();
  });

  // ─── loading state (markReadPending) ──────────────────────────────────────

  it("renders panel with data-testid when alert present", () => {
    render(<AlertDetailPanel {...defaultProps} alert={makeAlert()} />);
    expect(screen.getByTestId("alert-detail-panel")).toBeInTheDocument();
  });
});
