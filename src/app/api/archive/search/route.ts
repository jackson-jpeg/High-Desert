import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q") ?? "";
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const rows = parseInt(searchParams.get("rows") ?? "30", 10);

  if (!q.trim()) {
    return NextResponse.json({ numFound: 0, docs: [] });
  }

  const archiveQuery = `(${q}) AND mediatype:audio AND (creator:"Art Bell" OR title:"Coast to Coast")`;
  const params = new URLSearchParams({
    q: archiveQuery,
    fl: "identifier,title,date,description,creator,downloads",
    sort: "downloads desc",
    output: "json",
    rows: String(rows),
    page: String(page),
  });

  const res = await fetch(
    `https://archive.org/advancedsearch.php?${params.toString()}`,
    { next: { revalidate: 300 } },
  );

  if (!res.ok) {
    return NextResponse.json(
      { error: "Archive.org search failed" },
      { status: res.status },
    );
  }

  const data = await res.json();
  return NextResponse.json(data.response);
}
