# Community Stats — Design Document

> Aggregate listening stats visible to all users: per-episode play counts, leaderboards, and active listener presence.

**Date:** 2026-03-08
**Status:** Approved

## Problem

All stats are local (IndexedDB). Users have no sense of community — they can't see what's popular, what others are listening to, or that anyone else is even here.

## Solution

Add lightweight server-side counters via Vercel KV (Upstash Redis). Fire-and-forget writes on play/stop events, batch reads for display. Zero impact on playback if KV is down.

## Data Model (Vercel KV)

| Key | Type | Purpose | TTL |
|---|---|---|---|
| `ep:{archiveIdentifier}` | Counter | All-time play count per episode | None |
| `lb:alltime` | Sorted Set | All-time leaderboard (member=archiveId, score=plays) | None |
| `lb:week:{YYYY-WW}` | Sorted Set | Weekly leaderboard (same shape) | 14 days |
| `active` | Sorted Set | Active sessions (member=sessionId, score=unix timestamp) | None (stale entries pruned on read) |

**Storage estimate:** ~100 bytes per episode entry. At 5,000 episodes = ~500KB. Well under 256MB.

**Request estimate:** ~3,000 ops/day at 50 DAU (10% of 30K free tier).

## API Routes

All follow existing patterns: IP-based rate limiting via `rateLimit()`, consistent `NextResponse.json()` responses, `AbortController` timeouts.

### `POST /api/stats/play`

Records a play event. Called from `useAudioPlayer` alongside existing Umami tracking.

**Body:** `{ episodeId: string, sessionId: string }`

**Operations:**
1. `INCR ep:{episodeId}` — increment episode counter
2. `ZINCRBY lb:alltime {episodeId} 1` — update all-time leaderboard
3. `ZINCRBY lb:week:{YYYY-WW} {episodeId} 1` — update weekly leaderboard (set 14-day TTL on first write)
4. `ZADD active {timestamp} {sessionId}` — mark session as active

**Rate limit:** 60/min per IP

### `POST /api/stats/stop`

Removes session from active set. Called on pause/ended/stop/unload.

**Body:** `{ sessionId: string }`

**Operations:**
1. `ZREM active {sessionId}`

**Rate limit:** 60/min per IP

### `GET /api/stats/episodes?ids=id1,id2,...`

Batch fetch play counts. Called by library page for visible episodes.

**Query:** `ids` — comma-separated archive identifiers (max 100)

**Operations:**
1. `MGET ep:{id1} ep:{id2} ...` — batch get all counters

**Response:** `{ counts: { [archiveId]: number } }`

**Rate limit:** 30/min per IP

### `GET /api/stats/leaderboard?period=alltime|week`

Top 20 most-played episodes.

**Operations:**
1. `ZREVRANGE lb:{period-key} 0 19 WITHSCORES` — top 20 by play count

**Response:** `{ entries: [{ episodeId: string, plays: number }] }`

**Rate limit:** 30/min per IP

### `GET /api/stats/active`

Count of active listeners (sessions with activity in last 5 minutes).

**Operations:**
1. `ZREMRANGEBYSCORE active -inf {now - 5min}` — prune stale
2. `ZCARD active` — count remaining

**Response:** `{ count: number }`

**Rate limit:** 30/min per IP

## Service Layer

### `src/services/stats/kv.ts` (server-side)

Redis operations used by API routes. Wraps `@vercel/kv` calls. Keeps route handlers thin.

Functions: `incrementPlayCount()`, `removeActiveSession()`, `getEpisodeCounts()`, `getLeaderboard()`, `getActiveCount()`

### `src/services/stats/client.ts` (client-side)

Browser-facing functions that call the API routes. Follow existing `fetchWithRetry` pattern.

Functions: `reportPlay()`, `reportStop()`, `fetchEpisodeCounts()`, `fetchLeaderboard()`, `fetchActiveCount()`

All writes are fire-and-forget (no `await` in the hot path). Reads have 3s timeout, 1 retry.

## Client Integration

### Session ID

Generated once per tab: `crypto.randomUUID()`. Stored module-level in `useAudioPlayer.ts` (same pattern as `_listenAccum`). Not persisted — each tab is a unique session.

### Play/Stop Events (`useAudioPlayer.ts`)

Alongside existing Umami tracking:
- On play: `reportPlay(episode.archiveIdentifier, sessionId)` — fire-and-forget
- On pause/ended/stop: `reportStop(sessionId)` — fire-and-forget
- On `beforeunload`/`visibilitychange`: `navigator.sendBeacon('/api/stats/stop', ...)` for reliable delivery

Only fires for archive episodes (skip local files with no `archiveIdentifier`).

### `useCommunityStats` Hook

New hook for the library page:
- Takes array of visible `archiveIdentifier`s (from virtual list viewport)
- Debounced (300ms) batch fetch via `/api/stats/episodes`
- Returns `Map<string, number>` of play counts
- Caches results in a `useRef` map — only fetches IDs not already cached
- Refreshes cache entries older than 5 minutes

### Leaderboard + Active Count

Fetched on Stats page mount via `useSWR`-style pattern (or simple `useEffect` + `useState`). Active count refreshed every 60s. Leaderboard refreshed on page focus.

## UI Placement

### EpisodeCard — Play Count Badge

After duration, when count > 0:
```
1998-01-15  Coast to Coast AM — Mel's Hole
Richard Sahl · 2h 58m · ▶ 47
```

Style: `text-hd-8 text-bevel-dark/50` — same as existing metadata. The `▶` prefix distinguishes it from other numbers.

### EpisodeDetail — Play Count

In the metadata info section alongside source, format, file size. Same subdued style.

### Stats Page — "Community Top 20" Widget

New `Window` component in the two-column grid:
- Title: "Community Top 20"
- Two sections: "All Time" / "This Week" (toggle or stacked)
- Same horizontal bar chart style as "Frequent Callers"
- Each entry: episode title (truncated) + bar + play count
- Clickable → navigates to library and plays episode
- Falls back to "No community data yet" if KV is empty

### Status Bar (Desktop) — Active Listeners

New panel between episode count and signal bars:
- Format: `"12 listening"` or `"1 listening"`
- Style: `text-static-green` when > 0, hidden when 0 or fetch fails
- Width: `"90px"`
- Polls every 60s

### Mobile — ListeningStats Banner

Append to existing banner on Stats page:
- `"👥 12 listening now"` as a new span
- Same style as existing streak/time entries

## Error Handling

- **KV unavailable:** All writes silently fail (fire-and-forget). All reads return empty/zero — UI hides community stats gracefully.
- **Rate limited:** Standard 429 response. Client backs off, UI unchanged.
- **Invalid episode IDs:** API validates format, returns 400. Client ignores.
- **No archive identifier:** Client skips reporting for local-only episodes.

## Environment Variables

```
KV_REST_API_URL=      # Auto-set when linking Vercel KV store
KV_REST_API_TOKEN=    # Auto-set when linking Vercel KV store
```

Add to `.env.example` with placeholder comments.

## Dependencies

```
@vercel/kv  # Vercel KV client (Upstash Redis wrapper)
```

## Verification

1. `npm run build` passes
2. Play an episode → verify KV counter increments (check Vercel KV dashboard)
3. Load library → verify play counts appear on episodes
4. Open Stats page → verify Community Top 20 populates
5. Open two tabs → verify active listener count reflects both
6. Close a tab → verify count decreases within 5 minutes
7. Kill KV connection → verify app works normally without community stats
8. Check mobile views at all text scale levels
