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
 * <head> for show and guest pages (docs/show-pages.md). The share image is
 * not named here: the route's opengraph-image.tsx and twitter-image.tsx add
 * og:image and twitter:image themselves.
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
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
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
    },
    twitter: { card: "summary_large_image", title, description },
  };
}
