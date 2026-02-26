import { NextRequest, NextResponse } from "next/server";

const AUDIO_FORMATS = new Set(["VBR MP3", "MP3", "128Kbps MP3", "64Kbps MP3", "Ogg Vorbis"]);
const FETCH_TIMEOUT = 25000; // 25s — allow for slow archive.org responses while staying under Vercel 30s limit

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken || token !== adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: "Missing or invalid id parameter" }, { status: 400 });
  }

  // Block path traversal attempts
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    return NextResponse.json({ error: "Invalid id parameter" }, { status: 400 });
  }

  // Validate identifier format (alphanumeric with hyphens/underscores)
  const identifierRegex = /^[a-zA-Z0-9._-]+$/;
  if (!identifierRegex.test(id)) {
    return NextResponse.json({ error: "Invalid identifier format. Use only letters, numbers, hyphens, underscores, and periods" }, { status: 400 });
  }

  // Sanitize identifier
  const sanitized = id.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!sanitized) {
    return NextResponse.json({ error: "Invalid id parameter" }, { status: 400 });
  }

  // Check archive.org rate limit
  const { rateLimit: archiveRateLimit } = await import('@/lib/utils/rate-limit');
  const rl = archiveRateLimit.createArchiveRateLimiter().check();
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited by archive.org" },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
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

    // Validate response structure
    if (!data || typeof data !== 'object') {
      return NextResponse.json(
        { error: "Invalid response structure from archive.org" },
        { status: 502 }
      );
    }

    const metadata = data.metadata as Record<string, unknown> | undefined;
    const files = data.files as Record<string, unknown>[] | undefined;

    // Ensure metadata and files are valid
    if (!metadata || typeof metadata !== 'object') {
      return NextResponse.json(
        { error: "Missing or invalid metadata in response" },
        { status: 502 }
      );
    }

    if (!Array.isArray(files)) {
      return NextResponse.json(
        { error: "Missing or invalid files array in response" },
        { status: 502 }
      );
    }

    // Ensure metadata and files are valid
    if (!metadata || typeof metadata !== 'object') {
      return NextResponse.json(
        { error: "Missing or invalid metadata in response" },
        { status: 502 }
      );
    }

    if (!Array.isArray(files)) {
      return NextResponse.json(
        { error: "Missing or invalid files array in response" },
        { status: 502 }
      );
    }

    const audioFiles = files.filter(
      (f) => typeof f === 'object' && f !== null && AUDIO_FORMATS.has(String((f as Record<string, unknown>).format)),
    );

    return NextResponse.json({
      identifier: String(metadata?.identifier || ''),
      metadata: {
        title: String(metadata?.title || ''),
        date: String(metadata?.date || ''),
        description: String(metadata?.description || ''),
        creator: String(metadata?.creator || ''),
      },
      files: audioFiles.map((f) => {
        const file = f as Record<string, unknown>;
        return {
          name: String(file.name || ''),
          format: String(file.format || ''),
          size: String(file.size || ''),
          length: String(file.length || ''),
          source: String(file.source || ''),
        };
      }),
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
