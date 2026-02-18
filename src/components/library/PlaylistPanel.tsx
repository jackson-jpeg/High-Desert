"use client";

import { useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import type { Playlist } from "@/db/schema";
import type { Episode } from "@/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { useAdminStore } from "@/stores/admin-store";
import { toast } from "@/stores/toast-store";
import { Button, Dialog } from "@/components/win98";
import { cn } from "@/lib/utils/cn";

interface PlaylistPanelProps {
  onPlayEpisode: (episode: Episode) => void;
  className?: string;
}

export function PlaylistPanel({ onPlayEpisode, className }: PlaylistPanelProps) {
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const playlists = useLiveQuery(() => db.playlists.orderBy("createdAt").reverse().toArray(), []);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistEpisodes, setPlaylistEpisodes] = useState<Episode[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const loadPlaylist = useCallback(async (playlist: Playlist) => {
    setSelectedPlaylist(playlist);
    if (playlist.episodeIds.length === 0) {
      setPlaylistEpisodes([]);
      return;
    }
    const episodes = await db.episodes.where("id").anyOf(playlist.episodeIds).toArray();
    // Preserve order
    const byId = new Map(episodes.map((e) => [e.id, e]));
    setPlaylistEpisodes(playlist.episodeIds.map((id) => byId.get(id)).filter(Boolean) as Episode[]);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    await db.playlists.add({
      name: newName.trim(),
      description: newDesc.trim() || undefined,
      episodeIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setNewName("");
    setNewDesc("");
    setCreateOpen(false);
    toast.success(`Playlist "${newName.trim()}" created`);
  }, [newName, newDesc]);

  const handleDelete = useCallback(async (id: number) => {
    await db.playlists.delete(id);
    if (selectedPlaylist?.id === id) {
      setSelectedPlaylist(null);
      setPlaylistEpisodes([]);
    }
    toast.success("Playlist deleted");
  }, [selectedPlaylist]);

  const handleRename = useCallback(async (id: number) => {
    if (!editName.trim()) return;
    await db.playlists.update(id, { name: editName.trim(), updatedAt: Date.now() });
    setEditingId(null);
    if (selectedPlaylist?.id === id) {
      setSelectedPlaylist((prev) => prev ? { ...prev, name: editName.trim() } : null);
    }
  }, [editName, selectedPlaylist]);

  const handleRemoveFromPlaylist = useCallback(async (playlistId: number, episodeId: number) => {
    const playlist = await db.playlists.get(playlistId);
    if (!playlist) return;
    const newIds = playlist.episodeIds.filter((id) => id !== episodeId);
    await db.playlists.update(playlistId, { episodeIds: newIds, updatedAt: Date.now() });
    setPlaylistEpisodes((prev) => prev.filter((e) => e.id !== episodeId));
    setSelectedPlaylist((prev) => prev ? { ...prev, episodeIds: newIds } : null);
  }, []);

  const handlePlayAll = useCallback(() => {
    if (playlistEpisodes.length === 0) return;
    const store = usePlayerStore.getState();
    store.enqueueMany(playlistEpisodes);
    onPlayEpisode(playlistEpisodes[0]);
    toast.info(`Playing ${playlistEpisodes.length} episodes`);
  }, [playlistEpisodes, onPlayEpisode]);

  // Show selected playlist detail
  if (selectedPlaylist) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSelectedPlaylist(null); setPlaylistEpisodes([]); }}
            className="text-[10px] text-bevel-dark hover:text-desktop-gray cursor-pointer"
          >
            {"\u2190"} Back
          </button>
          <span className="text-[11px] text-desktop-gray font-bold truncate flex-1">
            {selectedPlaylist.name}
          </span>
          <span className="text-[9px] text-bevel-dark tabular-nums">
            {playlistEpisodes.length} ep{playlistEpisodes.length !== 1 ? "s" : ""}
          </span>
        </div>

        {selectedPlaylist.description && (
          <div className="text-[9px] text-bevel-dark/70">{selectedPlaylist.description}</div>
        )}

        {playlistEpisodes.length > 0 && (
          <Button variant="dark" size="sm" onClick={handlePlayAll}>
            Play All
          </Button>
        )}

        <div className="flex flex-col gap-1 max-h-[300px] overflow-auto">
          {playlistEpisodes.map((ep, i) => (
            <div
              key={ep.id}
              className="flex items-center gap-2 px-2 py-1.5 w98-raised-dark bg-card-surface cursor-pointer hover:bg-title-bar-blue/15 transition-colors-fast"
              onClick={() => onPlayEpisode(ep)}
            >
              <span className="text-[8px] text-bevel-dark/50 tabular-nums w-[14px] text-right">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-desktop-gray truncate">{ep.title || ep.fileName}</div>
                <div className="text-[8px] text-bevel-dark truncate">
                  {[ep.airDate, ep.guestName].filter(Boolean).join(" \u2014 ")}
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveFromPlaylist(selectedPlaylist.id!, ep.id!);
                  }}
                  className="text-[9px] text-bevel-dark/30 hover:text-red-400 cursor-pointer flex-shrink-0"
                  title="Remove from playlist"
                >
                  {"\u2715"}
                </button>
              )}
            </div>
          ))}
        </div>

        {playlistEpisodes.length === 0 && (
          <div className="text-[9px] text-bevel-dark/50 text-center py-4">
            {isAdmin ? "Right-click episodes to add them to this playlist." : "This playlist is empty."}
          </div>
        )}
      </div>
    );
  }

  // Playlist list
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-desert-amber uppercase tracking-wider font-bold">Playlists</span>
        {isAdmin && (
          <button
            onClick={() => setCreateOpen(true)}
            className="text-[9px] text-bevel-dark hover:text-desktop-gray cursor-pointer"
          >
            + New
          </button>
        )}
      </div>

      {(!playlists || playlists.length === 0) && (
        <div className="text-[9px] text-bevel-dark/50 text-center py-3">
          {isAdmin ? "Create your first playlist." : "No playlists yet."}
        </div>
      )}

      {playlists && playlists.map((pl) => (
        <div key={pl.id} className="flex items-center gap-1 group">
          {editingId === pl.id ? (
            <form
              onSubmit={(e) => { e.preventDefault(); handleRename(pl.id!); }}
              className="flex-1 flex items-center gap-1"
            >
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 bg-inset-well w98-inset-dark px-1 py-0.5 text-[10px] text-desktop-gray outline-none"
                autoFocus
              />
              <button type="submit" className="text-[9px] text-static-green cursor-pointer">{"\u2713"}</button>
              <button type="button" onClick={() => setEditingId(null)} className="text-[9px] text-bevel-dark cursor-pointer">{"\u2715"}</button>
            </form>
          ) : (
            <>
              <button
                onClick={() => loadPlaylist(pl)}
                className="flex-1 text-left text-[10px] text-desktop-gray hover:text-desert-amber cursor-pointer py-1 truncate transition-colors-fast"
              >
                {pl.name}
                <span className="text-[8px] text-bevel-dark/50 ml-1 tabular-nums">{pl.episodeIds.length}</span>
              </button>
              {isAdmin && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { setEditingId(pl.id!); setEditName(pl.name); }}
                    className="text-[8px] text-bevel-dark hover:text-desktop-gray cursor-pointer"
                    title="Rename"
                  >
                    {"\u270E"}
                  </button>
                  <button
                    onClick={() => handleDelete(pl.id!)}
                    className="text-[8px] text-bevel-dark hover:text-red-400 cursor-pointer"
                    title="Delete playlist"
                  >
                    {"\u2715"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Playlist" width="300px">
        <form
          onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
          className="p-4 flex flex-col gap-3"
        >
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] text-bevel-dark uppercase tracking-wider">Name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-inset-well w98-inset-dark px-2 py-1 text-[11px] text-desktop-gray outline-none"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] text-bevel-dark uppercase tracking-wider">Description (optional)</span>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="bg-inset-well w98-inset-dark px-2 py-1 text-[11px] text-desktop-gray outline-none"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="dark" type="submit" disabled={!newName.trim()}>Create</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** Helper to add episodes to a playlist — used from context menus */
export async function addToPlaylist(playlistId: number, episodeIds: number[]): Promise<void> {
  const playlist = await db.playlists.get(playlistId);
  if (!playlist) return;
  const existing = new Set(playlist.episodeIds);
  const newIds = [...playlist.episodeIds, ...episodeIds.filter((id) => !existing.has(id))];
  await db.playlists.update(playlistId, { episodeIds: newIds, updatedAt: Date.now() });
}
