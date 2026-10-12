import { NextResponse } from "next/server";
import { pacificDay } from "@/lib/live/schedule";
import { tonightPath } from "@/lib/tonight/tonight";

/**
 * `/tonight` → today's page, `/tonight/<yyyy-mm-dd>` (Pacific), the one that
 * is shared and indexed (docs/show-pages.md, "Tonight"). A temporary redirect,
 * never cached: tomorrow it points somewhere else.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new NextResponse(null, {
    status: 307,
    // Relative: behind nginx, request.url's host is the loopback one.
    headers: { Location: tonightPath(pacificDay(Date.now())), "Cache-Control": "no-store" },
  });
}
