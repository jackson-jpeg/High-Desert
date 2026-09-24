"use client";

import { useEffect } from "react";
import { reportHeartbeat } from "@/services/stats/client";
import { refreshNow, type LivePresence } from "@/services/stats/now-feed";
import { useCommunityNow } from "@/hooks/useCommunityNow";
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
 * Announces this tab as present, and returns who is here.
 *
 * The heartbeat keeps running while the tab is hidden: audio plays in
 * background tabs, and someone listening with the page backgrounded is very
 * much still online. Browsers throttle background timers to roughly one a
 * minute, which the server's five-minute presence window absorbs.
 *
 * The numbers it returns are not fetched here. They come from the shared feed
 * every other presence surface reads (`useCommunityNow`); this hook fetching
 * its own copy on its own clock is how the badge and On Air came to disagree.
 * The first beat refreshes the feed once it lands, so this visitor counts
 * themselves from the first paint rather than twenty seconds later.
 *
 * Every failure path resolves to zeroes, so with DATABASE_URL unset the
 * /api/stats/* routes 503 and the UI simply shows nothing.
 */
export function usePresence(): LivePresence {
  const { online, listening, poll } = useCommunityNow();

  useEffect(() => {
    const beat = () => reportHeartbeat(SESSION_ID, nowListeningTo());

    void beat().then(() => refreshNow());
    const id = setInterval(beat, HEARTBEAT_MS);

    // Coming back to the tab should announce it immediately rather than
    // waiting out the rest of a throttled interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { online, listening, poll };
}
