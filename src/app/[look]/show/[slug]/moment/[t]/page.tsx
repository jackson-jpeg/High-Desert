import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShowView } from "@/components/shows/ShowView";
import { showCatalog } from "@/lib/shows/load";
import { momentMetadata } from "@/lib/shows/metadata";
import { parseMomentSeconds, validMoment } from "@/lib/shows/share";
import { topicCatalog } from "@/lib/topics/load";

/**
 * A shared moment: `/show/<slug>?t=<seconds>` (docs/show-pages.md, "Sharing").
 *
 * Visitors never see this path. next.config.ts rewrites a show URL that has a
 * `t` of whole seconds here, and src/proxy.ts sends anyone who types this path
 * to the `?t=` URL, so a moment has one address and the plain show page stays
 * a static page whatever query it is asked with.
 *
 * Rendered per request, never cached: there is one moment per second of every
 * show, and caching each would let anyone fill the disk (about 175 KB a page)
 * by counting. A render is a lookup in the in-memory catalog.
 *
 * Canonical is the plain show page; the share card says the time. A second
 * at or past the show's end is no moment: the plain page, with no card.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; t: string }> };

function resolve(slug: string, raw: string) {
  const show = showCatalog().bySlug.get(slug);
  if (!show) return null;
  return { show, moment: validMoment(parseMomentSeconds(raw), show.row.duration) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, t } = await params;
  const r = resolve(slug, t);
  return r ? momentMetadata(r.show, r.moment) : {};
}

export default async function MomentPage({ params }: Props) {
  const { slug, t } = await params;
  const r = resolve(slug, t);
  if (!r) notFound();
  return <ShowView show={r.show} catalog={showCatalog()} topics={topicCatalog().byShow.get(slug) ?? []} moment={r.moment} />;
}
