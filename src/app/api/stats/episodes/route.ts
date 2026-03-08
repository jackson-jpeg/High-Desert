import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { getEpisodeCounts } from "@/services/stats/kv";

const ID_PATTERN = /^[a-zA-Z0-9._-]+$/;
const MAX_IDS = 100;
const MAX_ID_LENGTH = 200;

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-episodes:${ip}`, {
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const raw = request.nextUrl.searchParams.get("ids");
  if (!raw) {
    return NextResponse.json(
      { error: "Missing ids parameter" },
      { status: 400 },
    );
  }

  const ids = raw.split(",").filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Provide between 1 and ${MAX_IDS} ids` },
      { status: 400 },
    );
  }

  for (const id of ids) {
    if (id.length > MAX_ID_LENGTH || !ID_PATTERN.test(id)) {
      return NextResponse.json(
        { error: `Invalid id: ${id}` },
        { status: 400 },
      );
    }
  }

  try {
    const counts = await getEpisodeCounts(ids);
    return NextResponse.json({ counts });
  } catch (err) {
    console.error("[stats/episodes] KV error:", err);
    return NextResponse.json(
      { error: "Stats service unavailable" },
      { status: 503 },
    );
  }
}
