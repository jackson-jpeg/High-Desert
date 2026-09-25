"use client";

import type { Episode } from "@/db/schema";
import { Button } from "@/components/win98";
import { usePlayerStore } from "@/stores/player-store";
import { toast } from "@/stores/toast-store";
import { toggleFlag } from "@/services/episodes/management";
import { cn } from "@/lib/utils/cn";
import { archiveDetailsUrl } from "@/lib/library/episode-detail";
import { EpisodeShareButton } from "@/components/library/EpisodeShareButton";
import { mirrorUrl } from "@/audio/sources";

const manageClass = "text-hd-body md:text-hd-caption cursor-pointer transition-colors-fast min-h-touch md:min-h-0 flex items-center";

/** Play, Play Next, Queue and the favourite star. */
export function EpisodePlayControls({
  episode,
  isPlaying,
  onPlay,
  onToggleFavorite,
}: {
  episode: Episode;
  isPlaying: boolean;
  onPlay: (episode: Episode) => void;
  onToggleFavorite?: (episode: Episode) => void;
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <Button
        variant="dark"
        onClick={() => onPlay(episode)}
        disabled={isPlaying}
      >
        {isPlaying ? "Playing" : "▶ Play"}
      </Button>
      <Button
        variant="dark"
        size="sm"
        onClick={() => {
          usePlayerStore.getState().enqueueNext(episode);
          toast.info(`"${episode.title || episode.fileName}" plays next`);
        }}
        disabled={isPlaying}
      >
        Play Next
      </Button>
      <Button
        variant="dark"
        size="sm"
        onClick={() => {
          usePlayerStore.getState().enqueue(episode);
          toast.info("Added to queue");
        }}
      >
        Queue
      </Button>
      {onToggleFavorite && (
        <button
          onClick={() => onToggleFavorite(episode)}
          className={cn(
            "text-hd-h3 md:text-hd-body cursor-pointer transition-colors-fast ml-auto min-w-touch min-h-touch md:min-w-0 md:min-h-0 flex items-center justify-center",
            episode.favoritedAt ? "text-desert-amber" : "text-bevel-dark/85 hover:text-desert-amber",
          )}
          title={episode.favoritedAt ? "Remove from favorites" : "Add to favorites"}
        >
          {episode.favoritedAt ? "★" : "☆"}
        </button>
      )}
    </div>
  );
}

/** Archive link, Share, Flag, and — where the page allows it — Edit and Delete. */
export function EpisodeManageBar({
  episode,
  onEdit,
  onDelete,
}: {
  episode: Episode;
  onEdit?: () => void;
  onDelete?: (episode: Episode) => void;
}) {
  const archiveUrl = archiveDetailsUrl(episode);
  return (
    <div className="flex items-center gap-2 border-t border-bevel-dark/15 glass-divider pt-2 mt-0.5">
      {archiveUrl && (
        <a
          href={archiveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(manageClass, "text-bevel-dark/85 hover:text-desktop-gray active:text-desktop-gray")}
        >
          Archive ↗
        </a>
      )}
      <EpisodeShareButton episode={episode} />
      {mirrorUrl(episode) && <MagnetLink episode={episode} />}
      <button
        onClick={async () => {
          const flagged = await toggleFlag(episode.id!);
          toast[flagged ? "info" : "success"](flagged ? "Episode flagged as broken" : "Flag removed");
        }}
        className={cn(
          manageClass,
          // Full-strength red, not /70: this is a state readout and the text
          // ramp's floor is /85 (CLAUDE.md, "Three-tier text ramp").
          episode.flaggedAt
            ? "text-red-400"
            : "text-bevel-dark/85 hover:text-desktop-gray active:text-desktop-gray",
        )}
        title={episode.flaggedAt ? "Remove flag" : "Report broken/dead link"}
      >
        {episode.flaggedAt ? "Flagged" : "Flag"}
      </button>
      {onEdit && (
        <button
          onClick={onEdit}
          className={cn(manageClass, "text-bevel-dark/85 hover:text-desktop-gray active:text-desktop-gray")}
        >
          Edit
        </button>
      )}
      {onDelete && (
        <button
          onClick={() => onDelete(episode)}
          // Was red at /40 — deliberately quiet, and unreadable. Quiet now
          // comes from the ramp's dim tier; the red arrives on hover/press.
          className={cn(manageClass, "text-bevel-dark/85 hover:text-red-400 active:text-red-400 ml-auto")}
        >
          Delete
        </button>
      )}
    </div>
  );
}

/**
 * The episode's torrent, for a BitTorrent client: the same bytes as
 * archive.org, webseeded from it, and seeded by this site's mirror for the
 * most-played shows (services/mirror). Built by the gateway on request —
 * shipping every infohash in the page would cost every visitor ~200 KB for a
 * link few will use. Opens the listener's torrent client and copies the link,
 * since a browser with no handler for magnet: does nothing visible at all.
 */
export function MagnetLink({ episode }: { episode: Episode }) {
  return (
    <button
      onClick={async () => {
        try {
          const res = await fetch(`/mirror/magnet/${encodeURIComponent(episode.fileHash)}`);
          if (!res.ok) throw new Error(String(res.status));
          const { magnet } = (await res.json()) as { magnet: string };
          navigator.clipboard?.writeText(magnet).catch(() => {});
          toast.success("Magnet link copied");
          window.location.assign(magnet);
        } catch {
          toast.error("The magnet link isn't available right now.");
        }
      }}
      className={cn(manageClass, "text-bevel-dark/85 hover:text-desktop-gray active:text-desktop-gray")}
      title="Open this episode's torrent in a BitTorrent client"
      data-testid="magnet-link"
    >
      Magnet
    </button>
  );
}
