import type { Metadata } from "next";
import type { Guest } from "@/lib/shows/catalog";
import {
  SITE_NAME,
  guestPath,
  seriesOf,
  showDescription,
  showPageTitle,
  showPath,
  type Show,
} from "@/lib/shows/describe";
import { guestDescription } from "@/lib/shows/jsonld";
import { guestPeople } from "@/lib/shows/people";
import { momentLabel } from "@/lib/shows/share";
import { clip as clipText, DESCRIPTION_MAX } from "@/lib/shows/describe";

/**
 * <head> for show and guest pages (docs/show-pages.md). The share images are
 * named here: the pages live in the look segment (src/app/[look]/) and their
 * cards outside it (src/app/show/[slug]/opengraph-image.tsx), so that a
 * card's URL carries no look, and Next only adds a card by itself to a page
 * in its own segment.
 *
 * `openGraph` and `twitter` replace the root layout's objects whole, so every
 * field the root sets is set again here.
 */
export function showMetadata(show: Show): Metadata {
  const { row, slug } = show;
  const title = showPageTitle(row);
  const description = showDescription(row);
  const url = showPath(slug);
  return {
    title,
    description,
    alternates: { canonical: url },
    keywords: [
      "Art Bell",
      seriesOf(row).short,
      ...guestPeople(row),
      ...(row.aiCategory ? [row.aiCategory] : []),
      ...(row.aiTags ?? []),
    ],
    openGraph: {
      type: "article",
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: "en_US",
      ...(row.airDate ? { publishedTime: row.airDate } : {}),
      ...(row.sourceUrl ? { audio: [{ url: row.sourceUrl, type: "audio/mpeg" }] } : {}),
      images: [shareImage(url, "opengraph-image")],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [shareImage(url, "twitter-image")],
    },
  };
}

export function guestMetadata(guest: Guest): Metadata {
  const title = `${guest.name} on Art Bell · ${guest.shows.length} shows`;
  const description = guestDescription(guest);
  const url = guestPath(guest.slug);
  return {
    title,
    description,
    alternates: { canonical: url },
    keywords: ["Art Bell", guest.name, "Coast to Coast AM"],
    openGraph: {
      type: "profile",
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: "en_US",
      images: [shareImage(url, "opengraph-image")],
    },
    twitter: { card: "summary_large_image", title, description, images: [shareImage(url, "twitter-image")] },
  };
}

/**
 * A shared moment of a show: the show page's head, but its share card says
 * the time ("Starts at 1:23:45", src/app/show/[slug]/moment/[t]/) and its
 * og:url is the moment's own URL, so a preview links where it was shared
 * from. Canonical stays the plain show page: a moment is not a second page.
 * No moment (a second past the end): exactly the show page's head.
 */
export function momentMetadata(show: Show, seconds: number | null): Metadata {
  const base = showMetadata(show);
  if (seconds == null) return base;
  const page = showPath(show.slug);
  const url = `${page}?t=${seconds}`;
  const card = `${page}/moment/${seconds}`;
  const title = `${showPageTitle(show.row)}, from ${momentLabel(seconds)}`;
  return {
    ...base,
    title,
    openGraph: { ...base.openGraph, title, url, images: [shareImage(card, "opengraph-image", MOMENT_ALT)] },
    twitter: { ...base.twitter, title, images: [shareImage(card, "twitter-image", MOMENT_ALT)] },
  };
}

const MOMENT_ALT = "A High Desert card: the show, and the time the shared moment starts";

/** A page's share card: 1200x630, drawn by the route beside it. */
export function shareImage(
  pagePath: string,
  kind: "opengraph-image" | "twitter-image",
  alt = "A High Desert card: the title, date and guests",
) {
  return {
    url: `${pagePath}/${kind}`,
    width: 1200,
    height: 630,
    alt,
  };
}

/** A topic page's head (docs/show-pages.md, "Topic pages"). */
export function topicMetadata(topic: { name: string; slug: string; intro: string; shows: readonly Show[] }): Metadata {
  const title = `${topic.name} on Art Bell · ${topic.shows.length} shows`;
  const description = clipText(`${topic.intro} ${topic.shows.length} shows to play free on High Desert.`, DESCRIPTION_MAX);
  const url = `/topic/${topic.slug}`;
  const alt = `A High Desert card: ${topic.name} on Art Bell`;
  return {
    title,
    description,
    alternates: { canonical: url },
    keywords: ["Art Bell", topic.name, "Coast to Coast AM"],
    openGraph: {
      type: "website",
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: "en_US",
      images: [shareImage(url, "opengraph-image", alt)],
    },
    twitter: { card: "summary_large_image", title, description, images: [shareImage(url, "twitter-image", alt)] },
  };
}

/** A Tonight page's head (docs/show-pages.md, "Tonight"). */
export function tonightMetadata(day: string, title: string, description: string): Metadata {
  const url = `/tonight/${day}`;
  const alt = `A High Desert card: tonight's program for ${day}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    keywords: ["Art Bell", "Coast to Coast AM", "on this date", "live radio", "High Desert Live"],
    openGraph: {
      type: "website",
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: "en_US",
      images: [shareImage(url, "opengraph-image", alt)],
    },
    twitter: { card: "summary_large_image", title, description, images: [shareImage(url, "twitter-image", alt)] },
  };
}

/** The Request Line's <head>: its own share card ("Vote for my pick on High Desert"). */
export function requestLineMetadata(title: string, description: string): Metadata {
  const url = "/request-line";
  const alt = "A High Desert card: vote for my pick on the Request Line";
  return {
    title,
    description,
    alternates: { canonical: url },
    keywords: ["Art Bell", "Coast to Coast AM", "request line", "listener request", "High Desert Live"],
    openGraph: {
      type: "website",
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: "en_US",
      images: [shareImage(url, "opengraph-image", alt)],
    },
    twitter: { card: "summary_large_image", title, description, images: [shareImage(url, "twitter-image", alt)] },
  };
}
