import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";

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
  
  // Defense against injection attacks: sanitize input, validate length, and use URL encoding
  // The sanitized query is URL-encoded and sent to archive.org, not executed locally
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const rows = parseInt(searchParams.get("rows") ?? "30", 10);
  
  if (isNaN(page) || page < 1) {
    return NextResponse.json(
      { error: "Invalid page parameter" },
      { status: 400 }
    );
  }
  
  if (isNaN(rows) || rows < 1 || rows > 200) {
    return NextResponse.json(
      { error: "Invalid rows parameter (max 200)" },
      { status: 400 }
    );
  }

  // Enhanced sanitization: remove dangerous characters and patterns
  const q = rawQ
    .replace(/['"\\<>]/g, "") // Remove quotes, backslashes, angle brackets
    .replace(/[;|&$`]/g, "") // Remove shell metacharacters
    .replace(/\b(drop|delete|insert|update|union|select|exec|script|javascript|vbscript)\b/gi, "") // Remove SQL/JS keywords
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
  
  if (q.length < 2 || q.length > 500) {
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

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    res = await fetch(
      `https://archive.org/advancedsearch.php?${params.toString()}`,
      { signal: controller.signal, next: { revalidate: 300 } },
    );

    clearTimeout(timeout);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.json(
        { error: "Archive.org request timed out" },
        { status: 504 },
      );
    }
    console.error("[search] Error:", err);
    return NextResponse.json(
      { error: "Archive.org search failed" },
      { status: 500 },
    );
  }

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

  return NextResponse.json((data.response as Record<string, unknown>) ?? { numFound: 0, docs: [] });
}
