import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { recordSample } from "@/services/stats/store";

/**
 * Writes one traffic sample. Called by the `highdesert-sample.timer` systemd
 * unit every two minutes, never by a browser.
 *
 * Guarded by a shared secret from the chmod-600 EnvironmentFile. If
 * STATS_SAMPLE_SECRET is unset the route refuses outright rather than running
 * unauthenticated — an open write endpoint is worse than a missing one.
 */
function authorized(request: NextRequest): boolean {
  const expected = process.env.STATS_SAMPLE_SECRET;
  if (!expected) return false;

  const provided = request.headers.get("x-sample-token") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so compare lengths first —
  // that leaks only the length, which the attacker chose.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sample = await recordSample();
    return NextResponse.json({ ok: true, ...sample });
  } catch (err) {
    console.error("[stats/sample] store error:", err);
    return NextResponse.json(
      { error: "Stats service unavailable" },
      { status: 503 },
    );
  }
}
