"use client";

import { useState, useCallback } from "react";
import type { Episode, Playlist } from "@/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { useContextMenuStore } from "@/stores/context-menu-store";
import { useAdminStore } from "@/stores/admin-store";
import { toast } from "@/stores/toast-store";
import { deleteEpisode, toggleFavorite, toggleFlag, addToPlaylist } from "@/services/episodes/management";
import { shuffle } from "@/lib/utils/shuffle";

/**
 * What can be done to an episode from the library: play, queue, favourite,
 * shuffle, the row context menu, and the confirmed bulk delete.
 */
export function useLibraryActions({
  allEpisodes,
  allPlaylists,
  currentEpisodeId,
  selectedEpisode,
  setSelectedEpisode,
  selectedIds,
  setSelectedIds,
}: {
  allEpisodes: Episode[] | undefined;
  allPlaylists: Playlist[] | undefined;
  currentEpisodeId: number | undefined;
  selectedEpisode: Episode | null;
  setSelectedEpisode: (ep: Episode | null) => void;
  selectedIds: Set<number>;
  setSelectedIds: (ids: Set<number>) => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handlePlay = useCallback((episode: Episode) => {
    window.dispatchEvent(
      new CustomEvent("hd:play-episode", { detail: episode }),
    );
  }, []);

  const handleQueue = useCallback((episode: Episode) => {
    usePlayerStore.getState().enqueue(episode);
    toast.info("Added to queue");
  }, []);

  const handleToggleFavorite = useCallback(async (episode: Episode) => {
    const isFav = await toggleFavorite(episode.id!);
    toast.info(isFav ? "Added to favorites" : "Removed from favorites");
  }, []);

  const handleShuffle = useCallback((showType?: string) => {
    if (!allEpisodes || allEpisodes.length === 0) return;
    let pool = allEpisodes;
    if (showType && showType !== "all") {
      pool = allEpisodes.filter((ep) => ep.showType === showType);
    }
    if (pool.length === 0) {
      toast.info("No episodes to shuffle");
      return;
    }
    const shuffled = shuffle(pool);
    const batch = shuffled.slice(0, 20);
    const store = usePlayerStore.getState();
    store.enqueueMany(batch);
    if (batch[0]) {
      window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: batch[0] }));
    }
    const label = showType && showType !== "all"
      ? showType === "coast" ? "Coast to Coast" : showType === "dreamland" ? "Dreamland" : "Specials"
      : "All Shows";
    toast.info(`Shuffling ${batch.length} episodes from ${label}`);
  }, [allEpisodes]);

  const handleContextMenu = useCallback((episode: Episode, x: number, y: number) => {
    const isPlaying = episode.id === currentEpisodeId;
    const store = usePlayerStore.getState();
    const admin = useAdminStore.getState().isAdmin;

    const items = [
      {
        label: "Play",
        onClick: () => handlePlay(episode),
        disabled: isPlaying,
      },
      {
        label: "Play Next",
        onClick: () => {
          store.enqueueNext(episode);
          toast.info(`"${episode.title || episode.fileName}" plays next`);
        },
        disabled: isPlaying,
      },
      {
        label: "Add to Queue",
        onClick: () => {
          store.enqueue(episode);
          toast.info(`Added to queue`);
        },
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: episode.favoritedAt ? "Unfavorite" : "Favorite",
        onClick: () => handleToggleFavorite(episode),
      },
      {
        label: episode.flaggedAt ? "Remove Flag" : "Report Broken",
        onClick: async () => {
          const flagged = await toggleFlag(episode.id!);
          toast[flagged ? "info" : "success"](flagged ? "Episode flagged as broken" : "Flag removed");
        },
      },
      ...((allPlaylists && allPlaylists.length > 0)
        ? [
            { label: "", onClick: () => {}, separator: true },
            ...allPlaylists.map((pl) => ({
              label: `+ ${pl.name}`,
              onClick: async () => {
                await addToPlaylist(pl.id!, [episode.id!]);
                toast.info(`Added to "${pl.name}"`);
              },
            })),
          ]
        : []),
      ...(admin
        ? [
            { label: "", onClick: () => {}, separator: true },
            {
              label: "Delete",
              onClick: async () => {
                if (selectedIds.size > 1 && selectedIds.has(episode.id!)) {
                  setDeleteOpen(true);
                } else {
                  await deleteEpisode(episode.id!);
                  if (selectedEpisode?.id === episode.id) setSelectedEpisode(null);
                }
              },
              danger: true,
            },
          ]
        : []),
    ];

    useContextMenuStore.getState().show(x, y, items);
  }, [currentEpisodeId, handlePlay, handleToggleFavorite, selectedIds, selectedEpisode, setSelectedEpisode, allPlaylists]);

  const handleBulkDelete = useCallback(async () => {
    setDeleting(true);
    const count = selectedIds.size;
    try {
      for (const id of selectedIds) {
        await deleteEpisode(id);
      }
      setSelectedIds(new Set());
      setSelectedEpisode(null);
      toast.success(`Deleted ${count} episode${count !== 1 ? "s" : ""}`);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }, [selectedIds, setSelectedIds, setSelectedEpisode]);

  const requestBulkDelete = useCallback(() => setDeleteOpen(true), []);

  return {
    handlePlay,
    handleQueue,
    handleToggleFavorite,
    handleShuffle,
    handleContextMenu,
    handleBulkDelete,
    deleteOpen, setDeleteOpen, requestBulkDelete,
    deleting,
  };
}
