/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortfolioSummaryCard, type PortfolioSummaryData } from "./PortfolioSummaryCard";
import { HoldingsTable } from "./HoldingsTable";
import { ExposureAlertGroup, ExposureAlertList } from "./ExposureAlertGroup";
import type {
  PortfolioHolding,
  PortfolioExposureAlert,
} from "@workspace/api-client-react";

// ─── mock wouter (used by ExposureAlertGroup's Link) ────────────────────────
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useLocation: () => ["/portfolios", vi.fn()],
  useParams: () => ({}),
}));

// ─── test data helpers ───────────────────────────────────────────────────────

const makePortfolio = (
  overrides: Partial<PortfolioSummaryData> = {},
): PortfolioSummaryData => ({
  id: 1,
  name: "CLO Portfolio Alpha",
  description: "Investment-grade CLO holdings",
  holdingsCount: 42,
  mappedIssuerCount: 38,
  unmappedIssuerCount: 4,
  alertCount: 7,
  highSeverityAlertCount: 2,
  createdAt: "2024-01-10T00:00:00Z",
  updatedAt: "2024-06-15T00:00:00Z",
  ...overrides,
});

const makeHolding = (
  overrides: Partial<PortfolioHolding> = {},
): PortfolioHolding => ({
  id: 1,
  portfolioId: 1,
  issuerName: "ACME Corp Ltd",
  positionSize: 1000000,
  canonicalIssuerName: "Acme Corporation",
  mappingConfidence: 0.92,
  createdAt: "2024-01-10T00:00:00Z",
  ...overrides,
});

const makeExposureGroup = (
  overrides: Partial<PortfolioExposureAlert> = {},
): PortfolioExposureAlert => ({
  issuerName: "Acme Corporation",
  totalAlerts: 3,
  highSeverityCount: 1,
  mediumSeverityCount: 1,
  lowSeverityCount: 1,
  latestTriggeredAt: "2024-06-15T10:30:00Z",
  events: [
    {
      id: 101,
      alertRuleId: 5,
      articleId: 200,
      eventType: "downgrade",
      confidence: 0.88,
      severity: "high",
      triggeredAt: "2024-06-15T10:30:00Z",
      isRead: false,
    },
    {
      id: 102,
      alertRuleId: 5,
      articleId: 201,
      eventType: "earnings_miss",
      confidence: 0.72,
      severity: "medium",
      triggeredAt: "2024-06-14T08:00:00Z",
      isRead: true,
    },
  ],
  ...overrides,
});

// ─── PortfolioSummaryCard tests ───────────────────────────────────────────────

