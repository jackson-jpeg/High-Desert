"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Episode } from "@/db/schema";
import { toast } from "@/stores/toast-store";
import { BookmarkList } from "@/components/player/BookmarkMarkers";
import { MoreLikeThis } from "@/components/library/MoreLikeThis";
import { EpisodeDetailHeader } from "@/components/library/EpisodeDetailHeader";
import { EpisodeEditForm } from "@/components/library/EpisodeEditForm";
import { EpisodeOverview } from "@/components/library/EpisodeOverview";
import { EpisodeProgress } from "@/components/library/EpisodeProgress";
import { EpisodePlayControls, EpisodeManageBar } from "@/components/library/EpisodeActions";
import { EpisodeRating, useCommunityRating } from "@/components/library/EpisodeRating";
import { SeriesPartsList } from "@/components/library/SeriesPartsList";
import { useSwipeDown } from "@/hooks/useSwipeDown";
import { cn } from "@/lib/utils/cn";
import { removedFromCatalog } from "@/lib/library/removed-episodes";

interface EpisodeDetailProps {
  episode: Episode;
  isPlaying: boolean;
  onPlay: (episode: Episode) => void;
  onClose: () => void;
  onDelete?: (episode: Episode) => void;
  /**
   * "Remove from my library" for an episode pulled from the catalog. Offered to
   * every visitor, not only admins — it is their row — and it only *requests*
   * the removal: the page's confirmation and deleteEpisode() do the rest.
   */
  onRemoveUnavailable?: (episode: Episode) => void;
  onEdit?: (id: number, fields: Partial<Episode>) => void;
  onToggleFavorite?: (episode: Episode) => void;
  communityPlays?: number;
  className?: string;
}

/**
 * The library's episode detail panel. The shell — slide in/out, swipe to
 * dismiss, view/edit mode — lives here; each section is its own sibling
 * component (split under HD-018), and the pure pieces are in
 * src/lib/library/episode-detail.ts.
 */
export function EpisodeDetail({
  episode,
  isPlaying,
  onPlay,
  onClose,
  onDelete,
  onRemoveUnavailable,
  onEdit,
  onToggleFavorite,
  communityPlays,
  className,
}: EpisodeDetailProps) {
  const removed = removedFromCatalog(episode);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      closingRef.current = false;
      onClose();
    }, 200);
  }, [onClose]);

  const { swipeHandlers: dragHandlers } = useSwipeDown({
    onDismiss: handleClose,
    targetRef: panelRef,
    threshold: 80,
  });

  // Reset closing state when episode changes
  useEffect(() => {
    closingRef.current = false;
    setClosing(false); // eslint-disable-line react-hooks/set-state-in-effect -- reset derived state on prop change
  }, [episode.id]);

  const [editing, setEditing] = useState(false);

  // Fetched here rather than in <EpisodeRating> so it runs in edit mode too
  // and survives the view/edit switch without a refetch.
  const communityRating = useCommunityRating(episode);

  // Reset edit state when episode changes
  useEffect(() => {
    setEditing(false); // eslint-disable-line react-hooks/set-state-in-effect -- reset derived state on prop change
  }, [episode.id]);

  const handleSave = (fields: Partial<Episode>) => {
    if (!onEdit || !episode.id) return;
    onEdit(episode.id, fields);
    setEditing(false);
    toast.success("Episode updated");
  };

  return (
    <div
      ref={panelRef}
      className={cn(
        "w98-raised-dark bg-raised-surface flex flex-col glass-heavy",
        closing ? "animate-slide-down-out" : "animate-slide-up",
        className,
      )}
    >
      {/* Mobile drag handle — swipe down to dismiss */}
      <div className="flex justify-center pt-2 pb-0.5 md:hidden" {...dragHandlers}>
        <div className="w-8 h-[3px] rounded-full bg-white/15" />
      </div>

      <EpisodeDetailHeader episode={episode} onClose={handleClose} />

      {/* Body */}
      <div className="p-3 pb-[calc(0.75rem+var(--safe-bottom))] md:pb-3 flex flex-col gap-2.5 max-h-[80vh] md:max-h-none overflow-auto overscroll-contain md:overflow-visible">
        {editing ? (
          <EpisodeEditForm episode={episode} onSave={handleSave} onCancel={() => setEditing(false)} />
        ) : (
          <>
            {removed && (
              <div
                data-unavailable=""
                role="note"
                className="w98-inset-dark bg-inset-well p-2 flex flex-col gap-1.5"
              >
                <span className="text-hd-micro text-red-400 uppercase tracking-wide">Unavailable</span>
                <span className="text-hd-caption text-desktop-gray">
                  Removed from the catalog. {removed.reason} It stays in your library until you remove it.
                </span>
                {onRemoveUnavailable && (
                  <button
                    type="button"
                    onClick={() => onRemoveUnavailable(episode)}
                    className="self-start text-hd-caption text-desert-amber hover:underline min-h-touch md:min-h-0"
                  >
                    Remove from my library
                  </button>
                )}
              </div>
            )}

            <EpisodeOverview episode={episode} communityPlays={communityPlays} />

            {/* Bookmarks */}
            {episode.id && (
              <BookmarkList episodeId={episode.id} />
            )}

            <EpisodeProgress episode={episode} />

            <EpisodePlayControls
              episode={episode}
              isPlaying={isPlaying}
              onPlay={onPlay}
              onToggleFavorite={onToggleFavorite}
            />

            {episode.id && <EpisodeRating episode={episode} communityRating={communityRating} />}

            <EpisodeManageBar
              episode={episode}
              onEdit={onEdit ? () => setEditing(true) : undefined}
              onDelete={onDelete}
            />

            {/* Series parts list */}
            {episode.aiSeries && (
              <SeriesPartsList seriesName={episode.aiSeries} currentEpisodeId={episode.id} onPlay={onPlay} />
            )}

            {/* Recommendations */}
            <MoreLikeThis episode={episode} onPlay={onPlay} />
          </>
        )}
      </div>
    </div>
  );
}
