import { NextRequest, NextResponse } from "next/server";

const AUDIO_FORMATS = new Set(["VBR MP3", "MP3", "128Kbps MP3", "64Kbps MP3", "Ogg Vorbis"]);

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }

  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "Archive.org metadata fetch failed" },
      { status: res.status },
    );
  }

  const data = await res.json();

  const audioFiles = (data.files ?? []).filter(
    (f: Record<string, string>) => AUDIO_FORMATS.has(f.format),
  );

  return NextResponse.json({
    identifier: data.metadata?.identifier,
    metadata: {
      title: data.metadata?.title,
      date: data.metadata?.date,
      description: data.metadata?.description,
      creator: data.metadata?.creator,
    },
    files: audioFiles.map((f: Record<string, string>) => ({
      name: f.name,
      format: f.format,
      size: f.size,
      length: f.length,
      source: f.source,
    })),
  });
}
