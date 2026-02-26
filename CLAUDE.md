# High Desert — Project Guide

> A desktop-grade web player for the Art Bell radio archive. Windows 98 dark UI on desktop, glassmorphism on mobile, streaming from archive.org, all data stored client-side in IndexedDB.

**Live:** [highdesert.space](https://highdesert.space) | **Repo:** `jacksongoode/High-Desert`

## Quick Start

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY, ADMIN_API_TOKEN (both optional)
npm run dev                   # http://localhost:3000
npm run build                 # production build
npm run lint                  # ESLint (next/core-web-vitals + typescript)
```

## Tech Stack

- **Next.js 16.1.6** (App Router) + **React 19** + **TypeScript 5**
- **Tailwind CSS v4** with custom Win98/glass design tokens (`src/styles/`)
- **Dexie 4** — IndexedDB ORM, reactive queries via `useLiveQuery`
- **Zustand 5** — client state (player, radio dial, scanner, scraper, search, admin, context menu, sleep timer, toasts)
- **Web Audio API** — oscilloscope visualizer, radio static generator, startup sound
- **Anthropic Claude SDK** — AI episode categorization (server-side, `/api/categorize`)
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
| `/api/categorize` | POST | Claude Sonnet batch categorization (max 10 episodes, requires `x-hd-admin: true`, rate-limited 10/min) |

### Data Flow

1. **No server-side persistence** — all episode data lives in IndexedDB (Dexie)
2. **Audio streaming** — archive episodes stream via `archive.org/download/...` URLs
3. **Local files** — scanned, hashed (MD5), metadata extracted (ID3/Vorbis), cached in OPFS
4. **AI categorization** — client sends episode metadata to `/api/categorize` → Claude returns structured JSON (summary, tags, category, series info, notable flag)
5. **First visit** — library auto-seeded from `/public/seed/library.json`

## Key Directories

```
src/
├── app/                  # Next.js App Router pages + API routes
│   ├── (desktop)/        # Main route group (shared layout with player)
│   └── api/              # Server-side API proxies + AI endpoint
├── audio/                # Audio engine modules (singleton pattern)
│   ├── engine.ts         # HTMLAudioElement + AudioContext singleton
│   ├── cache.ts          # OPFS audio blob cache
│   ├── radio-static.ts   # White noise generator for radio page
│   ├── oscilloscope-renderer.ts  # Canvas waveform/static/idle drawing
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
│   ├── index.ts          # Dexie instance, indexes, migrations (v6), pref helpers
│   ├── deduplicate.ts    # Duplicate detection and merging
│   └── seed.ts           # First-visit library seeding + admin export
├── hooks/                # Custom React hooks
├── lib/utils/            # cn, format, rate-limit, retry, search-parser
├── services/
│   ├── archive/          # Archive.org client, scraper, filename parser
│   ├── scanner/          # File scanner, hasher, metadata extractor, filename parser
│   └── episodes/         # Episode CRUD, favorites, ratings, bookmarks, recategorize
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
| `hd:focus-search`, `hd:search` | Search focus/query |
| `hd:scroll-to-current` | Scroll library to now-playing |
| `hd:show-guest` | Open guest profile modal |
| `hd:tag-filter`, `hd:category-filter` | Apply library filters |
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

## Database (Dexie v6)

**Primary entity:** `Episode` — identity (id, fileHash), metadata (title, airDate, guestName, showType), audio (duration, bitrate), playback (lastPlayedAt, playbackPosition, playCount), archive source, AI fields (aiSummary, aiTags[], aiCategory, aiSeries, aiNotable, aiStatus), user fields (favoritedAt, rating).

**Other tables:** `Playlist`, `HistoryEntry`, `Bookmark`, `ScanSession`, `UserPrefs` (key/value).

**Show types:** `"coast"` | `"dreamland"` | `"special"` | `"unknown"`

## Admin Mode

Gated by `useAdminStore` — SHA-256 password check. Enables Scanner tab, Search tab, Library menu (import, categorize, export, deduplicate, clear). Persisted in `localStorage['hd-admin']`. Force viewer mode via `?viewer` URL param.

## Design System

- **Desktop:** Windows 98 dark theme — raised/inset bevels, title bars, menu bars, context menus, status bar
- **Mobile:** Glassmorphism — frosted blur surfaces over animated starfield, bottom tab navigation, swipe gestures
- **Responsive breakpoint:** 768px (`useIsMobile()` hook)
- **Player states:** ultra-mini (28px taskbar), mini (bar), expanded (full panel), mobile mini, mobile expanded (full-screen overlay)

## Security Headers

CSP configured in `next.config.ts` — connects to `archive.org`, `api.anthropic.com`. Frame ancestors denied. No inline eval in production ideal (currently `unsafe-inline unsafe-eval` for Next.js).

## Deployment

- **Target:** Vercel (serverless)
- **Required env vars:** `ANTHROPIC_API_KEY`, `ADMIN_API_TOKEN`, `NEXT_PUBLIC_ADMIN_TOKEN` — set in Vercel project settings
- `ADMIN_API_TOKEN` and `NEXT_PUBLIC_ADMIN_TOKEN` must match — the client sends the token as a Bearer header and the `/api/categorize` route validates it server-side
- The in-memory rate limiter (`src/lib/utils/rate-limit.ts`) does not persist across serverless function instances — each cold start gets a fresh counter. This is acceptable because the token auth is the primary security gate

## Scripts (`/scripts/`)

- `categorize-library.py` — Python script for batch AI categorization
- `clean-library.py` — Python script for library cleanup
