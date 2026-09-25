/**
 * Server side: is archive.org up? One probe answers every caller for a while.
 *
 * Shared by `/api/archive/health` (every tab polls it, useOutageMonitor) and
 * `/api/live/schedule` (the outage swap). Two routes, one memo: the state is
 * kept on `globalThis` because Next.js may give each route its own copy of a
 * module, and two memos would mean two probes and — briefly — two different
 * answers to the same question.
 *
 * Unmemoised, each poll was its own HEAD to archive.org — and during an outage
 * each of those waits out the 8 s timeout, so a room full of listeners became
 * a room full of hanging sockets pointed at a host that is already struggling.
 * Concurrent requests share the probe in flight.
 *
 * The memo is shorter than either client TTL, so it never makes the verdict a
 * client acts on older than the client itself would allow: a down verdict is
 * reused for 10 s, an up one for 60 s.
 */

export const HEALTH_TIMEOUT = 8000; // 8s — quick check
export const UP_MEMO_MS = 60_000;
export const DOWN_MEMO_MS = 10_000;

export interface Verdict {
  up: boolean;
  status: number;
  checkedAt: number;
}

interface MemoState {
  memo: Verdict | null;
  inFlight: Promise<Verdict> | null;
}

const KEY = Symbol.for("high-desert.archive-verdict");
function state(): MemoState {
  const g = globalThis as unknown as Record<symbol, MemoState | undefined>;
  return (g[KEY] ??= { memo: null, inFlight: null });
}

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

/** The shared verdict: memoised, and one probe in flight at most. Never throws. */
export async function archiveVerdict(): Promise<Verdict> {
  const s = state();
  if (s.memo && Date.now() - s.memo.checkedAt < (s.memo.up ? UP_MEMO_MS : DOWN_MEMO_MS)) return s.memo;
  s.inFlight ??= probe().then((v) => {
    s.memo = v;
    s.inFlight = null;
    return v;
  });
  return s.inFlight;
}

/**
 * The verdict without making the caller wait out a probe: the memo if there is
 * one (stale or not — a stale one also starts a refresh in the background),
 * else a fresh probe given at most `maxWaitMs`; past that, `null` — unknown,
 * which callers treat as up. For the live schedule, which must answer promptly
 * even while archive.org hangs every request for 8 s.
 */
export async function archiveVerdictPrompt(maxWaitMs = 1500): Promise<Verdict | null> {
  const s = state();
  const known = s.memo;
  const fresh = archiveVerdict();
  if (known) return known;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), maxWaitMs);
  });
  try {
    return await Promise.race([fresh, late]);
  } finally {
    clearTimeout(timer);
  }
}

export function resetArchiveVerdictForTests(): void {
  const s = state();
  s.memo = null;
  s.inFlight = null;
}
