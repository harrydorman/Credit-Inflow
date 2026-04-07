import { useGetAlertAnalytics, type AlertAnalytics } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, BarChart3, ThumbsUp, Volume2, Binoculars, Star } from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(n: number) {
  return (n * 100).toFixed(1) + "%";
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="text-2xl font-bold">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold tracking-tight border-b pb-1 mb-3">{children}</h2>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActionCounts({ data }: { data: AlertAnalytics }) {
  const total = data.workflowActionCounts.reduce((s, r) => s + r.count, 0);
  const labelFor = (a: string) =>
    a === "investigate" ? "Investigate" : a === "monitor" ? "Monitor" : "Ignore";
  const variantFor = (a: string): "default" | "secondary" | "outline" =>
    a === "investigate" ? "default" : a === "monitor" ? "secondary" : "outline";

  return (
    <section>
      <SectionTitle>Workflow Actions</SectionTitle>
      <div className="flex flex-wrap gap-3">
        <StatCard label="Total with action" value={total} />
        {data.workflowActionCounts.map((r) => (
          <StatCard
            key={r.action}
            label={labelFor(r.action)}
            value={r.count}
            sub={total > 0 ? pct(r.count / total) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function FeedbackCounts({ data }: { data: AlertAnalytics }) {
  const total = data.feedbackRatingCounts.reduce((s, r) => s + r.count, 0);
  const labelFor = (r: string) =>
    r === "useful" ? "Useful" : r === "noise" ? "Noise" : "Investigate Later";

  return (
    <section>
      <SectionTitle>Feedback Ratings</SectionTitle>
      <div className="flex flex-wrap gap-3">
        <StatCard label="Total with feedback" value={total} />
        {data.feedbackRatingCounts.map((r) => (
          <StatCard
            key={r.rating}
            label={labelFor(r.rating)}
            value={r.count}
            sub={total > 0 ? pct(r.count / total) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function PortfolioComparison({ data }: { data: AlertAnalytics }) {
  const { portfolioLinked, nonPortfolioLinked } = data.portfolioLinkedWorkflowCounts;
  return (
    <section>
      <SectionTitle>Portfolio-Linked vs. Non-Portfolio Alerts</SectionTitle>
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr className="border-b text-muted-foreground text-left">
              <th className="py-1 pr-4">Scope</th>
              <th className="py-1 pr-4">Total</th>
              <th className="py-1 pr-4">Investigate</th>
              <th className="py-1 pr-4">Monitor</th>
              <th className="py-1 pr-4">Ignore</th>
              <th className="py-1">Investigate %</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: "Portfolio-linked", d: portfolioLinked },
              { label: "Non-portfolio", d: nonPortfolioLinked },
            ].map(({ label, d }) => (
              <tr key={label} className="border-b last:border-0">
                <td className="py-2 pr-4 font-medium">{label}</td>
                <td className="py-2 pr-4">{d.total}</td>
                <td className="py-2 pr-4">{d.investigate}</td>
                <td className="py-2 pr-4">{d.monitor}</td>
                <td className="py-2 pr-4">{d.ignore}</td>
                <td className="py-2">{d.total > 0 ? pct(d.investigate / d.total) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TopTable<T>({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: T[];
  columns: { label: string; render: (r: T) => React.ReactNode }[];
}) {
  if (rows.length === 0) {
    return (
      <section>
        <SectionTitle>{title}</SectionTitle>
        <p className="text-sm text-muted-foreground">No data yet.</p>
      </section>
    );
  }

  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr className="border-b text-muted-foreground text-left">
              {columns.map((c) => (
                <th key={c.label} className="py-1 pr-4 last:pr-0">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                {columns.map((c) => (
                  <td key={c.label} className="py-2 pr-4 last:pr-0">
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AnalyticsDashboard() {
  const { data, isLoading, isError, refetch } = useGetAlertAnalytics();

  return (
    <Layout>
      <div className="p-6 space-y-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Alert Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Workflow actions, feedback signals, and ranking intelligence — org-scoped.
            </p>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="flex items-center gap-3 text-destructive border border-destructive/30 rounded-lg p-4">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">Failed to load analytics</p>
              <button
                onClick={() => refetch()}
                className="text-sm underline mt-1"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Data */}
        {data && (
          <>
            {/* Workflow action summary */}
            <ActionCounts data={data} />

            {/* Feedback rating summary */}
            <FeedbackCounts data={data} />

            {/* Portfolio comparison */}
            <PortfolioComparison data={data} />

            {/* Top noisy event types */}
            <TopTable
              title="Top Noisy Event Types (most 'noise' feedback)"
              rows={[...data.feedbackByEventType]
                .sort((a, b) => b.noise - a.noise)
                .slice(0, 10)}
              columns={[
                { label: "Event Type", render: (r) => r.eventType },
                { label: "Noise", render: (r) => r.noise },
                { label: "Useful", render: (r) => r.useful },
                {
                  label: "Noise %",
                  render: (r) =>
                    r.total > 0 ? pct(r.noise / r.total) : "—",
                },
              ]}
            />

            {/* Top useful event types */}
            <TopTable
              title="Top Useful Event Types (most 'useful' feedback)"
              rows={[...data.feedbackByEventType]
                .sort((a, b) => b.useful - a.useful)
                .slice(0, 10)}
              columns={[
                { label: "Event Type", render: (r) => r.eventType },
                { label: "Useful", render: (r) => r.useful },
                { label: "Noise", render: (r) => r.noise },
                {
                  label: "Useful %",
                  render: (r) =>
                    r.total > 0 ? pct(r.useful / r.total) : "—",
                },
              ]}
            />

            {/* Most investigated issuers */}
            <TopTable
              title="Most Investigated Issuers"
              rows={data.investigateIgnoreRatioByIssuer.slice(0, 10)}
              columns={[
                { label: "Issuer", render: (r) => r.issuerName },
                { label: "Investigate", render: (r) => r.investigateCount },
                { label: "Monitor", render: (r) => r.monitorCount },
                { label: "Ignore", render: (r) => r.ignoreCount },
                {
                  label: "Investigate %",
                  render: (r) => pct(r.investigateRatio),
                },
              ]}
            />

            {/* Rules with highest noise ratio */}
            <TopTable
              title="Rules with Highest Noise Ratio"
              rows={data.usefulNoiseRatioByRule.slice(0, 10)}
              columns={[
                { label: "Rule", render: (r) => r.ruleName },
                { label: "Noise", render: (r) => r.noiseCount },
                { label: "Useful", render: (r) => r.usefulCount },
                { label: "Total Feedback", render: (r) => r.total },
                { label: "Noise %", render: (r) => pct(r.noiseRatio) },
              ]}
            />

            {/* Ranking prep section */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Star className="h-4 w-4 text-amber-500" />
                <SectionTitle>Ranking Prep (not yet wired into scoring)</SectionTitle>
              </div>

              <div className="space-y-6">
                <TopTable
                  title="Event Type Usefulness Scores"
                  rows={data.rankingPrep.eventTypeUsefulnessScores.slice(0, 10)}
                  columns={[
                    { label: "Event Type", render: (r) => r.eventType },
                    { label: "Useful", render: (r) => r.usefulCount },
                    { label: "Noise", render: (r) => r.noiseCount },
                    { label: "Usefulness Score", render: (r) => pct(r.usefulnessScore) },
                  ]}
                />

                <TopTable
                  title="Issuer Investigate Scores"
                  rows={data.rankingPrep.issuerInvestigateScores.slice(0, 10)}
                  columns={[
                    { label: "Issuer", render: (r) => r.issuerName },
                    { label: "Investigate Count", render: (r) => r.investigateCount },
                    { label: "Total Workflow", render: (r) => r.totalWorkflow },
                    { label: "Investigate Score", render: (r) => pct(r.investigateScore) },
                  ]}
                />

                <TopTable
                  title="Rule Noise Scores"
                  rows={data.rankingPrep.ruleNoiseScores.slice(0, 10)}
                  columns={[
                    { label: "Rule", render: (r) => r.ruleName },
                    { label: "Noise Count", render: (r) => r.noiseCount },
                    { label: "Total Feedback", render: (r) => r.totalFeedback },
                    { label: "Noise Score", render: (r) => pct(r.noiseScore) },
                  ]}
                />
              </div>
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
