"use client";

import { usePlayerStore } from "@/stores/player-store";
import { useShowSlug } from "@/hooks/useShowSlug";
import { episodeTitle } from "@/lib/library/display-title";
import { communityKey } from "@/lib/utils/community-key";
import { momentLabel, momentShareText, showKeyShareUrl, showShareUrl } from "@/lib/shows/share";
import { cn } from "@/lib/utils/cn";
import { shareLink } from "./share-link";

/**
 * "Share this moment" (docs/show-pages.md, "Sharing"): the playing show's page
 * at the current second, `/show/<slug>?t=<seconds>`, which plays from there
 * and carries a card that says the time. Share sheet where there is one, the
 * clipboard otherwise. Drawn by each player layout with its own class; reads
 * `position` only when pressed, so it never re-renders on the tick.
 *
 * Not drawn for a show with no page (a local file, an import outside the
 * catalog).
 */
export function ShareMomentButton({ className, label = "Share this moment" }: { className?: string; label?: string }) {
  const episode = usePlayerStore((s) => s.currentEpisode);
  const slug = useShowSlug(episode);
  const key = episode ? communityKey(episode) : null;
  if (!episode || !key || slug === null) return null;

  const share = () => {
    const seconds = Math.max(0, Math.floor(usePlayerStore.getState().position));
    const origin = window.location.origin;
    // Before the slug has arrived, the key's redirect lands on the same page.
    const url = slug ? showShareUrl(origin, slug, seconds) : showKeyShareUrl(origin, key, seconds);
    const title = episodeTitle(episode);
    void shareLink({ title, text: momentShareText(title, seconds), url }, `Link copied: starts at ${momentLabel(seconds)}`);
  };

  return (
    <button
      type="button"
      onClick={share}
      className={cn("hd-share-moment", className)}
      aria-label="Share this moment: a link that plays from here"
      title="Share this moment"
      data-testid="share-moment"
    >
      {label}
    </button>
  );
}
