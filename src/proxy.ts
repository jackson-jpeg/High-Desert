import { NextResponse, type NextRequest } from "next/server";
import { isLook, LOOK_COOKIE } from "@/lib/look/look";
import { DIAL_HREF } from "@/lib/look/nav";

/**
 * Page requests. The look itself is a rewrite in next.config.ts (see there for
 * why it is not done here); this only:
 *
 *   - sends /radio to the Library's Dial mode, in both looks (src/lib/look/nav.ts);
 *   - sends a path that names a look (/night/library) to the page's one URL
 *     (/library), so a look is never a second address for a page;
 *   - removes the owner's preview cookies from before the looks went public: a
 *     signed, HttpOnly `hd_look` that script cannot overwrite, so the Display
 *     setting could never change it, and its script-readable copy. Only the
 *     server can remove the first.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/radio") {
    return NextResponse.redirect(new URL(DIAL_HREF, request.url), 308);
  }
  // One URL per page: the look is the cookie's business, never the path's.
  const named = LOOK_IN_PATH.exec(pathname);
  if (named) {
    const url = new URL(request.url);
    url.pathname = named[1] || "/";
    return NextResponse.redirect(url, 308);
  }
  const raw = request.cookies.get(LOOK_COOKIE)?.value;
  const legacyView = request.cookies.has(LEGACY_VIEW_COOKIE);
  if ((raw === undefined || isLook(raw)) && !legacyView) return NextResponse.next();
  const res = NextResponse.next();
  if (raw !== undefined && !isLook(raw)) res.cookies.delete(LOOK_COOKIE);
  if (legacyView) res.cookies.delete(LEGACY_VIEW_COOKIE);
  return res;
}

const LEGACY_VIEW_COOKIE = "hd_look_view";
const LOOK_IN_PATH = /^\/(?:win98|night)(\/.*)?$/;

export const config = {
  // Pages only. Share cards (opengraph-image, twitter-image) are served from
  // outside the look segment, so their URLs carry no look.
  matcher: [
    "/((?!api/|live-api/|mirror/|_next/|seed/|fonts/|icons/|audio/|.*opengraph-image|.*twitter-image|.*\\.[a-z0-9]+$).*)",
  ],
};
