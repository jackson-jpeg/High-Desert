import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";

const SEARCH_URL = "https://archive.org/advancedsearch.php";

// Broad query combining the curated collection + metadata fields
// Note: "Dreamland" alone causes false positives (old songs); Art Bell's Dreamland
// episodes are covered by collection:artbellshows and subject:"Art Bell"
const QUERY = [
  "mediatype:audio AND (",
  'collection:artbellshows',
  ' OR subject:"Art Bell"',
  ' OR creator:"Art Bell"',
  ' OR title:"Coast to Coast AM"',
  ' OR title:"Art Bell"',
  ' OR title:"Midnight in the Desert"',
  ' OR title:"Area 2000"',
  ")",
].join("");

const FIELDS = "identifier,title,date,description,creator,downloads";
const FETCH_TIMEOUT = 30000;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken || token !== adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit(`scrape:${ip}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  // Check archive.org rate limit
  const { rateLimit: archiveRateLimit } = await import('@/lib/utils/rate-limit');
  const archiveRl = archiveRateLimit.createArchiveRateLimiter().check();
  if (!archiveRl.allowed) {
    return NextResponse.json(
      { error: "Rate limited by archive.org" },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(archiveRl.retryAfterMs / 1000)) } }
    );
  }

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const rows = Math.min(parseInt(searchParams.get("rows") ?? "100", 10), 200);

  const params = new URLSearchParams({
    q: QUERY,
    fl: FIELDS,
    sort: "date asc",
    output: "json",
    rows: String(rows),
    page: String(page),
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Archive.org search failed: ${res.status}` },
        { status: res.status },
      );
    }

    let data: Record<string, unknown>;
    try {
      data = await res.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON from archive.org" },
        { status: 502 },
      );
    }

    const response = data.response as { numFound?: number; docs?: unknown[] } | undefined;
    const numFound = response?.numFound ?? 0;
    const docs = (response?.docs as unknown[]) ?? [];
    const totalPages = Math.ceil(numFound / rows);

    return NextResponse.json({
      items: docs,
      page,
      totalPages,
      total: numFound,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.json(
        { error: "Archive.org request timed out" },
        { status: 504 },
      );
    }
    console.error("[scrape] Error:", err);
    return NextResponse.json(
      { error: "Catalog request failed" },
      { status: 500 },
    );
  }
}
