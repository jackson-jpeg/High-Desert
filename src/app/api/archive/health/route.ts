import { NextResponse } from "next/server";

const HEALTH_TIMEOUT = 8000; // 8s — quick check

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT);

    const res = await fetch("https://archive.org/metadata/", {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const up = res.status < 500;

    return NextResponse.json(
      { up, status: res.status, checkedAt: Date.now() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        },
      },
    );
  } catch {
    // Timeout or network failure = archive is down
    return NextResponse.json(
      { up: false, status: 0, checkedAt: Date.now() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
        },
      },
    );
  }
}
