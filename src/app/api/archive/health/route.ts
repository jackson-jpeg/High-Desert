import { NextResponse } from "next/server";

const HEALTH_TIMEOUT = 8000; // 8s — quick check

/**
 * One probe of archive.org answers every client for a little while.
 *
 * Every open tab polls this route (useOutageMonitor): every 5 minutes while
 * archive.org is up and every 30 s while it is down. Unmemoised, each poll
 * was its own HEAD to archive.org — and during an outage each of those waits
 * out the 8 s timeout, so a room full of listeners became a room full of
 * hanging sockets pointed at a host that is already struggling. Concurrent
 * requests share the probe in flight.
 *
 * The memo is shorter than either client TTL, so it never makes the verdict a
 * client acts on older than the client itself would allow: a down verdict is
 * reused for 10 s, an up one for 60 s.
 */
export const UP_MEMO_MS = 60_000;
export const DOWN_MEMO_MS = 10_000;

interface Verdict {
  up: boolean;
  status: number;
  checkedAt: number;
}

let memo: Verdict | null = null;
let inFlight: Promise<Verdict> | null = null;

async function probe(): Promise<Verdict> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT);
    const res = await fetch("https://archive.org/metadata/", {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { up: res.status < 500, status: res.status, checkedAt: Date.now() };
  } catch {
    // Timeout or network failure = archive is down
    return { up: false, status: 0, checkedAt: Date.now() };
  }
}

async function verdict(): Promise<Verdict> {
  if (memo && Date.now() - memo.checkedAt < (memo.up ? UP_MEMO_MS : DOWN_MEMO_MS)) return memo;
  inFlight ??= probe().then((v) => {
    memo = v;
    inFlight = null;
    return v;
  });
  return inFlight;
}

export async function GET() {
  const v = await verdict();
  return NextResponse.json(v, {
    headers: {
      "Cache-Control": v.up
        ? "public, s-maxage=300, stale-while-revalidate=60"
        : "public, s-maxage=60, stale-while-revalidate=30",
    },
  });
}

export const __testing = {
  reset() {
    memo = null;
    inFlight = null;
  },
};
