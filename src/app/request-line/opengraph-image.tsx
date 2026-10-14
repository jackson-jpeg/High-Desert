import { ImageResponse } from "next/og";
// next/og renders without a stylesheet, so colours must be concrete strings.
import { PALETTE } from "@/lib/palette";
import { CARD_CACHE_CONTROL, ShowCard } from "@/components/shows/ShowCard";
import { requestLineData } from "@/services/live/request-line-page";

/**
 * The Request Line's share card (docs/request-line.md): "Vote for my pick on
 * High Desert", and the show leading tonight. Drawn per request and kept a
 * week by clients, like every card.
 */
export const alt = "A High Desert card: vote for my pick on the Request Line";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const { page } = await requestLineData();
  return new ImageResponse(
    <ShowCard
      palette={PALETTE}
      card={{ kicker: "THE REQUEST LINE · HIGH DESERT LIVE", stamp: "Tonight at 10 PM Pacific", title: page.card.title, subtitle: page.card.subtitle, footer: "Vote at highdesert.space/request-line" }}
    />,
    { ...size, headers: { "Cache-Control": CARD_CACHE_CONTROL } },
  );
}