describe("PortfolioSummaryCard", () => {
  it("renders portfolio name and description", () => {
    render(<PortfolioSummaryCard portfolio={makePortfolio()} />);
    expect(screen.getByText("CLO Portfolio Alpha")).toBeInTheDocument();
    expect(screen.getByText("Investment-grade CLO holdings")).toBeInTheDocument();
  });

  it("renders metric row when detail fields present", () => {
    render(<PortfolioSummaryCard portfolio={makePortfolio()} />);
    expect(screen.getByText("42")).toBeInTheDocument(); // holdingsCount
    expect(screen.getByText("38")).toBeInTheDocument(); // mappedIssuerCount
    expect(screen.getByText("4")).toBeInTheDocument();  // unmappedIssuerCount
  });

  it("does NOT render metric row when detail fields absent", () => {
    const basic: PortfolioSummaryData = {
      name: "Basic Portfolio",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    render(<PortfolioSummaryCard portfolio={basic} />);
    // No metric values like "Holdings", "Mapped", "Unresolved"
    expect(screen.queryByText("Holdings")).not.toBeInTheDocument();
  });

  it("shows HIGH severity badge when highSeverityAlertCount > 0", () => {
    render(<PortfolioSummaryCard portfolio={makePortfolio({ highSeverityAlertCount: 3 })} />);
    expect(screen.getByTestId("high-severity-badge")).toBeInTheDocument();
    expect(screen.getByText(/3 HIGH/)).toBeInTheDocument();
  });

  it("does not show HIGH badge when highSeverityAlertCount is 0", () => {
    render(
      <PortfolioSummaryCard
        portfolio={makePortfolio({ highSeverityAlertCount: 0, alertCount: 0 })}
      />,
    );
    expect(screen.queryByTestId("high-severity-badge")).not.toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<PortfolioSummaryCard portfolio={makePortfolio()} onClick={onClick} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders unresolved count with warning highlight when > 0", () => {
    render(<PortfolioSummaryCard portfolio={makePortfolio({ unmappedIssuerCount: 4 })} />);
    // The unresolved count should be shown
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});

// ─── HoldingsTable tests ──────────────────────────────────────────────────────

describe("HoldingsTable", () => {
  it("renders holding rows", () => {
    const holdings = [
      makeHolding({ id: 1, issuerName: "ACME Corp Ltd", canonicalIssuerName: "Acme Corporation" }),
      makeHolding({ id: 2, issuerName: "Beta Holdings", canonicalIssuerName: "Beta Holdings Inc" }),
    ];
    render(<HoldingsTable holdings={holdings} />);
    expect(screen.getByTestId("holding-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("holding-row-2")).toBeInTheDocument();
    expect(screen.getByText("ACME Corp Ltd")).toBeInTheDocument();
    expect(screen.getByText("Beta Holdings")).toBeInTheDocument();
  });

  it("shows empty state when no holdings", () => {
    render(<HoldingsTable holdings={[]} />);
    expect(screen.getByTestId("holdings-table-empty")).toBeInTheDocument();
    expect(screen.getByText("No holdings found.")).toBeInTheDocument();
  });

  it("shows loading skeleton", () => {
    render(<HoldingsTable holdings={[]} isLoading />);
    expect(screen.getByTestId("holdings-table-loading")).toBeInTheDocument();
  });

  it("shows canonical mapping for mapped holdings", () => {
    render(<HoldingsTable holdings={[makeHolding()]} />);
    expect(screen.getByText("Acme Corporation")).toBeInTheDocument();
  });

  it("shows unresolved indicator for unmapped holdings", () => {
    const unmapped = makeHolding({
      id: 3,
      canonicalIssuerName: null,
      mappingConfidence: null,
    });
    render(<HoldingsTable holdings={[unmapped]} />);
    expect(screen.getByTestId("unresolved-mapping-3")).toBeInTheDocument();
    expect(screen.getByText("Unresolved")).toBeInTheDocument();
  });

  it("shows high confidence label for high confidence mappings", () => {
    render(<HoldingsTable holdings={[makeHolding({ mappingConfidence: 0.92 })]} />);
    expect(screen.getByText(/High/)).toBeInTheDocument();
  });

  it("shows low confidence label for low confidence mappings", () => {
    render(<HoldingsTable holdings={[makeHolding({ mappingConfidence: 0.4 })]} />);
    expect(screen.getByText(/Low/)).toBeInTheDocument();
  });
});

// ─── ExposureAlertGroup tests ────────────────────────────────────────────────

describe("ExposureAlertGroup", () => {
  it("renders issuer name in group header", () => {
    render(<ExposureAlertGroup group={makeExposureGroup()} />);
    expect(screen.getByText("Acme Corporation")).toBeInTheDocument();
  });

  it("renders issuer link to issuer detail page", () => {
    render(<ExposureAlertGroup group={makeExposureGroup()} />);
    const link = screen.getByTestId("exposure-issuer-link-Acme Corporation");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/issuer/Acme%20Corporation");
  });

  it("renders high severity count badge when > 0", () => {
    render(<ExposureAlertGroup group={makeExposureGroup()} />);
    expect(screen.getByTestId("high-count-Acme Corporation")).toBeInTheDocument();
  });

  it("shows total alert count", () => {
    render(<ExposureAlertGroup group={makeExposureGroup()} />);
    expect(screen.getByText(/3 alert/)).toBeInTheDocument();
  });

  it("expands to show events when defaultExpanded=true", () => {
    render(<ExposureAlertGroup group={makeExposureGroup()} defaultExpanded />);
    expect(screen.getByTestId("exposure-event-101")).toBeInTheDocument();
    expect(screen.getByTestId("exposure-event-102")).toBeInTheDocument();
  });

  it("is collapsed by default when defaultExpanded=false", () => {
    render(<ExposureAlertGroup group={makeExposureGroup()} defaultExpanded={false} />);
    expect(screen.queryByTestId("exposure-event-101")).not.toBeInTheDocument();
  });

  it("expands on header click", async () => {
    render(<ExposureAlertGroup group={makeExposureGroup()} defaultExpanded={false} />);
    expect(screen.queryByTestId("exposure-event-101")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByTestId("exposure-group-header-Acme Corporation"),
    );

    expect(screen.getByTestId("exposure-event-101")).toBeInTheDocument();
  });

  it("renders event type badges within expanded group", async () => {
    render(<ExposureAlertGroup group={makeExposureGroup()} defaultExpanded />);
    expect(screen.getByText("downgrade")).toBeInTheDocument();
    expect(screen.getByText("earnings_miss")).toBeInTheDocument();
  });
});

// ─── ExposureAlertList tests ─────────────────────────────────────────────────

describe("ExposureAlertList", () => {
  it("renders all issuer groups", () => {
    const groups = [
      makeExposureGroup({ issuerName: "Acme Corp" }),
      makeExposureGroup({ issuerName: "Beta Holdings" }),
    ];
    render(<ExposureAlertList groups={groups} />);
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Beta Holdings")).toBeInTheDocument();
  });

  it("renders empty state when no groups", () => {
    render(<ExposureAlertList groups={[]} />);
    expect(screen.getByTestId("exposure-list-empty")).toBeInTheDocument();
    expect(screen.getByText("No portfolio exposure alerts found.")).toBeInTheDocument();
  });

  it("sorts groups with high-severity first", () => {
    const groups = [
      makeExposureGroup({ issuerName: "Low Risk Co", highSeverityCount: 0, totalAlerts: 1 }),
      makeExposureGroup({ issuerName: "High Risk Co", highSeverityCount: 3, totalAlerts: 5 }),
    ];
    render(<ExposureAlertList groups={groups} />);
    const items = screen.getAllByRole("button");
    // High Risk Co should appear first
    expect(items[0].textContent).toContain("High Risk Co");
  });
});
