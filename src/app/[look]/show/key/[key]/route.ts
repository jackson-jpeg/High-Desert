import { NextResponse } from "next/server";
import { showCatalog } from "@/lib/shows/load";
import { showPath, type Show } from "@/lib/shows/describe";
import { communityKey } from "@/lib/utils/community-key";

/**
 * `/show/key/<communityKey>` → 308 to the show's page. The library knows a
 * show by its community key, not its slug (the slug map stays on the server,
 * docs/show-pages.md), so the episode panel's "Show page" link comes here.
 */

let byKey: Map<string, Show> | null = null;

function lookup(key: string): Show | undefined {
  if (!byKey) {
    byKey = new Map();
    for (const show of showCatalog().shows) {
      const k = communityKey(show.row);
      if (k) byKey.set(k, show);
    }
  }
  return byKey.get(key);
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const show = lookup(key);
  if (!show) return new NextResponse("Not found", { status: 404 });
  // A relative Location: behind nginx, request.url's host is the loopback one.
  return new NextResponse(null, { status: 308, headers: { Location: showPath(show.slug) } });
}
