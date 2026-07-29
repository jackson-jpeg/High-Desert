"use client";

import { useEffect, useState } from "react";
import { Window, Button } from "@/components/win98";

/**
 * Which shows are failing to start, worst first. Admin-only panel on /stats.
 *
 * The point of this is to convert "it is a bit consistent for me" into a list
 * of specific episodes. A listener can only ever tell us that *something* is
 * wrong; this tells us which file, on which kind of device, and whether the
 * automatic retry rescued it.
 *
 * A `recovered` count that is high relative to failures means the retry is
 * doing its job and nobody is seeing a problem — worth knowing, and not a
 * reason to go looking for a bad file.
 */

interface FailureEntry {
  episodeId: string;
  title: string | null;
  failures: number;
  recovered: number;
  plays: number;
  rate: number | null;
  kinds: Record<string, number>;
  uaClasses: Record<string, number>;
  lastAt: string;
}

const RANGES = [7, 30, 90] as const;

export function PlaybackFailures() {
  const [days, setDays] = useState<number>(7);
  // One state object stamped with the range it belongs to, so switching range
  // derives "loading" from a stale stamp rather than needing a setState on the
  // effect's synchronous path.
  const [result, setResult] = useState<{
    days: number;
    entries: FailureEntry[] | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/stats/failures?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!cancelled) setResult({ days, entries: data.entries ?? [] });
      })
      .catch(() => {
        // 503 without DATABASE_URL is the documented degraded mode, not an
        // error worth shouting about. `entries: null` means unavailable.
        if (!cancelled) setResult({ days, entries: null });
      });

    return () => {
      cancelled = true;
    };
  }, [days]);

  const fresh = result?.days === days ? result : null;
  const entries = fresh?.entries ?? null;
  const unavailable = fresh !== null && fresh.entries === null;

  if (unavailable) return null;
  // Nothing failing is the expected state. An empty box every day would train
  // the eye to skip it, and then it would be skipped on the day it mattered.
  if (entries && entries.length === 0 && days === 7) return null;

  return (
    <Window title="Playback Failures" variant="dark" headingLevel={2}>
      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          {RANGES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={r === days ? "dark" : undefined}
              onClick={() => setDays(r)}
              aria-pressed={r === days}
            >
              {r}d
            </Button>
          ))}
        </div>

        {entries === null ? (
          <div className="text-hd-caption text-bevel-dark">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="text-hd-caption text-bevel-dark">
            No failures recorded in this window.
          </div>
        ) : (
          <div className="flex flex-col gap-[3px] max-h-[260px] overflow-auto overscroll-contain">
            {entries.map((e) => (
              <div
                key={e.episodeId}
                className="px-2 py-1.5 w98-raised-dark bg-card-surface flex flex-col gap-1"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-hd-caption text-desktop-gray truncate flex-1 min-w-0">
                    {e.title ?? e.episodeId}
                  </span>
                  <span className="text-hd-caption text-red-400/85 tabular-nums flex-shrink-0">
                    {e.failures}
                  </span>
                </div>
                <div className="text-hd-micro text-bevel-dark/85 flex flex-wrap gap-x-3 gap-y-0.5">
                  {e.rate != null && <span>{Math.round(e.rate * 100)}% of attempts</span>}
                  <span>{e.plays} played</span>
                  {e.recovered > 0 && <span>{e.recovered} recovered on retry</span>}
                  <span>
                    {Object.entries(e.kinds)
                      .map(([k, n]) => `${k}×${n}`)
                      .join(" ")}
                  </span>
                  <span>{Object.keys(e.uaClasses).join(", ")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Window>
  );
}
