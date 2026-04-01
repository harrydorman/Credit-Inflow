import { Link, useLocation } from "wouter";
import { Activity, BarChart3, FileText, Home, RefreshCw, Zap, Building, Layers, Newspaper } from "lucide-react";
import { useTriggerRefresh } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Progress } from "./ui/progress";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshMutation = useTriggerRefresh();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await refreshMutation.mutateAsync({});
      toast({
        title: "Data Ingestion Complete",
        description: `Fetched ${res.fetched}, Processed ${res.processed} articles.`,
      });
      // Force a reload or invalidate queries (handled by caller or global)
      window.location.reload(); // Simple approach for this demo to ensure all data updates
    } catch (error) {
      toast({
        title: "Refresh Failed",
        description: "An error occurred while fetching new data.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const navItems = [
    { href: "/", label: "Market Overview", icon: Home },
    { href: "/feed", label: "Live Feed", icon: Newspaper },
    { href: "/sectors", label: "Sectors", icon: Layers },
    { href: "/issuers", label: "Issuers", icon: Building },
    { href: "/signals", label: "Trend Signals", icon: Activity },
    { href: "/brief", label: "Daily Brief", icon: FileText },
  ];

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <span className="font-bold text-lg tracking-tight">CREDIT INTEL</span>
        </div>
        
        <div className="p-4">
          <Button 
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold" 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {isRefreshing ? "INGESTING..." : "REFRESH DATA"}
          </Button>
          {isRefreshing && (
            <Progress value={undefined} className="h-1 mt-2" />
          )}
        </div>

        <nav className="flex-1 px-2 space-y-1 mt-4">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className="block">
                <Button
                  variant="ghost"
                  className={`w-full justify-start ${
                    isActive 
                      ? "bg-secondary text-secondary-foreground" 
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  }`}
                >
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border text-xs text-muted-foreground font-mono">
          SYSTEM: ONLINE<br/>
          LAST SYNC: {new Date().toLocaleTimeString()}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
