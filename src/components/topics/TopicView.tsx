import Link from "next/link";
import { ShowList } from "@/components/shows/ShowView";
import { headlineGuest, longDate, seriesOf, showPath, showSubject, type Show } from "@/lib/shows/describe";
import {
  breadcrumbJsonLd,
  jsonLdScript,
  topicCrumbs,
  topicJsonLd,
  topicsIndexJsonLd,
  type Crumb,
} from "@/lib/shows/jsonld";
import { notableWhy } from "@/lib/shows/notable";
import { libraryIntentHref } from "@/lib/library/intents";
import { relatedTopics, topicPath, topicYears, type Topic, type TopicCatalog } from "@/lib/topics/catalog";

/**
 * A topic page and the topics index (docs/show-pages.md, "Topic pages").
 * Server components in the show pages' frame and class hooks (`hd-show-*`,
 * plus `hd-topic-*`), so each look draws them like the show pages.
 */

const link = "text-signal-blue hover:text-desktop-gray transition-colors-fast";

/** How many notable shows lead a topic page. */
export const START_HERE_MAX = 4;

function Crumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
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
        <li aria-current="page">{crumbs[crumbs.length - 1].name}</li>
      </ol>
    </nav>
  );
}

/** The show a newcomer should press first: a notable one, else the most recent. */
export function firstShow(topic: Topic): Show {
  return topic.shows.find((s) => notableWhy(s.row.fileHash)) ?? topic.shows[0];
}

export function TopicView({ topic, catalog }: { topic: Topic; catalog: TopicCatalog }) {
  const crumbs = topicCrumbs(topic);
  const years = topicYears(topic);
  const start = topic.shows.filter((s) => notableWhy(s.row.fileHash)).slice(0, START_HERE_MAX);
  const first = firstShow(topic);
  const related = relatedTopics(topic, catalog);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(topicJsonLd(topic)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(crumbs)) }} />
      <Crumbs crumbs={crumbs} />
      <article className="hd-show-article hd-topic w98-raised-dark bg-raised-surface p-4 md:p-6" data-topic-slug={topic.slug}>
        <p className="hd-show-series text-hd-caption uppercase tracking-wider text-desert-amber mb-1">Topic</p>
        <h1 className="hd-show-title w98-font text-hd-h2 text-desktop-gray leading-tight">{topic.name}</h1>
        <p className="hd-topic-intro text-hd-body text-desktop-gray mt-3 leading-relaxed">{topic.intro}</p>
        <p className="hd-show-meta-line text-hd-caption text-bevel-dark mt-2">
          {topic.shows.length} {topic.shows.length === 1 ? "show" : "shows"}
          {years ? `, ${years}` : ""}
        </p>
        <div className="hd-show-player w98-inset-dark bg-inset-well p-3 mt-4 flex flex-col gap-2">
          <p className="text-hd-caption text-bevel-dark">Start with</p>
          <Link
            href={showPath(first.slug)}
            className="hd-topic-first hd-show-open w98-raised-dark bg-raised-surface w98-font text-hd-body text-desktop-gray hover:text-desert-amber px-4 min-h-touch inline-flex items-center self-start"
          >
            ▶ {showSubject(first.row)}
            {headlineGuest(first.row) ? ` with ${headlineGuest(first.row)}` : ""}, {longDate(first.row.airDate)}
          </Link>
          <Link href={libraryIntentHref({ q: topic.name })} className={`text-hd-caption ${link} min-h-touch md:min-h-0 inline-flex items-center self-start`}>
            Search the Library for {topic.name}
          </Link>
        </div>
      </article>

      {start.length ? (
        <section className="hd-show-related hd-topic-start mt-8" aria-labelledby="hd-topic-start">
          <h2 id="hd-topic-start" className="hd-show-related-title w98-font text-hd-title text-desert-amber mb-1">
            Start here
          </h2>
          <ul className="hd-show-list flex flex-col gap-1">
            {start.map((s) => (
              <li key={s.slug} className="hd-show-list-item">
                <Link href={showPath(s.slug)} className="hd-show-list-link group flex flex-col py-1.5 min-h-touch md:min-h-0">
                  <span className="text-hd-body text-signal-blue group-hover:text-desktop-gray">
                    {showSubject(s.row)}
                    <span className="text-bevel-dark text-hd-caption"> · {seriesOf(s.row).short}, {longDate(s.row.airDate)}</span>
                  </span>
                  <span className="text-hd-caption text-desktop-gray">{notableWhy(s.row.fileHash)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="hd-show-related mt-8" aria-labelledby="hd-topic-shows">
        <h2 id="hd-topic-shows" className="hd-show-related-title w98-font text-hd-title text-desert-amber mb-1">
          Every show, newest first
        </h2>
        <ShowList shows={topic.shows} />
      </section>

      {related.length ? (
        <section className="hd-show-related hd-topic-related mt-8" aria-labelledby="hd-topic-related">
          <h2 id="hd-topic-related" className="hd-show-related-title w98-font text-hd-title text-desert-amber mb-1">
            Related topics
          </h2>
          <TopicLinks topics={related} />
        </section>
      ) : null}
    </>
  );
}

export function TopicLinks({ topics }: { topics: readonly Topic[] }) {
  return (
    <ul className="hd-topic-links flex flex-wrap gap-2 p-1">
      {topics.map((t) => (
        <li key={t.slug}>
          <Link
            href={topicPath(t.slug)}
            className="hd-show-topic inline-flex items-center min-h-touch md:min-h-0 px-2 py-0.5 text-hd-body text-signal-blue border border-bevel-dark/40 hover:text-desktop-gray"
          >
            {t.name}
            <span className="text-hd-caption text-bevel-dark ml-1">{t.shows.length}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const GROUPS: { kind: Topic["kind"]; title: string }[] = [
  { kind: "subject", title: "Famous subjects" },
  { kind: "category", title: "Categories" },
  { kind: "tag", title: "More topics" },
];

export function TopicsIndex({ catalog }: { catalog: TopicCatalog }) {
  const crumbs: Crumb[] = [
    { name: "High Desert", path: "/" },
    { name: "Topics", path: "/topics" },
  ];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(topicsIndexJsonLd(catalog.topics)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(crumbs)) }} />
      <Crumbs crumbs={crumbs} />
      <article className="hd-show-article hd-topic hd-topics-index w98-raised-dark bg-raised-surface p-4 md:p-6">
        <p className="hd-show-series text-hd-caption uppercase tracking-wider text-desert-amber mb-1">Topics</p>
        <h1 className="hd-show-title w98-font text-hd-h2 text-desktop-gray leading-tight">Art Bell shows by topic</h1>
        <p className="hd-topic-intro text-hd-body text-desktop-gray mt-3">
          {catalog.topics.length} topics across the archive. Each lists every show about it, newest first.
        </p>
      </article>
      {GROUPS.map((g) => {
        const list = catalog.topics.filter((t) => t.kind === g.kind).sort((a, b) => a.name.localeCompare(b.name));
        return list.length ? (
          <section key={g.kind} className="hd-show-related mt-8" aria-labelledby={`hd-topics-${g.kind}`}>
            <h2 id={`hd-topics-${g.kind}`} className="hd-show-related-title w98-font text-hd-title text-desert-amber mb-1">
              {g.title}
            </h2>
            <TopicLinks topics={list} />
          </section>
        ) : null;
      })}
    </>
  );
}
