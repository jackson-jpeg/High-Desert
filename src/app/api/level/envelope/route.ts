import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { SHOW_KEY_PATTERN } from "@/lib/library/intents";
import { showByKey } from "@/lib/shows/by-key";
import { readEnvelope } from "@/services/stats/db/envelopes";
import { ENVELOPE_VERSION, packEnvelope } from "@/lib/audio/level-envelope";

/**
 * `GET /api/level/envelope?key=<communityKey>`: the show's two-pass Level
 * envelope (src/lib/audio/level-envelope.ts, `packEnvelope`), binary.
 * 404 `{error: "none"}` while the job has not reached it (the browser then
 * uses the live leveler), cached briefly since one may arrive; 404
 * `{error: "not-a-show"}` for a key outside the catalog; 400 for a malformed
 * key; 503 without a database. An envelope never changes at its version, so
 * it may be kept a day. 120/min.
 */
export async function GET(request: NextRequest) {
  const rl = rateLimit(`level-envelope:${getClientKey(request)}`, { maxRequests: 120, windowMs: 60_000 });
  if (!rl.allowed) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (!SHOW_KEY_PATTERN.test(key)) {
    return NextResponse.json({ error: "bad-key" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const show = showByKey(key);
  if (!show) {
    return NextResponse.json({ error: "not-a-show" }, { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });
  }
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  let q: Int8Array | null;
  try {
    q = await readEnvelope(show.row.fileHash, ENVELOPE_VERSION);
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!q) return NextResponse.json({ error: "none" }, { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
  return new NextResponse(Buffer.from(packEnvelope(q)), {
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=86400" },
  });
}
