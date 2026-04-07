import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setOrgIdGetter } from "@workspace/api-client-react";
import { getOrgId } from "@/lib/org-context";
import NotFound from "@/pages/not-found";

import MarketOverview from "@/pages/market-overview";
import Dashboard from "@/pages/dashboard";
import ArticleDetail from "@/pages/article";
import Signals from "@/pages/signals";
import Brief from "@/pages/brief";
import Issuers from "@/pages/issuers";
import IssuerDetail from "@/pages/issuer-detail";
import Sectors from "@/pages/sectors";
import Watchlists from "@/pages/watchlists";
import Alerts from "@/pages/alerts";
import Portfolios from "@/pages/portfolios";
import PortfolioDetail from "@/pages/portfolio-detail";
import Analytics from "@/pages/analytics";

// Wire up organization ID for all API calls (dev/demo mode).
// Replace getOrgId() with your auth provider in production.
setOrgIdGetter(getOrgId);

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={MarketOverview} />
      <Route path="/feed" component={Dashboard} />
      <Route path="/sectors" component={Sectors} />
      <Route path="/article/:id" component={ArticleDetail} />
      <Route path="/signals" component={Signals} />
      <Route path="/brief" component={Brief} />
      <Route path="/issuers" component={Issuers} />
      <Route path="/issuer/:name" component={IssuerDetail} />
      <Route path="/watchlists" component={Watchlists} />
      <Route path="/alerts" component={Alerts} />
      <Route path="/portfolios" component={Portfolios} />
      <Route path="/portfolios/:id" component={PortfolioDetail} />
      <Route path="/analytics" component={Analytics} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
