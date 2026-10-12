import { NextResponse } from "next/server";
import { showByKey } from "@/lib/shows/by-key";
import { showPath } from "@/lib/shows/describe";
import { parseMomentSeconds } from "@/lib/shows/share";

/**
 * `/show/key/<communityKey>` → 308 to the show's page. The library knows a
 * show by its community key, not its slug (the slug map stays on the server,
 * docs/show-pages.md), so the episode panel's "Show page" link comes here,
 * and so does a moment shared before the browser knew the slug:
 * `?t=<seconds>` is carried to `/show/<slug>?t=<seconds>`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const show = showByKey(key);
  if (!show) return new NextResponse("Not found", { status: 404 });
  const t = parseMomentSeconds(new URL(request.url).searchParams.get("t"));
  // A relative Location: behind nginx, request.url's host is the loopback one.
  return new NextResponse(null, { status: 308, headers: { Location: `${showPath(show.slug)}${t !== null ? `?t=${t}` : ""}` } });
}
