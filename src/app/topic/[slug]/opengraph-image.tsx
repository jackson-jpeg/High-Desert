import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
// next/og renders without a stylesheet, so colours must be concrete strings.
import { PALETTE } from "@/lib/palette";
import { topicCatalog } from "@/lib/topics/load";
import { CARD_CACHE_CONTROL, ShowCard } from "@/components/shows/ShowCard";
import { topicYears } from "@/lib/topics/catalog";

/** A topic page's share card (docs/show-pages.md, "Topic pages"); drawn per request, kept a week by clients. */
export const alt = "A High Desert topic card: the topic and how many shows it has";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const topic = topicCatalog().bySlug.get(slug);
  if (!topic) notFound();
  const years = topicYears(topic);
  return new ImageResponse(
    <ShowCard
      palette={PALETTE}
      card={{
        kicker: "ART BELL ON",
        title: topic.name,
        subtitle: `${topic.shows.length} shows${years ? `, ${years}` : ""}`,
      }}
    />,
    { ...size, headers: { "Cache-Control": CARD_CACHE_CONTROL } },
  );
}
