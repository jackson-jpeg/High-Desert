"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { recentlyPlayedEpisodes } from "@/services/episodes/progress";
import type { Episode } from "@/db/schema";
import { cn } from "@/lib/utils/cn";
import { formatTime } from "@/lib/utils/format";
import { episodeTitle } from "@/lib/library/display-title";
import { shownGuest } from "@/lib/library/guest";
import { airYear } from "@/lib/live/hook";
import { continueItems, remainingLabel, type ContinueItem } from "@/lib/library/continue-listening";
import { ShowTitle } from "@/components/library/ShowTitle";

/**
 * Continue listening, front and centre: at the top of the Library (both
 * looks, phone and desktop) and on the welcome page. The show this browser
 * last stopped part way through, as one big tap that resumes it at the saved
 * second, and up to two more beside it. Hidden when there is nothing to
 * continue (src/lib/library/continue-listening.ts decides what counts).
 *
 * The tap is `onResume(episode)`: the Library emits `play-episode`, the
 * ordinary start path, which reads the saved position itself
 * (`startPositionFor(positionOf(…))`); the welcome page, which has no player,
 * goes to the Library with a `?resume=` intent. Nothing here touches the
 * audio element.
 *
 * `exclude`: the show already in the player (the Library passes it), left
 * out because the player is how to go on with that one. A prop, not a store
 * read: the welcome page has no player, and must not import one
 * (src/lib/__tests__/event-routes.test.ts).
 */
export function ContinueListening({
  onResume,
  exclude = null,
  className,
  dense = false,
}: {
  onResume: (episode: Episode) => void;
  exclude?: string | null;
  className?: string;
  /** One row, the latest show only: the Library on a phone, where the first
   *  shows of the list must still fit the first screen. */
  dense?: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  // From the `progress` table (HD-016). A database that cannot be read is
  // nothing to continue, never an error on the page.
  const played = useLiveQuery(async () => {
    try {
      return await recentlyPlayedEpisodes(12);
    } catch {
      return [];
    }
  }, []);
  const items = played ? continueItems(played, { exclude }) : [];
  if (hidden || items.length === 0) return null;
  const [first, ...more] = items;

  if (dense) {
    const ep = first.episode;
    const title = episodeTitle(ep);
    const left = remainingLabel(first.remaining);
    return (
      <section
        aria-labelledby="continue-heading"
        data-testid="continue-listening"
        data-dense=""
        className={cn("hd-continue w98-raised-dark bg-raised-surface flex items-center gap-2 pl-2 pr-0.5 py-1", className)}
      >
        <button
          type="button"
          onClick={() => onResume(ep)}
          data-testid="continue-resume"
          aria-label={`Resume ${title} at ${formatTime(first.position)}`}
          className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer min-h-touch group"
        >
          <span
            aria-hidden="true"
            className="hd-continue-play shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-desert-amber text-midnight text-hd-body group-active:scale-95"
          >
            {"▶"}
          </span>
          <span className="flex flex-col min-w-0 flex-1">
            <h2 id="continue-heading" className="w98-font text-hd-micro uppercase tracking-[0.14em] text-desert-amber">
              Continue listening
            </h2>
            <ShowTitle title={title} className="text-hd-caption text-desktop-gray font-bold truncate" />
            <span className="text-hd-micro text-bevel-dark truncate" data-testid="continue-at">
              Resume at {formatTime(first.position)}{left ? ` · ${left}` : ""}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="Hide Continue listening"
          className="min-h-touch min-w-touch flex items-center justify-center text-hd-body text-bevel-dark hover:text-desktop-gray cursor-pointer flex-shrink-0"
        >
          {"✕"}
        </button>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="continue-heading"
      data-testid="continue-listening"
      className={cn("hd-continue w98-raised-dark bg-raised-surface flex flex-col gap-2 px-3 py-2 animate-slide-up", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="continue-heading" className="w98-font text-hd-caption uppercase tracking-[0.18em] text-desert-amber">
          Continue listening
        </h2>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="Hide Continue listening"
          className="min-h-touch min-w-touch md:min-h-0 md:min-w-0 md:px-1 flex items-center justify-center text-hd-body text-bevel-dark hover:text-desktop-gray cursor-pointer"
        >
          {"✕"}
        </button>
      </div>

      <Featured item={first} onResume={onResume} />

      {more.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto scroll-fade-x" aria-label="More to continue">
          {more.map((item) => (
            <li key={item.episode.fileHash} className="flex-shrink-0 w-[220px] md:w-[240px]">
              <button
                type="button"
                onClick={() => onResume(item.episode)}
                data-testid="continue-more"
                aria-label={`Resume ${episodeTitle(item.episode)} at ${formatTime(item.position)}`}
                className="w-full min-h-touch px-2 py-1.5 w98-raised-dark bg-card-surface text-left cursor-pointer flex flex-col gap-1"
              >
                <ShowTitle title={episodeTitle(item.episode)} className="text-hd-caption text-desktop-gray" />
                <Progress item={item} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Featured({ item, onResume }: { item: ContinueItem; onResume: (episode: Episode) => void }) {
  const ep = item.episode;
  const title = episodeTitle(ep);
  const meta = [shownGuest(ep), airYear(ep.airDate)].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={() => onResume(ep)}
      data-testid="continue-resume"
      aria-label={`Resume ${title} at ${formatTime(item.position)}`}
      className="w-full flex items-center gap-3 text-left cursor-pointer min-h-[64px] group"
    >
      <span
        aria-hidden="true"
        className="hd-continue-play shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-desert-amber text-midnight text-hd-title group-active:scale-95"
      >
        {"▶"}
      </span>
      <span className="flex flex-col min-w-0 flex-1 gap-0.5">
        <ShowTitle title={title} className="text-hd-body text-desktop-gray font-bold" />
        {meta && <span className="text-hd-caption text-bevel-dark truncate">{meta}</span>}
        <span className="text-hd-caption text-desert-amber" data-testid="continue-at">
          Resume at {formatTime(item.position)}
        </span>
        <Progress item={item} />
      </span>
    </button>
  );
}

function Progress({ item }: { item: ContinueItem }) {
  const left = remainingLabel(item.remaining);
  if (item.percent === null) return null;
  return (
    <span className="flex items-center gap-2">
      <span className="flex-1 h-[4px] w98-inset-dark bg-inset-well overflow-hidden" aria-hidden="true">
        <span className="block h-full bg-phosphor-amber" style={{ width: `${item.percent}%` }} />
      </span>
      {left && <span className="text-hd-micro text-bevel-dark tabular-nums whitespace-nowrap">{left}</span>}
    </span>
  );
}
