import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
// next/og renders without a stylesheet, so colours must be concrete strings.
import { PALETTE } from "@/lib/palette";
import { showCatalog } from "@/lib/shows/load";
import { CARD_CACHE_CONTROL, momentCard, ShowCard } from "@/components/shows/ShowCard";
import { parseMomentSeconds, validMoment } from "@/lib/shows/share";

/**
 * A shared moment's card (docs/show-pages.md, "Sharing"): the show's card with
 * "Starts at 1:23:45". Named only in a `?t=` page's head (momentMetadata).
 * Drawn per request and kept a week by clients, like every card; a second
 * past the show's end is a 404.
 */
export const alt = "A High Desert card: the show, and the time the shared moment starts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string; t: string }> }) {
  const { slug, t } = await params;
  const show = showCatalog().bySlug.get(slug);
  const seconds = show ? validMoment(parseMomentSeconds(t), show.row.duration) : null;
  if (!show || seconds == null) notFound();
  return new ImageResponse(<ShowCard card={momentCard(show.row, seconds)} palette={PALETTE} />, {
    ...size,
    headers: { "Cache-Control": CARD_CACHE_CONTROL },
  });
}
