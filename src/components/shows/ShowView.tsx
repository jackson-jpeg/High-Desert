import Link from "next/link";
import { Fragment } from "react";
import type { ShowCatalog } from "@/lib/shows/catalog";
import {
  guestPath,
  headlineGuest,
  longDate,
  readableDuration,
  seriesOf,
  showPath,
  showSubject,
  shownTopic,
  type Show,
} from "@/lib/shows/describe";
import { guestPeople, personKey } from "@/lib/shows/people";
import { relatedShows } from "@/lib/shows/related";
import { breadcrumbJsonLd, episodeJsonLd, jsonLdScript, showCrumbs } from "@/lib/shows/jsonld";
import { libraryIntentHref } from "@/lib/library/intents";
import { communityKey } from "@/lib/utils/community-key";
import { resolveSources } from "@/audio/sources";
import { archiveDetailsUrl } from "@/lib/library/episode-detail";
import type { Episode } from "@/db/schema";
import { SHOW_TOPICS_MAX, topicPath, type Topic } from "@/lib/topics/catalog";
import { momentLabel } from "@/lib/shows/share";
import { ShowPlayButton } from "@/components/shows/ShowPlayButton";

/**
 * One show's page (docs/show-pages.md). A server component: the heading, the
 * facts, a native audio player, the topics and the related lists are all in
 * the HTML, so the page works with JavaScript off and is what a crawler
 * indexes. The one client piece is the big Play button (ShowPlayButton),
 * which drives the native player and is hidden without JavaScript.
 *
 * `moment` (seconds, from `?t=`; src/app/[look]/show/[slug]/moment/[t]) is a
 * shared moment: the player starts there (a `#t=` media fragment on each
 * source), the page says so, and "Open in High Desert" carries it.
 */

/** The native player's id, for the Play button. */
export const SHOW_AUDIO_ID = "hd-show-audio";

/** Without JavaScript the big Play button cannot work: hide it, the native controls remain. */
export const NO_SCRIPT_PLAY_CSS = ".hd-show-play{display:none!important}";

const link = "text-signal-blue hover:text-desktop-gray transition-colors-fast";

/** "John Lear and Bob Lazar", each linked to their guest page when they have one. */
function GuestNames({ show, catalog }: { show: Show; catalog: ShowCatalog }) {
  const people = guestPeople(show.row);
  const guest = headlineGuest(show.row);
  if (!guest) return null;
  if (!people.length) return <>{guest}</>;
  return (
    <>
      {people.map((p, i) => {
        const slug = catalog.guestSlugByPerson.get(personKey(p));
        const sep = i === 0 ? "" : i === people.length - 1 ? (people.length > 2 ? ", and " : " and ") : ", ";
        return (
          <Fragment key={p}>
            {sep}
            {slug ? (
              <Link href={guestPath(slug)} className={`hd-show-guest-link ${link}`}>
                {p}
              </Link>
            ) : (
              p
            )}
          </Fragment>
        );
      })}
    </>
  );
}

