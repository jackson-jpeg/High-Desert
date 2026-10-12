import { NextRequest, NextResponse } from "next/server";
import { showByKey } from "@/lib/shows/by-key";
import { SHOW_KEY_PATTERN } from "@/lib/library/intents";
import { showPath } from "@/lib/shows/describe";

/**
 * `GET /api/shows/link?key=<communityKey>` → `{slug, path}`: a show's page,
 * for the browser's Share buttons (src/hooks/useShowSlug.ts). The slug map
 * (data/show-slugs.json, 270 KB) stays on the server. 404 `{error}` for a key
 * that is not a catalog show (a local file, an import); 400 for a malformed one.
 *
 * Slugs are permanent, so an answer may be kept a day; a 404 only an hour,
 * since a deploy can add the show.
 */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (!SHOW_KEY_PATTERN.test(key)) {
    return NextResponse.json({ error: "bad-key" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const show = showByKey(key);
  if (!show) {
    return NextResponse.json({ error: "not-a-show" }, { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });
  }
  return NextResponse.json(
    { slug: show.slug, path: showPath(show.slug) },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
