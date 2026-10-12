import type { MetadataRoute } from "next";
import { showCatalog } from "@/lib/shows/load";
import { SITE_ORIGIN, guestPath, showPath } from "@/lib/shows/describe";

/**
 * Every page Google should index: the app's routes, then every show page and
 * every guest page (docs/show-pages.md). Show and guest entries carry no
 * lastModified: a broadcast from 1997 has none worth claiming, and a date that
 * moves on every build teaches Google to ignore the field.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_ORIGIN;
  const now = new Date();
  const catalog = showCatalog();

  return [
    {
      url: base,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/library`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${base}/live`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${base}/radio`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${base}/stats`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.5,
    },
    ...catalog.shows.map((s) => ({ url: `${base}${showPath(s.slug)}`, priority: 0.6 })),
    ...[...catalog.guests.values()].map((g) => ({ url: `${base}${guestPath(g.slug)}`, priority: 0.5 })),
  ];
}
