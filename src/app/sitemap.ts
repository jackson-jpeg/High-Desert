import type { MetadataRoute } from "next";
import { showCatalog } from "@/lib/shows/load";
import { SITE_ORIGIN, guestPath, showPath } from "@/lib/shows/describe";
import { topicCatalog } from "@/lib/topics/load";
import { topicPath } from "@/lib/topics/catalog";
import { pacificDay } from "@/lib/live/schedule";
import { tonightPath, tonightSitemapDays } from "@/lib/tonight/tonight";

/**
 * Every page Google should index: the app's routes, then every show page,
 * guest page and topic page, and the Tonight pages of the last
 * TONIGHT_SITEMAP_DAYS days (docs/show-pages.md). Show, guest and topic
 * entries carry no lastModified: a broadcast from 1997 has none worth
 * claiming, and a date that moves on every build teaches Google to ignore the
 * field. A Tonight page's date is its day.
 *
 * Regenerated hourly, not once per build: the Tonight window moves every day.
 */
export const revalidate = 3600;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const base = SITE_ORIGIN;
  const catalog = showCatalog();
  const topics = topicCatalog();

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
      url: `${base}/stats`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.5,
    },
    ...catalog.shows.map((s) => ({ url: `${base}${showPath(s.slug)}`, priority: 0.6 })),
    ...[...catalog.guests.values()].map((g) => ({ url: `${base}${guestPath(g.slug)}`, priority: 0.5 })),
    { url: `${base}/topics`, changeFrequency: "monthly", priority: 0.6 },
    ...topics.topics.map((t) => ({ url: `${base}${topicPath(t.slug)}`, priority: 0.7 })),
    ...tonightSitemapDays(pacificDay(now.getTime())).map((day, i) => ({
      url: `${base}${tonightPath(day)}`,
      lastModified: new Date(`${day}T12:00:00Z`),
      changeFrequency: i === 0 ? ("daily" as const) : ("never" as const),
      priority: i === 0 ? 0.8 : 0.4,
    })),
  ];
}
