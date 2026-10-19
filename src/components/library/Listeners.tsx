"use client";

import { useMemo, useState } from "react";
import { Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";
import { useCommunityNow } from "@/hooks/useCommunityNow";
import { presenceAttrs } from "@/services/stats/now-feed";
import { TrafficStat } from "@/components/library/TrafficSummary";
import { useListeners } from "@/components/library/useListeners";
import type { PlaceBreakdown, StationRecords, TuneInEntry } from "@/services/stats/client";
import {
  TIER_FILL,
  US_TILES,
  US_TILE_COLS,
  US_TILE_ROWS,
  agoLabel,
  countsByCode,
  dayLabel,
  placeLabel,
  splitKnown,
  tileTier,
} from "@/lib/stats/places";

// The Listeners panel (docs/visitors.md): everyone counted once since the
// funnel began, where they tune in from, and the station's records. Renders
// nothing when the stats service is unavailable, like Signal Traffic.

export const PERIODS = [
  { key: "now", label: "Right now" },
  { key: "week", label: "This week" },
  { key: "allTime", label: "All time" },
] as const;
export type Period = (typeof PERIODS)[number]["key"];

const n = (v: number) => v.toLocaleString("en-US");

/** The United States as a grid of tiles, darker where more listeners are. */
function StateMap({ states }: { states: PlaceBreakdown["states"] }) {
  const counts = useMemo(() => countsByCode(states), [states]);
  const max = Math.max(0, ...counts.values());
  return (
    <div
      className="grid gap-[3px] w-full max-w-[420px]"
      style={{ gridTemplateColumns: `repeat(${US_TILE_COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${US_TILE_ROWS}, auto)` }}
      role="img"
      aria-label={
        counts.size === 0
          ? "Map of the United States: no states yet"
          : `Map of the United States: ${[...counts].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${v}`).join(", ")}`
      }
      data-testid="listeners-map"
    >
      {US_TILES.map(([code, col, row]) => {
        const v = counts.get(code) ?? 0;
        const tier = tileTier(v, max);
        return (
          <div
            key={code}
            data-state={code}
            data-tier={tier}
            title={v ? `${code}: ${n(v)}` : code}
            className={cn(
              "aspect-square flex items-center justify-center text-hd-micro tabular-nums select-none",
              tier === 0 ? "w98-inset-dark bg-inset-well text-bevel-dark/85" : "text-desktop-gray",
            )}
            style={{
              gridColumn: col + 1,
              gridRow: row + 1,
              ...(tier > 0 ? { background: `color-mix(in srgb, var(--hd-amber) ${TIER_FILL[tier]}, var(--hd-well))` } : {}),
              ...(tier >= 3 ? { color: "var(--hd-well)" } : {}),
            }}
            aria-hidden="true"
          >
            {code}
          </div>
        );
      })}
    </div>
  );
}

/** A ranked list with bars; the unknown bucket said once, below it. */
function PlaceList({
  title,
  rows,
  unknown,
  unit,
  limit = 8,
  testId,
}: {
  title: string;
  rows: { label: string; n: number }[];
  unknown: number;
  unit: string;
  limit?: number;
  testId: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit).reduce((s, r) => s + r.n, 0);
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <h3 className="text-hd-micro text-bevel-dark uppercase tracking-wider">{title}</h3>
      {shown.length === 0 ? (
        <div className="text-hd-caption text-bevel-dark/85">None placed yet.</div>
      ) : (
        <ol className="flex flex-col gap-1">
          {shown.map((r) => (
            <li key={r.label} className="flex items-center gap-2 text-hd-caption">
              <span className="w-[42%] min-w-0 truncate text-desktop-gray">{r.label}</span>
              <span className="flex-1 h-[8px] w98-inset-dark bg-inset-well relative" aria-hidden="true">
                <span
                  className="absolute inset-y-0 left-0 bg-desert-amber"
                  style={{ width: `${Math.max(4, (r.n / max) * 100)}%` }}
                />
              </span>
              <span className="w-[3.5em] text-right tabular-nums text-desert-amber">{n(r.n)}</span>
            </li>
          ))}
        </ol>
      )}
      {(rest > 0 || unknown > 0) && (
        <div className="text-hd-micro text-bevel-dark/85">
          {[rest > 0 ? `${n(rest)} more elsewhere` : null, unknown > 0 ? `${n(unknown)} ${unit} not placed` : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

function TuningInFeed({ entries }: { entries: TuneInEntry[] }) {
  const lines = entries.map((e) => ({ ...e, label: placeLabel(e) })).filter((e) => e.label);
  return (
    <div className="flex flex-col gap-1" data-testid="listeners-feed">
      <h3 className="text-hd-micro text-bevel-dark uppercase tracking-wider">Tuning in from</h3>
      {lines.length === 0 ? (
        <div className="text-hd-caption text-bevel-dark/85">Nobody has tuned in to the station lately.</div>
      ) : (
        <ul className="flex flex-col">
          {lines.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex items-baseline gap-2 text-hd-caption py-0.5">
              <span className={cn("w-[6px] h-[6px] rounded-full flex-shrink-0", i === 0 ? "bg-static-green animate-pulse" : "bg-bevel-dark/40")} aria-hidden="true" />
              <span className="flex-1 min-w-0 truncate text-desktop-gray">{e.label}</span>
              <span className="text-hd-micro text-bevel-dark/85 tabular-nums whitespace-nowrap">
                <time dateTime={e.at}>{agoLabel(e.at)}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Records({ records }: { records: StationRecords }) {
  const { biggestCrowd: crowd, biggestDay: day, biggestArrivalDay: arrivals, mostPlayed } = records;
  if (!crowd && !day && !arrivals && !mostPlayed) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="listeners-records">
      <h3 className="text-hd-micro text-bevel-dark uppercase tracking-wider">Records</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {crowd && (
          <div className="flex flex-col gap-0.5">
            <TrafficStat label="Biggest crowd" value={n(crowd.online)} color="text-static-green" />
            <span className="text-hd-micro text-bevel-dark/85 text-center">online at once, {dayLabel(crowd.day)}</span>
          </div>
        )}
        {day && (
          <div className="flex flex-col gap-0.5">
            <TrafficStat label="Biggest day" value={n(day.plays)} color="text-desert-amber" />
            <span className="text-hd-micro text-bevel-dark/85 text-center">plays, {dayLabel(day.day)}</span>
          </div>
        )}
        {arrivals && (
          <div className="flex flex-col gap-0.5">
            <TrafficStat label="Most new listeners" value={n(arrivals.visitors)} color="text-signal-blue" />
            <span className="text-hd-micro text-bevel-dark/85 text-center">in one day, {dayLabel(arrivals.day)}</span>
          </div>
        )}
      </div>
      {mostPlayed && (
        <div className="w98-inset-dark bg-inset-well p-2 flex items-baseline gap-2 text-hd-caption" data-testid="listeners-most-played">
          <span className="text-hd-micro text-bevel-dark uppercase tracking-wider whitespace-nowrap">Most played</span>
          <span className="flex-1 min-w-0 truncate text-desktop-gray">{mostPlayed.title ?? "A show no longer in the catalog"}</span>
          <span className="tabular-nums text-desert-amber whitespace-nowrap">{n(mostPlayed.plays)} plays</span>
        </div>
      )}
    </div>
  );
}

export function Listeners() {
  const { visitors, tuneIns, records, attribution, loading } = useListeners();
  const now = useCommunityNow();
  const [period, setPeriod] = useState<Period>("allTime");

  if (loading && !visitors) {
    return (
      <Window title="Listeners" variant="dark" headingLevel={2}>
        <div className="p-6 text-center">
          <span className="animate-dot-1 inline-block text-bevel-dark text-hd-caption">Counting heads</span>
        </div>
      </Window>
    );
  }
  if (!visitors) return null;

  const { totals } = visitors;
  const where = visitors.locations[period];
  const states = splitKnown(where.states, (s) => s.code ?? s.region);
  const countries = splitKnown(where.countries, (c) => c.country);
  const unit = period === "now" ? "here now" : "listeners";

  return (
    <Window title="Listeners" variant="dark" headingLevel={2}>
      <div className="p-3 flex flex-col gap-4" id="listeners">
        {/* The headline: one number, and what it counts from. */}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="flex flex-col">
            <span className="text-hd-display font-bold tabular-nums text-desert-amber leading-none" data-testid="listeners-total">
              {n(totals.visitors)}
            </span>
            <span className="text-hd-caption text-bevel-dark">
              listeners since {dayLabel(visitors.countingSince)}
            </span>
          </div>
          <p className="text-hd-caption text-bevel-dark flex flex-wrap gap-x-3">
            {!now.loading && (
              <span {...presenceAttrs("listeners", now)}>
                <strong className="text-static-green font-normal tabular-nums">{n(now.online)}</strong> here now
              </span>
            )}
            <span>
              <strong className="text-desktop-gray font-normal tabular-nums">{n(totals.activeThisWeek)}</strong> this week
            </span>
            <span>
              <strong className="text-desktop-gray font-normal tabular-nums">{n(totals.newThisWeek)}</strong> new this week
            </span>
            <span>
              <strong className="text-desktop-gray font-normal tabular-nums">{n(totals.returning)}</strong> came back another day
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Where listeners are, over">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              aria-pressed={period === key}
              className={cn(
                "px-2 py-1 md:py-0.5 text-hd-caption cursor-pointer transition-colors-fast min-h-[32px] md:min-h-0",
                period === key
                  ? "bg-desert-amber/15 text-desert-amber w98-inset-dark"
                  : "text-bevel-dark/85 hover:text-desktop-gray",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {period === "now" && where.total === 0 ? (
          <div className="w98-inset-dark bg-inset-well p-4 text-center text-hd-caption text-bevel-dark">
            Nobody is on the site this minute. The map fills in as people tune in.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-3">
              <StateMap states={where.states} />
              <PlaceList
                title="By state"
                testId="listeners-states"
                rows={states.known.map((s) => ({ label: s.region ?? s.code ?? "", n: s.n }))}
                unknown={states.unknown}
                unit={unit}
              />
            </div>
            <div className="flex flex-col gap-4">
              <PlaceList
                title="By country"
                testId="listeners-countries"
                rows={countries.known.map((c) => ({ label: c.name ?? c.country ?? "", n: c.n }))}
                unknown={countries.unknown}
                unit={unit}
              />
              <TuningInFeed entries={tuneIns} />
            </div>
          </div>
        )}

        {records && <Records records={records} />}

        {/* What the number is, said plainly: the funnel began on 27 Sep, the
            people from before it count once they come back, and the shows
            before location lookups have no place. */}
        <div className="text-hd-micro text-bevel-dark/85 flex flex-col gap-0.5">
          <span>
            Each browser counts once. Counting began {dayLabel(visitors.countingSince)}; listeners from before then count
            when they come back
            {totals.backfilled > 0 ? `, and ${n(totals.backfilled)} early listeners have no place on the map yet` : ""}.
          </span>
          {attribution && (
            <span>
              Locations are approximate, by state at most.{" "}
              <a href={attribution.url} target="_blank" rel="noopener noreferrer" className="text-signal-blue underline">
                {attribution.text}
              </a>
            </span>
          )}
        </div>
      </div>
    </Window>
  );
}
