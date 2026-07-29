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
  skippedRetries: number;
  plays: number;
  rate: number | null;
  kinds: Record<string, number>;
  uaClasses: Record<string, number>;
  /** What the browser itself said — `MediaError.code` plus its message. */
  details: string[];
  lastAt: string;
}

interface FailureSummary {
  failures: number;
  recovered: number;
  skippedRetries: number;
  retriedAndFailed: number;
  episodes: number;
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
    summary: FailureSummary | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/stats/failures?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!cancelled)
          setResult({
            days,
            entries: data.entries ?? [],
            summary: data.summary ?? null,
          });
      })
      .catch(() => {
        // 503 without DATABASE_URL is the documented degraded mode, not an
        // error worth shouting about. `entries: null` means unavailable.
        if (!cancelled) setResult({ days, entries: null, summary: null });
      });

    return () => {
      cancelled = true;
    };
  }, [days]);

  const fresh = result?.days === days ? result : null;
  const entries = fresh?.entries ?? null;
  const summary = fresh?.summary ?? null;
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

        {/*
          Site-wide, not a sum of the rows below — that list is capped at 50
          episodes. `skipped` is the instrument for the user-activation gate:
          a retry that was not attempted because there was no gesture to call
          play() with, so the listener got the dialog instead of a silent
          teardown. Rising is expected; it is the intended behaviour becoming
          visible, not a regression.
        */}
        {summary && summary.failures > 0 && (
          <div className="px-2 py-1.5 w98-inset-dark bg-card-surface flex flex-wrap gap-x-3 gap-y-0.5 text-hd-micro text-bevel-dark">
            <span className="text-desktop-gray tabular-nums">
              {summary.failures} total
            </span>
            <span className="tabular-nums">{summary.episodes} episodes</span>
            <span className="tabular-nums">{summary.recovered} recovered</span>
            <span className="tabular-nums">
              {summary.retriedAndFailed} retried, still failed
            </span>
            <span
              className="tabular-nums text-signal-blue"
              title="Retry skipped: no user gesture to call play() with, so the dialog was raised instead of tearing the element down"
            >
              {summary.skippedRetries} retry skipped, dialog shown
            </span>
          </div>
        )}

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
                  {e.skippedRetries > 0 && (
                    <span className="text-signal-blue">
                      {e.skippedRetries} retry skipped
                    </span>
                  )}
                  <span>
                    {Object.entries(e.kinds)
                      .map(([k, n]) => `${k}×${n}`)
                      .join(" ")}
                  </span>
                  <span>{Object.keys(e.uaClasses).join(", ")}</span>
                </div>
                {/*
                  What the browser itself said. On Chromium this is the only
                  thing that separates an empty file from an unreachable one —
                  it errors on the missing frames rather than reporting a short
                  duration, so the duration guard cannot fire there at all.
                  Stored since the detail column shipped and readable only via
                  psql until now.
                */}
                {e.details.length > 0 && (
                  <div className="text-hd-micro text-bevel-dark/85 font-mono flex flex-col gap-0.5">
                    {e.details.map((d) => (
                      <span key={d} className="truncate" title={d}>
                        {d}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Window>
  );
}
