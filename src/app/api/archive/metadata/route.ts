import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";

const AUDIO_FORMATS = new Set(["VBR MP3", "MP3", "128Kbps MP3", "64Kbps MP3", "Ogg Vorbis"]);
const FETCH_TIMEOUT = 25000; // 25s — allow for slow archive.org responses while staying under Vercel 30s limit

export async function GET(request: NextRequest) {
  // The same budget as search and scrape (HD-027): each call is an outbound
  // archive.org request on this server's address, and this was the one proxy
  // anyone could drive at full speed.
  const ip = getClientKey(request);
  const rl = rateLimit(`metadata:${ip}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }

  // Sanitize identifier
  const sanitized = id.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!sanitized) {
    return NextResponse.json({ error: "Invalid id parameter" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const res = await fetch(
      `https://archive.org/metadata/${encodeURIComponent(sanitized)}`,
      {
        signal: controller.signal,
        next: { revalidate: 3600 },
      },
    );

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: "Archive.org metadata fetch failed" },
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

    const metadata = data.metadata as Record<string, string> | undefined;
    const files = data.files as Record<string, string>[] | undefined;

    const audioFiles = (files ?? []).filter(
      (f) => AUDIO_FORMATS.has(f.format),
    );

    return NextResponse.json({
      identifier: metadata?.identifier,
      metadata: {
        title: metadata?.title,
        date: metadata?.date,
        description: metadata?.description,
        creator: metadata?.creator,
      },
      files: audioFiles.map((f) => ({
        name: f.name,
        format: f.format,
        size: f.size,
        length: f.length,
        source: f.source,
      })),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.json(
        { error: "Archive.org request timed out" },
        { status: 504 },
      );
    }
    console.error("[metadata] Error:", err);
    return NextResponse.json(
      { error: "Metadata fetch failed" },
      { status: 500 },
    );
  }
}
