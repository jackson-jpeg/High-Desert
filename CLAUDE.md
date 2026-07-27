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
| `/api/stats/stop` | POST | End a listening session. Body `{sessionId}`. Returns `{ok}` |
| `/api/stats/rate` | POST | Submit a rating 1–5 or null. Body `{episodeId, rating}`. Returns `{ok}` |
| `/api/stats/episodes` | GET | Play counts for up to **100** ids. Returns **`{counts: {id: n}}`** |
| `/api/stats/ratings` | GET | Ratings for up to **50** ids. Returns a **bare map** `{id: {avg, count}}` |
| `/api/stats/leaderboard` | GET | Top episodes. Returns **`{entries: [{episodeId, plays}]}`** |
| `/api/stats/active` | GET | Active listener count. Returns **`{count: n}`** |

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
  chmod-600 `EnvironmentFile=`, never inlined into the unit and never committed
- **Rate limiting:** `src/lib/utils/rate-limit.ts` is an in-memory Map. That was useless on
  serverless but is **correct here** — one long-lived process. It depends on nginx setting
  `X-Forwarded-For` to `$remote_addr` (overwrite, not append) so clients can't spoof it
- **Build id:** `next.config.ts` derives `NEXT_PUBLIC_BUILD_ID` from the git SHA and the service
  worker registers as `/sw.js?v=<id>`, so each deploy installs a fresh worker and purges the
  previous build's cache. Do not hardcode the cache name again
- **No env vars are required** for the app to boot; without `DATABASE_URL` the `/api/stats/*`
  routes return 503 and the UI degrades to empty stats

## Scripts (`/scripts/`)

- `categorize-library.py` — offline batch AI categorization; output is committed into `public/seed/library.json`. This is the ONLY place AI runs
- `clean-library.py` — Python script for library cleanup

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

Safe deploy:

```bash
cd /root/High-Desert
git pull                     # or checkout the intended ref
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
- Regression tests live in `src/db/__tests__/`; `dedupKey` must yield 1,313 distinct keys for the
  real seed catalog.
