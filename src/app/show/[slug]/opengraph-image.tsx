import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
// next/og renders without a stylesheet, so colours must be concrete strings.
import { PALETTE } from "@/lib/palette";
import { showCatalog } from "@/lib/shows/load";
import { showCard, ShowCard } from "@/components/shows/ShowCard";

/**
 * Each show's share card, 1200x630 (docs/show-pages.md). Rendered on its first
 * request and cached by Next until the next deploy (the page's
 * generateStaticParams returns nothing, so no card is drawn at build time).
 */
export const alt = "A High Desert show card: the show's title, date and guests";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const show = showCatalog().bySlug.get(slug);
  if (!show) notFound();
  return new ImageResponse(<ShowCard card={showCard(show.row)} palette={PALETTE} />, { ...size });
}
