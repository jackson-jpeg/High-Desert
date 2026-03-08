# Community Stats Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add server-side aggregate listening stats (per-episode play counts, leaderboards, active listeners) via Vercel KV, surfaced in the existing UI.

**Architecture:** Vercel KV (Upstash Redis) stores counters and sorted sets. Five thin API routes handle reads/writes. Client fires play/stop events alongside existing Umami tracking. A `useCommunityStats` hook provides debounced batch counts to the library. Stats page gets a Community Top 20 widget. Status bar shows active listener count.

**Tech Stack:** `@vercel/kv`, Next.js API routes, Zustand (existing), existing `fetchWithRetry` and `rateLimit` utilities.

**Design doc:** `docs/plans/2026-03-08-community-stats-design.md`

---

### Task 1: Install dependency and configure env

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.env.local`

**Step 1: Install `@vercel/kv`**

Run: `npm install @vercel/kv`

**Step 2: Update `.env.example`**

Add after the existing `NEXT_PUBLIC_ADMIN_TOKEN` line:

```
# Vercel KV (community stats). Auto-populated when you link a KV store in Vercel dashboard.
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

**Step 3: Create Vercel KV store**

Run: `vercel kv create high-desert-stats` (or create via Vercel dashboard → Storage → KV → Create)

Then: `vercel env pull .env.local` to populate the KV env vars locally.

**Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add @vercel/kv dependency for community stats"
```

---

### Task 2: Server-side KV service layer

**Files:**
- Create: `src/services/stats/kv.ts`

**Step 1: Create the KV service module**

This wraps all Redis operations. API routes call these functions — they never import `@vercel/kv` directly.

```typescript
import { kv } from "@vercel/kv";

// ── Helpers ──

