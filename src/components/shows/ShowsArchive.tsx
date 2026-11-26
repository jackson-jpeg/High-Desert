import Link from "next/link";
import { ShowList } from "@/components/shows/ShowView";
import { Crumbs } from "@/components/topics/TopicView";
import { breadcrumbJsonLd, jsonLdScript, showsIndexJsonLd, showsYearJsonLd, type Crumb } from "@/lib/shows/jsonld";
import { SHOWS_PATH, byMonth, showsYearPath, type ShowYear } from "@/lib/shows/archive";

/**
 * The archive by year (docs/show-pages.md, "The archive by year"): server
 * HTML in the show pages' frame and class hooks, every show a plain link.
 */

const link = "text-signal-blue hover:text-desktop-gray transition-colors-fast";

export function ShowsIndex({ years }: { years: ShowYear[] }) {
  const total = years.reduce((n, y) => n + y.shows.length, 0);
  const crumbs: Crumb[] = [
    { name: "High Desert", path: "/" },
    { name: "Every show", path: SHOWS_PATH },
  ];
  const first = years[0]?.year;
  const last = years[years.length - 1]?.year;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(showsIndexJsonLd(years)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(crumbs)) }} />
      <Crumbs crumbs={crumbs} />
      <article className="hd-show-article hd-topic hd-shows-index w98-raised-dark bg-raised-surface p-4 md:p-6">
        <p className="hd-show-series text-hd-caption uppercase tracking-wider text-desert-amber mb-1">The archive</p>
        <h1 className="hd-show-title w98-font text-hd-h2 text-desktop-gray leading-tight">Every Art Bell show, by year</h1>
        <p className="hd-topic-intro text-hd-body text-desktop-gray mt-3">
          {total.toLocaleString("en-US")} shows{first && last ? `, ${first} to ${last}` : ""}. Pick a year to see every show that aired in it.
        </p>
      </article>
      <section className="hd-show-related mt-8" aria-labelledby="hd-shows-years">
        <h2 id="hd-shows-years" className="hd-show-related-title w98-font text-hd-title text-desert-amber mb-1">
          Years
        </h2>
        <ul className="hd-topic-links hd-shows-years flex flex-wrap gap-2 p-1">
          {years.map((y) => (
            <li key={y.year}>
              <Link
                href={showsYearPath(y.year)}
                className="hd-show-topic inline-flex items-center min-h-touch md:min-h-0 px-2 py-0.5 text-hd-body text-signal-blue border border-bevel-dark/40 hover:text-desktop-gray"
              >
                {y.year}
                <span className="text-hd-caption text-bevel-dark ml-1">{y.shows.length}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function ShowsYearView({ year, prev, next }: { year: ShowYear; prev: string | null; next: string | null }) {
  const crumbs: Crumb[] = [
    { name: "High Desert", path: "/" },
    { name: "Every show", path: SHOWS_PATH },
    { name: year.year, path: showsYearPath(year.year) },
  ];
  const months = byMonth(year.shows);
  const n = year.shows.length;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(showsYearJsonLd(year.year, year.shows)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(crumbs)) }} />
      <Crumbs crumbs={crumbs} />
      <article className="hd-show-article hd-topic hd-shows-year w98-raised-dark bg-raised-surface p-4 md:p-6" data-year={year.year}>
        <p className="hd-show-series text-hd-caption uppercase tracking-wider text-desert-amber mb-1">The archive</p>
        <h1 className="hd-show-title w98-font text-hd-h2 text-desktop-gray leading-tight">Art Bell shows from {year.year}</h1>
        <p className="hd-topic-intro text-hd-body text-desktop-gray mt-3">
          {n === 1 ? `The one show from ${year.year} in the archive.` : `${n} shows from ${year.year} in the archive, in the order they aired.`}
        </p>
        <YearNav prev={prev} next={next} />
      </article>
      {months.map((m) => (
        <section key={m.month} className="hd-show-related mt-8" aria-labelledby={`hd-shows-${m.month}`}>
          <h2 id={`hd-shows-${m.month}`} className="hd-show-related-title w98-font text-hd-title text-desert-amber mb-1">
            {m.month} {year.year}
          </h2>
          <ShowList shows={m.shows} />
        </section>
      ))}
      <div className="mt-8">
        <YearNav prev={prev} next={next} />
      </div>
    </>
  );
}

function YearNav({ prev, next }: { prev: string | null; next: string | null }) {
  return (
    <nav aria-label="Years" className="hd-shows-year-nav flex flex-wrap gap-x-4 gap-y-1 mt-3 text-hd-body">
      {prev ? (
        <Link href={showsYearPath(prev)} className={`${link} min-h-touch md:min-h-0 inline-flex items-center`}>
          ‹ {prev}
        </Link>
      ) : null}
      <Link href={SHOWS_PATH} className={`${link} min-h-touch md:min-h-0 inline-flex items-center`}>
        Every year
      </Link>
      {next ? (
        <Link href={showsYearPath(next)} className={`${link} min-h-touch md:min-h-0 inline-flex items-center`}>
          {next} ›
        </Link>
      ) : null}
    </nav>
  );
}
