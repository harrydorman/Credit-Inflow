import { useParams, useLocation } from "wouter";
import {
  useGetPortfolioDetails,
  useGetPortfolioExposureAlerts,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrgId } from "@/lib/org-context";
import {
  PortfolioSummaryCard,
  HoldingsTable,
  ExposureAlertList,
} from "@/components/portfolios";
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  ShieldAlert,
} from "lucide-react";

export default function PortfolioDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const orgId = useOrgId();

  const portfolioId = parseInt(params.id ?? "", 10);
  const isValidId = !isNaN(portfolioId);

  const {
    data: detail,
    isLoading: detailLoading,
    isError: detailError,
    refetch: refetchDetail,
  } = useGetPortfolioDetails(
    isValidId ? portfolioId : 0,
    { organizationId: orgId },
    { query: { enabled: isValidId } },
  );

  const {
    data: exposureData,
    isLoading: exposureLoading,
    isError: exposureError,
    refetch: refetchExposure,
  } = useGetPortfolioExposureAlerts(
    isValidId ? portfolioId : 0,
    { query: { enabled: isValidId } },
  );

  const exposureGroups = exposureData?.alerts ?? [];

  // ── invalid ID ─────────────────────────────────────────────────────────────
  if (!isValidId) {
    return (
      <Layout>
        <div className="p-6 flex flex-col items-center justify-center py-20 gap-3">
          <AlertCircle className="h-8 w-8 text-destructive opacity-60" />
          <p className="font-mono text-sm text-destructive">
            Invalid portfolio ID.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs h-7"
            onClick={() => navigate("/portfolios")}
          >
            Back to Portfolios
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {/* Back link + header */}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs font-mono -ml-2"
            onClick={() => navigate("/portfolios")}
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Portfolios
          </Button>
        </div>

        {/* Detail loading */}
        {detailLoading && (
          <div className="space-y-4" data-testid="portfolio-detail-loading">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-28 w-full rounded-md" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-20 rounded-md" />
              <Skeleton className="h-20 rounded-md" />
            </div>
          </div>
        )}

        {/* Detail error */}
        {detailError && (
          <div
            className="flex flex-col items-center justify-center py-16 gap-3 text-center"
            data-testid="portfolio-detail-error"
          >
            <AlertCircle className="h-8 w-8 text-destructive opacity-60" />
            <p className="font-mono text-sm text-destructive">
              Failed to load portfolio.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="font-mono text-xs h-7"
              onClick={() => refetchDetail()}
            >
              Retry
            </Button>
          </div>
        )}

        {/* Detail loaded */}
        {!detailLoading && !detailError && detail && (
          <>
            {/* Page title */}
            <div className="flex items-center gap-3">
              <Briefcase className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight">{detail.name}</h1>
              {detail.highSeverityAlertCount > 0 && (
                <Badge className="font-mono text-xs bg-red-600 text-white border-red-600">
                  <ShieldAlert className="h-3 w-3 mr-1" />
                  {detail.highSeverityAlertCount} HIGH RISK
                </Badge>
              )}
            </div>

            {/* Summary card with full detail metrics */}
            <PortfolioSummaryCard
              portfolio={detail}
              data-testid="portfolio-summary-card"
            />

            {/* Tabs: Holdings | Exposure Alerts */}
            <Tabs defaultValue="holdings" className="space-y-4">
              <TabsList className="h-8">
                <TabsTrigger
                  value="holdings"
                  className="text-xs font-mono h-7 px-3"
                  data-testid="tab-holdings"
                >
                  Holdings
                  <Badge variant="secondary" className="ml-1.5 text-[10px] h-4 px-1">
                    {detail.holdingsCount}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  value="exposure"
                  className="text-xs font-mono h-7 px-3"
                  data-testid="tab-exposure"
                >
                  Exposure Alerts
                  {exposureGroups.length > 0 && (
                    <Badge
                      variant="secondary"
                      className={`ml-1.5 text-[10px] h-4 px-1 ${
                        detail.highSeverityAlertCount > 0
                          ? "bg-red-600 text-white"
                          : ""
                      }`}
                    >
                      {exposureGroups.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* Holdings tab */}
              <TabsContent value="holdings" className="space-y-3">
                {detail.unmappedIssuerCount > 0 && (
                  <div
                    className="flex items-center gap-2 px-3 py-2 bg-amber-950/10 border border-amber-500/30 rounded-md text-xs font-mono text-amber-500"
                    data-testid="unresolved-warning"
                  >
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {detail.unmappedIssuerCount} issuer
                    {detail.unmappedIssuerCount !== 1 ? "s" : ""} with unresolved
                    mapping — alerts may be missed for these issuers
                  </div>
                )}
                <HoldingsTable
                  holdings={detail.holdings}
                  data-testid="holdings-table"
                />
              </TabsContent>

              {/* Exposure Alerts tab */}
              <TabsContent value="exposure" className="space-y-3">
                {exposureLoading && (
                  <div className="space-y-2" data-testid="exposure-loading">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full rounded-md" />
                    ))}
                  </div>
                )}
                {exposureError && (
                  <div
                    className="flex flex-col items-center justify-center py-12 gap-3 text-center"
                    data-testid="exposure-error"
                  >
                    <AlertCircle className="h-6 w-6 text-destructive opacity-60" />
                    <p className="font-mono text-xs text-destructive">
                      Failed to load exposure alerts.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-mono text-xs h-7"
                      onClick={() => refetchExposure()}
                    >
                      Retry
                    </Button>
                  </div>
                )}
                {!exposureLoading && !exposureError && (
                  <ExposureAlertList
                    groups={exposureGroups}
                    data-testid="exposure-alert-list"
                  />
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </Layout>
  );
}
