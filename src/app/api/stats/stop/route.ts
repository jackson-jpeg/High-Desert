import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { removeActiveSession } from "@/services/stats/kv";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-stop:${ip}`, {
    maxRequests: 60,
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

  if (typeof sessionId !== "string" || !sessionId) {
    return NextResponse.json(
      { error: "sessionId is a required string" },
      { status: 400 },
    );
  }

  try {
    await removeActiveSession(sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stats/stop] KV error:", err);
    return NextResponse.json(
      { error: "Stats unavailable" },
      { status: 503 },
    );
  }
}
