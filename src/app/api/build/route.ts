import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { serverBuild } from "@/lib/utils/build-id";

/**
 * The build this server is running: `{ build }` (a build id, or null in
 * development). `no-store`.
 *
 * A long-lived tab compares it with its own `<meta name="hd-build">` and, when
 * they differ, reloads itself at the next natural break
 * (src/services/build/stale-tab.ts). Each open tab asks every few minutes.
 */
export async function GET(request: NextRequest) {
  const ip = getClientKey(request);
  const rl = rateLimit(`build:${ip}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  return NextResponse.json({ build: serverBuild() }, { headers: { "Cache-Control": "no-store" } });
}
