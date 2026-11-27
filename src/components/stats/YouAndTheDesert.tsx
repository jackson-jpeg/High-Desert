"use client";

import { useMemo } from "react";
import type { Episode, HistoryEntry } from "@/db/schema";
import { Window } from "@/components/win98";
import { useCommunityCatalog } from "@/hooks/useCommunityCatalog";
import { youAndTheDesert } from "@/lib/stats/you-and-desert";
import { formatHeard } from "@/lib/stats/format-heard";

/** The You tab's comparison with everyone else (UI plan push 6, batch 4). */
export function YouAndTheDesert({ episodes, history }: { episodes: Episode[]; history: HistoryEntry[] }) {
  const community = useCommunityCatalog();
  const d = useMemo(() => youAndTheDesert(episodes, history, community), [episodes, history, community]);
  if (d.catalog === 0) return null;
  const pct = d.heard > 0 ? Math.max(1, Math.round((d.heard / d.catalog) * 100)) : 0;

  return (
    <Window title="You and the desert" variant="dark" headingLevel={2}>
      <div className="p-3 flex flex-col gap-2 text-hd-12 text-desktop-gray" data-testid="you-and-desert">
        <p data-you="heard">
          You&apos;ve heard <strong className="tabular-nums">{d.heard.toLocaleString()}</strong> of{" "}
          <span className="tabular-nums">{d.catalog.toLocaleString()}</span> shows
          {d.heard > 0 && <span className="text-bevel-dark"> ({pct}%)</span>}.
        </p>
        {d.yourGuest ? (
          <p data-you="guest">
            Your top guest: <strong>{d.yourGuest.name}</strong>
            <span className="text-bevel-dark"> ({formatHeard(d.yourGuest.seconds)} heard)</span>
            {d.stationGuest &&
              (d.stationGuest.name === d.yourGuest.name ? (
                <span>, the station&apos;s too.</span>
              ) : (
                <span>
                  . The station&apos;s: <strong>{d.stationGuest.name}</strong>
                  <span className="text-bevel-dark"> ({d.stationGuest.plays.toLocaleString()} plays)</span>.
                </span>
              ))}
          </p>
        ) : (
          d.stationGuest && (
            <p data-you="guest">
              The station&apos;s top guest: <strong>{d.stationGuest.name}</strong>
              <span className="text-bevel-dark"> ({d.stationGuest.plays.toLocaleString()} plays)</span>. Listen to a show
              with a guest for a minute and yours shows up here.
            </p>
          )
        )}
      </div>
    </Window>
  );
}
