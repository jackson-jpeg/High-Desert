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

/** A page's share card: 1200x630, drawn by the route beside it. */
function shareImage(pagePath: string, kind: "opengraph-image" | "twitter-image") {
  return {
    url: `${pagePath}/${kind}`,
    width: 1200,
    height: 630,
    alt: "A High Desert card: the title, date and guests",
  };
}
