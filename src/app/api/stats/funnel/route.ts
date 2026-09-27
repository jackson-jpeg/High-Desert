import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { getFunnel, isAcceptableCohort, isFunnelStep, recordFunnelStep } from "@/services/stats/store";
import { readJsonObject } from "@/lib/utils/json-body";

/**
 * The arrival funnel (docs/funnel.md).
 *
 * POST `{step, cohort}`: one browser reached `step` (`visit`, `live`, `tune`,
 * `call`) for the first time, and it first arrived on `cohort` (a UTC date).
 * Adds one to that counter. Returns `{ok}`. Nothing else is stored: no
 * session, no address, no id. The browser keeps "already reported" itself
 * (src/services/stats/funnel-client.ts). Like every other counter here it can
 * be inflated by someone who wants to; it is rate limited per client.
 *
 * GET `?days=7|30|90`: `{days, cohorts: [{day, visit, live, tune, call}],
 * totals: {visit, live, tune, call}}`, cohorts oldest first. What
 * `highdesert-status`'s `funnel` line reads.
 */
function limited(key: string, maxRequests: number): NextResponse | null {
  const rl = rateLimit(key, { maxRequests, windowMs: 60_000 });
  if (rl.allowed) return null;
  return NextResponse.json(
    { error: "Rate limited" },
    { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
  );
}

export async function POST(request: NextRequest) {
  // A browser posts each step once, ever: four in its lifetime. Ten a minute
  // leaves room for a household behind one address and nothing much more.
  const blocked = limited(`stats-funnel:${getClientKey(request)}`, 10);
  if (blocked) return blocked;

  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const { step, cohort } = parsed.body;
  if (!isFunnelStep(step)) {
    return NextResponse.json({ error: "step must be visit, live, tune or call" }, { status: 400 });
  }
  if (!isAcceptableCohort(cohort)) {
    return NextResponse.json({ error: "cohort must be a recent YYYY-MM-DD" }, { status: 400 });
  }

  try {
    await recordFunnelStep(cohort, step);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stats/funnel] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  const blocked = limited(`stats-funnel-read:${getClientKey(request)}`, 30);
  if (blocked) return blocked;
  const daysParam = Number(request.nextUrl.searchParams.get("days") ?? 7);
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 7;
  try {
    return NextResponse.json(await getFunnel(days), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[stats/funnel] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
