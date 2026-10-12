import type { Guest, ShowCatalog } from "@/lib/shows/catalog";
import {
  SITE_ORIGIN,
  SITE_NAME,
  absolute,
  guestPath,
  isoDuration,
  seriesOf,
  showDescription,
  showPath,
  showSubject,
  headlineGuest,
  type Show,
} from "@/lib/shows/describe";
import { guestPeople, personKey } from "@/lib/shows/people";

/**
 * Structured data for show and guest pages (docs/show-pages.md): what Google
 * reads to know a page is one broadcast of a radio programme, when it aired,
 * who was on it and where the audio is. Validated against the schema.org
 * vocabulary by scripts/lib/jsonld-check.mjs, in the unit tests and again by
 * scripts/seo-check.mjs on the served pages.
 */

type Node = Record<string, unknown>;

export const ART_BELL: Node = {
  "@type": "Person",
  name: "Art Bell",
  sameAs: "https://en.wikipedia.org/wiki/Art_Bell",
};

/** The share image's stable address (Next appends a cache-busting query in the meta tag). */
export const showImageUrl = (slug: string) => `${absolute(showPath(slug))}/opengraph-image`;

/** A guest as a Person, linked to their guest page when they have one. */
function person(name: string, catalog: ShowCatalog): Node {
  const slug = catalog.guestSlugByPerson.get(personKey(name));
  return { "@type": "Person", name, ...(slug ? { url: absolute(guestPath(slug)) } : {}) };
}

export function episodeJsonLd(show: Show, catalog: ShowCatalog): Node {
  const { row, slug } = show;
  const url = absolute(showPath(slug));
  const series = seriesOf(row);
  const guest = headlineGuest(row);
  const duration = isoDuration(row.duration);
  const people = guestPeople(row);
  const node: Node = {
    "@context": "https://schema.org",
    "@type": "PodcastEpisode",
    "@id": `${url}#episode`,
    url,
    name: `${showSubject(row)}${guest ? ` with ${guest}` : ""}`,
    description: row.aiSummary?.trim() || showDescription(row),
    datePublished: row.airDate,
    inLanguage: "en",
    isAccessibleForFree: true,
    image: showImageUrl(slug),
    partOfSeries: {
      "@type": "PodcastSeries",
      "@id": `${SITE_ORIGIN}/#series-${series.key}`,
      name: series.name,
      creator: ART_BELL,
    },
    creator: ART_BELL,
    ...(people.length ? { actor: people.map((p) => person(p, catalog)) } : {}),
    ...(duration ? { duration } : {}),
    ...(row.aiCategory ? { genre: row.aiCategory } : {}),
    ...(row.aiTags?.length ? { keywords: row.aiTags.join(", ") } : {}),
    associatedMedia: {
      "@type": "AudioObject",
      contentUrl: row.sourceUrl,
      encodingFormat: "audio/mpeg",
      ...(duration ? { duration } : {}),
      ...(row.fileSize ? { contentSize: `${row.fileSize} B` } : {}),
    },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_ORIGIN },
  };
  return node;
}

export interface Crumb {
  name: string;
  /** Site path; the last crumb (this page) may omit it. */
  path?: string;
}

export function breadcrumbJsonLd(crumbs: Crumb[]): Node {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.path ? { item: absolute(c.path) } : {}),
    })),
  };
}

export function showCrumbs(show: Show): Crumb[] {
  return [
    { name: SITE_NAME, path: "/" },
    { name: "Library", path: "/library" },
    { name: showSubject(show.row), path: showPath(show.slug) },
  ];
}

export function guestCrumbs(guest: Guest): Crumb[] {
  return [
    { name: SITE_NAME, path: "/" },
    { name: "Library", path: "/library" },
    { name: guest.name, path: guestPath(guest.slug) },
  ];
}

/** A guest page: a collection about one person, listing their shows. */
export function guestJsonLd(guest: Guest): Node {
  const url = absolute(guestPath(guest.slug));
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": url,
    url,
    name: `${guest.name} on Art Bell`,
    description: guestDescription(guest),
    about: { "@type": "Person", name: guest.name },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: guest.shows.length,
      itemListElement: guest.shows.map((s, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: absolute(showPath(s.slug)),
        name: showSubject(s.row),
      })),
    },
  };
}

export function guestDescription(guest: Guest): string {
  const years = [...new Set(guest.shows.map((s) => s.row.airDate?.slice(0, 4)).filter(Boolean))];
  const span = years.length > 1 ? `${years[0]} to ${years[years.length - 1]}` : years[0] ?? "";
  return `${guest.name} on Art Bell's radio shows: ${guest.shows.length} broadcasts${span ? `, ${span}` : ""}. Listen to every one free on High Desert.`;
}

/** Inline-safe JSON for a <script type="application/ld+json">: no "</script>" can close it early. */
export function jsonLdScript(node: Node): string {
  return JSON.stringify(node).replace(/</g, "\\u003c");
}
