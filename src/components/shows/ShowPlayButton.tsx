"use client";

import { useEffect, useRef, useState } from "react";
import { momentLabel } from "@/lib/shows/share";
import { installShowListen } from "@/services/stats/show-page-listen";

/**
 * A show page's big one-tap Play (docs/show-pages.md). It drives the page's
 * own native `<audio>` (by id), which is there and works without JavaScript;
 * this is the better button on top of it, hidden by a <noscript> rule when
 * there is no script to run it (NO_SCRIPT_PLAY_CSS in ShowView.tsx: a constant
 * exported from this "use client" file would reach the server as a client
 * reference, not a string).
 *
 * For a moment (`?t=`) the sources already carry `#t=<seconds>` (a media
 * fragment: the browser starts there by itself), and this seeks there too on
 * the first play, for a browser that ignored the fragment.
 */

type State = "idle" | "loading" | "playing" | "paused";

export function ShowPlayButton({
  audioId,
  startAt,
  episodeId,
}: {
  audioId: string;
  startAt: number | null;
  /** The show's community key: its listen is counted (show-page-listen.ts), whichever control started it. */
  episodeId: string | null;
}) {
  const [state, setState] = useState<State>("idle");
  const started = useRef(false);

  useEffect(() => {
    const audio = document.getElementById(audioId) as HTMLAudioElement | null;
    if (!audio) return;
    const on: [string, () => void][] = [
      ["play", () => setState("loading")],
      ["playing", () => setState("playing")],
      ["waiting", () => setState("loading")],
      ["pause", () => setState("paused")],
      ["ended", () => setState("paused")],
      [
        "loadedmetadata",
        () => {
          // Once: a browser that ignored #t= still lands on the moment.
          if (startAt != null && !started.current && audio.currentTime < startAt - 1) audio.currentTime = startAt;
          started.current = true;
        },
      ],
    ];
    for (const [type, fn] of on) audio.addEventListener(type, fn);
    const uncount = episodeId ? installShowListen(audio, episodeId) : null;
    return () => {
      for (const [type, fn] of on) audio.removeEventListener(type, fn);
      uncount?.();
    };
  }, [audioId, startAt, episodeId]);

  const toggle = () => {
    const audio = document.getElementById(audioId) as HTMLAudioElement | null;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    // Inside the tap, nothing awaited first: the browser's own rule for sound.
    audio.play().catch(() => setState("paused"));
  };

  const label =
    state === "playing"
      ? "Pause"
      : state === "loading"
        ? "Loading..."
        : state === "paused"
          ? "Resume"
          : startAt != null
            ? `Play from ${momentLabel(startAt)}`
            : "Play the show";

  return (
    <button
      type="button"
      onClick={toggle}
      data-state={state}
      data-testid="show-play"
      className="hd-show-play w98-raised-dark bg-raised-surface w98-font text-hd-h3 text-desert-amber px-5 min-h-[56px] inline-flex items-center justify-center gap-3 cursor-pointer"
    >
      <span aria-hidden="true">{state === "playing" ? "❚❚" : "▶"}</span>
      <span>{label}</span>
    </button>
  );
}
