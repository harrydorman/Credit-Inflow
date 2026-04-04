import { useState } from "react";
import {
  useListWatchlists,
  useCreateWatchlist,
  useRemoveWatchlistItem,
  useGetWatchlistArticles,
  getListWatchlistsQueryKey,
  getGetWatchlistArticlesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { ArticleCard } from "@/components/article-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Bookmark, Plus, Trash2, BookOpen } from "lucide-react";

export default function Watchlists() {
  const queryClient = useQueryClient();
  const { data: watchlistData, isLoading: watchlistsLoading } = useListWatchlists();
  const createWatchlist = useCreateWatchlist();
  const removeItem = useRemoveWatchlistItem();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");

  const { data: articlesData, isLoading: articlesLoading } = useGetWatchlistArticles(
    selectedId ?? 0,
    { limit: 50 },
    { query: { enabled: selectedId !== null } }
  );

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const created = await createWatchlist.mutateAsync({ data: { name } });
    setNewName("");
    queryClient.invalidateQueries({ queryKey: getListWatchlistsQueryKey() });
    setSelectedId(created.id);
  };

  const handleRemoveItem = async (watchlistId: number, issuerName: string) => {
    await removeItem.mutateAsync({ id: watchlistId, issuerName });
    queryClient.invalidateQueries({ queryKey: getListWatchlistsQueryKey() });
    if (selectedId !== null) {
      queryClient.invalidateQueries({
        queryKey: getGetWatchlistArticlesQueryKey(selectedId),
      });
    }
  };

  const selectedWatchlist = watchlistData?.watchlists.find((w) => w.id === selectedId);

  return (
    <Layout>
      <div className="flex h-full overflow-hidden">
        {/* Left panel: watchlist list */}
        <aside className="w-64 border-r border-border flex flex-col shrink-0 overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-primary" />
            <span className="font-mono text-sm font-bold">WATCHLISTS</span>
          </div>

          <div className="p-3 border-b border-border space-y-2">
            <Input
              placeholder="New watchlist name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="h-8 text-sm font-mono"
            />
            <Button
              size="sm"
              className="w-full h-8 font-mono text-xs"
              onClick={handleCreate}
              disabled={!newName.trim() || createWatchlist.isPending}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              CREATE
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {watchlistsLoading ? (
              [...Array(3)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)
            ) : watchlistData?.watchlists.length === 0 ? (
              <p className="text-xs text-muted-foreground font-mono px-2 py-3">No watchlists yet.</p>
            ) : (
              watchlistData?.watchlists.map((w) => (
                <Button
                  key={w.id}
                  variant="ghost"
                  className={`w-full justify-start h-9 text-sm font-mono ${
                    selectedId === w.id
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  }`}
                  onClick={() => setSelectedId(w.id)}
                >
                  <Bookmark className="h-3.5 w-3.5 mr-2 shrink-0" />
                  <span className="truncate">{w.name}</span>
                </Button>
              ))
            )}
          </div>
        </aside>

        {/* Main panel: articles for selected watchlist */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {selectedId === null ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3">
              <BookOpen className="h-10 w-10 opacity-30" />
              <p className="font-mono text-sm">Select a watchlist to view articles</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                    <Bookmark className="h-6 w-6 text-primary" />
                    {selectedWatchlist?.name}
                  </h1>
                  {selectedWatchlist?.description && (
                    <p className="text-sm text-muted-foreground mt-1">{selectedWatchlist.description}</p>
                  )}
                </div>
                {articlesData && (
                  <Badge variant="outline" className="font-mono text-xs">
                    {articlesData.articles.length} article{articlesData.articles.length !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>

              {/* Issuers in this watchlist */}
              {articlesData && articlesData.articles.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs font-mono text-muted-foreground">ISSUERS:</span>
                  {Array.from(new Set(articlesData.articles.map((a) => a.issuerName).filter(Boolean))).map(
                    (name) => (
                      <Badge
                        key={name as string}
                        variant="outline"
                        className="font-mono text-xs flex items-center gap-1"
                      >
                        {name as string}
                        <button
                          className="ml-1 hover:text-destructive transition-colors"
                          title={`Remove ${name} from watchlist`}
                          onClick={() => handleRemoveItem(selectedId, name as string)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </Badge>
                    )
                  )}
                </div>
              )}

              {articlesLoading ? (
                <div className="space-y-4">
                  {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
                </div>
              ) : !articlesData || articlesData.articles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
                  <BookOpen className="h-8 w-8 opacity-30" />
                  <p className="font-mono text-sm">No articles yet.</p>
                  <p className="text-xs">Add issuers to this watchlist from the Issuers page.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {articlesData.articles.map((article) => (
                    <ArticleCard key={article.id} article={article} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
