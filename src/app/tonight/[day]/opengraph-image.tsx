import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
// next/og renders without a stylesheet, so colours must be concrete strings.
import { PALETTE } from "@/lib/palette";
import { showCatalog } from "@/lib/shows/load";
import { CARD_CACHE_CONTROL, ShowCard } from "@/components/shows/ShowCard";
import { pacificDay } from "@/lib/live/schedule";
import { tonightDate, tonightDayInRange, tonightPage } from "@/lib/tonight/tonight";
import { tonightData } from "@/services/live/tonight";

/**
 * A Tonight page's share card (docs/show-pages.md, "Tonight"): the date, and
 * how many broadcasts aired on it. Drawn per request and kept a week by
 * clients, like every card.
 */
export const alt = "A High Desert card: the day's program and the broadcasts that aired on this date";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  const today = pacificDay(Date.now());
  if (!tonightDayInRange(day, today)) notFound();
  const data = await tonightData(day);
  if (day > today && !data.program) notFound();
  const page = tonightPage(day, data.program, showCatalog());
  return new ImageResponse(
    <ShowCard
      palette={PALETTE}
      card={{ kicker: "TONIGHT ON HIGH DESERT", stamp: tonightDate(day), title: page.card.title, subtitle: page.card.subtitle, footer: "Tune in at highdesert.space/live" }}
    />,
    { ...size, headers: { "Cache-Control": CARD_CACHE_CONTROL } },
  );
}
