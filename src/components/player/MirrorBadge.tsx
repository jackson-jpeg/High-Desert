"use client";

import { usePlayerStore } from "@/stores/player-store";
import { cn } from "@/lib/utils/cn";

/**
 * "VIA MIRROR": the show is coming from this site's own mirror because
 * archive.org stopped delivering (src/audio/sources.ts). Shown in the desktop
 * status bar and the mobile player. Says so plainly rather than hiding it: the
 * mirror holds only the most-played shows and whatever was fetched before the
 * outage, so a listener who sees it knows why the next show might not start.
 */
export function MirrorBadge({ className }: { className?: string }) {
  const viaMirror = usePlayerStore((s) => s.source === "mirror" && !!s.currentEpisode);
  if (!viaMirror) return null;
  return (
    <span
      data-testid="via-mirror"
      title="archive.org isn't answering — this show is coming from High Desert's own mirror"
      className={cn(
        "inline-flex items-center px-1 text-hd-micro font-bold tracking-wider text-signal-blue border border-signal-blue/60 whitespace-nowrap flex-shrink-0",
        className,
      )}
    >
      VIA MIRROR
    </span>
  );
}
