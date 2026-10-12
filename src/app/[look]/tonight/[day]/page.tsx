import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TonightView } from "@/components/tonight/TonightView";
import { showCatalog } from "@/lib/shows/load";
import { tonightMetadata } from "@/lib/shows/metadata";
import { pacificDay } from "@/lib/live/schedule";
import { tonightDayInRange, tonightPage } from "@/lib/tonight/tonight";
import { tonightData } from "@/services/live/tonight";

/**
 * /tonight/<yyyy-mm-dd>: one station day (docs/show-pages.md, "Tonight"), a
 * permanent page per day. Past days and today read; a future day only once
 * the station has frozen its program, else 404. Without a database the page
 * still lists the date's broadcasts from the catalog.
 *
 * Rendered on first request and kept an hour (TONIGHT_REVALIDATE_S): a
 * frozen program never changes, and an hour bounds how long a day that was
 * not frozen yet (or a database that was down) is remembered that way.
 */
export const dynamicParams = true;
export const revalidate = 3600;

export function generateStaticParams(): { day: string }[] {
  return [];
}

type Props = { params: Promise<{ day: string }> };

async function load(day: string) {
  const today = pacificDay(Date.now());
  if (!tonightDayInRange(day, today)) return null;
  const data = await tonightData(day);
  // A future day exists once the station has frozen it; never from the catalog alone.
  if (day > today && !data.program) return null;
  // With a database, a past day the station never aired has no page.
  if (data.available && !data.program) return null;
  return { today, data, page: tonightPage(day, data.program, showCatalog()) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { day } = await params;
  const r = await load(day);
  return r ? tonightMetadata(day, r.page.title, r.page.description) : {};
}

export default async function TonightPage({ params }: Props) {
  const { day } = await params;
  const r = await load(day);
  if (!r) notFound();
  return (
    <TonightView day={day} today={r.today} page={r.page} available={r.data.available} prev={r.data.prev} next={r.data.next} />
  );
}
