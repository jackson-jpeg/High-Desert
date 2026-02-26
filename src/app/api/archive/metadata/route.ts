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
    const res = await fetch(
      `https://archive.org/metadata/${encodeURIComponent(sanitized)}`,
      {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        next: { revalidate: 3600 },
      },
    );

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

    // Null check for archive metadata response
    if (!data || data.metadata === null || data.files === null) {
      return NextResponse.json(
        { error: "Empty or null metadata response from archive.org" },
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

    // Validate required metadata fields
    const identifier = String(metadata?.identifier || '');
    if (!identifier) {
      return NextResponse.json(
        { error: "Missing identifier in metadata" },
        { status: 502 }
      );
    }

    // Validate file structure
    const validFiles = files.filter(
      (f): f is Record<string, unknown> => 
        typeof f === 'object' && 
        f !== null && 
        typeof f.name === 'string' && 
        f.name.length > 0
    );

    if (validFiles.length === 0 && files.length > 0) {
      return NextResponse.json(
        { error: "No valid files found in response" },
        { status: 502 }
      );
    }

    const audioFiles = validFiles.filter(
      (f) => AUDIO_FORMATS.has(String(f.format)),
    );

    return NextResponse.json({
      identifier,
      metadata: {
        title: String(metadata?.title || ''),
        date: String(metadata?.date || ''),
        description: String(metadata?.description || ''),
        creator: String(metadata?.creator || ''),
      },
      files: audioFiles.map((f) => ({
        name: String(f.name || ''),
        format: String(f.format || ''),
        size: String(f.size || ''),
        length: String(f.length || ''),
        source: String(f.source || ''),
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
