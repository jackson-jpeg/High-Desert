"use client";

import { useEffect, useRef, useState } from "react";
import { useAppPathname } from "@/hooks/useAppPathname";
import { cn } from "@/lib/utils/cn";
import { useLook } from "@/hooks/useLook";
import { useOnAirSlot } from "@/hooks/useLiveStation";
import { useLiveStore } from "@/stores/live-store";
import { tuneIn } from "@/audio/live-controller";
import { episodeTitle } from "@/lib/library/display-title";
import type { ProgramSlot } from "@/lib/live/schedule";

/**
 * The player with nothing loaded (it used to draw nothing at all): what is on
 * the station now, and one tap to tune in. `tuneIn()` runs inside the tap, so
 * the browser lets audio start. The program comes from the shared live store
 * through `useOnAirSlot` (the same reader as the dial's ON AIR lamp), never a
 * poller of its own.
 *
 * Not on the Live screen: that screen is the station, and on a phone its
 * Listen live card is the one tune-in control (docs/funnel.md).
 *
 * It is the station's front door on every other screen, so it is drawn as a
 * lit tuning display (docs/UI-PLAN.md, push 1): an ON AIR lamp that breathes,
 * phosphor text behind scanlines on curved glass, the show's year, and a
 * marquee that carries the whole line when it does not fit (still with
 * reduced motion, paused on hover and focus: src/styles/ticker.css). Win98
 * keeps Winamp's green LCD; Night glows in its amber.
 */
export function PlayerEmptyState() {
  const pathname = useAppPathname();
  const look = useLook();
  const slot = useOnAirSlot();
  const haveProgram = useLiveStore((s) => s.schedule !== null);
  if (pathname === "/live") return null;
  return <OnAirStrip look={look} slot={slot} canTune={haveProgram} />;
}

/** What the strip says: the show on the air, its guest, or the gap between shows. */
export function onAirLine(slot: ProgramSlot | null, haveProgram: boolean): { title: string; guest: string | null } {
  if (slot) return { title: episodeTitle({ title: slot.title, fileName: "" }), guest: slot.guestName };
  if (haveProgram) return { title: "Between shows. The next one starts in a moment.", guest: null };
  return { title: "Nothing playing. Pick a show from the Library.", guest: null };
}

/** The year the show on the air first aired ("1996"), or null. */
export function airYear(slot: ProgramSlot | null): string | null {
  return (slot?.airDate && /^(\d{4})-/.exec(slot.airDate)?.[1]) || null;
}

/**
 * True while the line is wider than its window: only then does the marquee
 * run, so a short line on a wide desktop strip stays put.
 */
function useOverflows(text: string) {
  const windowRef = useRef<HTMLSpanElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const win = windowRef.current;
    const line = lineRef.current;
    if (!win || !line) return;
    const measure = () => setOverflows(line.scrollWidth > win.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(win);
    return () => ro.disconnect();
  }, [text]);
  return { windowRef, lineRef, overflows };
}

function Line({ title, guest, year }: { title: string; guest: string | null; year: string | null }) {
  return (
    <>
      {title}
      {guest && <span className="hd-ticker-guest"> with {guest}</span>}
      {year && <span className="hd-ticker-year"> · {year}</span>}
    </>
  );
}

function OnAirStrip({ look, slot, canTune }: { look: "win98" | "night"; slot: ProgramSlot | null; canTune: boolean }) {
  const line = onAirLine(slot, canTune);
  const year = airYear(slot);
  const { windowRef, lineRef, overflows } = useOverflows(`${line.title}|${line.guest}|${year}`);
  const win98 = look === "win98";
  const size = win98 ? "text-hd-caption" : "text-hd-body md:text-hd-caption";

  return (
    <div
      data-testid="player-empty"
      data-look-variant={look}
      className={cn(
        "hd-ticker flex items-center",
        win98
          ? "hd-w98-idle gap-2 px-2 py-1 w98-font"
          : "hd-night-ticker gap-3 px-3 py-2 md:py-1.5 glass-light glass-promote md:bg-midnight/80 md:border-t md:border-bevel-dark/15",
      )}
    >
      <div className={cn("hd-ticker-glass flex-1 min-w-0 flex items-center gap-2", win98 ? "hd-w98-idle-lcd px-2 py-[3px]" : "px-3 py-1.5")}>
        <span className="hd-ticker-lamp flex-shrink-0" data-on-air={slot ? "" : undefined} aria-hidden="true" />
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <span className="hd-ticker-label text-hd-micro uppercase tracking-wider">{slot ? "On the air now" : "High Desert Live"}</span>
          <span
            ref={windowRef}
            className="hd-ticker-window block overflow-hidden whitespace-nowrap"
            data-overflows={overflows ? "" : undefined}
          >
            <span ref={lineRef} className="hd-ticker-track inline-block">
              <span className={cn("hd-ticker-half", size)}>
                <span className="hd-ticker-text" data-testid="player-empty-title">
                  <Line title={line.title} guest={line.guest} year={null} />
                </span>
                {year && <span className="hd-ticker-year"> · {year}</span>}
              </span>
              {overflows && (
                <span className={cn("hd-ticker-half hd-ticker-copy", size)} aria-hidden="true">
                  <Line title={line.title} guest={line.guest} year={year} />
                </span>
              )}
            </span>
          </span>
        </div>
      </div>
      {canTune && (
        <button
          type="button"
          onClick={() => tuneIn()}
          data-testid="player-empty-tune"
          className={cn(
            "flex-shrink-0 cursor-pointer font-bold",
            win98
              ? "hd-w98-idle-tune w98-raised-dark bg-raised-surface text-hd-12 px-3 min-h-touch md:min-h-[26px]"
              : "hd-night-ticker-tune min-h-touch md:min-h-[30px] px-4 rounded-full bg-desert-amber text-midnight text-hd-body md:text-hd-caption",
          )}
        >
          Tune in
        </button>
      )}
    </div>
  );
}
