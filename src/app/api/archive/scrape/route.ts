import { NextRequest, NextResponse } from "next/server";

const SCRAPE_URL = "https://archive.org/services/search/v1/scrape";
const QUERY = 'mediatype:audio AND (creator:"Art Bell" OR title:"Coast to Coast" OR title:"Dreamland" OR subject:"Art Bell")';
const FIELDS = "identifier,title,date,description,creator,downloads";
const FETCH_TIMEOUT = 30000; // 30s

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const cursor = searchParams.get("cursor") ?? "";
  const count = Math.min(parseInt(searchParams.get("count") ?? "100", 10), 200);

  const params = new URLSearchParams({
    q: QUERY,
    fields: FIELDS,
    count: String(count),
  });

  if (cursor) {
    params.set("cursor", cursor);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const res = await fetch(`${SCRAPE_URL}?${params.toString()}`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Archive.org scrape failed: ${res.status}` },
        { status: res.status },
      );
    }

    let data: Record<string, unknown>;
    try {
      data = await res.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON from archive.org scrape API" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      items: (data.items as unknown[]) ?? [],
      cursor: (data.cursor as string) ?? null,
      total: (data.total as number) ?? 0,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.json(
        { error: "Archive.org scrape request timed out" },
        { status: 504 },
      );
    }
    console.error("[scrape] Error:", err);
    return NextResponse.json(
      { error: "Scrape request failed" },
      { status: 500 },
    );
  }
}
