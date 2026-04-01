import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import ArticleDetail from "@/pages/article";
import Signals from "@/pages/signals";
import Brief from "@/pages/brief";
import Issuers from "@/pages/issuers";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/article/:id" component={ArticleDetail} />
      <Route path="/signals" component={Signals} />
      <Route path="/brief" component={Brief} />
      <Route path="/issuers" component={Issuers} />
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
