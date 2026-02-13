import { NextRequest, NextResponse } from "next/server";

const SCRAPE_URL = "https://archive.org/services/search/v1/scrape";
const QUERY = 'mediatype:audio AND (creator:"Art Bell" OR title:"Coast to Coast")';
const FIELDS = "identifier,title,date,description,creator,downloads";

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
    const res = await fetch(`${SCRAPE_URL}?${params.toString()}`);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Archive.org scrape failed: ${res.status}` },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json({
      items: data.items ?? [],
      cursor: data.cursor ?? null,
      total: data.total ?? 0,
    });
  } catch (err) {
    console.error("[scrape] Error:", err);
    return NextResponse.json(
      { error: "Scrape request failed" },
      { status: 500 },
    );
  }
}
