"use client";

import { useEffect, useState } from "react";
import { Window } from "@/components/win98";
import { HowWeCount } from "@/components/stats/HowWeCount";
import { useCommunityKeyIndex } from "@/hooks/useCommunityKeyIndex";
import { keyTitle } from "@/lib/library/display-title";
import { fetchRatingsReport, type RatingsReport as Report } from "@/services/stats/client";

/** "Nov 28" for the instant finishes are counted from. */
export function sinceLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "7 at the peak, about twice a typical day (3)" style, from real numbers only. */
export function crowdLine(crowd: NonNullable<Report["crowd"]>): string {
  const { peak, typical } = crowd;
  const people = (n: number) => `${n} ${n === 1 ? "listener" : "listeners"}`;
  if (typical <= 0) return `${people(peak)} at the peak in the last 12 hours`;
  const ratio = peak / typical;
  const vs = ratio >= 1.15 ? "above" : ratio <= 0.85 ? "below" : "about level with";
  return `${people(peak)} at the peak in the last 12 hours, ${vs} a typical day's ${typical}`;
}

/**
 * The Station tab's ratings report (UI plan push 6, batch 4): tonight's crowd
 * against a typical day, the hottest show this week, states tuning in for the
 * first time, then Most played this week beside Most finished. Every line is
 * from the server's own counts and is left out when there is not enough yet.
 */
export function RatingsReport() {
  const [report, setReport] = useState<Report | null | undefined>(undefined);
  const index = useCommunityKeyIndex();

  useEffect(() => {
    let live = true;
    void fetchRatingsReport().then((r) => live && setReport(r));
    return () => {
      live = false;
    };
  }, []);

  if (report === null) return null; // no database: the rest of the tab says so
  const title = (id: string, catalog?: string | null) => keyTitle(index.get(id), id, catalog);
  const week = report?.week ?? [];
  const hottest = week[0];

  return (
    <Window title="Ratings Report" variant="dark" headingLevel={2}>
      <div className="p-3 flex flex-col gap-3" data-testid="ratings-report">
        {report === undefined ? (
          <p className="text-hd-11 text-bevel-dark">Reading the week&apos;s numbers...</p>
        ) : (
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {report.crowd && (
              <div data-report="crowd">
                <dt className="text-hd-10 text-desert-amber uppercase tracking-wider font-bold">Tonight&apos;s crowd</dt>
                <dd className="text-hd-12 text-desktop-gray mt-0.5">{crowdLine(report.crowd)}</dd>
              </div>
            )}
            {hottest && (
              <div data-report="hottest">
                <dt className="text-hd-10 text-desert-amber uppercase tracking-wider font-bold">Hottest show this week</dt>
                <dd className="text-hd-12 text-desktop-gray mt-0.5">
                  {title(hottest.episodeId, hottest.title)}
                  <span className="text-bevel-dark"> · {hottest.plays} plays</span>
                </dd>
              </div>
            )}
            <div data-report="new-states">
              <dt className="text-hd-10 text-desert-amber uppercase tracking-wider font-bold">New states this week</dt>
              <dd className="text-hd-12 text-desktop-gray mt-0.5">
                {report.newStates.length > 0 ? report.newStates.map((s) => s.region).join(", ") : "None new this week"}
              </dd>
            </div>
          </dl>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <section aria-labelledby="report-played-h" data-report="most-played">
            <h3 id="report-played-h" className="text-hd-10 text-desert-amber uppercase tracking-wider font-bold mb-1">
              Most played this week
            </h3>
            {report === undefined ? null : week.length === 0 ? (
              <p className="text-hd-11 text-bevel-dark">No plays this week yet.</p>
            ) : (
              <ol className="flex flex-col gap-0.5">
                {week.map((e, i) => (
                  <li key={e.episodeId} className="flex gap-2 text-hd-11" data-row={e.episodeId}>
                    <span className="tabular-nums text-bevel-dark w-4 text-right">{i + 1}</span>
                    <span className="flex-1 truncate text-desktop-gray">{title(e.episodeId, e.title)}</span>
                    <span className="tabular-nums text-bevel-dark">{e.plays}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          {report && (
            <section aria-labelledby="report-finished-h" data-report="most-finished">
              <h3 id="report-finished-h" className="text-hd-10 text-desert-amber uppercase tracking-wider font-bold mb-1">
                Most finished
              </h3>
              {report.finished.entries.length === 0 ? (
                <p className="text-hd-11 text-bevel-dark">
                  Counting since {sinceLabel(report.finished.since)}. A show appears here once{" "}
                  {report.finished.minPlays} listeners have started it.
                </p>
              ) : (
                <ol className="flex flex-col gap-0.5">
                  {report.finished.entries.map((e, i) => (
                    <li key={e.episodeId} className="flex gap-2 text-hd-11" data-row={e.episodeId} data-share={e.share}>
                      <span className="tabular-nums text-bevel-dark w-4 text-right">{i + 1}</span>
                      <span className="flex-1 truncate text-desktop-gray">{title(e.episodeId, e.title)}</span>
                      <span className="tabular-nums text-bevel-dark" title={`${e.finishes} of ${e.plays} reached the end`}>
                        {Math.round(e.share * 100)}%
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>
        {report && (
          <HowWeCount id="report">
            <p>
              Tonight&apos;s crowd is the most people online at once in the last 12 hours, beside the middle of the daily
              peaks of the 28 days before today.
            </p>
            <p>Most played this week counts plays started in the last 7 days. New states are ones nobody had tuned in from before this week.</p>
            <p>
              Most finished is the share of plays that reached the end of the show, counted since{" "}
              {sinceLabel(report.finished.since)}, for shows with at least {report.finished.minPlays} plays since then.
            </p>
            <p>Automated visitors and our own checks are not counted. Nothing here names a listener.</p>
          </HowWeCount>
        )}
      </div>
    </Window>
  );
}
