import Link from "next/link";
import { breadcrumbJsonLd, jsonLdScript, requestLineCrumbs, requestLineJsonLd } from "@/lib/shows/jsonld";
import { formatStationTime } from "@/lib/live/format";
import { pacificDay, requestCloseAt, requestStartAt } from "@/lib/live/schedule";
import { showPath } from "@/lib/shows/describe";
import { tonightDate, tonightPath } from "@/lib/tonight/tonight";
import type { requestLinePage } from "@/lib/live/request-line-page";
import { RequestLineList } from "./RequestLineList";

/**
 * The Request Line page (docs/request-line.md): what it is, tonight's locked
 * request once voting has closed, and the day's nominations with their votes.
 * Server-rendered in the show pages' frame; the list is a client island that
 * renders the same rows on the server, then adds this browser's own marks,
 * one-tap votes, the admin's veto and Share.
 */

const link = "text-signal-blue hover:text-desktop-gray transition-colors-fast";

export function RequestLineView({ page, available, now }: { page: ReturnType<typeof requestLinePage>; available: boolean; now: number }) {
  const crumbs = requestLineCrumbs();
  const today = pacificDay(now);
  const forTomorrow = page.day !== today;
  const closes = requestCloseAt(page.day);
  const t = page.tonight;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(requestLineJsonLd(page.day, page.title, page.description, page.listed)) }} />
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
          <li aria-current="page">Request Line</li>
        </ol>
      </nav>

      <article className="hd-show-article hd-request-line w98-raised-dark bg-raised-surface p-4 md:p-6" data-request-day={page.day}>
        <p className="hd-show-series text-hd-caption uppercase tracking-wider text-desert-amber mb-1">High Desert Live · 10 PM Pacific</p>
        <h1 className="hd-show-title w98-font text-hd-h2 text-desktop-gray leading-tight">The Request Line</h1>
        <p className="hd-request-intro text-hd-body text-desktop-gray mt-3 leading-relaxed">
          Every night at 10 PM Pacific, Art&apos;s old airtime, the station plays the show its listeners picked. Request one from any
          show page or the Library (one a day), and vote here with one tap. Voting closes at 6 PM Pacific. Shows the station played in
          the last 30 days wait their turn.
        </p>

        {t ? (
          <section data-testid="request-tonight" className="hd-request-tonight w98-inset-dark bg-inset-well p-3 mt-4" aria-labelledby="hd-request-tonight">
            <h2 id="hd-request-tonight" className="w98-font text-hd-title text-desert-amber">
              Tonight at {formatStationTime(requestStartAt(today))} PT
            </h2>
            {t.title ? (
              <p className="text-hd-body text-desktop-gray mt-1">
                {t.slug ? (
                  <Link href={showPath(t.slug)} className={link}>
                    {t.title}
                  </Link>
                ) : (
                  t.title
                )}
                <span className="text-bevel-dark">
                  {" "}
                  · requested by {t.by ?? "a listener"}
                  {t.place ? `, calling from ${t.place}` : ""} · {t.votes} {t.votes === 1 ? "vote" : "votes"}
                </span>
              </p>
            ) : (
              <p className="text-hd-body text-desktop-gray mt-1">Nobody put in a request today, so a fan favorite plays at 10 PM.</p>
            )}
            <p className="text-hd-caption mt-1">
              <Link href={tonightPath(today)} className={link}>
                The whole program for {tonightDate(today)}
              </Link>{" "}
              ·{" "}
              <Link href="/live" className={link}>
                Listen live
              </Link>
            </p>
          </section>
        ) : null}

        <section className="hd-show-related hd-request-list mt-6" aria-labelledby="hd-request-nominations">
          <h2 id="hd-request-nominations" className="hd-show-related-title w98-font text-hd-title text-desert-amber mb-1">
            {forTomorrow ? `Up for tomorrow night, ${tonightDate(page.day)}` : "Up for tonight"}
          </h2>
          <p className="text-hd-caption text-bevel-dark mb-2">
            Voting closes at {formatStationTime(closes)} PT{forTomorrow ? " tomorrow" : ""}. Most votes wins; a tie goes to the first pick.
          </p>
          {available ? (
            <RequestLineList initial={page.nominations} day={page.day} closesAt={closes} />
          ) : (
            <p className="text-hd-body text-desktop-gray p-2">The Request Line cannot be read right now. Try again in a little while.</p>
          )}
          <p className="text-hd-caption text-desktop-gray mt-3">
            To pick a show, open it from the{" "}
            <Link href="/library" className={link}>
              Library
            </Link>{" "}
            or any show page and press Request it.
          </p>
        </section>
      </article>
    </>
  );
}
