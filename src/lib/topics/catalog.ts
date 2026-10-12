import type { ShowCatalog } from "@/lib/shows/catalog";
import type { Show } from "@/lib/shows/describe";
import { deriveTopics, type TopicKind } from "@/lib/topics/rules";

/**
 * Topic pages' data (docs/show-pages.md, "Topic pages"): the rule's topics
 * (src/lib/topics/rules.ts) over the shows that have pages, each with its
 * permanent slug from data/topic-slugs.json. Pure; built from the real files
 * the same way by the server (src/lib/topics/load.ts) and the tests.
 */

export interface Topic {
  slug: string;
  id: string;
  kind: TopicKind;
  name: string;
  intro: string;
  /** Newest first (ties by slug). */
  shows: Show[];
}

export interface TopicCatalog {
  /** Every topic with a page, in the rule's order: subjects, categories, tags. */
  topics: Topic[];
  bySlug: ReadonlyMap<string, Topic>;
  /** Show slug → the topics that list it, in the order a show page names them. */
  byShow: ReadonlyMap<string, Topic[]>;
}

/** How many topics a show page names, and how many related topics a topic page offers. */
export const SHOW_TOPICS_MAX = 8;
export const RELATED_TOPICS_MAX = 8;

const newestFirst = (a: Show, b: Show) =>
  (b.row.airDate ?? "").localeCompare(a.row.airDate ?? "") || a.slug.localeCompare(b.slug);

/** Subjects are the most specific, then tags, then the broad categories. */
const KIND_ORDER: Record<TopicKind, number> = { subject: 0, tag: 1, category: 2 };

export function buildTopicCatalog(catalog: ShowCatalog, slugs: Readonly<Record<string, string>>): TopicCatalog {
  const topics: Topic[] = [];
  for (const def of deriveTopics(catalog.shows.map((s) => s.row))) {
    const slug = slugs[def.id];
    // A topic with no slug gets no page; topics.test.ts fails on one.
    if (!slug) continue;
    const shows = def.fileHashes.map((h) => catalog.byHash.get(h)).filter((s): s is Show => !!s).sort(newestFirst);
    topics.push({ slug, id: def.id, kind: def.kind, name: def.name, intro: def.intro, shows });
  }
  const bySlug = new Map(topics.map((t) => [t.slug, t]));
  const byShow = new Map<string, Topic[]>();
  for (const t of topics) {
    for (const s of t.shows) {
      const list = byShow.get(s.slug);
      if (list) list.push(t);
      else byShow.set(s.slug, [t]);
    }
  }
  for (const list of byShow.values()) {
    list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.shows.length - b.shows.length || a.slug.localeCompare(b.slug));
  }
  return { topics, bySlug, byShow };
}

/** The topics a show page links to: most specific first, bounded. */
export function topicsOfShow(show: Show, tc: TopicCatalog): Topic[] {
  return (tc.byShow.get(show.slug) ?? []).slice(0, SHOW_TOPICS_MAX);
}

/**
 * Topics that share the most shows with this one (at least two), as a share
 * of the smaller topic, so a small subject inside a big category still finds
 * its neighbours. Never the topic itself; ties by name.
 */
export function relatedTopics(topic: Topic, tc: TopicCatalog): Topic[] {
  const mine = new Set(topic.shows.map((s) => s.slug));
  const scored: { t: Topic; score: number }[] = [];
  for (const t of tc.topics) {
    if (t.slug === topic.slug) continue;
    let shared = 0;
    for (const s of t.shows) if (mine.has(s.slug)) shared++;
    if (shared < 2) continue;
    scored.push({ t, score: shared / Math.min(mine.size, t.shows.length) });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name))
    .slice(0, RELATED_TOPICS_MAX)
    .map((x) => x.t);
}

export const topicPath = (slug: string) => `/topic/${slug}`;

/** "1992 to 2015", or one year. */
export function topicYears(topic: Topic): string {
  const years = topic.shows.map((s) => s.row.airDate?.slice(0, 4)).filter((y): y is string => !!y).sort();
  if (!years.length) return "";
  return years[0] === years[years.length - 1] ? years[0] : `${years[0]} to ${years[years.length - 1]}`;
}

/** The topics a guest's shows fall under, most of their shows first: a guest page's "talked about". */
export function guestTopics(shows: readonly Show[], tc: TopicCatalog, max = SHOW_TOPICS_MAX): Topic[] {
  const count = new Map<Topic, number>();
  for (const s of shows) for (const t of tc.byShow.get(s.slug) ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || KIND_ORDER[a[0].kind] - KIND_ORDER[b[0].kind] || a[0].name.localeCompare(b[0].name))
    .slice(0, max)
    .map(([t]) => t);
}
