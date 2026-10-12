import { NextResponse, type NextRequest } from "next/server";
import { LOOK_COOKIE, LOOK_VIEW_COOKIE, verifyLook } from "@/lib/look/look";
import { DIAL_HREF, radioRetired } from "@/lib/look/nav";

/**
 * Keeps the script-readable look cookie in step with the signed one
 * (src/lib/look/look.ts). A request with neither cookie, which is every
 * public visitor, passes through untouched.
 */
export async function proxy(request: NextRequest) {
  const signed = request.cookies.get(LOOK_COOKIE)?.value;
  const view = request.cookies.get(LOOK_VIEW_COOKIE)?.value;
  if (!signed && !view) return NextResponse.next();

  const look = await verifyLook(signed, process.env.HD_LOOK_KEY);
  // The preview looks have no Radio tab: /radio is the Library's Dial mode
  // (src/lib/look/nav.ts). The public look never gets here with a look.
  const res = look && radioRetired(look) && request.nextUrl.pathname === "/radio"
    ? NextResponse.redirect(new URL(DIAL_HREF, request.url), 307)
    : NextResponse.next();
  if (look) {
    if (view !== look) {
      const exp = Number(signed!.split(".")[2]);
      res.cookies.set(LOOK_VIEW_COOKIE, look, {
        path: "/",
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        maxAge: Math.max(1, Math.floor((exp - Date.now()) / 1000)),
      });
    }
  } else if (view) {
    res.cookies.delete(LOOK_VIEW_COOKIE);
  }
  return res;
}

export const config = {
  // Documents only: the cookie matters where the boot script reads it.
  matcher: ["/((?!api/|live-api/|mirror/|_next/|seed/|fonts/|icons/|audio/|.*\\.[a-z0-9]+$).*)"],
};
