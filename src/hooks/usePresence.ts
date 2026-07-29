"use client";

import { useEffect, useState } from "react";
import { fetchPresence, reportHeartbeat, type Presence } from "@/services/stats/client";
import { SESSION_ID } from "@/lib/utils/session-id";
import { usePlayerStore } from "@/stores/player-store";
import { communityKey } from "@/lib/utils/community-key";

const HEARTBEAT_MS = 60_000;

/**
 * What this tab is playing right now, as a community key, or null.
 *
 * Read from the store at beat time rather than subscribed to: this hook must
 * not re-render the shell every time playback state changes, and the heartbeat
 * only needs the answer once a minute.
 */
export function nowListeningTo(): string | null {
  const { currentEpisode, playing } = usePlayerStore.getState();
  if (!playing || !currentEpisode) return null;
  return communityKey(currentEpisode);
}

/**
 * Announces this tab as present and reports who else is here.
 *
 * The heartbeat keeps running while the tab is hidden: audio plays in
 * background tabs, and someone listening with the page backgrounded is very
 * much still online. Browsers throttle background timers to roughly one a
 * minute, which the server's five-minute presence window absorbs.
 *
 * Every failure path resolves to zeroes, so with DATABASE_URL unset the
 * /api/stats/* routes 503 and the UI simply shows nothing.
 */
export function usePresence(): Presence {
  const [presence, setPresence] = useState<Presence>({ online: 0, listening: 0 });

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      reportHeartbeat(SESSION_ID, nowListeningTo());
      fetchPresence().then((p) => {
        if (!cancelled) setPresence(p);
      });
    };

    tick();
    const id = setInterval(tick, HEARTBEAT_MS);

    // Coming back to the tab should refresh immediately rather than waiting out
    // the rest of a throttled interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return presence;
}
