"use client";

import { useCallback, useEffect, useState } from "react";
import type { Episode } from "@/db";
import { Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";
import { formatAirDate, formatRelativeTime, getShowLabel } from "@/lib/utils/format";
import { useNowPlaying } from "@/hooks/useNowPlaying";
import { useCommunityKeyIndex } from "@/hooks/useCommunityKeyIndex";
import type { OnAirEntry, RecentPlay } from "@/services/stats/client";

/** Animated level meter, matching the status bar's signal bars. */
function LevelMeter({ live }: { live: boolean }) {
  return (
    <span className="flex items-end gap-[1px] h-[12px] w-[11px] flex-shrink-0" aria-hidden="true">
      {[4, 8, 6, 10].map((h, i) => (
        <span
          key={i}
          className={cn(
            "w-[2px]",
            live ? `bg-static-green animate-signal-${i + 1}` : "bg-bevel-dark/40",
          )}
          style={{ height: `${h}px` }}
        />
      ))}
    </span>
  );
}

/**
 * One episode row. Clicking it starts the same episode locally — the point of
 * the panel is that you can join what someone else already has on.
 */
function AirRow({
  episode,
  fallbackId,
  live,
  meta,
  onPlay,
}: {
  episode: Episode | undefined;
  fallbackId: string;
  live: boolean;
  meta: string;
  onPlay: (episode: Episode) => void;
}) {
  const title = episode?.title || episode?.fileName || fallbackId;
  const show = getShowLabel(episode?.showType);
  const sub = [
    episode?.airDate ? formatAirDate(episode.airDate) : null,
    episode?.guestName,
    show,
  ]
    .filter(Boolean)
    .join(" · ");

  // An episode the visitor does not have locally cannot be played, so it is
  // rendered as plain text rather than a button that would do nothing.
  const playable = episode != null;

  const body = (
    <>
      <LevelMeter live={live} />
      <span className="flex flex-col min-w-0 flex-1 text-left">
        <span className="text-hd-body text-desktop-gray truncate">{title}</span>
        {sub && (
          <span className="text-hd-micro text-bevel-dark/85 truncate">{sub}</span>
        )}
      </span>
      <span
        className={cn(
          "text-hd-micro tabular-nums flex-shrink-0 whitespace-nowrap",
          live ? "text-static-green" : "text-bevel-dark/85",
        )}
      >
        {meta}
      </span>
      {playable && (
        <span
          className="text-hd-micro text-desert-amber opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity flex-shrink-0 hidden sm:inline"
          aria-hidden="true"
        >
          Tune in ▸
        </span>
      )}
    </>
  );

  if (!playable) {
    return (
      <li className="flex items-center gap-2 px-2 py-2 min-h-touch md:min-h-0 md:py-1.5">
        {body}
      </li>
    );
  }

  return (
    <li>
      <button
        onClick={() => onPlay(episode)}
        className="group w-full flex items-center gap-2 px-2 py-2 md:py-1.5 min-h-touch md:min-h-0 cursor-pointer hover:bg-title-bar-blue/20 transition-colors-fast"
        title={`Play ${title}`}
      >
        {body}
      </button>
    </li>
  );
}

/**
 * What the community has on right now.
 *
 * The live *count* was already in the status bar, but a bare number is not a
 * room — "4 online" tells you nothing about who is there or what they came for.
 * This is the same data made specific: the shows that are actually playing, and
 * the ones that were just started, each one something you can join with a
 * click. That is the difference between a metric and a signal you tune into.
 *
 * Renders nothing when the stats service is unavailable, matching the
 * documented contract for every /api/stats/* consumer.
 */
export function OnAir() {
  const { online, listening, onAir, recent, loading } = useNowPlaying();
  const hasAnything = online > 0 || onAir.length > 0 || recent.length > 0;
  const index = useCommunityKeyIndex(hasAnything);

  // Relative labels are computed at render, so without this they would freeze
  // between polls — "just now" stays "just now" for twenty seconds.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const handlePlay = useCallback((episode: Episode) => {
    window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: episode }));
  }, []);

  // Nothing to say yet, or stats are down — either way, no empty frame.
  // `loading` is read so the first paint waits for a real answer rather than
  // rendering and then vanishing.
  if (loading || !hasAnything) return null;

  const listeners = (n: number) => `${n} listening`;

  return (
    <Window title="On Air" variant="dark" headingLevel={2}>
      <div className="flex flex-col" id="on-air">
        {/* Marquee: the headline number, in words rather than a bare integer */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-bevel-dark/15">
          <span
            className={cn(
              "w-[8px] h-[8px] rounded-full flex-shrink-0",
              listening > 0 ? "bg-red-500 animate-on-air" : "bg-static-green animate-on-air",
            )}
            aria-hidden="true"
          />
          <span className="text-hd-caption text-desktop-gray">
            <strong className="text-static-green tabular-nums font-normal">{online}</strong>
            {online === 1 ? " person is" : " people are"} in the desert
            {listening > 0 && (
              <>
                {" · "}
                <strong className="text-desert-amber tabular-nums font-normal">
                  {listening}
                </strong>
                {listening === 1 ? " has" : " have"} the radio on
              </>
            )}
          </span>
        </div>

        {onAir.length > 0 ? (
          <ul className="flex flex-col py-1">
            {onAir.map((e: OnAirEntry) => (
              <AirRow
                key={e.episodeId}
                episode={index.get(e.episodeId)}
                fallbackId={e.episodeId}
                live
                meta={listeners(e.listeners)}
                onPlay={handlePlay}
              />
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-hd-caption text-bevel-dark/85">
            Nobody has the mic right now — the band is open.
          </p>
        )}

        {recent.length > 0 && (
          <>
            <div className="px-3 pt-2 pb-1 text-hd-micro uppercase tracking-wider text-bevel-dark/85 border-t border-bevel-dark/15">
              Recently played
            </div>
            <ul className="flex flex-col pb-1">
              {recent.map((r: RecentPlay) => (
                <AirRow
                  key={r.episodeId}
                  episode={index.get(r.episodeId)}
                  fallbackId={r.episodeId}
                  live={false}
                  meta={formatRelativeTime(r.at)}
                  onPlay={handlePlay}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </Window>
  );
}
