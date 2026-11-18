"use client";

import { useEffect, useState } from "react";
import { SHOW_SWITCH_EVENT, type ShowSwitchDetail } from "@/lib/shows/next";

/**
 * The Next card's one Play (src/lib/shows/next.ts). The card itself is server
 * HTML, a plain link to the next show's page that works without JavaScript;
 * this button is the better way on top of it, hidden by the page's
 * <noscript> rule (NO_SCRIPT_PLAY_CSS).
 *
 * It plays the next show in the page's own native `<audio>`, inside the tap:
 * a page that navigated first would lose the gesture, and the browser would
 * refuse the sound. Then it tells the page's Play button (SHOW_SWITCH_EVENT),
 * which counts the next show's listen from there (show-page-listen.ts).
 * Once this show has ended, the card says so.
 */

type State = "ready" | "ended" | "playing";

export function ShowNextPlay({
  audioId,
  sources,
  episodeId,
}: {
  audioId: string;
  /** The next show's sources, in order (archive.org, then the mirror). */
  sources: string[];
  episodeId: string | null;
}) {
  const [state, setState] = useState<State>("ready");

  useEffect(() => {
    const audio = document.getElementById(audioId) as HTMLAudioElement | null;
    if (!audio) return;
    const onEnded = () => setState((s) => (s === "ready" ? "ended" : s));
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [audioId]);

  const play = () => {
    const audio = document.getElementById(audioId) as HTMLAudioElement | null;
    if (!audio || state === "playing") return;
    audio.pause();
    for (const old of Array.from(audio.querySelectorAll("source"))) old.remove();
    for (const url of sources) {
      const s = document.createElement("source");
      s.src = url;
      s.type = "audio/mpeg";
      audio.appendChild(s);
    }
    audio.load();
    const detail: ShowSwitchDetail = { episodeId };
    audio.dispatchEvent(new CustomEvent(SHOW_SWITCH_EVENT, { detail }));
    // Inside the tap, nothing awaited first: the browser's own rule for sound.
    audio.play().catch(() => {});
    setState("playing");
  };

  return (
    <div className="hd-show-next-play flex flex-wrap items-center gap-3" data-state={state} data-testid="show-next-play">
      {state === "ended" ? <span className="text-hd-body text-desktop-gray">That was the show.</span> : null}
      {state === "playing" ? (
        <span className="text-hd-body text-desert-amber">Playing now, in the player above.</span>
      ) : (
        <button
          type="button"
          onClick={play}
          className="w98-raised-dark bg-raised-surface w98-font text-hd-body text-desert-amber px-4 min-h-touch inline-flex items-center gap-2 cursor-pointer"
        >
          <span aria-hidden="true">▶</span>
          <span>Play next</span>
        </button>
      )}
    </div>
  );
}
