"use client";

import { useEffect, useState } from "react";
import { fetchNowPlaying, type NowPlaying } from "@/services/stats/client";

/** Fast enough to feel live, slow enough to be two indexed reads a minute. */
const POLL_MS = 20_000;

const EMPTY: NowPlaying = { online: 0, listening: 0, onAir: [], recent: [] };

/**
 * Polls what the community has playing right now.
 *
 * Unlike the shell's `usePresence` heartbeat — which keeps running in a hidden
 * tab because someone listening with the page backgrounded is still here — this
 * one stops while hidden. Nobody is reading a panel they cannot see, and it
 * refreshes the moment the tab comes back, so returning never shows stale data.
 */
export function useNowPlaying(): NowPlaying & { loading: boolean } {
  const [state, setState] = useState<NowPlaying>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = () => {
      fetchNowPlaying().then((next) => {
        if (cancelled) return;
        setState(next);
        setLoading(false);
      });
    };

    const start = () => {
      if (timer) return;
      tick();
      timer = setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    // A tab that starts hidden stays in `loading` until it is looked at, which
    // is what we want: the panel renders nothing rather than flashing an empty
    // state into a page nobody is watching.
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { ...state, loading };
}
