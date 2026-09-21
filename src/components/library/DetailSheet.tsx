"use client";

import { useRef, useCallback } from "react";
import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { updateEpisode } from "@/services/episodes/management";
import { EpisodeDetail } from "@/components/library/EpisodeDetail";
import { cn } from "@/lib/utils/cn";

/**
 * The episode detail panel: a slide-up sheet with swipe-down-to-close on
 * mobile, a 280px sidebar on desktop. Renders only while an episode is
 * selected.
 *
 * It renders `selectedEpisodeLive` — the row re-read from the live query — not
 * the click-time `selectedEpisode` snapshot, or writes made from inside the
 * panel (a rating, a favourite) are invisible until it is closed and reopened.
 * The snapshot still keys the panel and decides "is playing".
 */
export function DetailSheet({
  selectedEpisode,
  selectedEpisodeLive,
  currentEpisodeId,
  isAdmin,
  communityPlays,
  onPlay,
  onClose,
  onToggleFavorite,
  setSelectedEpisode,
  onRequestDelete,
}: {
  selectedEpisode: Episode;
  selectedEpisodeLive: Episode | null;
  currentEpisodeId: number | undefined;
  isAdmin: boolean;
  communityPlays: number | undefined;
  onPlay: (episode: Episode) => void;
  onClose: () => void;
  onToggleFavorite: (episode: Episode) => void;
  setSelectedEpisode: (ep: Episode | null) => void;
  /** Opens the library's delete confirmation (HD-011) — never deletes itself. */
  onRequestDelete: (ids: number[]) => void;
}) {
  // Detail panel swipe-down-to-close
  const detailSwipe = useRef({ startY: 0, currentY: 0, swiping: false });
  const detailRef = useRef<HTMLDivElement>(null);

  const onDetailTouchStart = useCallback((e: React.TouchEvent) => {
    // Only activate from the top 48px (drag handle area)
    const rect = detailRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touchY = e.touches[0].clientY;
    if (touchY - rect.top > 48) return;
    detailSwipe.current = { startY: touchY, currentY: touchY, swiping: true };
  }, []);

  const onDetailTouchMove = useCallback((e: React.TouchEvent) => {
    const s = detailSwipe.current;
    if (!s.swiping) return;
    s.currentY = e.touches[0].clientY;
    const dy = s.currentY - s.startY;
    if (dy > 0 && detailRef.current) {
      detailRef.current.style.transform = `translateY(${dy}px)`;
      detailRef.current.style.transition = "none";
    }
  }, []);

  const onDetailTouchEnd = useCallback(() => {
    const s = detailSwipe.current;
    if (!s.swiping) return;
    s.swiping = false;
    const dy = s.currentY - s.startY;
    if (detailRef.current) {
      detailRef.current.style.transform = "";
      detailRef.current.style.transition = "transform 0.2s ease-out";
    }
    if (dy > 80) {
      onClose();
    }
  }, [onClose]);

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 md:hidden animate-glass-backdrop"
        onClick={onClose}
      />
      <div
        ref={detailRef}
        onTouchStart={onDetailTouchStart}
        onTouchMove={onDetailTouchMove}
        onTouchEnd={onDetailTouchEnd}
        className={cn(
        // Mobile: slide-up overlay from bottom
        "fixed bottom-0 inset-x-0 z-50 max-h-[80dvh] overflow-auto pb-[var(--safe-bottom)] animate-glass-sheet rounded-t-xl will-change-transform",
        // Desktop: static sidebar — no fixed/sticky, no transform animation
        "md:relative md:bottom-auto md:inset-x-auto md:w-[280px] md:flex-shrink-0 md:h-full md:max-h-none md:overflow-auto md:pb-0 md:z-auto md:border-l md:border-bevel-dark/20 md:animate-fade-in md:rounded-none md:will-change-auto",
      )}>
        <EpisodeDetail
          key={selectedEpisode.id}
          /* The live row, not the click-time snapshot — see
             selectedEpisodeLive in useLibrarySelection. */
          episode={selectedEpisodeLive ?? selectedEpisode}
          isPlaying={selectedEpisode.id === currentEpisodeId}
          onPlay={onPlay}
          onClose={onClose}
          onToggleFavorite={onToggleFavorite}
          communityPlays={communityPlays}
          {...(isAdmin
            ? {
                onDelete: (ep: Episode) => onRequestDelete([ep.id!]),
                onEdit: async (id: number, fields: Partial<Episode>) => {
                  await updateEpisode(id, fields);
                  const updated = await db.episodes.get(id);
                  if (updated) setSelectedEpisode(updated);
                },
              }
            : {})}
        />
      </div>
    </>
  );
}
