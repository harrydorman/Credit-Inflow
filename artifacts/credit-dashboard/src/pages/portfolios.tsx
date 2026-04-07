import { useListPortfolios, type Portfolio } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgId } from "@/lib/org-context";
import { PortfolioSummaryCard } from "@/components/portfolios";
import { Briefcase, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export default function Portfolios() {
  const orgId = useOrgId();
  const [, navigate] = useLocation();
  const { data, isLoading, isError, refetch } = useListPortfolios({
    organizationId: orgId,
  });

  const portfolios = data?.portfolios ?? [];

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Briefcase className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Portfolios</h1>
        </div>

        {/* Loading */}
        {isLoading && (
          <div
            className="space-y-3"
            data-testid="portfolios-loading"
          >
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-md" />
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div
            className="flex flex-col items-center justify-center py-16 gap-3 text-center"
            data-testid="portfolios-error"
          >
            <AlertCircle className="h-8 w-8 text-destructive opacity-60" />
            <p className="font-mono text-sm text-destructive">
              Failed to load portfolios.
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
        {!isLoading && !isError && portfolios.length === 0 && (
          <div
            className="flex flex-col items-center justify-center py-20 gap-3 text-center"
            data-testid="portfolios-empty"
          >
            <Briefcase className="h-12 w-12 opacity-10" />
            <p className="font-mono text-sm text-muted-foreground">
              No portfolios yet.
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Upload a portfolio CSV via the API to get started. Portfolios
              track issuer exposure and surface risk alerts tied to your
              holdings.
            </p>
          </div>
        )}

        {/* Portfolio list */}
        {!isLoading && !isError && portfolios.length > 0 && (
          <div
            className="space-y-3"
            data-testid="portfolios-list"
          >
            {portfolios.map((p: Portfolio) => (
              <PortfolioSummaryCard
                key={p.id}
                portfolio={p}
                onClick={() => navigate(`/portfolios/${p.id}`)}
                data-testid={`portfolio-card-${p.id}`}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
