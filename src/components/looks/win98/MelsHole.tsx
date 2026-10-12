"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Dialog } from "@/components/win98/Dialog";
import { Button } from "@/components/win98/Button";
import { db } from "@/db";
import { emit } from "@/lib/events";
import { formatAirDate } from "@/lib/utils/format";
import { episodeTitle } from "@/lib/library/display-title";
import { useOpenLibraryIntent } from "@/hooks/useOpenLibraryIntent";
import { cn } from "@/lib/utils/cn";
import {
  depthStatus,
  FEET_PER_PRESS,
  formatFeet,
  formatMiles,
  isMelsHoleShow,
  lineOut,
  MEL_LINE_FEET,
  MELS_HOLE_LORE,
} from "./mels-hole";

const REDUCED = "(prefers-reduced-motion: reduce)";

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia?.(REDUCED);
      mq?.addEventListener?.("change", cb);
      return () => mq?.removeEventListener?.("change", cb);
    },
    () => window.matchMedia?.(REDUCED).matches ?? false,
    () => false,
  );
}

/**
 * Mel's Hole: a hidden program in the Win98 look (open it from Start, Run...,
 * with `melshole`, or by typing `hole` with nothing focused). A reel pays
 * weighted line down a shaft and the counter never reports a bottom. The
 * story is the caller's, told as lore (mels-hole.ts). With reduced motion the
 * shaft is still and the line goes down only by the button.
 */
export function MelsHole({ onClose }: { onClose: () => void }) {
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [reeling, setReeling] = useState(true);
  const started = useRef<number | null>(null);
  const banked = useRef(0);
  const openLibrary = useOpenLibraryIntent();

  // The reel: ten counter updates a second, from the clock, not from frames.
  useEffect(() => {
    if (reduced || !reeling) return;
    started.current = performance.now();
    const id = setInterval(() => {
      if (started.current !== null) setElapsed(banked.current + performance.now() - started.current);
    }, 100);
    return () => {
      clearInterval(id);
      if (started.current !== null) banked.current += performance.now() - started.current;
      started.current = null;
    };
  }, [reduced, reeling]);

  const feet = lineOut(reduced ? 0 : elapsed, pressed);
  const shows = useLiveQuery(async () => {
    const rows = await db.episodes.filter((ep) => isMelsHoleShow(ep)).toArray();
    return rows.sort((a, b) => (a.airDate ?? "").localeCompare(b.airDate ?? ""));
  }, []);

  return (
    <Dialog open onClose={onClose} title="Mel's Hole" width="680px">
      <div className="flex flex-col md:flex-row gap-3 p-2" data-testid="w98-mels-hole">
        <div
          className={cn("hd-w98-hole w98-inset-dark flex-shrink-0", (reduced || !reeling) && "hd-w98-hole-still")}
          aria-hidden="true"
        >
          <div className="hd-w98-hole-shaft" />
          <div className="hd-w98-hole-line" />
          <div className="hd-w98-hole-weight" />
        </div>
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <div className="w98-inset-dark bg-black px-3 py-2 flex flex-col gap-0.5" role="status" aria-live="off">
            <span className="hd-w98-hole-counter tabular-nums" data-testid="w98-hole-feet">
              {formatFeet(feet)}
            </span>
            <span className="hd-w98-hole-sub tabular-nums">
              {formatMiles(feet)} of line out. {depthStatus(feet)}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="dark" onClick={() => setPressed((p) => p + FEET_PER_PRESS)} data-testid="w98-hole-lower">
              Lower more line
            </Button>
            {!reduced && (
              <Button variant="dark" onClick={() => setReeling((r) => !r)} aria-pressed={!reeling}>
                {reeling ? "Hold the reel" : "Let it run"}
              </Button>
            )}
          </div>
          <div className="text-hd-12 leading-relaxed flex flex-col gap-1">
            {MELS_HOLE_LORE.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {feet >= MEL_LINE_FEET && (
              <p className="text-desert-amber" data-testid="w98-hole-past">
                You have now lowered more line than he said he had.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-hd-12 font-bold">The calls, in the archive</span>
            <ul className="w98-inset-dark bg-inset-well max-h-[140px] overflow-auto p-[2px]" data-testid="w98-hole-shows">
              {shows === undefined && <li className="px-1 text-hd-12">Looking...</li>}
              {shows?.length === 0 && <li className="px-1 text-hd-12">None of the Mel Waters shows are in this library.</li>}
              {shows?.map((ep) => (
                <li key={ep.fileHash}>
                  <button
                    type="button"
                    className="hd-w98-list-item w-full text-left flex gap-2 px-1 py-[2px] min-h-touch md:min-h-0 text-hd-12 cursor-pointer"
                    onClick={() => {
                      emit("play-episode", ep);
                      onClose();
                    }}
                    title={`Play ${episodeTitle(ep)}`}
                  >
                    <span className="tabular-nums flex-shrink-0">{formatAirDate(ep.airDate)}</span>
                    <span className="truncate">{episodeTitle(ep)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="dark"
              onClick={() => {
                openLibrary({ q: "mels hole" });
                onClose();
              }}
            >
              Find in Library
            </Button>
            <Button variant="dark" onClick={onClose}>
              Reel in
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
