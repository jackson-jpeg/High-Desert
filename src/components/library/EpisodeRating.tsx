"use client";

import { useEffect, useState } from "react";
import type { Episode } from "@/db/schema";
import { cn } from "@/lib/utils/cn";
import { rateEpisode } from "@/services/episodes/management";
import { reportRating, fetchRatings } from "@/services/stats/client";
import { communityKey } from "@/lib/utils/community-key";

export type CommunityRating = { avg: number; count: number } | null;

/** The community average for this episode, re-read after a local rating change. */
export function useCommunityRating(episode: Episode): CommunityRating {
  const [communityRating, setCommunityRating] = useState<CommunityRating>(null);

  const epCommunityKey = communityKey(episode);
  useEffect(() => {
    if (!epCommunityKey) return;
    // Without the catch this was an unhandled rejection on every open while
    // the stats service was unreachable.
    fetchRatings([epCommunityKey])
      .then((data) => setCommunityRating(data[epCommunityKey] ?? null))
      .catch(() => setCommunityRating(null));
  }, [epCommunityKey, episode.rating]); // re-fetch after local rating changes

  return communityRating;
}

/** Five stars (clicking the current rating clears it) and the community average. */
export function EpisodeRating({ episode, communityRating }: { episode: Episode; communityRating: CommunityRating }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={async () => {
            const newRating = episode.rating === star ? undefined : star;
            await rateEpisode(episode.id!, newRating);
            // Sync to community rating system
            const ratingKey = communityKey(episode);
            if (ratingKey) {
              reportRating(ratingKey, newRating ?? null);
            }
          }}
          className={cn(
            "text-hd-h3 md:text-hd-body cursor-pointer transition-colors-fast min-w-touch min-h-touch md:min-w-0 md:min-h-0 flex items-center justify-center",
            star <= (episode.rating ?? 0)
              ? "text-desert-amber"
              : "text-bevel-dark/85 hover:text-desert-amber/85 active:text-desert-amber/85",
          )}
          title={`Rate ${star} star${star !== 1 ? "s" : ""}`}
          aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
        >
          {star <= (episode.rating ?? 0) ? "★" : "☆"}
        </button>
      ))}
      {episode.rating && (
        <span className="text-hd-body md:text-hd-caption text-bevel-dark/85 ml-1">{episode.rating}/5</span>
      )}
      {communityRating && communityRating.count > 0 && (
        <span className="text-hd-caption md:text-hd-micro text-bevel-dark/85 ml-2" title={`${communityRating.count} community rating${communityRating.count !== 1 ? "s" : ""}`}>
          {communityRating.avg.toFixed(1)} avg · {communityRating.count}
        </span>
      )}
    </div>
  );
}
