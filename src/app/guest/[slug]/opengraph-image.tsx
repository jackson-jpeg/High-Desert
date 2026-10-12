import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
// next/og renders without a stylesheet, so colours must be concrete strings.
import { PALETTE } from "@/lib/palette";
import { showCatalog } from "@/lib/shows/load";
import { ShowCard } from "@/components/shows/ShowCard";

/** A guest page's share card (docs/show-pages.md); rendered on first request, then cached. */
export const alt = "A High Desert guest card: the guest's name and how many shows they were on";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guest = showCatalog().guests.get(slug);
  if (!guest) notFound();
  const first = guest.shows[0].row.airDate?.slice(0, 4);
  const last = guest.shows[guest.shows.length - 1].row.airDate?.slice(0, 4);
  return new ImageResponse(
    <ShowCard
      palette={PALETTE}
      card={{
        kicker: "GUEST OF ART BELL",
        title: guest.name,
        subtitle: `${guest.shows.length} shows${first && last && first !== last ? `, ${first} to ${last}` : first ? `, ${first}` : ""}`,
      }}
    />,
    { ...size },
  );
}
