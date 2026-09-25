"use client";

import { useState, useCallback } from "react";
import type { Episode, Playlist } from "@/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { useContextMenuStore } from "@/stores/context-menu-store";
import { useAdminStore } from "@/stores/admin-store";
import { toast } from "@/stores/toast-store";
import { deleteEpisode, toggleFavorite, toggleFlag, addToPlaylist } from "@/services/episodes/management";
import { shuffle } from "@/lib/utils/shuffle";
import { emit } from "@/lib/events";
import { isRemovedFromCatalog } from "@/lib/library/removed-episodes";

/**
 * What can be done to an episode from the library: play, queue, favourite,
 * shuffle, the row context menu, and the confirmed delete.
 *
 * **Every delete goes through the confirmation dialog, one episode or many.**
 * Single deletes used to be immediate from three places — Backspace/Delete in
 * admin mode, the row context menu, and the detail panel's Delete — with no
 * confirmation and no undo, while only the bulk path asked. Admin mode is
 * reachable through an easter egg, and all user data lives only in this
 * browser's IndexedDB (HD-011). `requestDelete(ids)` is the one way in; the ids
 * are captured when the dialog opens, so what the user confirms is exactly
 * what is deleted even if the selection changes behind the dialog.
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
  const [pendingDelete, setPendingDelete] = useState<number[] | null>(null);
  const deleteOpen = pendingDelete !== null;
  const [deleting, setDeleting] = useState(false);

  const handlePlay = useCallback((episode: Episode) => {
    emit("play-episode", episode);
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
      emit("play-episode", batch[0]);
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
      // A row pulled from the catalog can be removed by anyone — it is theirs,
      // and it can no longer play. Through the same confirmation as Delete.
      ...(isRemovedFromCatalog(episode)
        ? [
            { label: "", onClick: () => {}, separator: true },
            {
              label: "Remove from my library",
              onClick: () => setPendingDelete([episode.id!]),
              danger: true,
            },
          ]
        : []),
      ...(admin
        ? [
            { label: "", onClick: () => {}, separator: true },
            {
              label: "Delete",
              onClick: async () => {
                if (selectedIds.size > 1 && selectedIds.has(episode.id!)) {
                  setPendingDelete([...selectedIds]);
                } else {
                  setPendingDelete([episode.id!]);
                }
              },
              danger: true,
            },
          ]
        : []),
    ];

    useContextMenuStore.getState().show(x, y, items);
  }, [currentEpisodeId, handlePlay, handleToggleFavorite, selectedIds, allPlaylists]);

  /** Opens the confirmation for exactly these episodes. Deletes nothing. */
  const requestDelete = useCallback((ids: number[]) => {
    if (ids.length > 0) setPendingDelete(ids);
  }, []);

  const requestBulkDelete = useCallback(
    () => requestDelete([...selectedIds]),
    [requestDelete, selectedIds],
  );

  const setDeleteOpen = useCallback((open: boolean) => {
    if (!open) setPendingDelete(null);
  }, []);

  /** The dialog's Delete button — the only caller of `deleteEpisode` here. */
  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const ids = pendingDelete;
    const count = ids.length;
    try {
      for (const id of ids) {
        await deleteEpisode(id);
      }
      const gone = new Set(ids);
      if ([...selectedIds].some((id) => gone.has(id))) {
        setSelectedIds(new Set([...selectedIds].filter((id) => !gone.has(id))));
      }
      if (selectedEpisode?.id !== undefined && gone.has(selectedEpisode.id)) {
        setSelectedEpisode(null);
      }
      toast.success(`Deleted ${count} episode${count !== 1 ? "s" : ""}`);
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }, [pendingDelete, selectedIds, setSelectedIds, selectedEpisode, setSelectedEpisode]);

  return {
    handlePlay,
    handleQueue,
    handleToggleFavorite,
    handleShuffle,
    handleContextMenu,
    handleConfirmDelete,
    /** How many episodes the open confirmation will delete. */
    pendingDeleteCount: pendingDelete?.length ?? 0,
    deleteOpen, setDeleteOpen, requestDelete, requestBulkDelete,
    deleting,
  };
}
