import type { Metadata } from "next";
import { RequestLineView } from "@/components/request-line/RequestLineView";
import { requestLineMetadata } from "@/lib/shows/metadata";
import { requestLineData } from "@/services/live/request-line-page";

/**
 * /request-line: today's nominations for the station's 10 PM slot, with their
 * votes (docs/request-line.md). Server-rendered on every request: the counts
 * move, and a crawler or a phone with no JavaScript reads the list as it is.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { page } = await requestLineData();
  return requestLineMetadata(page.title, page.description);
}

export default async function RequestLinePage() {
  const { available, now, page } = await requestLineData();
  return <RequestLineView page={page} available={available} now={now} />;
}
