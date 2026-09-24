"use client";

import { useState } from "react";
import { Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";
import {
  hourLabel,
  isNight,
  NIGHT_FROM,
  NIGHT_TO,
  TRAFFIC_RANGES,
  type TrafficRange,
} from "@/lib/library/traffic";
import { TrafficChart } from "@/components/library/TrafficChart";
import { TrafficHourProfile } from "@/components/library/TrafficHourProfile";
import {
  TrafficLegend,
  TrafficStat,
  TrafficSummary,
} from "@/components/library/TrafficSummary";
import { useTraffic } from "@/components/library/useTraffic";
import { useCommunityNow } from "@/hooks/useCommunityNow";
import { presenceAttrs } from "@/services/stats/now-feed";

// The panel. Its parts were split out under HD-018: the geometry and labels
// are pure (src/lib/library/traffic.ts), the chart, hour profile and summary
// are siblings, and the fetch is useTraffic.

/**
 * Public traffic history — the click-through target for the live count in the
 * status bar.
 *
 * Renders nothing at all when the stats service is unavailable or has yet to
 * collect a sample, rather than showing an empty chart frame: with
 * DATABASE_URL unset every /api/stats/* route 503s by design.
 */
export function SignalTraffic() {
  const [range, setRange] = useState<TrafficRange>("24h");
  const { traffic, loading } = useTraffic(range);
  const now = useCommunityNow();

  if (loading && !traffic) {
    return (
      <Window title="Signal Traffic" variant="dark" headingLevel={2}>
        <div className="p-6 text-center">
          <span className="animate-dot-1 inline-block text-bevel-dark text-hd-caption">
            Reading the logs
          </span>
        </div>
      </Window>
    );
  }

  if (!traffic) return null;

  const hasHistory = traffic.points.length > 1;
  const rangeLabel = TRAFFIC_RANGES.find((r) => r.key === range)?.label ?? range;

  return (
    <Window title="Signal Traffic" variant="dark" headingLevel={2}>
      <div className="p-3 flex flex-col gap-3" id="traffic">
        {/* Range switcher */}
        <div className="flex items-center gap-1" role="group" aria-label="Time range">
          {TRAFFIC_RANGES.map(({ key, label, short }) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              aria-pressed={range === key}
              className={cn(
                "px-2 py-1 md:py-0.5 text-hd-caption cursor-pointer transition-colors-fast min-h-[32px] md:min-h-0",
                range === key
                  ? "bg-desert-amber/15 text-desert-amber w98-inset-dark"
                  : "text-bevel-dark/85 hover:text-desktop-gray",
              )}
            >
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{short}</span>
            </button>
          ))}
        </div>

        {/* The headline in a sentence. A grid of integers makes a reader do the
            interpreting; this states the finding and lets the tiles below back
            it up. */}
        {/* The current value. Read from the same feed as the status bar and
            On Air, never from the newest sample: a sample is up to two
            minutes old and would put a third number on the same screen. */}
        {!now.loading && (
          <p className="text-hd-caption text-bevel-dark" {...presenceAttrs("signal-traffic", now)}>
            Right now:{" "}
            <strong className="text-static-green font-normal tabular-nums">{now.online}</strong> online
            {" · "}
            <strong className="text-signal-blue font-normal tabular-nums">{now.listening}</strong> listening
          </p>
        )}

        <TrafficSummary traffic={traffic} rangeLabel={rangeLabel} range={range} />

        {hasHistory ? (
          <>
            <TrafficChart points={traffic.points} range={range} />
            <div className="flex items-center gap-3 flex-wrap">
              <TrafficLegend color="var(--hd-green)" label="Online" />
              <TrafficLegend color="var(--hd-blue)" label="Listening" />
              <TrafficLegend color="var(--hd-amber)" label="Plays" block />
              {/* Only explain the shading when some of it is on screen —
                  a legend for an absent band reads as a rendering fault. */}
              {traffic.points.some((p) => isNight(new Date(p.t))) && (
                <span className="text-hd-micro text-bevel-dark/85">
                  shaded = {hourLabel(NIGHT_FROM)}–{hourLabel(NIGHT_TO)}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="w98-inset-dark bg-inset-well p-6 text-center">
            <div className="text-hd-caption text-desktop-gray mb-1">Not enough history yet.</div>
            <div className="text-hd-caption text-bevel-dark/85 max-w-[320px] mx-auto">
              Traffic is sampled every couple of minutes. Check back shortly —
              the chart appears once there are at least two samples in range.
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <TrafficStat label="Peak online" value={traffic.peakOnline.toLocaleString()} color="text-static-green" />
          <TrafficStat label="Peak listening" value={traffic.peakListening.toLocaleString()} color="text-signal-blue" />
          <TrafficStat label="Plays in range" value={traffic.playsInRange.toLocaleString()} color="text-desert-amber" />
          <TrafficStat label="Plays all time" value={traffic.totalPlays.toLocaleString()} color="text-desktop-gray" />
        </div>
        {/* Plays all time is the per-episode counter, which predates the
            timestamped event log (play_events starts 2026-07-28). Every range
            total comes from the log, so no range can add up to it — said here
            rather than left to look like an error (docs/stats-audit.md). */}
        <div className="text-hd-caption text-bevel-dark/85">
          Plays all time includes plays counted before per-play timestamps began on 28 Jul 2026;
          range totals start there.
        </div>

        {traffic.hourly.length > 0 && <TrafficHourProfile hourly={traffic.hourly} />}
      </div>
    </Window>
  );
}