function weekKey(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `lb:week:${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── Writes ──

export async function recordPlay(episodeId: string, sessionId: string): Promise<void> {
  const wk = weekKey();
  await Promise.all([
    kv.incr(`ep:${episodeId}`),
    kv.zincrby("lb:alltime", 1, episodeId),
    kv.zincrby(wk, 1, episodeId),
    kv.zadd("active", { score: Date.now(), member: sessionId }),
  ]);
  // Set 14-day TTL on weekly key (idempotent — resets each write, which is fine)
  await kv.expire(wk, 14 * 24 * 60 * 60);
}

export async function removeActiveSession(sessionId: string): Promise<void> {
  await kv.zrem("active", sessionId);
}

// ── Reads ──

export async function getEpisodeCounts(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const keys = ids.map((id) => `ep:${id}`);
  const values = await kv.mget<(number | null)[]>(...keys);
  const result: Record<string, number> = {};
  for (let i = 0; i < ids.length; i++) {
    const v = values[i];
    if (v && v > 0) result[ids[i]] = v;
  }
  return result;
}

export async function getLeaderboard(
  period: "alltime" | "week",
  limit = 20,
): Promise<{ episodeId: string; plays: number }[]> {
  const key = period === "alltime" ? "lb:alltime" : weekKey();
  const raw = await kv.zrange(key, 0, limit - 1, { rev: true, withScores: true });
  // raw is [member, score, member, score, ...]
  const entries: { episodeId: string; plays: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({ episodeId: raw[i] as string, plays: raw[i + 1] as number });
  }
  return entries;
}

export async function getActiveCount(): Promise<number> {
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  // Prune stale entries
  await kv.zremrangebyscore("active", 0, fiveMinAgo);
  return kv.zcard("active");
}
```

**Step 2: Commit**

```bash
git add src/services/stats/kv.ts
git commit -m "feat(stats): add server-side KV service layer"
```

---

### Task 3: API routes — play and stop

**Files:**
- Create: `src/app/api/stats/play/route.ts`
- Create: `src/app/api/stats/stop/route.ts`

**Step 1: Create POST `/api/stats/play`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { recordPlay } from "@/services/stats/kv";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-play:${ip}`, { maxRequests: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
    });
  }

  let body: { episodeId?: string; sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { episodeId, sessionId } = body;
  if (!episodeId || typeof episodeId !== "string" || !sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "Missing episodeId or sessionId" }, { status: 400 });
  }

  // Sanitize — archive identifiers are alphanumeric with dots, hyphens, underscores
  if (!/^[a-zA-Z0-9._-]+$/.test(episodeId) || episodeId.length > 200) {
    return NextResponse.json({ error: "Invalid episodeId" }, { status: 400 });
  }

  try {
    await recordPlay(episodeId, sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stats/play] KV error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
```

**Step 2: Create POST `/api/stats/stop`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { removeActiveSession } from "@/services/stats/kv";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-stop:${ip}`, { maxRequests: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
    });
  }

  let body: { sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId } = body;
  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  try {
    await removeActiveSession(sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stats/stop] KV error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
```

**Step 3: Commit**

```bash
git add src/app/api/stats/play/route.ts src/app/api/stats/stop/route.ts
git commit -m "feat(stats): add play/stop API routes"
```

---

### Task 4: API routes — reads (episodes, leaderboard, active)

**Files:**
- Create: `src/app/api/stats/episodes/route.ts`
- Create: `src/app/api/stats/leaderboard/route.ts`
- Create: `src/app/api/stats/active/route.ts`

**Step 1: Create GET `/api/stats/episodes`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { getEpisodeCounts } from "@/services/stats/kv";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-episodes:${ip}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
    });
  }

  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json({ error: "Missing ids parameter" }, { status: 400 });
  }

  const ids = idsParam.split(",").filter(Boolean).slice(0, 100);
  if (ids.length === 0) {
    return NextResponse.json({ counts: {} });
  }

  // Validate each ID
  for (const id of ids) {
    if (!/^[a-zA-Z0-9._-]+$/.test(id) || id.length > 200) {
      return NextResponse.json({ error: `Invalid id: ${id}` }, { status: 400 });
    }
  }

  try {
    const counts = await getEpisodeCounts(ids);
    return NextResponse.json({ counts });
  } catch (err) {
    console.error("[stats/episodes] KV error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
```

**Step 2: Create GET `/api/stats/leaderboard`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { getLeaderboard } from "@/services/stats/kv";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-lb:${ip}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
    });
  }

  const period = request.nextUrl.searchParams.get("period");
  if (period !== "alltime" && period !== "week") {
    return NextResponse.json({ error: "Invalid period (alltime or week)" }, { status: 400 });
  }

  try {
    const entries = await getLeaderboard(period);
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("[stats/leaderboard] KV error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
```

**Step 3: Create GET `/api/stats/active`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { getActiveCount } from "@/services/stats/kv";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-active:${ip}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
    });
  }

  try {
    const count = await getActiveCount();
    return NextResponse.json({ count });
  } catch (err) {
    console.error("[stats/active] KV error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
```

**Step 4: Commit**

```bash
git add src/app/api/stats/episodes/route.ts src/app/api/stats/leaderboard/route.ts src/app/api/stats/active/route.ts
git commit -m "feat(stats): add read API routes (episodes, leaderboard, active)"
```

---

### Task 5: Client-side stats service

**Files:**
- Create: `src/services/stats/client.ts`

**Step 1: Create the client service**

These are browser-facing functions that call the API routes. Writes are fire-and-forget. Reads use `fetchWithRetry` with short timeout.

```typescript
import { fetchWithRetry } from "@/lib/utils/retry";

// ── Writes (fire-and-forget) ──

export function reportPlay(episodeId: string, sessionId: string): void {
  fetch("/api/stats/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ episodeId, sessionId }),
  }).catch(() => {}); // silent fail
}

export function reportStop(sessionId: string): void {
  fetch("/api/stats/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {}); // silent fail
}

/** Reliable stop for unload — uses sendBeacon which survives page close */
export function reportStopBeacon(sessionId: string): void {
  const data = JSON.stringify({ sessionId });
  const sent = navigator.sendBeacon("/api/stats/stop", new Blob([data], { type: "application/json" }));
  if (!sent) {
    // Fallback to fetch (may not complete on unload, but worth trying)
    fetch("/api/stats/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: data,
      keepalive: true,
    }).catch(() => {});
  }
}

// ── Reads ──

export async function fetchEpisodeCounts(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  try {
    const res = await fetchWithRetry(
      `/api/stats/episodes?ids=${ids.join(",")}`,
      undefined,
      { retries: 1, timeout: 5000 },
    );
    if (!res.ok) return {};
    const data = await res.json();
    return data.counts ?? {};
  } catch {
    return {};
  }
}

export async function fetchLeaderboard(
  period: "alltime" | "week",
): Promise<{ episodeId: string; plays: number }[]> {
  try {
    const res = await fetchWithRetry(
      `/api/stats/leaderboard?period=${period}`,
      undefined,
      { retries: 1, timeout: 5000 },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.entries ?? [];
  } catch {
    return [];
  }
}

export async function fetchActiveCount(): Promise<number> {
  try {
    const res = await fetchWithRetry(
      "/api/stats/active",
      undefined,
      { retries: 1, timeout: 5000 },
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return data.count ?? 0;
  } catch {
    return 0;
  }
}
```

**Step 2: Commit**

```bash
git add src/services/stats/client.ts
git commit -m "feat(stats): add client-side stats service"
```

---

### Task 6: Hook into useAudioPlayer for play/stop tracking

**Files:**
- Modify: `src/hooks/useAudioPlayer.ts`

**Step 1: Add session ID and imports**

At the top of the file (after existing imports, around line 13), add:

```typescript
import { reportPlay, reportStop, reportStopBeacon } from "@/services/stats/client";

// ── Community stats session ──
const _sessionId = typeof crypto !== "undefined" ? crypto.randomUUID() : "ssr";
```

**Step 2: Report play on episode start**

In the `playEpisode` callback, after the existing Umami tracking block (around line 122), add:

```typescript
        // Report to community stats
        if (episode.archiveIdentifier) {
          reportPlay(episode.archiveIdentifier, _sessionId);
        }
```

**Step 3: Report stop on pause/ended/stop**

In the `flushListenTime` function (around line 31), add after the Umami tracking:

```typescript
  if (reason !== "pause") {
    reportStop(_sessionId);
  }
```

**Step 4: Use sendBeacon for unload**

In the unload flush function (around line 335-363), add after the existing `flushListenTime("unload")` call:

```typescript
      reportStopBeacon(_sessionId);
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Passes with no errors.

**Step 6: Commit**

```bash
git add src/hooks/useAudioPlayer.ts
git commit -m "feat(stats): track play/stop events to community stats"
```

---

### Task 7: `useCommunityStats` hook for batch episode counts

**Files:**
- Create: `src/hooks/useCommunityStats.ts`

**Step 1: Create the hook**

```typescript
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchEpisodeCounts } from "@/services/stats/client";

const DEBOUNCE_MS = 300;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  count: number;
  fetchedAt: number;
}

// Shared cache across hook instances
const cache = new Map<string, CacheEntry>();

export function useCommunityStats(archiveIds: string[]): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevIdsRef = useRef<string>("");

  const fetchCounts = useCallback(async (ids: string[]) => {
    const now = Date.now();

    // Filter to only IDs not in cache or expired
    const uncached = ids.filter((id) => {
      const entry = cache.get(id);
      return !entry || now - entry.fetchedAt > CACHE_TTL;
    });

    // Build result from cache first
    const result = new Map<string, number>();
    for (const id of ids) {
      const entry = cache.get(id);
      if (entry) result.set(id, entry.count);
    }

    // Fetch uncached
    if (uncached.length > 0) {
      const fresh = await fetchEpisodeCounts(uncached);
      for (const [id, count] of Object.entries(fresh)) {
        cache.set(id, { count, fetchedAt: now });
        result.set(id, count);
      }
      // Cache zero-results too (avoids re-fetching)
      for (const id of uncached) {
        if (!fresh[id]) {
          cache.set(id, { count: 0, fetchedAt: now });
        }
      }
    }

    setCounts(result);
  }, []);

  useEffect(() => {
    // Only valid archive IDs
    const validIds = archiveIds.filter(Boolean);
    if (validIds.length === 0) return;

    // Skip if IDs haven't changed
    const idsKey = validIds.join(",");
    if (idsKey === prevIdsRef.current) return;
    prevIdsRef.current = idsKey;

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchCounts(validIds), DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [archiveIds, fetchCounts]);

  return counts;
}
```

**Step 2: Commit**

```bash
git add src/hooks/useCommunityStats.ts
git commit -m "feat(stats): add useCommunityStats hook with debounced batch fetch"
```

---

### Task 8: Show play counts on EpisodeCard

**Files:**
- Modify: `src/components/library/EpisodeCard.tsx` (props + display)
- Modify: `src/app/(desktop)/library/page.tsx` (pass counts down)

**Step 1: Add `communityPlays` prop to EpisodeCard**

In `src/components/library/EpisodeCard.tsx`, add to the `EpisodeCardProps` interface (around line 10):

```typescript
  communityPlays?: number;
```

**Step 2: Display play count after duration**

In the duration section (around line 254-258), after the duration span, add:

```typescript
        {communityPlays != null && communityPlays > 0 && (
          <span className="text-hd-8 text-bevel-dark/40 tabular-nums flex-shrink-0" title={`Played ${communityPlays} times across all listeners`}>
            ▶ {communityPlays.toLocaleString()}
          </span>
        )}
```

**Step 3: Add to memo comparator**

In the memo equality check (around line 269-282), add:

```typescript
    prev.communityPlays === next.communityPlays &&
```

**Step 4: Wire up in library page**

In `src/app/(desktop)/library/page.tsx`, import the hook and pass counts to cards:

1. Import: `import { useCommunityStats } from "@/hooks/useCommunityStats";`
2. Compute visible archive IDs from the virtual list's visible episodes
3. Call `const communityCounts = useCommunityStats(visibleArchiveIds);`
4. Pass `communityPlays={communityCounts.get(episode.archiveIdentifier ?? "")}` to each `<EpisodeCard>`

The exact integration point depends on how the virtual list exposes visible items — find the render callback for `EpisodeCard` and add the prop there.

**Step 5: Verify build**

Run: `npm run build`

**Step 6: Commit**

```bash
git add src/components/library/EpisodeCard.tsx src/app/\(desktop\)/library/page.tsx
git commit -m "feat(stats): show community play counts on episode cards"
```

---

### Task 9: Show play count on EpisodeDetail

**Files:**
- Modify: `src/components/library/EpisodeDetail.tsx`

**Step 1: Add `communityPlays` prop**

Add to the `EpisodeDetailProps` interface (around line 17):

```typescript
  communityPlays?: number;
```

**Step 2: Display in metadata area**

Find the metadata section near the top of the detail panel (near air date and duration display, around line 270-280). Add a play count line:

```typescript
{communityPlays != null && communityPlays > 0 && (
  <span className="text-hd-10 md:text-hd-9 text-bevel-dark/50">
    ▶ {communityPlays.toLocaleString()} community plays
  </span>
)}
```

**Step 3: Pass from library page**

In the library page where `<EpisodeDetail>` is rendered, pass the count from `communityCounts`.

**Step 4: Commit**

```bash
git add src/components/library/EpisodeDetail.tsx src/app/\(desktop\)/library/page.tsx
git commit -m "feat(stats): show community plays on episode detail panel"
```

---

### Task 10: Community Top 20 widget on Stats page

**Files:**
- Create: `src/components/library/CommunityLeaderboard.tsx`
- Modify: `src/app/(desktop)/stats/page.tsx`

**Step 1: Create the CommunityLeaderboard component**

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";
import { fetchLeaderboard } from "@/services/stats/client";
import { formatAirDate } from "@/lib/utils/format";

interface LeaderboardEntry {
  episodeId: string;
  plays: number;
}

export function CommunityLeaderboard() {
  const [period, setPeriod] = useState<"alltime" | "week">("alltime");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch leaderboard
  useEffect(() => {
    setLoading(true);
    fetchLeaderboard(period).then((data) => {
      setEntries(data);
      setLoading(false);
    });
  }, [period]);

  // Resolve episode metadata from local DB
  const episodeIds = entries.map((e) => e.episodeId);
  const episodes = useLiveQuery(async () => {
    if (episodeIds.length === 0) return new Map();
    const eps = await db.episodes.where("archiveIdentifier").anyOf(episodeIds).toArray();
    return new Map(eps.map((ep) => [ep.archiveIdentifier!, ep]));
  }, [episodeIds.join(",")]);

  const maxPlays = entries[0]?.plays ?? 1;

  const handlePlay = useCallback((archiveId: string) => {
    const ep = episodes?.get(archiveId);
    if (ep) {
      window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: ep }));
    }
  }, [episodes]);

  if (!loading && entries.length === 0) return null;

  return (
    <Window title="Community Top 20" variant="dark" headingLevel={2}>
      <div className="p-3">
        {/* Period toggle */}
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setPeriod("alltime")}
            className={cn(
              "text-hd-9 px-2 py-0.5 cursor-pointer transition-colors-fast",
              period === "alltime"
                ? "text-desert-amber w98-inset-dark bg-inset-well"
                : "text-bevel-dark hover:text-desktop-gray",
            )}
          >
            All Time
          </button>
          <button
            onClick={() => setPeriod("week")}
            className={cn(
              "text-hd-9 px-2 py-0.5 cursor-pointer transition-colors-fast",
              period === "week"
                ? "text-desert-amber w98-inset-dark bg-inset-well"
                : "text-bevel-dark hover:text-desktop-gray",
            )}
          >
            This Week
          </button>
        </div>

        {loading ? (
          <div className="text-hd-9 text-bevel-dark/50 text-center py-4">Loading...</div>
        ) : (
          <div className="flex flex-col gap-[3px]">
            {entries.map((entry, i) => {
              const ep = episodes?.get(entry.episodeId);
              const pct = (entry.plays / maxPlays) * 100;
              return (
                <button
                  key={entry.episodeId}
                  onClick={() => handlePlay(entry.episodeId)}
                  className="flex items-center gap-2 group text-left cursor-pointer hover:bg-title-bar-blue/10 transition-colors-fast"
                >
                  <span className="text-hd-8 text-bevel-dark/60 tabular-nums w-[14px] text-right">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-hd-10 md:text-hd-9 text-desktop-gray truncate">
                      {ep?.title || entry.episodeId}
                    </div>
                    {ep?.airDate && (
                      <span className="text-hd-8 text-desert-amber/60 tabular-nums">
                        {formatAirDate(ep.airDate)}
                      </span>
                    )}
                    <div className="h-[8px] w98-inset-dark bg-inset-well overflow-hidden mt-0.5">
                      <div
                        className="h-full bg-desert-amber/40 animate-bar-grow"
                        style={{ width: `${pct}%`, "--i": i } as React.CSSProperties}
                      />
                    </div>
                  </div>
                  <span className="text-hd-8 text-bevel-dark tabular-nums w-[28px] text-right flex-shrink-0">
                    {entry.plays}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Window>
  );
}
```

**Step 2: Add to Stats page**

In `src/app/(desktop)/stats/page.tsx`, import and place in the two-column grid (around line 668, after "Most Listened"):

```typescript
import { CommunityLeaderboard } from "@/components/library/CommunityLeaderboard";
```

Add inside the `grid grid-cols-1 lg:grid-cols-2 gap-4` div:

```tsx
<WidgetErrorBoundary name="Community Leaderboard">
  <CommunityLeaderboard />
</WidgetErrorBoundary>
```

**Step 3: Verify build**

Run: `npm run build`

**Step 4: Commit**

```bash
git add src/components/library/CommunityLeaderboard.tsx src/app/\(desktop\)/stats/page.tsx
git commit -m "feat(stats): add Community Top 20 leaderboard on stats page"
```

---

### Task 11: Active listener count in status bar and mobile

**Files:**
- Modify: `src/components/desktop/DesktopShell.tsx`
- Modify: `src/components/library/ListeningStats.tsx`

**Step 1: Add active count polling in DesktopShell**

In `DesktopShell.tsx`, import and add state:

```typescript
import { fetchActiveCount } from "@/services/stats/client";
```

Add state and polling effect (near other useEffects):

```typescript
const [activeListeners, setActiveListeners] = useState(0);

// Poll active listener count every 60s
useEffect(() => {
  const poll = () => fetchActiveCount().then(setActiveListeners);
  poll(); // initial fetch
  const id = setInterval(poll, 60_000);
  return () => clearInterval(id);
}, []);
```

**Step 2: Add status bar panel**

In the `StatusBar` panels array (around line 537-570), add a new panel before the episode count panel:

```typescript
...(activeListeners > 0 ? [{
  content: (
    <span className="text-hd-10 text-static-green/70">
      {activeListeners} listening
    </span>
  ),
  width: "90px",
}] : []),
```

**Step 3: Add to mobile ListeningStats banner**

In `src/components/library/ListeningStats.tsx`, import and add:

```typescript
import { fetchActiveCount } from "@/services/stats/client";
```

Add state and effect:

```typescript
const [activeCount, setActiveCount] = useState(0);

useEffect(() => {
  fetchActiveCount().then(setActiveCount);
}, []);
```

Add to the rendered output (after the topGuest span, inside the flex wrapper):

```typescript
{activeCount > 0 && (
  <span className="text-desktop-gray/70">
    👥 {activeCount} listening now
  </span>
)}
```

**Step 4: Verify build**

Run: `npm run build`

**Step 5: Commit**

```bash
git add src/components/desktop/DesktopShell.tsx src/components/library/ListeningStats.tsx
git commit -m "feat(stats): show active listener count in status bar and mobile banner"
```

---

### Task 12: Verify end-to-end

**Step 1: Build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 2: Manual testing with dev server**

Run: `npm run dev`

Test checklist:
- [ ] Play an archive episode → network tab shows POST to `/api/stats/play` with 200
- [ ] Pause/stop → POST to `/api/stats/stop` with 200
- [ ] Library page → GET to `/api/stats/episodes` returns counts
- [ ] Episode cards show play count badge after duration
- [ ] Episode detail shows community plays
- [ ] Stats page → Community Top 20 loads with All Time / This Week toggle
- [ ] Status bar shows "N listening" when playing
- [ ] Mobile ListeningStats banner shows active count
- [ ] Close tab → `/api/stats/stop` fires via sendBeacon (check KV dashboard)
- [ ] Kill KV connection (bad env var) → app works normally, community stats hidden
- [ ] Local-only episodes (no archiveIdentifier) don't fire stats events

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: community stats — per-episode plays, leaderboard, active listeners

Vercel KV-backed aggregate listening stats visible to all users.
- Per-episode play counts on library cards and detail panel
- Community Top 20 leaderboard (all time + weekly) on stats page
- Active listener count in status bar and mobile banner
- Fire-and-forget writes, graceful degradation if KV unavailable"
```

**Step 4: Push and deploy**

```bash
git push
```

Verify KV store is linked in Vercel dashboard and env vars are set.
