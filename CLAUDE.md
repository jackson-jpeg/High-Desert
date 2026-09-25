# High Desert — Project Guide

> A desktop-grade web player for the Art Bell radio archive. Windows 98 dark UI on desktop, glassmorphism on mobile, streaming from archive.org, all data stored client-side in IndexedDB.

**Live:** [highdesert.space](https://highdesert.space) | **Repo:** `jacksongoode/High-Desert`

## Quick Start

```bash
npm install
cp .env.example .env.local   # DATABASE_URL (optional — stats degrade gracefully without it)
npm run dev                   # http://localhost:3000
npm run build                 # production build
npm run lint                  # ESLint (next/core-web-vitals + typescript)
npm run test                  # Vitest
npm run test:mutations        # does each test actually observe its subject?
npm run check:csp -- <url>    # every route in Chromium: CSP violations / console errors
E2E_BASE_URL=<url> npm run test:e2e   # Playwright, desktop + mobile projects
```

**e2e specs import `test` from `e2e/fixtures.ts`, never from `@playwright/test`** (ESLint
enforces it). The fixture answers every stats write in the page and blocks the service
worker, whose fetches bypass `page.route()`. Without it, a spec that starts a show writes a
permanent play to whatever server it points at — this broke the test DB once. Run e2e servers
against the e2e database (`/root/.high-desert-e2e.env`), never `TEST_DATABASE_URL`.

(Quick Start is for a *development* checkout. In `/root/High-Desert`, which is
production, never `npm install` — see "Deploying to the VPS".)

**Database-backed tests** (`*.db.test.ts`, `scripts/__tests__/backup-db.test.ts`) need
`TEST_DATABASE_URL`, a `*_test` database — enforced by `src/test-support/test-db.ts`. CI
provides one; on the VPS: `set -a; . /root/.high-desert-test.env; set +a`. Without it they
skip, and `test:mutations` reports their mutations as **NOT CHECKED** rather than passing
(in CI a missing URL is an error).

**`npm run test:mutations` is not optional garnish.** Four defects in this project
were checks disconnected from the thing they checked — a watchdog whose listeners
were never attached, two tests that re-implemented their subject, and a handoff
that asserted "pushed to origin" without looking. A passing suite cannot tell those
from working ones. `scripts/mutate-check.mjs` breaks one real line per module and
requires the suite to notice; it runs in CI. Read `docs/disconnected-checks.md`
before adding a test, and add a mutation alongside it.

## Tech Stack

- **Next.js 16.2.2** (App Router) + **React 19** + **TypeScript 5**
- **Tailwind CSS v4** with custom Win98/glass design tokens (`src/styles/`)
- **Dexie 4** — IndexedDB ORM, reactive queries via `useLiveQuery`
- **Zustand 5** — client state (player, radio dial, scanner, scraper, search, admin, context menu, sleep timer, toasts)
- **Web Audio API** — oscilloscope visualizer, radio static generator, startup sound
- **Postgres** — community stats only (play counts, ratings, leaderboard, active listeners)
- **No third-party services** — self-hosted on the VPS; no analytics scripts, no hosted KV, no runtime AI
- **OPFS** — Origin Private File System for offline audio caching

## Architecture Overview

### Routing (`src/app/`)

| Route | Purpose |
|---|---|
| `/` | Welcome/splash with animated starfield |
| `/library` | Main episode browser — virtual list, search, filters, detail panel |
| `/radio` | Radio dial — tune through episodes on a frequency strip |
| `/scanner` | Local file scanner + archive.org catalog scraper (admin) |
| `/search` | Archive.org search and import (admin) |
| `/stats` | Listening statistics |

All primary pages share `(desktop)/layout.tsx` — the master client component that initializes the audio player, handles global keyboard shortcuts, seeds the library on first visit, and persists playback state.

### API Routes (`src/app/api/`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/archive/search` | GET | Proxy to archive.org advanced search (rate-limited 30/min) |
| `/api/archive/scrape` | GET | Proxy for catalog scrape (rate-limited 30/min) |
| `/api/archive/metadata` | GET | Proxy for item metadata (cached 1hr) |
| `/api/archive/health` | GET | archive.org reachability probe. Returns **`{up, status, checkedAt}`**. One upstream HEAD is shared by every caller for 60 s (up) / 10 s (down), and concurrent callers share the one in flight — every tab polls it (`useOutageMonitor`) |
| `/api/stats/play` | POST | Record a play. Body `{episodeId, sessionId, source?}`. Returns `{ok}`. `episodeId` must be in the community-key allowlist. `source` is where the audio came from — `archive`/`mirror`/`cache`/`local` (`PLAY_SOURCES`); anything else is **400**, absent is stored NULL (*unknown*, never assumed to be archive.org) |
| `/api/stats/stop` | POST | End playback. Body `{sessionId, keepPresence?}`. `keepPresence: true` clears only the listening mark (the tab is still open); omitting it deletes the session, which is what the unload beacon does. Returns `{ok}` |
| `/api/stats/rate` | POST | Submit a rating 1–5 or null. Body `{episodeId, rating}`. Returns `{ok}`. One ballot per client (IPv4 address / IPv6 /64), stored as an HMAC; **503 when `RATING_VOTER_SECRET` is unset** |
| `/api/stats/episodes` | GET | Play counts for up to **100** ids. Returns **`{counts: {id: n}}`** |
| `/api/stats/ratings` | GET | Ratings for up to **50** ids. Returns a **bare map** `{id: {avg, count}}` |
| `/api/stats/community` | GET | Community plays and ratings for the **whole catalog**: **`{episodes: {id: {plays, avg, count}}}`**, only episodes with a play or rating. What "Most played" / "Top rated" sort by and what the list's metric column shows (`src/lib/library/sort-keys.ts`), read through `useCommunityCatalog`. Proxy-cached 60s |
| `/api/stats/leaderboard` | GET | Top episodes. **`?period=alltime\|week` is required.** Returns **`{entries: [{episodeId, plays}]}`**. `alltime` is `episode_plays` — the same numbers as `/api/stats/community` and the library's "Most played" |
| `/api/stats/active` | GET | **Legacy alias**, read by no surface in the current build. Returns **`{count, online, listening}`** from the same `getPresence()` as `/now` — `count` is a synonym for `listening` |
| `/api/stats/heartbeat` | POST | Mark a session present. Body `{sessionId, episodeId?}`. Returns `{ok}`. Every open tab posts on a 60s interval. `episodeId` is sent **only while that tab is actually playing** and renews `listening_at` — it is what keeps a show on air for its whole runtime instead of for five minutes after someone pressed play. Omitting it leaves the listening mark alone rather than clearing it, so a pause does not yank the show off the air; the mark decays on its own. Same allowlist gate as `/api/stats/play`, but a bad id drops the mark instead of failing the beat — presence is the primary job. A client past `SESSIONS_PER_CLIENT` new sessions gets the same `{ok}` and is not counted |
| `/api/stats/now` | GET | **The one presence endpoint.** Presence **plus what is playing**. Returns **`{online, listening, onAir: [{episodeId, listeners}], recent: [{episodeId, at}]}`**. `online` is distinct *clients* (not sessions) with a heartbeat inside 5 min; `listening` is the subset with a playing session; `listeners` is distinct clients per episode. `no-store` — a stale on-air list is worse than none. Aggregate only: no query joins `session_id` to `episode_id`, and `recent_plays` stores no session at all |
| `/api/stats/traffic` | GET | Traffic history. `?range=24h\|7d\|30d`. Returns **`{range, points: [{t, online, listening, plays}], peakOnline, peakListening, playsInRange, totalPlays, peakAt, hourly: [{hour, online, listening, plays, samples}]}`**. `hourly` is always a 24-entry, zero-filled, **UTC**-hour profile over the last 30 days and does *not* vary with `range`; the client rotates it into local time. `samples: 0` means *never observed*, which is not the same as "observed, nobody here" — the UI hides the profile until 8 hours have been sampled, or a day-old deployment draws 23 empty columns and looks like a dead site. **`playsBySource: {archive, mirror, …, unknown}`** counts `play_events` in the range by `source` — what `highdesert-status` reads for "mirror plays in 24h" |
| `/api/stats/sample` | POST | Writes one traffic sample, then rolls up the day and expires old session refs. Requires `x-sample-token`; called only by `highdesert-sample.timer`. Also prunes `weekly_plays` past 3 weeks. Returns `{ok, online, listening, totalPlays, rolledUp, anonymized, prunedWeeks}` |
| `/api/playback-event` | POST | A show failed to start. Body `{episodeId, kind, retried, recovered, elapsedMs, uaClass, detail?}`. `kind` is one of `timeout`/`stall`/`play-rejected`/`network-error`/`decode-error`/`empty-media`/`empty-media-suspected`; `uaClass` is a coarse bucket from `src/lib/utils/platform.ts`, **never a raw user-agent**. `detail` is short (≤200 char) free text: the reported duration on an advisory row, or `MediaError.code` plus its message on a `decode-error`/`network-error`/`empty-media`. That message is a browser pipeline diagnostic (`DEMUXER_ERROR_COULD_NOT_OPEN: …`) and is the **only** way an empty file is distinguishable from an unreachable one on Chromium, which errors on the missing frames rather than reporting a short duration. A `detail` containing `HD-VERIFY` (any case, checked after truncation) is **rejected with 400** — this table is the instrument that decides whether the 5s duration floor is safe to promote, and verification rows have polluted it twice; intercept the POST in the page instead. No session id, no IP. `episodeId` must be in the community-key allowlist. Optional `source` as on `/api/stats/play`, but an unknown value is stored NULL rather than refused — losing a failure row costs more than losing its source. A failover row carries the source that *failed* (`archive`) and `recovered: true` once the mirror plays |
| `/mirror/{fileHash}` | GET | **Not Next.js** — `highdesert-mirror` on 127.0.0.1:3004, proxied by nginx. The episode's MP3 from the outage mirror, with byte ranges: `206` + `Content-Range`, `416` for an unsatisfiable range, **503 JSON** if nothing has delivered a first byte within 15s. See "archive.org outage mirror" |
| `/mirror/manifest` | GET | **Not Next.js** (the gateway). What the mirror can play with archive.org gone: **`{version, count, pinned, fileHashes: [...]}`** — every episode complete on disk, pinned or kept by the LRU. `version` is a digest of the list and the `ETag`; `If-None-Match` gets a 304. Memoised 60 s. Outage mode's input (`src/services/mirror/manifest.ts`) |
| `/mirror/magnet/{fileHash}` | GET | `{magnet}`: the episode's own single-file torrent (trackers, the archive.org webseed as `ws=`, this server as `x.pe=`). The episode sheet's "Magnet link" |
| `/live-api/stream` | GET | **Not Next.js** — `highdesert-live` on 127.0.0.1:3005, the phone lines (`docs/live-chat.md`). SSE: `hello {you: {name, line, admin}, slowMode, recent, resumed, hidden}`, then `message {id, at, name, line, body}` (SSE `id:` = message id), `hide {ids}`, `slow`, `rename {ids, name}`. `Last-Event-ID` resumes. nginx: buffering off, `limit_conn` 8 per client |
| `/live-api/messages` | POST | **Not Next.js.** `{body}` → **201** `{id, at, name, line, body}` (body as stored — mild profanity masked). **400** `{error: "rejected", reason, message}`, **429** `{error: "rate", retryAfter, slowMode}`, **403** muted/banned. Every `/live-api` POST needs `Content-Type: application/json` (415) and a highdesert.space `Origin` (403) |
| `/live-api/name`, `/live-api/report`, `/live-api/me` | POST/POST/GET | **Not Next.js.** Rename `{name}` → `{name, line, nextChangeInS}` / 409 taken / 429; report `{messageId}` → `{ok, hidden}`; me → `{name, line, admin, mutedUntil, nextNameChangeInS, slowMode}` |
| `/live-api/admin/*` | POST | **Not Next.js.** `hide`, `mute`, `ban`, `slow`, `clear-name`, `verify` (the deploy's round trip), `signin` `{nonce}`, `signout`; GET `signin-page`. Cookie or `Authorization: Bearer $LIVE_ADMIN_TOKEN`, else **401** `{error: "admin-only"}`. `/live-api/health` is loopback only (nginx 404s it) |
| `/api/stats/failures` | GET | Which episodes are failing, worst first. `?days=7\|30\|90`. Returns **`{days, summary, entries: [{episodeId, title, failures, recovered, skippedRetries, plays, rate, kinds, uaClasses, details, lastAt}]}`**. Ids resolved to titles from the seed catalog. `details` is the browser's own diagnostics (up to 3 distinct, newest first), **filtered to diagnostic shapes** — the raw text is attacker-controlled (`publicDetails`, HD-038). `skippedRetries` counts retries not attempted for want of a user gesture, excluding `empty-media`, which is never retried by design — it is the instrument for the activation gate. `summary` is site-wide and is deliberately **not** a sum of `entries`, which is capped at 50 episodes. **Excludes advisory kinds** (`ADVISORY_KINDS` in `src/services/stats/db/failures.ts`) — this ranks episodes by how badly they are failing, and a row that never stopped playback would inflate that. Unauthenticated — it is aggregate-only, and the admin gate is presentation, not protection. `?since=<ISO>` adds **`window: {from, to, failures, plays}`**, the fixed 7 days from that instant (cut at now) — how `highdesert-status` holds a release to `docs/reliability-baseline.md` |
| `/api/stats/export` | GET | **The permanent record, for sang3r.com.** Requires `x-service-token` (`STATS_EXPORT_SECRET`). `?mode=summary\|events\|daily\|episodes`. The only route that returns the event log rather than aggregates, and the only one not reachable from a browser. Episode ids are resolved to titles from the seed catalog. Page `events` with `after=<last id>` — **not** with `since`, which cannot disambiguate two plays sharing a timestamp |

> Response shapes are inconsistent by history, not design. `src/services/stats/client.ts`
> tolerates both wrapped and bare forms — a mismatch here silently made every community
> play count read as 0 for months. Document the shape when adding a route.

### Data Flow

1. **No server-side persistence** — all episode data lives in IndexedDB (Dexie)
2. **Audio streaming** — archive episodes stream via `archive.org/download/...` URLs
3. **Local files** — scanned, hashed (MD5), metadata extracted (ID3/Vorbis), cached in OPFS
4. **AI categorization is offline only** — `scripts/categorize-library.py` runs against the catalog and its output ships in `public/seed/library.json`. There is no runtime AI endpoint and no API key in the app
5. **First visit** — library auto-seeded from `/public/seed/library.json`

## Key Directories

```
src/
├── app/                  # Next.js App Router pages + API routes
│   ├── (desktop)/        # Main route group (shared layout with player)
│   └── api/              # archive.org proxies + community stats
├── audio/                # Audio engine modules (singleton pattern)
│   ├── engine.ts         # HTMLAudioElement + AudioContext singleton
│   ├── cache.ts          # OPFS audio blob cache
│   ├── radio-static.ts   # White noise generator for radio page
│   ├── visualizations/   # Oscilloscope/bars/radar/VU/waterfall/milkdrop renderers + registry
│   └── startup-sound.ts  # Synthesized boot chime
├── components/
│   ├── desktop/          # Shell, starfield, dialogs (about, shortcuts, clear)
│   ├── library/          # EpisodeCard, EpisodeDetail, TimelineView, SearchBar, widgets
│   ├── player/           # AudioPlayer, Oscilloscope, PlaybackControls, QueuePanel
│   ├── radio/            # RadioDial, TuningStrip, DialControls, SignalMeter
│   ├── scanner/          # FolderPicker, ScanProgress, ScanResults
│   ├── scraper/          # CatalogScraper, CollectionImport
│   ├── search/           # SearchPanel, ArchiveResultCard
│   ├── mobile/           # MobileMenuSheet
│   ├── ui/               # Toaster
│   ├── win98/            # Win98 component library (Button, Window, Dialog, MenuBar, etc.)
│   ├── CommandPalette.tsx
│   └── PageTransition.tsx
├── db/
│   ├── schema.ts         # Episode, Playlist, HistoryEntry, Bookmark, ScanSession, UserPrefs
│   ├── index.ts          # Dexie instance, indexes, migrations (v8), pref helpers
│   ├── deduplicate.ts    # Duplicate detection and merging
│   └── seed.ts           # Seeding, reconcile (restores missing episodes), export
├── hooks/                # Custom React hooks
├── lib/utils/            # cn, format, rate-limit, retry, search-parser, streak,
│                         #   community-key, scroll-lock, platform
├── services/
│   ├── archive/          # Archive.org client, scraper, filename parser
│   ├── scanner/          # File scanner, hasher, metadata extractor, filename parser
│   ├── episodes/         # Episode CRUD, favorites, ratings, bookmarks, playlists
│   └── stats/            # Community stats client + Postgres queries (db/: pool, presence,
│                         #   plays, ratings, traffic, failures, export; store.ts re-exports)
├── stores/               # Zustand stores
└── styles/               # win98.css, animations.css, crt.css, radio.css
```

## Stores (Zustand)

| Store | Key State |
|---|---|
| `usePlayerStore` | `currentEpisode`, `queue[]`, `queueIndex`, `playing`, `position`, `duration`, `volume`, `playbackRate`, `shuffle`, `repeat`, `mini` |
| `useRadioDialStore` | `position`, `lockedEpisode`, `signalStrength`, `scanning`, `zoom` |
| `useScannerStore` | `status`, `totalFiles`, `processedFiles`, `newEpisodes`, `duplicates` |
| `useScraperStore` | `phase`, `fetched`, `total`, `imported`, `categorized`, `errors` |
| `useSearchStore` | `query`, `results[]`, `loading`, `addingIds`, `addedIds` |
| `useSleepTimerStore` | `remaining`, `active`, `fadeFrom` |
| `useToastStore` | `toasts[]` — also exports module-level `toast.success/error/info/caller()` |
| `useAdminStore` | `isAdmin` — SHA-256 password gate, persisted in localStorage |
| `useContextMenuStore` | `open`, `position`, `items[]` |
| `useOutageStore` | `archiveUp` (verdict, null = unknown), `manifest`, `unavailable` — see "Outage mode" |
| `useProgressStore` | `byHash` (fileHash → `Progress`), `started`, `loaded` — the in-memory mirror of the `progress` table; see "Playback position lives in `progress`" |

All eleven have tests in `src/stores/__tests__/` and at least one mutation each in
`scripts/mutate-check.mjs` — and `src/stores/__tests__/coverage.test.ts`
*checks* that sentence, reading the stores from disk and the mutation list from
the script itself. It used to be false for `player-store` (HD-042) and nothing
noticed. A new store fails CI until it has both.

**`setVolume()` writes `preMuteVolume` on every call with a non-zero value.** Anything that
changes the volume temporarily must remember the original itself and put it back — reading
`player.volume` or `preMuteVolume` on a later tick reads back its own output. The sleep
timer's fade did exactly that: it compounded to ~0.7% with fifteen seconds still to run,
then "restored" that faded number as the listener's setting, and because `preMuteVolume`
had been overwritten too, muting and unmuting could not recover it either. The app was
simply quiet the next morning with nothing on screen to explain it. `useSleepTimerStore`
now captures `fadeFrom` once and hands exactly that back — on expiry, and on cancel. A
timer that expires without ever fading does not touch the volume at all.

## Library sorts — whose numbers, and one of them

`src/lib/library/sort-keys.ts` decides, once, what each numeric sort orders by:
**"Most played · everyone"** and **"Top rated · everyone"** are community numbers
(`/api/stats/community`); **"My plays"** and **"My rating"** are this browser's. The
comparator (`sortEpisodes`), the group buckets (`deriveRailGroups`) and the list's metric
column (`metricFor`) all read `sortValue` — "Most played" once sorted by local plays, grouped
by them, and showed community counts, so the rows read 41, 6, 78, 120 under a "Played 2–4
times (2)" header. **Every group has an inline header** (`list-layout.ts`); row offsets are
not `index × rowHeight`, so scroll through the list (`scrollListToRow`), never by arithmetic.
`sort-properties.test.ts` holds every sort monotonic and every header count equal to its rows.

## /stats — every number has a test that recomputes it

Local figures come from `computeLibraryStats()` (`src/lib/stats/library-stats.ts`),
recomputed from raw rows in `src/lib/stats/__tests__/library-stats.test.ts` against the
real catalog; the page test (`src/app/(desktop)/stats/__tests__/stats-page.test.tsx`)
holds the page to that function. Findings and fixes: `docs/stats-audit.md`.

- **Listened is time heard**, measured from the 250 ms position tick
  (`src/services/episodes/listen-time.ts`) and stored as `history.duration`. Never derive
  it from `playbackPosition` — that is *where you are*, reset to 0 on `ended`.
- **Personal lists say so.** "My Most Played" is this browser's `playCount`; Community
  Top 20 is everyone's. Each drills into the library sort that uses its own numbers
  (`my-plays`, `played`).
- **"Plays all time" exceeds every range total by design** — the counter predates the
  `play_events` log (2026-07-28). The page says so.

## Event bus and library intents — read before adding a cross-component signal

**The bus is typed: `src/lib/events.ts`.** `HdEventMap` declares every key and its
detail type; `emit("play-episode", ep)`, `useHdEvent("key", handler)` (one
subscription, latest handler) and `onHdEvent` for non-React code. The transport is still
a `window` CustomEvent named `hd:<key>`, so e2e specs can listen and dispatch by name
(they take it from `hdEventName()` via `e2e/fixtures.ts`, never spelled) — but in
`src/` an `hd:*` string literal anywhere except events.ts is an ESLint error
(`HD_EVENT_NAME_RULES`, proven in `src/lib/__tests__/eslint-rules.test.ts`). Always pass
the key as a string literal.

**An instruction needs a listener on every route it can fire from.**
`src/lib/__tests__/event-routes.test.ts` walks the import graph from each `page.tsx` and
its layouts, and fails when a key is emitted on a route where nothing listens. That is
HD-013: "Shuffle Coast" in the palette on `/stats` fired an event only the library page
heard. Keys that merely announce something (`HD_NOTIFICATIONS`: `seed-settled`,
`text-scale`, `status-message`) are exempt.

| Key | Emitted by | Heard by |
|---|---|---|
| `play-episode` | library, stats, radio, search, palette, player, queue, stores | `(desktop)/layout.tsx` |
| `episode-unavailable` | `useAudioPlayer`, `(desktop)/layout.tsx` (a pulled episode) | `UnavailableEpisodeDialog` |
| `scan-preview`, `scan-preview-stop` | `useRadioDial` | `(desktop)/layout.tsx` |
| `filter-tag`, `filter-category`, `filter-series`, `show-guest` | `EpisodeCard`, `EpisodeDetail` (on /library) | `useLibraryBusListeners` |
| `easter-egg` | layout keys, library, `SearchBar` | `DesktopShell` |
| `admin-prompt` | `SearchBar` | `AdminPromptDialog` |
| `toggle-shortcuts` | layout `?` key | `DesktopShell` |
| `toggle-ultra-mini` | `StatusBar` | `AudioPlayer` |
| `seed-settled` | layout | library (notification) |
| `text-scale` | `applyTextScale` | `useTextScale` (notification) |
| `status-message` | `toast-store` | `StatusBar` (notification) |

**Library intents are URLs, not events** (`src/lib/library/intents.ts`):
`/library?shuffle=all|coast|dreamland|special`, `?sort=<SortMode>`, `?q=<search>`,
`?scroll=current`. Callers use `useOpenLibraryIntent()` — push from another route,
replace on /library — never an event and never `setTimeout` waiting for the page to mount.
`LibraryIntentReader` parses (invalid values ignored), clears the parameters with a
replace, and `useLibraryIntents` applies them once the data they need exists.
`/`, Ctrl/Cmd+F and Q are registered by the library itself
(`useLibrarySearchShortcuts`), so the browser's find works on every other route.

## Conventions

- **Import alias:** `@/*` → `./src/*` — all internal imports use `@/`
- **Components:** PascalCase files, named exports (pages/layouts use `export default`)
- **Hooks:** `use` prefix, camelCase (`useAudioPlayer.ts`)
- **Stores:** `use` + Name + `Store` (`usePlayerStore`)
- **Services/Utils:** kebab-case (`file-scanner.ts`, `rate-limit.ts`)
- **CSS classes:** prefixed kebab-case (`w98-`, `glass-`, `crt-`, `animate-`)
- **Client components:** `"use client"` directive at top
- **Zustand selectors:** always use selector functions to minimize re-renders
- **Class names:** always use `cn()` utility (`@/lib/utils/cn`) for conditional Tailwind classes
- **Dexie queries:** `useLiveQuery` from `dexie-react-hooks` for reactive reads
- **Error boundaries:** `DBErrorBoundary` around Dexie-dependent UI, `WidgetErrorBoundary` around individual widgets
- **Virtual scrolling:** `useVirtualList` hook with fixed `itemHeight` and `containerRef`

## Type scale and the text ramp — read before styling text

**Tailwind v4's font-size namespace is `--text-*`, not `--font-size-*`.** The theme
block in `src/app/globals.css` originally registered the scale under `--font-size-hd-*`,
which v4 silently drops — it emitted no CSS at all, so all 694 `text-hd-*` usages across
57 files were inert and every character on the site rendered at the inherited body size.
Colors from the same `@theme` block compiled fine, which is what made it invisible for
so long. If you add a size, add it as `--text-hd-*` **and verify it in the built CSS**:

```bash
C=$(ls -t .next/static/chunks/*.css | head -1)
grep -o '\.text-hd-[a-z0-9]*' "$C" | sort -u    # must list your new token
```

- **Eight steps:** `micro` 11 · `caption` 12 · `body` 14 · `title` 16 · `h3` 20 ·
  `h2` 28 · `display` 36 · `hero` 48. Each ships a line-height. Prefer the semantic
  names; the legacy numeric names (`text-hd-10`, …) are aliases onto the nearest step
  and the number no longer reflects the rendered size.
- **Every step carries `--hd-text-scale`**, the user's text-size setting. Anything that
  hard-codes a pixel height for text content must scale with it — use
  `itemHeightFor()` / `currentItemHeight()` from `@/hooks/useTextScale` rather than a
  literal. Fixed row heights are why "Extra Large" made virtual-list rows overlap.

**Three-tier text ramp — never take text below `/85` opacity.** `--color-bevel-dark`
is `#9AA0AE`; at `/85` it is 4.89:1 on `raised-surface`, the darkest surface it sits on.
Below that it fails AA. Use color, not opacity, for hierarchy:
`text-desktop-gray` (primary) → `text-bevel-dark` (secondary) → `text-bevel-dark/85` (dim).

`--color-title-bar-blue` (`#000080`) and `--color-highlight-blue` are **chrome fills**
— title bars and selection. As text on the dark surfaces they measure ~1.1:1, i.e.
invisible. For blue *text* use `--color-signal-blue` (`#6BA3F0`, 7.0:1).

**One colour, one definition.** `src/app/globals.css` holds the canonical palette as
`--hd-*` custom properties. The Tailwind `@theme` tokens (`--color-*`) and the Win98
chrome tokens (`--w98-*`, in `src/styles/win98.css`) are both *aliases* over it — never
write a hex in either. Seven values were previously declared independently in both
namespaces, and four dark-bevel hexes appeared as raw literals a dozen times each
inside `win98.css`.

**No hex anywhere else in `src/`** (HD-036) — `src/lib/__tests__/no-raw-hex.test.ts` fails
on one, on a `var(--hd-*)` that is not defined, and on palette drift. Where `var()` cannot
reach — canvas `fillStyle`, `next/og`, `<meta theme-color>`, the boot splash,
`global-error.tsx` — import `PALETTE` from `src/lib/palette.ts`, a copy the same test holds
key-for-key equal to globals.css. A new colour is a new `--hd-*` property first.

Use `min-h-touch` / `min-w-touch` (44px, `--spacing-touch`) for tap targets rather than
a literal. Note the common pairing `min-h-touch md:min-h-0` — the floor is a mobile
concern, so measure it at a mobile viewport or you will read `0px` and think it broke.

## Playback — read before touching the play path

**`loadEpisode()` does not touch the `<audio>` element.** It is a Zustand setter.
The only things that assign a real `src` are `playEpisode()` and `primeEpisode()` in
`src/hooks/useAudioPlayer.ts`. The restore-on-revisit path called only `loadEpisode`,
so the player rendered a live ▶ over an element with no source and `togglePlay`
returned at `if (!audio.src)` — silently. No error, no toast, no log. A listener hit
this every time they came back, worked around it by picking a different show, and
concluded it was their own mistake. Regression test:
`src/hooks/__tests__/restore-play.test.ts`.

- **There are two start paths, and anything a play must do has to happen on both.**
  `playEpisode()` covers the library click, the queue advance and the radio dial.
  `togglePlay()` covers the restored player: once `primeEpisode()` has given the element
  a `src`, pressing ▶ plays it in place and never goes near `playEpisode`. That second
  path shipped reporting nothing — no `reportPlay`, no local `playCount` — so a listen
  started from the remembered show wrote no leaderboard entry, no permanent event, and
  no `active_sessions.episode_id`, which is what made it absent from "on air" while it
  was audibly playing. Both now call `countListen()`; `firstPlay` distinguishes it from
  an ordinary pause/resume, which is the same listen continuing. Regression test:
  `src/hooks/__tests__/play-reporting.test.ts`, which mounts the real hook precisely
  because a test that re-implements `togglePlay` would reproduce the omission and pass.
- **Nothing outside `src/audio/engine.ts` touches the player's element.** It is a detached
  `new Audio()` that is never in the DOM, so `document.querySelector("audio")` finds nothing —
  the sleep timer "paused" that way for months while the show played on, and bookmark
  markers moved only the store's `position`, which the next tick overwrote. Use
  `pauseEngine()` / `seekEngine(t)`. `seekEngine` at `readyState` 0 holds the seek and applies
  it on `loadedmetadata` — a `currentTime` written before there is a timeline is discarded.
  ESLint bans `querySelector("audio")` and every `src = ""` spelling in `src/` (the proof
  is `src/lib/__tests__/eslint-rules.test.ts`).
- **Every start takes a generation token** (`src/audio/play-session.ts`). Picking show B
  while A is loading makes A's `play()` reject with `AbortError` and queues an `abort`
  event that fires *after* B has started; both used to be charged as failures — to B.
  A superseded start's rejection, any `AbortError`, and `abort` itself are not failures.
  The layout's `hd:play-episode` handler takes its token *before* its awaits (metadata,
  OPFS) and passes it to `playEpisode`, so a slow A cannot land on top of B.
- **A listen is counted once per source** (`markListenCounted`), which is what separates
  a first ▶ on a restored show from resume. `togglePlay` dispatches on the store's
  `playing`; MediaSession play/pause call `resumePlayback`/`pausePlayback` explicitly,
  never a toggle — a headset "pause" must never start audio.
- **Finished means start over.** `startPositionFor()`: within 30 s of the end or past 95%
  starts at 0, and `ended` clears the saved position. Position is saved every 30 s
  (`POSITION_SAVE_MS`) plus on pause, `visibilitychange` and `pagehide`; the save is
  caught, never an unhandled rejection. Saves go to the `progress` table through
  `writeProgress()`, and every start reads the position synchronously with
  `positionOf(fileHash)` — never from the episode row (see "Playback position lives in
  `progress`").
- **Only the leaves in `PositionReadouts.tsx` subscribe to `position`.** It changes four
  times a second; `AudioPlayer` selecting it re-rendered the whole player per tick.
  `render-pressure.test.tsx` holds that.
- **The radio scan preview is `src/audio/scan-preview.ts`**, its own elements, not the
  player's. A new preview clears every timer of the last one (its fade-out used to fire
  on the *new* preview), stops with `removeAttribute("src")` + `load()`, and seeks on
  `loadedmetadata`.
- **`primeEpisode()` sets `preload="none"` before assigning `src`.** Keep it that way.
  At `"metadata"` every page load fetches the head of a show nobody asked for, and a
  VBR rip with no Xing header can make that most of the file. `play()` loads
  regardless of `preload`, so the button still works.
- **Never `audio.src = ""`.** It resolves against the document URL, so the browser
  fetches the HTML page and tries to decode it as audio. Use `removeAttribute("src")`
  then `load()`.
- **`play()` before `resumeContext()`.** The analyser context is not required for
  playback; awaiting it first put a task boundary between the tap and `play()`, which
  is how Safari decides a call was not user-initiated.
- **The watchdog owns failure policy** (`src/audio/playback-watchdog.ts`): one silent
  retry, then `loadState: "failed"`, which raises `PlaybackErrorDialog`. Its load
  deadline resets on every `progress` event — it catches *silence*, not slowness.
  Timing out a slow-but-moving download would throw away everything buffered, the same
  mistake the service worker's navigation handler once made.
- **A watchdog that cannot see must not report, and must never interrupt sound.** Both
  learned the hard way. Because the media listeners were never attached (above), no
  `progress` ever reset the deadline and no `canplay` ever settled the attempt: every
  load ran the full 12s out, the retry tore down an element that was *streaming fine* —
  the show cut out and restarted, or on iOS stopped dead — and a timeout was recorded
  against a working episode. All 32 rows in `playback_failures` were written that way,
  with `recovered: false` on every one, because `noteReady()` was unreachable. So:
  `noteListenersAttached()`/`noteListenersDetached()` bracket the media-events install,
  and `armWatchdog()` **refuses to arm** without them rather than supervising blind;
  and before the deadline or stall clock acts it checks `!paused && readyState >=
  HAVE_CURRENT_DATA` and stands down if the show is audibly playing. `paused` alone is
  not enough — `play()` clears it synchronously, so a dead load also reports unpaused.
- **The retry must not start audio nobody asked for**, and **must not be attempted when
  `play()` cannot succeed.** It runs in a timer callback twelve seconds after the tap, so
  the transient activation that authorised the original `play()` has almost always
  expired. It therefore checks `navigator.userActivation.isActive` *before* touching the
  element: no activation and a `play()` would be needed → **skip the retry entirely** and
  `giveUp`, raising `PlaybackErrorDialog`, whose *Try Again* is a real gesture and can
  succeed. Tearing the element down first and discovering the refusal afterwards leaves
  the listener with no audio, no buffer and (before `setFailureHandler` was wired) nothing
  on screen. This is **not an iOS special case** — Safari refuses loudest, but a `play()`
  that cannot succeed should not be attempted anywhere. Where the API is unsupported
  (Safari <16.4, Firefox <121) it is treated as *permitted*: guessing "no" would disable
  the retry where it may work, and guessing "yes" costs at worst a rejected `play()`,
  which is terminal and raises the same dialog seconds later. Skipped retries record
  `retried: false`, so they are distinguishable in the data from retries that ran and
  did not help. It also still only re-issues `play()` if the element was unpaused when
  the deadline fired.
- **`PlaybackErrorDialog` is mounted in `(desktop)/layout.tsx`, not inside `AudioPlayer`.**
  Keep it there. It must render in every player state — including ultra-mini, where the
  error banner went missing once — and on pages that draw no player chrome at all.
- **`useAudioPlayer` is mounted twice** — by `(desktop)/layout.tsx` and by
  `AudioPlayer.tsx`, whose `return null` sits after the hooks. Global listeners,
  timers and intervals go through `withGlobals(key, install)` so they install once.
  Anything new with a side effect outside React must too, or it runs twice: that is why
  the queue used to skip two tracks at the end of a show.
  **The count is per `key`, and that is not a detail.** It was one shared module-level
  counter across all five call sites, so `count === 1` was true for exactly one call in
  the whole hook — the position timer, which happens to be declared first — and the
  other four installs *never ran, in any browser, ever*. The media element listeners
  were never attached, `setFailureHandler` was never installed, position was never
  persisted and the unload beacon never fired. A new call site needs a new key in
  `GlobalKey`; reusing an existing one silently disables one of them.
  Regression test: `src/hooks/__tests__/global-listeners.test.ts`, which mounts the hook
  **twice** — the way production does — and asserts each subsystem installs exactly once.
- **`useAudioPlayer.ts` is the start/stop/seek surface and the wiring; the rest is in
  `src/hooks/player/`** (HD-018): `globals.ts` (`withGlobals`, `GlobalKey`),
  `play-session.ts` (`openListen`/`armListen`/`countListen`, the watchdog's failure and
  failover handlers — not to be confused with `src/audio/play-session.ts`, the start
  token), `media-events.ts` (the element listeners), `persistence.ts` (position tick,
  position saves, unload flush, `POSITION_SAVE_MS`) and `media-session.ts`. Every
  `withGlobals` call stays in `useAudioPlayer.ts`, one per key, so the keys can be read
  in one place; the modules export plain `install*()` functions that return their teardown.
- **The service worker must never see media.** `public/sw.js` returns early for
  `Range` requests, `destination === "audio"`, archive.org hosts and audio extensions.
  It never cached audio, so `respondWith()` bought nothing while defeating native
  byte-range handling and turning network failures into a body-less 504 that the
  element reports as "source not supported".
- **Offline, an API call gets JSON, never an empty 504** (HD-034). The worker keeps the
  last good answer of a same-origin `GET /api/stats/*` and serves it only when the network
  fails; anything else under `/api/` offline is `503 {"error":"offline"}`. **Presence is
  never cached** — `/api/stats/now`, its alias `/active` (and `/export`) are on
  `API_NEVER_CACHE`, and a `no-store`/`private` response is never kept: a stale on-air list
  is worse than none. POSTs and the archive.org proxies are never cached. Tested against
  the real script in `src/lib/__tests__/service-worker.test.ts`.

## archive.org outage mirror — read before touching `src/audio/sources.ts` or `services/mirror/`

Every show streams from archive.org. When archive.org is down — it has had
multi-day outages — the site used to be a dead player. There is now a fallback,
and it is deliberately modest: a bounded cache on this server, not a copy of the
archive. Feasibility, measurements and sizing: `docs/torrent-mirror-feasibility.md`.

- **archive.org's own torrent covers none of the episodes.** Its item torrent
  (btih `ec92fe3b…`, 2024) holds two metadata files and zero MP3s, and nobody
  outside seeds anything here (measured against a control that found hundreds of
  peers). So `scripts/build-torrent-index.mjs --hash` builds **one single-file
  torrent per episode** from the bytes archive.org serves — 256 KiB pieces, BEP-19
  `url-list` = the archive.org file URL, so archive.org is the webseed while it is
  up. Infohashes are deterministic. Output: `data/torrents/episodes.json`
  (`fileHash → {infohash, length, pieceLength}`, committed) and the `.torrent`
  files in `/var/lib/highdesert-mirror/torrents` (not committed, 1,312 of them;
  `deploy-mirror.sh` refuses if any indexed one is missing). Resumable, ≤2 req/s.
- **The gateway** (`services/mirror/`, its own package — webtorrent; unit
  `highdesert-mirror`, user `hdmirror`, `/opt/highdesert-mirror`): a file whose
  `.complete` marker exists is served from disk; otherwise the torrent is added on
  demand, `createReadStream({start,end})` prioritises the pieces the range needs,
  and idle torrents are dropped after 5 minutes. The cache
  (`/var/cache/highdesert-mirror`) evicts least-recently-served first under a
  20 GB cap **and** a 10 GB disk-free floor — the floor binds first on a 100 GB
  disk — and never a pinned or in-flight file. Upload capped at 2 MB/s,
  `CPUQuota=50%`, `IOWeight=20`, `MemoryMax=700M`. Ports 6881/tcp+udp and
  6882/udp are open in ufw so the pinned shows are actually seeded back.
- **It listens before it seeds, and does not re-verify what it already
  verified** (`lib/serve.mjs`, `skipVerify` in `ensureTorrent`). The first
  deploy after a nightly warm awaited seeding 338 pins before `listen()`,
  re-reading all 15 GB on the way at its memory ceiling; health never answered
  inside `deploy-mirror.sh`'s window, and the rollback copy started the same
  way — the mirror was down until this changed. Requests never needed the pins
  seeded: a complete file is served from disk.
- **`peers` means distinct outside addresses**, never wires. Each tracker hands
  our own announce back, so the client dialled itself both ways for every
  torrent (677 "peers" with 338 pins); our public address is now on the
  client's blocklist (`lib/client-options.mjs`) and excluded from the count.
  `wires` in `/mirror/health` is the raw breakdown by type.
- **DHT bootstrap is resolved to IPv4 by us** (`lib/bootstrap.mjs`). The
  library's own list resolved to IPv6 on this box, which its udp4 socket cannot
  reach, and it reported "ready" with **zero nodes** — silently, for every hash.
  Two of its three default routers no longer answer at all.
- **Warm cache:** `highdesert-mirror-warm.timer` (04:10 UTC) pins the most-played
  episodes by 90-day `play_events`, whole files only, up to 15 GB, fetched from the
  archive.org webseed and verified against the piece hashes before the `.complete`
  marker is written. **It skips itself while hypervisor steal is above 20%** and
  records why in `warm-status.json`. Pins are exempt from eviction and seeded.
- **Client failover** (`src/audio/sources.ts`, `playback-watchdog.ts`,
  `useAudioPlayer.ts`, `src/hooks/player/play-session.ts`): `resolveSources()` is archive.org then
  `/mirror/{fileHash}`; only catalog episodes have a mirror, and while archive.org
  is known down a show the manifest lacks has none (outage mode, below). On a watchdog
  `network-error`, `stall` or `timeout` — **never `play-rejected`**, which is the
  browser refusing sound, and never decode/empty-media, which are about the bytes —
  the watchdog calls the failover handler *before* its retry: the **same element**
  gets the mirror `src`, the position is restored with `seekEngine`, `play()` is
  re-issued, and **no second listen is counted** (`isListenCounted()`). The
  failover spends the retry: a mirror that also fails raises the dialog, it does
  not go back to archive.org. A mid-show media error (code 2/4) on an archive
  source goes through the same path. If `play()` after the swap is refused (iOS,
  activation expired) the failure is `play-rejected` and `PlaybackErrorDialog`'s
  *Try Again* is the gesture — the same rule as the retry.
- **The health probe's verdicts are re-probed on different clocks** (`src/services/archive/health.ts`):
  up after 5 min, **down after 30 s**, and a probe that failed to reach *our* server
  is not a verdict at all. It used to hold any failure for 5 minutes, and with the
  mirror that would route every play away from a recovered archive.org. Verdicts are
  published to `useOutageStore`; `archiveKnownDown()` reads it and is synchronous —
  the play path must not await before `play()`. While it is true, starts go
  straight to the mirror, or are refused (outage mode, below).
- **`source` is recorded everywhere a play or failure is** (player store,
  `/api/stats/play`, `/api/playback-event`, `play_events.source`,
  `playback_failures.source`). The UI says so: **VIA MIRROR** (`MirrorBadge`) in the
  desktop status bar and the mobile player, and a **Magnet link** action in the
  episode sheet.
- **Deploy:** `bash scripts/deploy-mirror.sh` — stages `/opt/highdesert-mirror.next`,
  `npm ci --omit=dev` there, swaps, restarts, installs the units, ufw rules and
  (with `nginx -t` first) the vhost, then verifies health and a real `206` through
  `https://highdesert.space/mirror/…`, rolling back on failure. `--rollback`
  swaps back. The app's `scripts/deploy.sh` does not touch the mirror.
- **Outage mode** (`src/stores/outage-store.ts`, `src/audio/outage-gate.ts`). When
  the health probe says archive.org is down, the app says so and stops pretending
  every show can play: a banner (**"archive.org is down. Playing from the High
  Desert mirror."**), a **MIRROR** mark on rows the manifest lists, the rest
  dimmed (greyscale and a lower text tier — never opacity), and a **"Playable
  now"** filter that turns on for the outage and off after it. A start the
  mirror cannot serve is **refused at the tap** by `refuseIfUnavailable()` —
  synchronously, from the manifest in memory — and `OutageDialog` offers three
  shows it holds (same guest, then category, then year: `suggestPlayable`). All
  three start paths go through it: the play-episode handler (before it queues,
  `admitRequestedStart`), `playEpisode()` and a restored show's first ▶. It used
  to wait out the gateway's 15 s first-byte budget and fail anyway.
  - **One verdict, everywhere.** `archiveKnownDown()` is the store's verdict —
    held until a probe says otherwise — not "a fresh down": a start must agree
    with the banner on screen. `useOutageMonitor` (mounted once in the layout)
    keeps it current: a probe on load, every 30 s while down, every 5 min while
    up, and on returning to a hidden tab. The banner and dimming clear when a
    probe says up — there is no timer.
  - **A null manifest is "unknown", never "empty".** Down with no manifest, a
    start goes to the mirror to find out. The manifest is read the moment outage
    mode begins and kept in localStorage, so a page loaded mid-outage marks rows
    before its own fetch returns.
  - **Local files are never marked or refused** — they never needed archive.org.
  - Tests start from `archiveUpFixture` / `archiveDownFixture`
    (`src/test-support/outage.ts`); `e2e/chaos-mirror.spec.ts` runs it on production.
- **Status:** `highdesert-status` has `steal` (30-min mean; WARN >20%, FAIL >50%),
  `mirror` (active, health, cache size, pinned, peers, 24h mirror plays) and
  `warm` (last run; WARN when stale >36h, skipped for steal, or with failed
  fetches) lines.

## Live chat — the phone lines (read before touching `services/live/` or `src/components/live/`)

The chat beside Live Broadcast. Its own unit, **`highdesert-live`**, runs as
user `hdlive` from `/opt/highdesert-live` on 127.0.0.1:3005. It carries SSE
down and JSON POST up, and keeps its state in seven `live_*` tables in the
`highdesert` database. It connects as its own role, `highdesert_live`. A web
deploy never drops a chat stream. The full account is in `docs/live-chat.md`.

- **The listener count is not the chat's.** `<LiveChat />` shows
  `useCommunityNow().live` from the one presence function. The service's
  `clients` is an operational number for `highdesert-status` only.
- **No address is stored.** `client_ref` is an HMAC of the app's own
  `clientKey()` under `CHAT_CLIENT_SECRET`. The implementation is shared
  through the symlink `services/live/lib/shared/client-key.ts →
  src/lib/utils/client-key.ts`, and deploy copies it with `-L`. Every
  `client_ref` column has a CHECK that it is 64 hex characters.
  `X-Forwarded-For` is trusted only from loopback.
- **Moderation is server-side and free.** `obscenity` plus
  `data/chat-blocklist.txt`, which the owner extends: `mask:`, `allow:`,
  `b64:`, `*wildcards*`.
  - Mild profanity is masked; slurs, threats, hate and sexual terms are
    blocked.
  - Links, emails and phone numbers are refused.
  - Limits: 280 characters, 1 message per 3 s, duplicate and flood checks,
    and auto slow mode at 20 messages in 30 s.
  - 3 reports from distinct clients hide a message and mute the sender for
    10 min.
  - Names go through the same filter, are unique among active callers, and
    change at most once per 10 min.
  - **Every catalogue title must pass unchanged** (`filter.test.mjs`). Fix a
    false positive with `allow:`, never by weakening a transformer.
  - **Test fixtures hold no slurs in plain text.** They are base64, and the
    variants are derived at test time.
- **Ship a blocklist change without a restart:** commit it, then run
  `bash scripts/deploy-live.sh --blocklist`, which parses the file, installs
  it and sends SIGHUP.
- **Admin is a server-checked credential.** `LIVE_ADMIN_TOKEN` lives in
  `/root/.high-desert-live.env` (chmod 600). `bash scripts/live-setup.sh --link`
  mints a single-use sign-in link (24 h, stored hashed) and copies it to the
  Mac's `~/Downloads`. The link sets an HttpOnly, Secure, SameSite=Strict
  HMAC cookie. The UI only reflects `admin: true`; the server checks every
  action.
- **The 10% rule.** `highdesert-status`'s `live` line FAILs above 10% of one
  core, judged on hd-cpu-sample's 15-minute cgroup mean. The service's own
  average from `/live-api/health` is the fallback while the ring is young.
  `CPUQuota=25%` is only a safety net. A load test of 200 callers measured
  3.0%, with 0 deliveries lost (`services/live/scripts/load.mjs`).
- **The load-test header `x-live-test-client`** works only with
  `LIVE_LOAD_TEST=1` and only from loopback. The unit never sets it, and
  `deploy-live.sh` refuses an env file that does.
- **Deploy** (never `npm install` here):
  1. `bash scripts/live-setup.sh` (once);
  2. `bash scripts/deploy-live.sh` — stages, runs `npm ci`, `pg_dump`, applies
     the schema, installs the unit, swaps, installs the nginx locations
     (`nginx -t` first), then verifies health, an SSE hello through nginx and
     a POST round trip, rolling back on failure;
  3. `bash scripts/live-setup.sh --link`.

  `--verify-only` and `--rollback` exist. `scripts/deploy.sh` does not touch
  the chat.

## Dexie: clearing a field

**Correction — the claim that used to be here was wrong.** It said `Table.update()`
ignores keys whose value is `undefined`, making `update(id, { rating: undefined })` a
silent no-op. **Dexie 4.3.0 deletes the key**, exactly as `.modify()` does. Verified
directly against the installed library; `dexie` has been pinned `^4.3.0` since the first
commit and has never been upgraded, so the premise was never true for this project.

The belief survived because the regression test asserted it against a *hand-written model
of Dexie* rather than Dexie — it could not fail. The test now uses `fake-indexeddb` and
drives `toggleFavorite`/`rateEpisode`/`toggleFlag` end to end against the real database:
`src/services/episodes/__tests__/clear-field.test.ts`. The full account — what `b88378d`
claimed, what the library source actually does, and why the mirror test could not
disprove it — is in `docs/dexie-update-semantics.md`.

`applyEpisodeFields()` in `src/services/episodes/management.ts` stays, and is still what
to use — it is explicit about intent and does not depend on a third-party library's
treatment of `undefined` staying put. But it is **not load-bearing** for this behaviour.
Whatever made ratings and favourites appear uncleared, it was not `update()`; the other
half of that fix, below, is the likelier culprit and is independently confirmed.

Related: the library's detail panel renders `selectedEpisodeLive`, re-read from the
live query, not the `useState` snapshot taken when the row was clicked. Writes made from
inside the panel are otherwise invisible until it is closed and reopened.

## Database (Dexie v9)

**Primary entity:** `Episode` — identity (id, fileHash), metadata (title, airDate, guestName, showType), audio (duration, bitrate), playCount, archive source, AI fields (aiSummary, aiTags[], aiCategory, aiSeries, aiNotable, aiStatus), user fields (favoritedAt, rating).

**Other tables:** `Progress` (below), `Playlist`, `HistoryEntry`, `Bookmark`, `ScanSession`, `UserPrefs` (key/value).

### Playback position lives in `progress` (v9, HD-016)

`playbackPosition` and `lastPlayedAt` are **not** on the episode row any more. They
live in `db.progress` (`Progress {fileHash, playbackPosition?, lastPlayedAt?}`, schema
`"fileHash, lastPlayedAt"`). Every position save used to be a write to `episodes`,
which re-ran every live query over the whole table — the library list, facets, smart
playlists, stats — every 30 s of playback and on every pause.
`src/hooks/library/__tests__/position-save-quiet.test.tsx` drives the real saves against
the library's real query (`useLibraryEpisodes`) and holds its render count still, with a
control proving an episodes write does wake it.

- **Keyed by `fileHash`**, not the numeric id: it is what Export/Import travel by, the
  dedup/heal/legacy-key merges retire ids but never hashes, a doubled library's twins
  share one entry, and the unload flush can `put` without reading the episode first.
- **One writer: `writeProgress()`** (`src/services/episodes/progress.ts`) — patches
  `useProgressStore` synchronously, then upserts the table. The one exception is the
  unload flush, a raw IndexedDB `put` into `progress` (Dexie cannot run in unload) that
  patches the store itself.
- **Reads are synchronous, from `useProgressStore`** (`positionOf`, `useProgress(hash)`,
  `useProgressIndex()`, `useStartedHashes()`). `playEpisode()` must not await before
  `play()`, so the start position cannot come from IndexedDB. `startProgressSync()` —
  started once in `(desktop)/layout.tsx` — keeps the store equal to the table, other tabs
  included; the restore path awaits `progressReady()`. An entry keeps its object identity
  until its own numbers change, so a save re-renders the one playing row, not 1,312.
- **"Recently played" / "Continue listening"** read `recentlyPlayedEpisodes()`, which walks
  the `progress.lastPlayedAt` index and joins episodes by `fileHash`.
- **Listened time was never on the episode row** — it is `history.duration`
  (`src/services/episodes/listen-time.ts`) and stays there.
- **The v9 upgrade COPIES and leaves the old fields in place**
  (`src/db/progress-migration.ts`). Stripping them would be a second write to every row
  of the one table with no server backup, inside an upgrade, for no gain. No code reads
  them: the `Episode` type no longer has them (`StoredEpisode` names them for the merge
  code that runs *before* v9), and the episodes' `lastPlayedAt` index is dropped so a
  stray `where("lastPlayedAt")` throws instead of answering from frozen data. Two rows
  sharing a hash become one entry by `mergeProgress` (later play wins, with its position).
  `src/db/__tests__/progress-migration.test.ts` runs v8 → v9 on the real seeded catalog
  and asserts every value arrives and every row of every table is otherwise unchanged.
- **Every path that deletes or merges episodes handles `progress` in the same
  transaction:** `deleteEpisode` (drops the entry unless a twin still has the hash),
  `clearLibrary`, `deduplicateEpisodes` (moves the later-played copy's entry to the
  keeper's hash). A new one must too.

**Show types:** `"coast"` | `"dreamland"` | `"special"` | `"unknown"`

## Admin Mode

Gated by `useAdminStore` — SHA-256 password check. Enables Scanner tab, Search tab, Library menu
(import, export, deduplicate, clear). Persisted in `localStorage['hd-admin']`, hydrated **after**
mount (reading it during render caused a hydration mismatch). Force viewer mode via `?viewer`.

**This is UI gating, not a security boundary.** The hash is a client-side constant and anyone can
set the localStorage key. Never put anything behind it that must actually be protected — all
admin features are local-only and touch nothing server-side.

## Design System

- **Desktop:** Windows 98 dark theme — raised/inset bevels, title bars, menu bars, context menus, status bar
- **Mobile:** Glassmorphism — frosted blur surfaces over animated starfield, bottom tab navigation, swipe gestures
- **Responsive breakpoint:** 768px (`useIsMobile()` hook). **It answers desktop on the server and
  through hydration** (HD-037); a phone flips to mobile right after. It used to be the other
  way round, so every desktop visit mounted the mobile tree first
  (`src/hooks/__tests__/is-mobile-hydration.test.tsx`)
- **Player states:** ultra-mini (28px taskbar), mini (bar), expanded (full panel), mobile mini, mobile expanded (full-screen overlay)

## Security Headers

CSP built in `src/lib/csp.ts`, sent by `next.config.ts` — `connect-src` allows only
`archive.org` (and self). `frame-ancestors` permits `'self'` plus `sang3r.com`/`www.sang3r.com`
(deliberate embedding), so it is *not* fully denied. `'unsafe-inline'` stays (Next's inline
bootstrap); **`'unsafe-eval'` is development-only**. `object-src 'none'`, `base-uri 'self'`,
`form-action 'self'`. `images.unoptimized` (nothing uses `next/image`, so `/_next/image` is
404) and `poweredByHeader: false`.

`npm run check:csp -- <url>` (`scripts/csp-check.mjs`) loads every route in headless Chromium
and fails on any CSP violation, page error or console error. CI runs it against the built app
with a real Postgres behind it. Run it against production after anything that could change
what a page loads.

## Deployment — self-hosted on the VPS

No third-party hosting. Same shape as `sanger-next`.

- **App:** `next start -p 3003` under systemd (`highdesert.service`), nginx vhost with a certbot cert
- **Stats:** Postgres database `highdesert` on the same host; `DATABASE_URL` comes from a
  chmod-600 `EnvironmentFile=` (`/root/.high-desert.env`), never inlined into the unit and
  never committed. Apply schema changes with
  `psql "$DATABASE_URL" -f scripts/schema.sql` — it is idempotent
- **Backup:** `highdesert-backup.timer` (17:30 UTC) pg_dumps to `/root/backups/highdesert`
  (14 days) and rsyncs to the MacBook over Tailscale (skipped under 5 GB free).
  `highdesert-backup-status` → OK / FAILED / STALE (>36h). Restore procedure and the
  rehearsal: `docs/backup.md`
- **Traffic sampler:** `highdesert-sample.timer` POSTs `/api/stats/sample` every 2 minutes,
  authenticated with `STATS_SAMPLE_SECRET` from the same env file. This is the only writer to
  `listener_samples`, and the only reason any *history* exists — `active_sessions` is a live
  set that is pruned as it is counted, and `episode_plays` has no timestamps. A timer rather
  than sampling on read, so quiet periods record real zeroes instead of leaving gaps
- **Presence has one truth.** `getPresence()` is the only computation of online and
  listening — distinct `client_ref`, not sessions (two tabs are one person) — and
  `/api/stats/now` the only endpoint any surface reads, through the shared, ref-counted
  client feed `src/services/stats/now-feed.ts` (`useCommunityNow`). The Stats badge, the
  status bar, the mobile sheet, On Air and Signal Traffic's "Right now" all render that one
  snapshot, each tagged with `presenceAttrs()` (`data-presence`, `data-online`,
  `data-listening`, `data-presence-poll`); `presence-surfaces.test.tsx` holds them equal and
  `highdesert-status` checks the live site. Never give a surface its own fetch or its own
  arithmetic — the badge's `online − 1` and a second poll on a second clock once put 7, 8
  and 10 "online" on one screen. `listener_samples.online` counts clients from 2026-09-24
- **On air is a renewed mark, not a timestamp of when you pressed play.** `onAir` filters
  `active_sessions` on `listening_at >= now() - 5 min`. `recordPlay` sets that mark once;
  if nothing renews it, every listener drops off the air five minutes in and stays off for
  the remaining two hours and fifty-five minutes of a Coast to Coast broadcast — the list
  silently degrades into "who started something recently". The 60s heartbeat carries the
  episode while playing and renews it. Anything that changes the heartbeat must keep that
  property, and `ACTIVE_WINDOW_MS` must stay comfortably above the heartbeat interval
- **Recent plays:** `recent_plays` is a rolling 24h log written by `recordPlay`, pruned in the
  same statement that inserts. It exists because neither `episode_plays` (a counter) nor
  `listener_samples` (a cumulative total) can answer *what* was just put on — the one thing
  that makes the site feel inhabited. It deliberately holds no session id
- **The forever log:** `play_events` and `traffic_daily` are the only tables here that are
  never pruned, and everything else is expressly temporary — `recent_plays` at 24h,
  `listener_samples` at 90 days, `weekly_plays` at 3 weeks, `active_sessions` as a live set.
  `recordPlay` appends to `play_events` in the same atomic statement as everything else, and
  the sample timer rolls the day up into `traffic_daily` so multi-year history survives the
  sample prune. Rollup recomputes a 3-day trailing window (so a play either side of midnight
  is not frozen into the wrong day) and never revises a day's plays or sessions *downward*
- **Session refs expire, events do not.** `play_events.session_ref` holds the anonymous
  per-page-load id for 90 days, then `anonymizeOldSessions()` NULLs it and the permanent row
  becomes exactly what `recent_plays` always was: an episode and a time, attached to nobody.
  The id was never linkable to a person or a returning visitor (`src/lib/utils/session-id.ts`
  regenerates it every page load), so this is about not being able to group one sitting's
  listening years later. **Keep the public `/api/stats/*` routes aggregate-only** — the
  session ref exists for `/api/stats/export` and nothing else
- **Rate limiting:** `src/lib/utils/rate-limit.ts` is an in-memory Map. That was useless on
  serverless but is **correct here** — one long-lived process. It depends on nginx setting
  `X-Forwarded-For` to `$remote_addr` (overwrite, not append) so clients can't spoof it.
  **Key on `getClientKey()`, never the raw address**: it buckets IPv6 on the /64 (a home
  connection can mint 2^64 addresses) and folds IPv4-mapped v6 into the v4 client
  (`src/lib/utils/client-key.ts`, HD-007). The Map is capped at `MAX_KEYS`, evicts in LRU
  batches that skip entries currently blocking someone, and is swept by an unref'd interval —
  never inside a request. nginx adds a coarse outer `limit_req` on the POST stats routes;
  the vhost is versioned at `deploy/nginx/highdesert.conf` and `highdesert-status` WARNs on drift
- **Presence cap:** one client holds at most `SESSIONS_PER_CLIENT` (10) sessions in the
  online count. Session ids are minted in the browser, so without it "online" and "on air"
  were whatever a script posted. Over the cap a heartbeat is accepted (`{ok: true}`) and not
  counted; `active_sessions.client_ref` is an HMAC under a per-process random salt, never an
  address, and cannot be joined to `rating_votes`
- **Rating voters are HMACs:** `rating_votes.voter` is `voterId()` — HMAC-SHA256 of the client
  key under `RATING_VOTER_SECRET` (in `/root/.high-desert.env`). Without the secret
  `/api/stats/rate` returns 503 rather than store anything weaker, and the store refuses any
  voter that is not 64 hex. `scripts/migrate-hash-voters.mjs` converted the old plaintext rows
  (HD-008); see `deploy/README.md`
- **`playback_failures.detail` is attacker-controlled text.** It is stored as posted (bounded,
  for diagnosis by psql) but `/api/stats/failures` serves only browser-diagnostic shapes —
  `code=N`, `code=N DEMUXER_ERROR_…` (the tail dropped), `duration=…` — via `publicDetails()`
  in `src/services/stats/failure-detail.ts` (HD-038). Anything else is one placeholder
- **Build id:** `next.config.ts` derives `NEXT_PUBLIC_BUILD_ID` from the git SHA and the service
  worker registers as `/sw.js?v=<id>`, so each deploy installs a fresh worker and purges the
  previous build's cache. Do not hardcode the cache name again
- **No env vars are required** for the app to boot; without `DATABASE_URL` the `/api/stats/*`
  routes return 503 and the UI degrades to empty stats
- **sang3r.com reads this database, it does not copy it.** `/high-desert` on sang3r.com and
  the `sanger_highdesert` MCP tool both proxy `/api/stats/export` over loopback
  (`HIGHDESERT_API` / `HIGHDESERT_TOKEN` in `/root/Sanger/.env.local`, where the token is this
  app's `STATS_EXPORT_SECRET`). Mirroring the log into Supabase was the alternative and would
  have meant a sync cursor to babysit and a second definition of "a play". One writer, one
  source of truth — if the shape of the export changes, only the proxy and the page follow

## Scripts (`/scripts/`)

- `categorize-library.py` — offline batch AI categorization; output is committed into `public/seed/library.json`. This is the ONLY place AI runs
- `clean-library.py` — Python script for library cleanup
- `schema.sql` — the community stats schema; idempotent, re-run on every deploy that touches it
- `backfill-traffic-daily.sql` — one-time (and re-runnable) fill of `traffic_daily` from
  whatever `listener_samples` still holds. Only matters when the rollup is deployed after
  sampling has been running; plays are derived from cumulative deltas, so those days are
  approximate at the midnight boundary and carry `sessions: 0`

## Deploying to the VPS — do not break the live service

`/root/High-Desert` **is** the production directory. `next start` reads chunks
from `.next` lazily, at request time, so the running server holds a manifest
pointing at files on disk.

**Never `rm -rf .next` or `node_modules` here while the service is running.**
Doing so leaves the process serving pages that reference JS chunks that no
longer exist: every route still returns **200**, but browsers cannot load the
app — buttons do nothing and audio never starts. This has happened once, during
a "clean install" verification, and took real users down. HTTP status checks
will not catch it.

Deploy — **always with the script** (full account: `docs/deploy.md`):

```bash
cd /root/High-Desert
git pull                               # or checkout the intended ref
bash scripts/deploy.sh                 # refuses a dirty tree
bash scripts/deploy.sh --verify-only   # client-side check of the running server
bash scripts/deploy.sh --rollback      # swap live <-> previous build, restart, verify
highdesert-status                      # deploy drift, service, backup, sampler, failures, audit
```

- **It builds into `.next-staging`** (`HD_DIST_DIR`, read by `next.config.ts`), never
  into the live `.next`. `next build` empties its distDir first, so building in place
  meant a failed build left the running server serving deleted chunks. A failed build
  now exits non-zero with the live site untouched and nothing restarted.
- **A lockfile change installs and builds in a staging copy** of the tree and swaps
  `node_modules` in with the build. The live `node_modules` is never deleted under the
  running process.
- **Verification is client-side and fails closed**: the server must answer, and `/`,
  `/library`, `/radio`, `/stats` must each be 200, reference ≥1 chunk, and every chunk
  must be 200. Any failure **rolls back to `.next.prev` automatically**.
- The commit is checked into the service-worker registration chunk *before* the swap.

**Never run `npm install` / `npm ci` in `/root/High-Desert`.** It rewrites the live
`node_modules` under the running server — this happened during the 2026-09-21 upgrade
(`docs/deploy.md`, "Incident"). Change dependencies in a separate checkout
(`git worktree add ../hd-deps main`), commit, pull here, and let `deploy.sh` install
them in its staging copy. There is no safe "by hand" equivalent of the deploy any more:
the old `npm run build && systemctl restart` builds in place.

**Commit before you build.** `NEXT_PUBLIC_BUILD_ID` names the service worker
cache, and `activate` only purges caches whose name *differs* from the current
one — so a build id that repeats the previous deploy's leaves that deploy's
shell cached and served to offline visitors. A build once ran 85 seconds before
the commit it was meant to ship and went out stamped with its predecessor.
`next.config.ts` hashes the working tree into the id when the tree is dirty, but a
dirty deploy still ships something that is not in git.

For destructive verification (clean installs, dependency bisects), copy the repo
elsewhere and test there.

**The service is sandboxed** (`deploy/highdesert.service`, HD-026): `next start -H
127.0.0.1`, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only`,
`PrivateTmp`, and only `.next` writable. Anything new that writes at runtime outside
`.next` will fail with `EROFS` — add a `ReadWritePaths=` for it, deliberately.

## Data safety — read before touching `src/db/`

All user data (favorites, ratings, playback positions, history, bookmarks) lives **only** in the
visitor's IndexedDB. There is no server backup. A bad write here is unrecoverable.

- **Identity key is `fileHash`** (`archive:{identifier}:{fileName}`) — unique across the catalog,
  indexed, and built identically by the seeder and both import paths — always through
  `archiveFileHash()` in `src/db/identity.ts`. `archiveIdentifier` is the
  *collection* id and is the SAME for every episode; never use it alone as an identity. The catalog
  scraper once wrote `archive:{identifier}` with no file name; the **v8** Dexie upgrade
  (`src/db/legacy-keys.ts`) rewrites those rows, merging any that collide with a canonical row
  without dropping user data.
- **Seed, heal and reconcile hold the cross-tab `"hd-seed"` Web Lock** (`src/db/seed-lock.ts`) and
  re-check inside their rw transaction. Two first-visit tabs used to seed 1,312 rows each (HD-009).
  The lock is not re-entrant — never call one locked function from inside another.
- **`reconcileLibrary()` is `bulkAdd`-only.** It restores catalog rows missing locally and by
  construction cannot touch an existing row. Keep it that way — never `bulkPut`, never `update`.
- **No unattended destructive operations against `db.episodes`, ever.** Deduplication is
  user-initiated and confirmed. An automatic dedup once deleted 1,312 of 1,313 episodes for
  users who had grown their library past a threshold. **Two narrowly scoped exceptions, each
  documented at the top of its file and each asserting on what survives:** `healDoubledLibrary()`
  (`src/db/heal.ts`) acts only when every catalog `fileHash` present appears *exactly twice* — the
  double-seed signature — and refuses the whole library on anything else (a triple, a lone
  user-made duplicate); and the v8 legacy-key upgrade merges only rows with the identical
  canonical key. Both fold the retired row's favourite/rating/plays/flag into the keeper
  (`absorbUserData`) and repoint history, bookmarks, playlists and the saved queue
  (`repointEpisodeRefs`, `src/db/merge.ts`) in one transaction before anything is removed. Do not
  add a third.
- **The v9 upgrade (`src/db/progress-migration.ts`) writes only to the new `progress`
  table.** It copies `playbackPosition`/`lastPlayedAt` off every episode row and leaves the
  rows exactly as they were — no field stripped, no row rewritten — which the migration test
  asserts row by row on the real catalog. Keep upgrades over `episodes` additive like this; a
  cleanup of the frozen fields, if ever wanted, is its own reviewed version.
- **`refreshCatalogFlags()` (`src/db/catalog-flags.ts`) is an unattended write, not a
  destructive one.** It sets `aiNotable: true` on the rows listed in `data/notable.json`,
  once per `NOTABLE_VERSION`, under the seed lock — never unsets it, never touches another
  field, never adds or removes a row. It exists because `reconcileLibrary()` is bulkAdd-only,
  so a catalog flag added after a visitor's seed never reaches them otherwise.
  `src/db/__tests__/notable.test.ts` compares every field of every row before and after.
  Adding to the list: `data/notable.md`, "Rules for adding one".
- **Delete and Clear Library are each one rw transaction** over every dependent table
  (`deleteEpisode`, `clearLibrary` in `src/services/episodes/management.ts`). A failure part-way
  leaves nothing half-deleted.
- **`deduplicateEpisodes()` has safety rails** (`MAX_GROUP_SIZE` 20, `MAX_DELETE_RATIO` 25%) and
  aborts rather than throwing. They are not optional — they would have prevented that incident
  independently of the key bug.
- Regression tests live in `src/db/__tests__/`; `dedupKey` must yield one distinct key per row of
  the real seed catalog (**1,312** — see `docs/broken-episodes.md` for the one that was removed).
  The count is asserted against the catalog rather than hardcoded, so pulling an episode does not
  need the test edited; changing it to a literal would make the next removal look like a bug.
- **`deleteEpisode()` is covered end to end** against `fake-indexeddb` in
  `src/services/episodes/__tests__/delete-episode.test.ts` — the cascade into
  history/bookmarks/playlists, the tombstone, and `reconcileLibrary()` honouring it. Note the
  **control test**: it deletes the same row *without* a tombstone and asserts reconcile **does**
  restore it. Without that, "reconcile restored nothing" is not evidence — a reconcile that never
  ran would pass identically, which is the exact trap `docs/disconnected-checks.md` is about.
  The cascade assertions are written on what **survives**, not on what is gone; the incident here
  was blast radius, and a too-wide cascade is invisible to a test that only checks the target row.
  `management.ts` carries four mutations in `scripts/mutate-check.mjs` rather than the usual one —
  it writes to five tables and there is no server backup, so one anchor would leave two of the
  three properties unobserved.

## Keeping the data: persist(), the audio cache, Export / Import (HD-010)

- **`navigator.storage.persist()` is asked once per profile, after the first real write**
  (`src/db/persist.ts`). Dexie hooks installed from `src/db/index.ts` watch episodes
  (`favoritedAt`/`rating`/`flaggedAt` changes), every `progress` write (a saved
  position), bookmark creation and playlist writes; the seed is not counted. The request is recorded as the userPref
  `storage-persist-requested` and never repeated. A new write path needs nothing — the hook
  sees it — but a new *kind* of listener data belongs in `USER_EPISODE_FIELDS` or a hook.
- **The OPFS cache shares a quota with the library** (`src/audio/cache.ts`), and running out
  evicts the whole origin. Writes are checked against `storage.estimate()`, refused past
  `CACHE_QUOTA_FRACTION` (0.8), serialized, and removed if they fail midway.
  `cacheAudioBlob` resolves a `CacheWriteResult` and never rejects. No `estimate()` → refused.
- **File > Export / Import My Data** (and the mobile sheet) — `src/services/user-data/portable.ts`.
  Versioned (`format: "high-desert-user-data"`, `version: 1`), keyed by `fileHash`, never the
  numeric id. Import validates the whole file first, previews counts in a dialog, and merges
  **add-only** in one rw transaction: local values win conflicts, positions go to the later
  listen, same-name playlists are extended. Position and last-played are read from and
  written to `db.progress`; the file format is unchanged. A new personal field must be added to both
  export and `plan()`, with the round-trip test in `__tests__/portable.test.ts`.
- **The admin "Export Library Seed..." writes a bare array** (`src/db/catalog-export.ts`),
  the shape `public/seed/library.json` and `src/services/stats/catalog.ts` read, from an
  allowlist of catalog fields — no favourites, ratings, flags, positions or local files.

## Pulling an episode from the catalog

Removing a row from `public/seed/library.json` is a four-step change, and skipping any of them
breaks a test or a route:

1. Remove the object from `public/seed/library.json`.
2. `node scripts/gen-community-keys.mjs` — otherwise the allowlist keeps a key with no episode
   behind it and `src/services/stats/__tests__/catalog.test.ts` fails. (It did, which is the
   point of that test.)
3. Record it in `docs/broken-episodes.md`, with the full original JSON object so it can be
   restored without reconstruction.
4. Add its `fileHash` to `REMOVED_FROM_CATALOG` (`src/lib/library/removed-episodes.ts`).
   `removed-episodes.test.ts` holds that list equal to the doc's JSON records and fails if
   one is back in the catalog.

Existing visitors keep the row: `reconcileLibrary()` is `bulkAdd`-only and never deletes. That is
deliberate, and it is why the runtime guard below matters — a removal only stops an episode
reaching *new* visitors. **Nothing removes it for them automatically, and nothing may.** The row
is *marked* instead: **Unavailable** in the list and the detail panel; a play stops in
`playEpisode()` before any source is assigned (so no archive.org request, and whatever is playing
carries on) and raises `UnavailableEpisodeDialog`; and the detail panel and row menu offer
**Remove from my library** to every visitor, which opens the library's ordinary delete
confirmation and then `deleteEpisode()` — one transaction, tombstoned. Marked by exact `fileHash`
from the explicit list, never by "absent from the catalog", so a local file or the visitor's own
import is never marked. Tests: `unavailable-episode.test.tsx`, `unavailable-play.test.ts`.

## Is there actually a broadcast in the file?

One catalogued episode contained no audio at all: 77,380 bytes of ID3v2 tag wrapping a JPEG cover,
zero MPEG frames. Archive.org serves it with a clean `206`, the right `Content-Type` and a
plausible `Content-Length`, so **every HTTP-level check passes it** — including the full 1,313-file
sweep in `scripts/audit-episodes.mjs`. Pressing play produced nothing, which is exactly the "the
show didn't start" report that began this work.

- **`scripts/audit-durations.mjs`** is the catalog sweep. It reads the first 64KB of real audio and
  walks the MPEG frame headers. It must seek past the ID3 tag first — the tags on this collection
  carry cover art and run ~77KB, so a window taken from byte zero lands entirely inside the
  artwork and reports working three-hour shows as empty. The first draft did exactly that to 10 of
  the first 12 episodes.
- **`src/audio/duration-sanity.ts`** is the runtime guard, and it is deliberately timid. The
  "much shorter than catalogued" comparison waits for `ended`, when the number is a measurement.
  37 of the episodes are legitimately under ten minutes; flagging on length alone would break
  working shows to fix a broken one.
- **`ended` has sole authority to fail a show. `loadedmetadata` is advisory.** The absolute
  floor (under 5s) is still evaluated there, but it now only *records* — kind
  `empty-media-suspected`, with the reported duration in `detail` — and lets playback continue.
  `duration` at `loadedmetadata` is extrapolated from the first frame for a VBR rip with no Xing
  header, which is most of this catalog, and an extrapolation must not get stopping power over an
  episode that plays fine: a false stop costs a listener a show, while letting a genuinely empty
  file run costs a few seconds until `ended`. Note this code path had **never executed in
  production** before the `withGlobals` fix — the listener that calls it was never attached. The
  advisory rows exist to decide, from real traffic, whether the 5s floor is safe to promote.
- **A missing `duration` is not evidence of anything.** Archive.org's VBR derive reports
  `length: "0"` for five episodes here, two of which are full three-hour broadcasts.
- `empty-media` is the one `FailureKind` that is **never retried** — the same bytes come back, so a
  retry only adds twelve seconds to the wait. `PlaybackErrorDialog` drops its "Try Again" button
  and says the recording is empty rather than blaming the connection.
