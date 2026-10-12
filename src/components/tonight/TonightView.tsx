import Link from "next/link";
import { ShowList } from "@/components/shows/ShowView";
import { LocalTime } from "@/components/tonight/LocalTime";
import { headlineGuest, longDate, showPath, showSubject } from "@/lib/shows/describe";
import { breadcrumbJsonLd, jsonLdScript, tonightCrumbs, tonightJsonLd } from "@/lib/shows/jsonld";
import { formatStationTime } from "@/lib/live/format";
import { addDays } from "@/lib/live/schedule";
import { SLOT_LABELS, monthDayName, tonightDate, tonightPath, type tonightPage } from "@/lib/tonight/tonight";

/**
 * A Tonight page (docs/show-pages.md, "Tonight"): the station's program for
 * one Pacific day with why each show is worth hearing, every broadcast that
 * aired on that date, and a big way into Live. Server-rendered in the show
 * pages' frame; the only client piece is each time's "your time" beside the
 * Pacific one.
 */

const link = "text-signal-blue hover:text-desktop-gray transition-colors-fast";

export function TonightView({
  day,
  today,
  page,
  available,
  prev,
  next,
}: {
  day: string;
  today: string;
  page: ReturnType<typeof tonightPage>;
  available: boolean;
  prev: boolean;
  next: boolean;
}) {
  const date = tonightDate(day);
  const crumbs = tonightCrumbs(day, date);
  const when = day === today ? "Tonight" : day < today ? "That night" : "Tomorrow";
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(tonightJsonLd(day, page.title, page.description, page.listed)) }}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(crumbs)) }} />
      <nav aria-label="Breadcrumb" className="hd-show-crumbs text-hd-caption text-bevel-dark mb-3">
        <ol className="flex flex-wrap items-center gap-1">
          {crumbs.slice(0, -1).map((c) => (
            <li key={c.name} className="flex items-center gap-1">
              <Link href={c.path!} className={link}>
                {c.name}
              </Link>
              <span aria-hidden="true">›</span>
            </li>
          ))}
          <li aria-current="page">{date}</li>
        </ol>
      </nav>

      <article className="hd-show-article hd-tonight w98-raised-dark bg-raised-surface p-4 md:p-6" data-tonight-day={day}>
        <p className="hd-show-series text-hd-caption uppercase tracking-wider text-desert-amber mb-1">{when} on High Desert</p>
        <h1 className="hd-show-title w98-font text-hd-h2 text-desktop-gray leading-tight">{date}</h1>
        <p className="hd-tonight-intro text-hd-body text-desktop-gray mt-3 leading-relaxed">
          High Desert Live is one station, Art Bell around the clock, heard by everyone at the same second. Each day it
          plays the shows that first aired on that date, then the ones listeners play most.
        </p>
        <div className="hd-show-player w98-inset-dark bg-inset-well p-3 mt-4 flex flex-col md:flex-row md:items-center gap-3">
          <Link
            href="/live"
            className="hd-tonight-tune w98-raised-dark bg-raised-surface w98-font text-hd-h3 text-desert-amber px-5 min-h-[56px] inline-flex items-center justify-center gap-3"
          >
            <span aria-hidden="true">▶</span>
            <span>Tune in to the station now</span>
          </Link>
          <p className="text-hd-caption text-bevel-dark">Free, no sign-up. The phone lines are open beside the player.</p>
        </div>
        <nav aria-label="Other days" className="hd-tonight-days flex flex-wrap gap-4 mt-4 text-hd-caption">
          {prev ? (
            <Link href={tonightPath(addDays(day, -1))} className={`${link} min-h-touch md:min-h-0 inline-flex items-center`}>
              ‹ {monthDayName(addDays(day, -1))}
            </Link>
          ) : null}
          {next ? (
            <Link href={tonightPath(addDays(day, 1))} className={`${link} min-h-touch md:min-h-0 inline-flex items-center`}>
              {monthDayName(addDays(day, 1))} ›
            </Link>
          ) : null}
        </nav>
      </article>

      <section className="hd-show-related hd-tonight-program mt-8" aria-labelledby="hd-tonight-program">
        <h2 id="hd-tonight-program" className="hd-show-related-title w98-font text-hd-title text-desert-amber mb-1">
          The program, midnight to midnight Pacific
        </h2>
        {page.lineup.length ? (
          <ol className="hd-show-list hd-tonight-lineup flex flex-col gap-1">
            {page.lineup.map((e) => (
              <li key={`${e.start}-${e.title}`} className="hd-show-list-item hd-tonight-slot py-2" data-kind={e.kind}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-hd-caption text-bevel-dark">
                  <LocalTime ms={e.start} pacific={formatStationTime(e.start)} />
                  <span className="hd-tonight-kind uppercase tracking-wider text-desert-amber">{SLOT_LABELS[e.kind]}</span>
                </div>
                {e.show ? (
                  <Link href={showPath(e.show.slug)} className={`hd-tonight-show text-hd-body ${link}`}>
                    {showSubject(e.show.row)}
                    {headlineGuest(e.show.row) ? <span className="text-desktop-gray"> with {headlineGuest(e.show.row)}</span> : null}
                    <span className="text-bevel-dark text-hd-caption"> · {longDate(e.show.row.airDate)}</span>
                  </Link>
                ) : (
                  <span className="text-hd-body text-desktop-gray">{e.title}</span>
                )}
                {e.why ? <p className="hd-tonight-why text-hd-caption text-desktop-gray mt-0.5 leading-relaxed">{e.why}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="hd-tonight-none text-hd-body text-desktop-gray p-2">
            {available
              ? "The station has not set this day's program yet."
              : "The station's program cannot be read right now. The shows below are the ones that aired on this date."}{" "}
            <Link href="/live" className={link}>
              Hear what is on now
            </Link>
          </p>
        )}
      </section>

      <section className="hd-show-related hd-tonight-dated mt-8" aria-labelledby="hd-tonight-dated">
        <h2 id="hd-tonight-dated" className="hd-show-related-title w98-font text-hd-title text-desert-amber mb-1">
          On {monthDayName(day)} in other years
        </h2>
        {page.dated.length ? (
          <ShowList shows={page.dated} />
        ) : (
          <p className="text-hd-body text-desktop-gray p-2">
            No show in the archive aired on {monthDayName(day)}.{" "}
            <Link href="/topics" className={link}>
              Browse by topic
            </Link>
          </p>
        )}
      </section>
    </>
  );
}
