/**
 * What the Request Line page says (docs/request-line.md), from the day's
 * nominations, tonight's locked night and the catalog. Pure, so the page and
 * its share card say the same thing and a test can hold them to it.
 */

import type { ShowCatalog } from "@/lib/shows/catalog";
import type { Show } from "@/lib/shows/describe";
import { REQUEST_SHARE_TITLE } from "@/lib/live/request-line";

export interface PageNomination {
  id: number;
  fileHash: string;
  title: string;
  airDate: string | null;
  guestName: string | null;
  name: string;
  place: string | null;
  note: string | null;
  votes: number;
  /** The show's page, when it has one. */
  slug: string | null;
}

export interface TonightRequest {
  /** Null on a night nobody nominated for. */
  title: string | null;
  slug: string | null;
  by: string | null;
  place: string | null;
  votes: number;
}

export function requestLinePage(
  day: string,
  rows: readonly Omit<PageNomination, "slug">[],
  night: { fileHash: string | null; by: string | null; place: string | null; votes: number } | null,
  catalog: ShowCatalog,
) {
  const nominations: PageNomination[] = rows.map((r) => ({ ...r, slug: catalog.byHash.get(r.fileHash)?.slug ?? null }));
  const listed: Show[] = nominations.map((n) => catalog.byHash.get(n.fileHash)).filter((s): s is Show => !!s);
  const tonight: TonightRequest | null = night
    ? {
        title: night.fileHash ? (catalog.byHash.get(night.fileHash)?.row.title ?? null) : null,
        slug: night.fileHash ? (catalog.byHash.get(night.fileHash)?.slug ?? null) : null,
        by: night.by,
        place: night.place,
        votes: night.votes,
      }
    : null;
  const title = "The Request Line · High Desert";
  const count = nominations.length;
  const description =
    count > 0
      ? `${count} ${count === 1 ? "show is" : "shows are"} up for tonight's 10 PM request on High Desert Live. Vote with one tap, or pick an Art Bell show of your own.`
      : "Pick the Art Bell show High Desert Live plays tonight at 10 PM Pacific, Art's old airtime. Nominate one, and vote with one tap.";
  const top = nominations[0];
  const card = {
    title: REQUEST_SHARE_TITLE,
    subtitle: top ? `Leading tonight: ${top.title}` : "Pick tonight's 10 PM show on High Desert Live",
  };
  return { day, nominations, listed, tonight, title, description, card };
}
