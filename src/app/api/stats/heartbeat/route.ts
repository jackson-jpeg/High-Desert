import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { recordHeartbeat } from "@/services/stats/store";

const SESSION_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * Marks a session present. Every open tab posts here on an interval, which is
 * what makes the "online" figure mean "people on the site" rather than "people
 * who happened to press play in the last five minutes".
 *
 * Response shape: `{ ok: true, online, listening }` — the counts are returned
 * so a client can refresh its own display from the same round trip instead of
 * immediately polling /api/stats/active. Document changes here; CLAUDE.md
 * records why response shapes in this directory are worth being careful with.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  // One tab beats every 60s. 20/min leaves room for several tabs plus retries
  // while still capping what a single client can write.
  const rl = rateLimit(`stats-heartbeat:${ip}`, {
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId } = body as Record<string, unknown>;

  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json(
      { error: "Invalid sessionId format" },
      { status: 400 },
    );
  }

  try {
    await recordHeartbeat(sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stats/heartbeat] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
