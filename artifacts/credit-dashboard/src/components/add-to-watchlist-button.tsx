import { useState } from "react";
import {
  useListWatchlists,
  useAddWatchlistItem,
  getGetWatchlistArticlesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bookmark, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AddToWatchlistButtonProps {
  issuerName: string;
}

export function AddToWatchlistButton({ issuerName }: AddToWatchlistButtonProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  const { data: watchlistData, isLoading: watchlistsLoading } = useListWatchlists({
    query: { enabled: open },
  });
  const addItem = useAddWatchlistItem();

  const handleAdd = async (watchlistId: number, watchlistName: string) => {
    try {
      await addItem.mutateAsync({ id: watchlistId, data: { issuerName } });
      setAddedIds((prev) => new Set(prev).add(watchlistId));
      queryClient.invalidateQueries({
        queryKey: getGetWatchlistArticlesQueryKey(watchlistId),
      });
      toast({
        title: "Added to watchlist",
        description: `${issuerName} added to "${watchlistName}".`,
      });
    } catch {
      toast({
        title: "Error",
        description: "Could not add to watchlist.",
        variant: "destructive",
      });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs font-mono text-muted-foreground hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <Bookmark className="h-3.5 w-3.5 mr-1" />
          WATCH
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-52 p-2 space-y-1"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-mono text-muted-foreground px-2 pb-1">ADD TO WATCHLIST</p>
        {watchlistsLoading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !watchlistData?.watchlists.length ? (
          <p className="text-xs text-muted-foreground px-2 py-1">
            No watchlists. Create one first.
          </p>
        ) : (
          watchlistData.watchlists.map((w) => (
            <Button
              key={w.id}
              variant="ghost"
              size="sm"
              className="w-full justify-between h-8 text-xs font-mono"
              disabled={addedIds.has(w.id) || addItem.isPending}
              onClick={() => handleAdd(w.id, w.name)}
            >
              <span className="truncate">{w.name}</span>
              {addedIds.has(w.id) && <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />}
            </Button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
