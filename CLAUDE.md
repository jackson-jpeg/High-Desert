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
```

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
| `/api/archive/health` | GET | archive.org reachability probe (cached) |
| `/api/stats/play` | POST | Record a play. Body `{episodeId, sessionId}`. Returns `{ok}`. `episodeId` must be in the community-key allowlist |
| `/api/stats/stop` | POST | End playback. Body `{sessionId, keepPresence?}`. `keepPresence: true` clears only the listening mark (the tab is still open); omitting it deletes the session, which is what the unload beacon does. Returns `{ok}` |
| `/api/stats/rate` | POST | Submit a rating 1–5 or null. Body `{episodeId, rating}`. Returns `{ok}` |
| `/api/stats/episodes` | GET | Play counts for up to **100** ids. Returns **`{counts: {id: n}}`** |
| `/api/stats/ratings` | GET | Ratings for up to **50** ids. Returns a **bare map** `{id: {avg, count}}` |
| `/api/stats/leaderboard` | GET | Top episodes. Returns **`{entries: [{episodeId, plays}]}`** |
| `/api/stats/active` | GET | Presence. Returns **`{count, online, listening}`** — `count` is a synonym for `listening`, kept for older clients |
| `/api/stats/heartbeat` | POST | Mark a session present. Body `{sessionId}`. Returns `{ok}`. Every open tab posts on a 60s interval |
| `/api/stats/now` | GET | Presence **plus what is playing**. Returns **`{online, listening, onAir: [{episodeId, listeners}], recent: [{episodeId, at}]}`**. `no-store` — a stale on-air list is worse than none. Aggregate only: no query joins `session_id` to `episode_id`, and `recent_plays` stores no session at all |
| `/api/stats/traffic` | GET | Traffic history. `?range=24h\|7d\|30d`. Returns **`{range, points: [{t, online, listening, plays}], peakOnline, peakListening, playsInRange, totalPlays, peakAt, hourly: [{hour, online, listening, plays, samples}]}`**. `hourly` is always a 24-entry, zero-filled, **UTC**-hour profile over the last 30 days and does *not* vary with `range`; the client rotates it into local time. `samples: 0` means *never observed*, which is not the same as "observed, nobody here" — the UI hides the profile until 8 hours have been sampled, or a day-old deployment draws 23 empty columns and looks like a dead site |
| `/api/stats/sample` | POST | Writes one traffic sample, then rolls up the day and expires old session refs. Requires `x-sample-token`; called only by `highdesert-sample.timer`. Returns `{ok, online, listening, totalPlays, rolledUp, anonymized}` |
| `/api/playback-event` | POST | A show failed to start. Body `{episodeId, kind, retried, recovered, elapsedMs, uaClass}`. `kind` is one of `timeout`/`stall`/`play-rejected`/`network-error`/`decode-error`; `uaClass` is a coarse bucket from `src/lib/utils/platform.ts`, **never a raw user-agent**. No session id, no IP. `episodeId` must be in the community-key allowlist |
| `/api/stats/failures` | GET | Which episodes are failing, worst first. `?days=7\|30\|90`. Returns **`{days, entries: [{episodeId, title, failures, recovered, plays, rate, kinds, uaClasses, lastAt}]}`**. Ids resolved to titles from the seed catalog. Unauthenticated — it is aggregate-only, and the admin gate is presentation, not protection |
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
│   ├── index.ts          # Dexie instance, indexes, migrations (v7), pref helpers
│   ├── deduplicate.ts    # Duplicate detection and merging
│   └── seed.ts           # Seeding, reconcile (restores missing episodes), export
├── hooks/                # Custom React hooks
├── lib/utils/            # cn, format, rate-limit, retry, search-parser, streak,
│                         #   community-key, scroll-lock, platform
├── services/
│   ├── archive/          # Archive.org client, scraper, filename parser
│   ├── scanner/          # File scanner, hasher, metadata extractor, filename parser
│   ├── episodes/         # Episode CRUD, favorites, ratings, bookmarks, playlists
│   └── stats/            # Community stats client + Postgres queries
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
| `useSleepTimerStore` | `remaining`, `active` |
| `useToastStore` | `toasts[]` — also exports module-level `toast.success/error/info/caller()` |
| `useAdminStore` | `isAdmin` — SHA-256 password gate, persisted in localStorage |
| `useContextMenuStore` | `open`, `position`, `items[]` |

## Custom Events (Window Bus)

Cross-component communication via `window.dispatchEvent(new CustomEvent(...))`:

| Event | Purpose |
|---|---|
| `hd:play-episode` | Trigger playback |
| `hd:sort`, `hd:shuffle` | Library sorting/shuffling |
| `hd:focus-search` | Focus the search box |
| `hd:scroll-to-current` | Scroll library to now-playing |
| `hd:show-guest` | Open guest profile modal |
| `hd:filter-tag`, `hd:filter-category`, `hd:filter-series` | Apply library filters |
| `hd:easter-egg`, `hd:admin-prompt`, `hd:status-message` | Shell/easter-egg signals |
| `hd:archive-status`, `hd:queue-selected`, `hd:toggle-shortcuts` | Misc |
| `hd:toggle-ultra-mini` | Toggle ultra-mini player |
| `hd:scan-preview` / `hd:scan-preview-stop` | Radio scan audio snippets |

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
- **`useAudioPlayer` is mounted twice** — by `(desktop)/layout.tsx` and by
  `AudioPlayer.tsx`, whose `return null` sits after the hooks. Global listeners,
  timers and intervals go through `withGlobals()` so they install once. Anything new
  with a side effect outside React must too, or it runs twice: that is why the queue
  used to skip two tracks at the end of a show.
- **The service worker must never see media.** `public/sw.js` returns early for
  `Range` requests, `destination === "audio"`, archive.org hosts and audio extensions.
  It never cached audio, so `respondWith()` bought nothing while defeating native
  byte-range handling and turning network failures into a body-less 504 that the
  element reports as "source not supported".

## Dexie: clearing a field

**`Table.update()` ignores keys whose value is `undefined`.** `update(id, { rating:
undefined })` is a silent no-op, not a delete. Every "toggle off" path in
`src/services/episodes/management.ts` was written that way, so un-rating, un-favouriting
and un-flagging all returned the new state and fired a toast while the stored row never
changed. Use `applyEpisodeFields()` in that file, which goes through `.modify()` and
`delete`s the key. Regression test: `src/services/episodes/__tests__/clear-field.test.ts`.

Related: the library's detail panel renders `selectedEpisodeLive`, re-read from the
live query, not the `useState` snapshot taken when the row was clicked. Writes made from
inside the panel are otherwise invisible until it is closed and reopened.

## Database (Dexie v7)

**Primary entity:** `Episode` — identity (id, fileHash), metadata (title, airDate, guestName, showType), audio (duration, bitrate), playback (lastPlayedAt, playbackPosition, playCount), archive source, AI fields (aiSummary, aiTags[], aiCategory, aiSeries, aiNotable, aiStatus), user fields (favoritedAt, rating).

**Other tables:** `Playlist`, `HistoryEntry`, `Bookmark`, `ScanSession`, `UserPrefs` (key/value).

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
- **Responsive breakpoint:** 768px (`useIsMobile()` hook)
- **Player states:** ultra-mini (28px taskbar), mini (bar), expanded (full panel), mobile mini, mobile expanded (full-screen overlay)

## Security Headers

CSP configured in `next.config.ts` — `connect-src` allows only `archive.org` (and self).
`frame-ancestors` permits `'self'` plus `sang3r.com`/`www.sang3r.com` (deliberate embedding),
so it is *not* fully denied. Still carries `unsafe-inline`/`unsafe-eval` for Next.js.

## Deployment — self-hosted on the VPS

No third-party hosting. Same shape as `sanger-next`.

- **App:** `next start -p 3003` under systemd (`highdesert.service`), nginx vhost with a certbot cert
- **Stats:** Postgres database `highdesert` on the same host; `DATABASE_URL` comes from a
  chmod-600 `EnvironmentFile=` (`/root/.high-desert.env`), never inlined into the unit and
  never committed. Apply schema changes with
  `psql "$DATABASE_URL" -f scripts/schema.sql` — it is idempotent
- **Traffic sampler:** `highdesert-sample.timer` POSTs `/api/stats/sample` every 2 minutes,
  authenticated with `STATS_SAMPLE_SECRET` from the same env file. This is the only writer to
  `listener_samples`, and the only reason any *history* exists — `active_sessions` is a live
  set that is pruned as it is counted, and `episode_plays` has no timestamps. A timer rather
  than sampling on read, so quiet periods record real zeroes instead of leaving gaps
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
  `X-Forwarded-For` to `$remote_addr` (overwrite, not append) so clients can't spoof it
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

Safe deploy — **use the script**, which does all of the below and then verifies it:

```bash
cd /root/High-Desert
git pull                     # or checkout the intended ref
bash scripts/deploy.sh       # refuses a dirty tree; build + restart + verify
```

It refuses to deploy uncommitted work (`--allow-dirty` to override), builds,
restarts, then walks every `/_next/static/chunks/*.js` on four routes and exits
non-zero if any does not return 200. Build and restart are one step on purpose:
separating them is what leaves the running process serving a manifest for chunks
that no longer exist.

**Commit before you build.** `NEXT_PUBLIC_BUILD_ID` names the service worker
cache, and `activate` only purges caches whose name *differs* from the current
one — so a build id that repeats the previous deploy's leaves that deploy's
shell cached and served to offline visitors. A build once ran 85 seconds before
the commit it was meant to ship and went out stamped with its predecessor.
`next.config.ts` now hashes the working tree into the id when the tree is dirty,
so the collision cannot recur, but a dirty deploy still ships something that is
not in git. The equivalent by hand:

```bash
npm ci                       # only if package-lock.json changed
npm run build                # writes a new .next
systemctl restart highdesert # load the new build
```

Then verify the **client**, not just the status code — fetch the page and
confirm every `/_next/static/chunks/*.js` it references returns 200:

```bash
R="--resolve highdesert.space:443:187.77.218.14"
for c in $(curl -s $R https://highdesert.space/library \
    | grep -oE '/_next/static/chunks/[a-zA-Z0-9._-]+\.js' | sort -u); do
  echo "$(curl -s $R -o /dev/null -w '%{http_code}' https://highdesert.space$c) $c"
done
```

For destructive verification (clean installs, dependency bisects), copy the repo
elsewhere and test there. Restart the live service only onto a finished build.

## Data safety — read before touching `src/db/`

All user data (favorites, ratings, playback positions, history, bookmarks) lives **only** in the
visitor's IndexedDB. There is no server backup. A bad write here is unrecoverable.

- **Identity key is `fileHash`** (`archive:{identifier}:{fileName}`) — unique across the catalog,
  indexed, and built identically by the seeder and both import paths. `archiveIdentifier` is the
  *collection* id and is the SAME for every episode; never use it alone as an identity.
- **`reconcileLibrary()` is `bulkAdd`-only.** It restores catalog rows missing locally and by
  construction cannot touch an existing row. Keep it that way — never `bulkPut`, never `update`.
- **No unattended destructive operations against `db.episodes`, ever.** Deduplication is
  user-initiated and confirmed. An automatic dedup once deleted 1,312 of 1,313 episodes for
  users who had grown their library past a threshold.
- **`deduplicateEpisodes()` has safety rails** (`MAX_GROUP_SIZE` 20, `MAX_DELETE_RATIO` 25%) and
  aborts rather than throwing. They are not optional — they would have prevented that incident
  independently of the key bug.
- Regression tests live in `src/db/__tests__/`; `dedupKey` must yield one distinct key per row of
  the real seed catalog (**1,312** — see `docs/broken-episodes.md` for the one that was removed).
  The count is asserted against the catalog rather than hardcoded, so pulling an episode does not
  need the test edited; changing it to a literal would make the next removal look like a bug.

## Pulling an episode from the catalog

Removing a row from `public/seed/library.json` is a three-step change, and skipping any of them
breaks a test or a route:

1. Remove the object from `public/seed/library.json`.
2. `node scripts/gen-community-keys.mjs` — otherwise the allowlist keeps a key with no episode
   behind it and `src/services/stats/__tests__/catalog.test.ts` fails. (It did, which is the
   point of that test.)
3. Record it in `docs/broken-episodes.md`, with the full original JSON object so it can be
   restored without reconstruction.

Existing visitors keep the row: `reconcileLibrary()` is `bulkAdd`-only and never deletes. That is
deliberate, and it is why the runtime guard below matters — a removal only stops an episode
reaching *new* visitors.

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
- **`src/audio/duration-sanity.ts`** is the runtime guard, and it is deliberately timid. Only the
  absolute floor (under 5s) is judged at `loadedmetadata`, because `duration` there is
  extrapolated from the first frame for a VBR rip with no Xing header — which is most of this
  catalog — and browsers correct it later. The "much shorter than catalogued" comparison waits for
  `ended`, when the number is a measurement. 37 of the episodes are legitimately under ten
  minutes; flagging on length alone would break working shows to fix a broken one.
- **A missing `duration` is not evidence of anything.** Archive.org's VBR derive reports
  `length: "0"` for five episodes here, two of which are full three-hour broadcasts.
- `empty-media` is the one `FailureKind` that is **never retried** — the same bytes come back, so a
  retry only adds twelve seconds to the wait. `PlaybackErrorDialog` drops its "Try Again" button
  and says the recording is empty rather than blaming the connection.
