import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/utils/rate-limit";
import { rateLimit } from "@/lib/api";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken || token !== adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit(`search:${ip}`, { maxRequests: 30, windowMs: 60_000 });
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
  
  if (!searchParams.has("q")) {
    return NextResponse.json(
      { error: "Missing required parameter: q" },
      { status: 400 }
    );
  }
  
  const rawQ = searchParams.get("q") ?? "";
  if (!rawQ.trim()) {
    return NextResponse.json(
      { error: "Query parameter q cannot be empty" },
      { status: 400 }
    );
  }
  
  // Additional validation for query parameter
  if (rawQ.length > 500) {
    return NextResponse.json(
      { error: "Query parameter q is too long (max 500 characters)" },
      { status: 400 }
    );
  }
  
  // Validate parameter types and ranges
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const rows = parseInt(searchParams.get("rows") ?? "30", 10);
  const frequency = searchParams.get("frequency");
  
  if (isNaN(page) || page < 1 || page > 1000) {
    return NextResponse.json(
      { error: "Invalid page parameter (must be 1-1000)" },
      { status: 400 }
    );
  }
  
  if (isNaN(rows) || rows < 1 || rows > 200) {
    return NextResponse.json(
      { error: "Invalid rows parameter (must be 1-200)" },
      { status: 400 }
    );
  }
  
  if (frequency !== null) {
    const freqNum = parseFloat(frequency);
    if (isNaN(freqNum) || freqNum <= 0) {
      return NextResponse.json(
        { error: "Invalid frequency parameter (must be a positive number)" },
        { status: 400 }
      );
    }
  }
  
  // Use URLSearchParams to safely encode the user-supplied query
  const encodedQ = encodeURIComponent(rawQ.trim());

  if (encodedQ.length < 2 || encodedQ.length > 500) {
    return NextResponse.json({ error: "Query parameter q is invalid" }, { status: 400 });
  }

  const archiveQuery = `(${encodedQ}) AND mediatype:audio AND (creator:"Art Bell" OR title:"Coast to Coast")`;
  const params = new URLSearchParams({
    q: archiveQuery,
    fl: "identifier,title,date,description,creator,downloads",
    sort: "downloads desc",
    output: "json",
    rows: String(rows),
    page: String(page),
  });

  const { retryFetch } = await import('@/lib/utils/retry');
  const res = await retryFetch(
    `https://archive.org/advancedsearch.php?${params.toString()}`,
    {
      timeout: 30000,
      next: { revalidate: 300 },
    }
  );
  if (!res.ok) {
    return NextResponse.json(
      { error: "Archive.org search failed" },
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

  const response = data.response as Record<string, unknown> | undefined;
  if (!response || typeof response !== 'object') {
    return NextResponse.json(
      { error: "Missing or invalid response field" },
      { status: 502 }
    );
  }

  const numFound = response.numFound as number | undefined;
  const docs = response.docs as unknown[] | undefined;

  if (typeof numFound !== 'number' || numFound < 0) {
    return NextResponse.json(
      { error: "Invalid or missing numFound field" },
      { status: 502 }
    );
  }

  if (!Array.isArray(docs)) {
    return NextResponse.json(
      { error: "Invalid or missing docs array" },
      { status: 502 }
    );
  }

  // Validate each document has required identifier
  const validDocs = docs.filter((doc): doc is Record<string, unknown> => 
    typeof doc === 'object' && 
    doc !== null && 
    typeof (doc as Record<string, unknown>).identifier === 'string' &&
    (doc as Record<string, unknown>).identifier.length > 0
  );

  return NextResponse.json({
    numFound: validDocs.length,
    docs: validDocs
  });
}
