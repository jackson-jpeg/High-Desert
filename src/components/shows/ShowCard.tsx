import type { PALETTE } from "@/lib/palette";
import { clip, headlineGuest, longDate, seriesOf, showSubject, type CatalogRow } from "@/lib/shows/describe";

/**
 * The share card drawn by next/og for a show or a guest (docs/show-pages.md).
 * next/og has no stylesheet and supports only inline flexbox styles, so this
 * takes the palette as concrete strings (src/lib/palette.ts) and every box
 * says `display: flex`.
 */

/**
 * How long a browser or a link-preview service may keep a card. Cards are
 * drawn per request (~0.1 s), not cached on disk: 1,600 of them would cost
 * the box ~80 MB per deploy for images crawlers fetch rarely.
 */
export const CARD_CACHE_CONTROL = "public, max-age=604800, stale-while-revalidate=86400";

export interface CardText {
  kicker: string;
  title: string;
  subtitle?: string;
  footer?: string;
}

/** What a show's card says. Clipped so the longest title in the catalog fits two lines. */
export function showCard(row: CatalogRow): CardText {
  const guest = headlineGuest(row);
  return {
    kicker: `${seriesOf(row).short} · ${longDate(row.airDate)}`.toUpperCase(),
    title: clip(showSubject(row), 70),
    subtitle: guest ? clip(`with ${guest}`, 80) : undefined,
    footer: row.aiCategory,
  };
}

export function ShowCard({ card, palette }: { card: CardText; palette: typeof PALETTE }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: palette.midnight,
        padding: "56px 72px",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: palette.amber, display: "flex" }} />
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 6, color: palette.amber, display: "flex" }}>
          HIGH DESERT
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        <div style={{ fontSize: 28, letterSpacing: 3, color: palette.blue, display: "flex", marginBottom: 18 }}>
          {card.kicker}
        </div>
        <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, color: palette.chromeLighter, display: "flex" }}>
          {card.title}
        </div>
        {card.subtitle ? (
          <div style={{ fontSize: 40, lineHeight: 1.2, color: palette.chrome, display: "flex", marginTop: 20 }}>
            {card.subtitle}
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: `2px solid ${palette.edge}`,
          paddingTop: 22,
          fontSize: 26,
          color: palette.muted,
        }}
      >
        <div style={{ display: "flex" }}>Art Bell radio archive · highdesert.space</div>
        {card.footer ? <div style={{ display: "flex", color: palette.green }}>{card.footer}</div> : null}
      </div>
    </div>
  );
}
