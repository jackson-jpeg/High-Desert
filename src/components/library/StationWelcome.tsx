"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { useLook } from "@/hooks/useLook";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { onAirAt, useLiveSchedule, useStationClock } from "@/hooks/useLiveStation";
import { useLiveStore } from "@/stores/live-store";
import { usePlayerStore } from "@/stores/player-store";
import { tuneIn } from "@/audio/live-controller";
import { showHook } from "@/lib/live/hook";
import { funnelArrival } from "@/services/stats/funnel-client";
import {
  markStationWelcomeDone,
  stationWelcomeDone,
  stationWelcomeShows,
  type Arrival,
} from "@/lib/live/station-welcome";
import { HeroCount, NowPlaying, useCatalogRow } from "@/components/live/LiveStation";
import { OnAirLamp } from "@/components/live/OnAirLamp";
import type { Look } from "@/lib/look/look";

/** How long to wait for the funnel's verdict (it lands once the library count resolves). */
const ARRIVAL_POLL_MS = 1000;
const ARRIVAL_POLL_LIMIT = 30;

/**
 * "On the air now" above a new desktop visitor's Library: the show, its guest
 * and year, the hook, time left, how many are tuned in, and one Listen live
 * (`tuneIn()` inside the tap). Who sees it: `stationWelcomeShows`
 * (src/lib/live/station-welcome.ts).
 */
export function StationWelcome() {
  const isMobile = useIsMobile();
  const look = useLook();
  const tuned = useLiveStore((s) => s.tuned);
  const hasEpisode = usePlayerStore((s) => s.currentEpisode !== null);
  const [arrival, setArrival] = useState<Arrival>(null);
  const [done, setDone] = useState(true);

  // Storage is read after mount (never during render: hydration). The verdict
  // may not exist yet on a first load, so it is asked again for a while.
  useEffect(() => {
    setDone(stationWelcomeDone());
    let tries = 0;
    const read = () => {
      const a = funnelArrival();
      if (a) {
        setArrival(a);
        return true;
      }
      return ++tries >= ARRIVAL_POLL_LIMIT;
    };
    if (read()) return;
    const id = window.setInterval(() => {
      if (read()) window.clearInterval(id);
    }, ARRIVAL_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Tuned in from anywhere (this window, the player, Live): it has done its job.
  useEffect(() => {
    if (tuned && !done) {
      markStationWelcomeDone("tuned");
      setDone(true);
    }
  }, [tuned, done]);

  const shows = stationWelcomeShows({ arrival, isMobile, done, tuned, hasEpisode, now: Date.now() });
  if (!shows) return null;
  return (
    <StationWelcomeWindow
      look={look}
      onClose={() => {
        markStationWelcomeDone("closed");
        setDone(true);
      }}
    />
  );
}

/** The window itself: mounted only for a browser that passes the rule, so nobody else polls or ticks. */
function StationWelcomeWindow({ look, onClose }: { look: Look; onClose: () => void }) {
  const schedule = useLiveSchedule();
  const now = useStationClock(1000);
  const on = onAirAt(schedule, now);
  const slot = on && "slot" in on ? on.slot : null;
  const row = useCatalogRow(slot?.fileHash ?? null);
  if (!schedule || !slot) return null;
  const hook = showHook({ fileHash: slot.fileHash, aiSummary: row?.aiSummary });

  return (
    <section
      data-testid="station-welcome"
      aria-label="On the air now"
      className={cn(
        "mx-3 my-2 w98-raised-dark bg-raised-surface flex flex-col gap-3 px-4 py-3 max-w-[880px]",
        look === "night" && "rounded-xl",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <OnAirLamp lit tuned={false} size="sm" />
          <span className="text-hd-caption text-bevel-dark truncate">
            High Desert Live plays Art Bell around the clock. Everyone hears the same second.
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <HeroCount />
          <button
            type="button"
            onClick={onClose}
            data-testid="station-welcome-close"
            aria-label="Close"
            className="w98-raised-dark bg-raised-surface text-desktop-gray w98-font text-hd-caption px-2 min-h-[24px] cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
      <div className="flex items-end gap-6">
        <div className="flex-1 min-w-0">
          <NowPlaying slot={slot} now={now} hook={hook} phone dial={false} />
        </div>
        <button
          type="button"
          onClick={() => tuneIn()}
          data-testid="station-welcome-listen"
          className={cn(
            "flex-shrink-0 min-h-[48px] px-6 cursor-pointer w98-font text-hd-title font-bold",
            look === "win98"
              ? "w98-raised-dark bg-raised-surface text-desktop-gray"
              : "rounded-full bg-desert-amber text-midnight",
          )}
        >
          ▶ Listen live
        </button>
      </div>
    </section>
  );
}