export function ShowList({ shows, className }: { shows: Show[]; className?: string }) {
  return (
    <ul className={`hd-show-list flex flex-col gap-1 ${className ?? ""}`}>
      {shows.map((s) => (
        <li key={s.slug} className="hd-show-list-item">
          <Link href={showPath(s.slug)} className="hd-show-list-link group flex flex-col md:flex-row md:items-baseline md:gap-3 py-1.5 min-h-touch md:min-h-0">
            <span className="text-hd-body text-signal-blue group-hover:text-desktop-gray transition-colors-fast">
              {showSubject(s.row)}
              {headlineGuest(s.row) ? <span className="text-desktop-gray"> with {headlineGuest(s.row)}</span> : null}
            </span>
            <span className="text-hd-caption text-bevel-dark whitespace-nowrap">
              {seriesOf(s.row).short} · {longDate(s.row.airDate)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Related({ title, shows, id }: { title: string; shows: Show[]; id: string }) {
  if (!shows.length) return null;
  return (
    <section className="hd-show-related-group" aria-labelledby={id}>
      <h2 id={id} className="hd-show-related-title w98-font text-hd-title text-desert-amber mb-1">
        {title}
      </h2>
      <ShowList shows={shows} />
    </section>
  );
}

export function ShowView({
  show,
  catalog,
  topics = [],
  moment = null,
}: {
  show: Show;
  catalog: ShowCatalog;
  /** Every topic that lists this show, most specific first (src/lib/topics/catalog.ts). */
  topics?: Topic[];
  moment?: number | null;
}) {
  const { row, slug } = show;
  const series = seriesOf(row);
  const date = longDate(row.airDate);
  const subject = showSubject(row);
  const guest = headlineGuest(row);
  const topic = shownTopic(row);
  const length = readableDuration(row.duration);
  const key = communityKey(row);
  const sources = resolveSources(row as Pick<Episode, "fileHash" | "sourceUrl">);
  const archive = archiveDetailsUrl(row as Episode);
  const related = relatedShows(show, catalog);
  const people = guestPeople(row);
  const firstGuest = people[0] ?? guest;
  const crumbs = showCrumbs(show);
  const fragment = moment != null ? `#t=${moment}` : "";
  const categoryTopic = row.aiCategory ? topics.find((t) => t.id === `category:${row.aiCategory}`) : undefined;
  const shownTopics = topics.slice(0, SHOW_TOPICS_MAX);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(episodeJsonLd(show, catalog)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(crumbs)) }}
      />
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
          <li aria-current="page" className="truncate max-w-[60vw]">
            {subject}
          </li>
        </ol>
      </nav>

      <article className="hd-show-article w98-raised-dark bg-raised-surface p-4 md:p-6" data-show-slug={slug}>
        <p className="hd-show-series text-hd-caption uppercase tracking-wider text-desert-amber mb-1">
          {series.short}
          {date ? <> · <time dateTime={row.airDate}>{date}</time></> : null}
        </p>
        <h1 className="hd-show-title w98-font text-hd-h2 text-desktop-gray leading-tight">
          {subject}
          {guest ? " " : null}
          {guest ? (
            <span className="hd-show-with block text-hd-h3 text-desktop-gray mt-1">
              with <GuestNames show={show} catalog={catalog} />
            </span>
          ) : null}
        </h1>


        {moment != null ? (
          <p className="hd-show-moment text-hd-body text-desktop-gray mt-5" data-moment={moment}>
            A moment from this show, shared from <strong className="text-desert-amber">{momentLabel(moment)}</strong>. Press play
            and it starts there.{" "}
            <Link href={showPath(slug)} className={link}>
              Play it from the beginning
            </Link>
          </p>
        ) : null}

        <div className="hd-show-player w98-inset-dark bg-inset-well p-3 mt-5 flex flex-col gap-3">
          <ShowPlayButton audioId={SHOW_AUDIO_ID} startAt={moment} />
          <noscript dangerouslySetInnerHTML={{ __html: `<style>${NO_SCRIPT_PLAY_CSS}</style>` }} />
          {/* Native controls: plays with JavaScript off. preload="none" so a
              visit fetches nothing from archive.org until someone presses play.
              A moment's sources carry #t=, so the browser starts there. */}
          <audio id={SHOW_AUDIO_ID} controls preload="none" className="hd-show-audio w-full" aria-label={`Play ${subject}`}>
            {sources.map((s) => (
              <source key={s.url} src={`${s.url}${fragment}`} type="audio/mpeg" />
            ))}
          </audio>
          <div className="flex flex-wrap items-center gap-3">
            {key ? (
              <Link
                href={libraryIntentHref({ show: key, t: moment ?? undefined })}
                className="hd-show-open w98-raised-dark bg-raised-surface w98-font text-hd-body text-desktop-gray hover:text-desert-amber px-4 min-h-touch inline-flex items-center"
              >
                Open in High Desert
              </Link>
            ) : null}
            {archive ? (
              <a
                href={archive}
                className={`hd-show-archive text-hd-caption ${link} min-h-touch md:min-h-0 inline-flex items-center`}
                rel="noopener"
              >
                archive.org page ↗
              </a>
            ) : null}
          </div>
        </div>

        {row.aiSummary ? (
          <section className="hd-show-summary mt-5" aria-labelledby="hd-show-about">
            <h2 id="hd-show-about" className="w98-font text-hd-title text-desert-amber mb-1">
              About this show
            </h2>
            <p className="text-hd-body text-desktop-gray leading-relaxed">{row.aiSummary}</p>
          </section>
        ) : null}

        <dl className="hd-show-meta grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mt-4 text-hd-body">
          <dt className="text-bevel-dark">Aired</dt>
          <dd>{date || "Unknown"}</dd>
          <dt className="text-bevel-dark">Program</dt>
          <dd>{series.name}</dd>
          {guest ? (
            <>
              <dt className="text-bevel-dark">{people.length > 1 ? "Guests" : "Guest"}</dt>
              <dd>
                <GuestNames show={show} catalog={catalog} />
              </dd>
            </>
          ) : null}
          {topic ? (
            <>
              <dt className="text-bevel-dark">Topic</dt>
              <dd>{topic}</dd>
            </>
          ) : null}
          {row.aiCategory ? (
            <>
              <dt className="text-bevel-dark">Category</dt>
              <dd>
                {categoryTopic ? (
                  <Link href={topicPath(categoryTopic.slug)} className={`hd-show-category-link ${link}`}>
                    {row.aiCategory}
                  </Link>
                ) : (
                  row.aiCategory
                )}
              </dd>
            </>
          ) : null}
          {row.aiSeries ? (
            <>
              <dt className="text-bevel-dark">Series</dt>
              <dd>
                {row.aiSeries}
                {row.aiSeriesPart ? `, part ${row.aiSeriesPart}` : ""}
              </dd>
            </>
          ) : null}
          {length ? (
            <>
              <dt className="text-bevel-dark">Length</dt>
              <dd>{length}</dd>
            </>
          ) : null}
        </dl>

        {row.aiTags?.length ? (
          <ul className="hd-show-tags flex flex-wrap gap-2 mt-4" aria-label="Tags">
            {row.aiTags.map((t) => (
              <li key={t}>
                <Link
                  href={libraryIntentHref({ q: t })}
                  className="hd-show-tag inline-flex items-center min-h-touch md:min-h-0 px-2 py-0.5 text-hd-caption text-bevel-dark border border-bevel-dark/40 hover:text-desktop-gray"
                >
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {shownTopics.length ? (
          <section className="hd-show-topics mt-5" aria-labelledby="hd-show-topics-title">
            <h2 id="hd-show-topics-title" className="w98-font text-hd-title text-desert-amber mb-1">
              Topics
            </h2>
            <ul className="flex flex-wrap gap-2">
              {shownTopics.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={topicPath(t.slug)}
                    className="hd-show-topic inline-flex items-center min-h-touch md:min-h-0 px-2 py-0.5 text-hd-body text-signal-blue border border-bevel-dark/40 hover:text-desktop-gray"
                  >
                    {t.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>

      <div className="hd-show-related flex flex-col gap-6 mt-8">
        <Related
          id="hd-show-more-guest"
          title={firstGuest && people.length === 1 ? `More with ${firstGuest}` : "More with these guests"}
          shows={related.withGuest}
        />
        <Related id="hd-show-same-day" title={date ? `On ${date.replace(/, \d{4}$/, "")} in other years` : "On this day"} shows={related.sameDay} />
        <Related
          id="hd-show-category"
          title={row.aiCategory ? `More ${row.aiCategory}` : "More like this"}
          shows={related.category}
        />
      </div>
    </>
  );
}
