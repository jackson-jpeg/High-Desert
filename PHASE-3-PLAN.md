# Phase 3 — The Listening Experience

> *Phase 1 built the foundation. Phase 2 connected the archive. Phase 3 makes it a place you want to stay.*

---

## The Problem

High Desert can scan files, search archive.org, and play a single episode. But it doesn't feel like a *listening tool* yet. There's no queue. Local episodes demand a file-picker every time you press play. You can't delete a bad rip. You can't right-click anything. The library has no concept of "recently played" or "continue where I left off." The AI categorization silently fails with no retry. For a library of 500+ episodes, the timeline will choke without virtualization.

This phase closes every gap between "tech demo" and "daily driver."

---

## Audit Summary (What's Solid, What's Not)

### Solid
- Win98 design system is cohesive and complete
- Web Audio API chain works (including CORS for archive streams)
- Dexie schema is well-indexed
- Playback position persists every 5s
- Scanner pipeline is thorough (hash dedup, ID3 extraction, filename parsing)
- Archive search/add flow works end-to-end

### Broken or Missing
| Issue | Severity |
|-------|----------|
| **No queue/playlist** — single track, no "play next" | Critical |
| **Local episodes need file re-pick every play** — File API handles lost on reload | Critical |
| **No individual episode delete** — only "Clear All" | High |
| **AI categorization silently swallows errors** — no retry, no batch limit, no user feedback | High |
| **No library virtualization** — renders all cards, will lag at 500+ | High |
| **No right-click context menu** — un-Win98 | Medium |
| **No keyboard navigation in library** — can't arrow through episodes | Medium |
| **No "Continue Listening" or "Recently Played"** — cold start every time | Medium |
| **Zero accessibility** — no ARIA labels, no semantic roles on player controls | Medium |
| **Archive search has no input sanitization** — query injection possible | Low |
| **No retry/backoff on network calls** — archive.org and Gemini | Low |

---

## Architecture Decisions

### Queue lives in Zustand, not Dexie
The queue is ephemeral — it's a session concept, not a saved playlist. Store it in `player-store` alongside `currentEpisode`. Playlists (saved, named collections) are a future phase and *would* go in Dexie, but don't build that yet.

### Local file handles via Origin Private File System (OPFS) cache
The File System Access API's `FileHandle` can't survive a page reload without `navigator.storage.getDirectory()`. Instead of fighting the browser, cache the audio blob into OPFS on first play. Subsequent plays read from OPFS by `fileHash` key. This also enables offline playback of previously-played local files.

### Virtual scrolling via lightweight custom hook
Don't add `react-window` or `react-virtuoso` — they fight the Win98 card layout. Write a `useVirtualList` hook that measures card height (fixed at ~80px), calculates visible range from scroll offset, and renders a windowed slice with spacer divs. Keep it under 60 lines.

### Context menu as a single shared component
One `<ContextMenu>` component mounted at the shell level, positioned via pointer coordinates, populated by the triggering component's menu config. No per-card menu instances.

---

## Implementation Plan

### Step 1: Queue System

**New state in `player-store.ts`:**
```
queue: Episode[]
queueIndex: number
```

**New actions:**
- `enqueue(episode)` — add to end of queue
- `enqueueNext(episode)` — insert after current
- `playFromQueue(index)` — jump to queue position
- `clearQueue()` — empty queue
- `removeFromQueue(index)` — remove single item
- `next()` — advance to next, stop if end
- `previous()` — go to previous, restart current if >3s in

**Wire into `useAudioPlayer`:**
- On `ended` event: call `next()` instead of just `setPlaying(false)`
- Expose `next`/`previous` in hook return

**Update `PlaybackControls`:**
- Add `|<<` (previous) and `>>|` (next) transport buttons
- Disable when queue is empty or at boundary

**New `QueuePanel` component:**
- Slide-out panel or expandable section below player
- Draggable reorder (optional — defer if complex)
- Shows queue with current item highlighted
- Right-click or X to remove items

### Step 2: OPFS Audio Cache (Local File Persistence)

**New module `src/lib/audio/cache.ts`:**
- `cacheAudioBlob(fileHash: string, blob: Blob): Promise<void>` — write to OPFS
- `getCachedAudio(fileHash: string): Promise<Blob | null>` — read from OPFS
- `hasCachedAudio(fileHash: string): Promise<boolean>` — check existence
- `clearAudioCache(): Promise<void>` — purge all cached audio
- `getCacheSize(): Promise<number>` — total bytes used

**Update play flow in `layout.tsx`:**
```
1. Episode has sourceUrl? → stream directly (archive)
2. Episode has cached blob in OPFS? → create object URL from cache
3. Neither? → show file picker, cache blob after playback starts
```

**Update scanner:**
- After successful scan of a local file, cache its blob to OPFS
- Add progress indicator: "Caching audio..."

**Cache management:**
- Add "Clear Audio Cache" option in Library menu (separate from Clear Library)
- Show cache size in About dialog

### Step 3: Context Menu

**New component `src/components/win98/ContextMenu.tsx`:**
- Accepts `items: MenuItem[]` (same shape as MenuBar items)
- Positioned at `{x, y}` coordinates
- Closes on click-outside, Escape, or item click
- Dark variant matching existing dropdown style (`w98-dropdown-dark`)

**New hook `src/hooks/useContextMenu.ts`:**
- Returns `{ contextMenu, onContextMenu }` — handler to attach to elements
- Manages open/close state and position

**Wire into EpisodeCard:**
Right-click menu items:
- Play
- Play Next (enqueue after current)
- Add to Queue
- separator
- Delete from Library
- separator
- Re-categorize with AI

**Wire into ArchiveResultCard:**
Right-click menu items:
- Add to Library
- Add to Library & Play

### Step 4: Episode Management

**Individual episode delete:**
- `db.episodes.delete(id)` — remove from Dexie
- Also remove from OPFS cache if exists
- If currently playing, stop playback
- If in queue, remove from queue
- Confirmation dialog (reuse existing Dialog component)

**Re-categorize:**
- Call `/api/categorize` for a single episode
- Show brief "Categorizing..." state on the card
- Update episode in Dexie when done
- Retry once on failure, then surface error

**Bulk operations (multi-select):**
- Hold Shift+click for range select, Ctrl+click for toggle
- Bulk delete, bulk re-categorize
- Selection state lives in library page, not global store

### Step 5: Continue Listening

**"Recently Played" section at top of library:**
- Query: `db.episodes.where('lastPlayedAt').above(0).reverse().sortBy('lastPlayedAt')` limited to 5
- Horizontal row of compact cards above the main timeline
- Only show if there are recently played episodes
- Click resumes from `playbackPosition`

**"Continue" indicator on episode cards:**
- If `playbackPosition > 0 && playbackPosition < duration - 30`, show a small progress bar at bottom of card
- Thin amber line, width = `(position / duration) * 100%`

**Auto-resume on app load:**
- Store last-played episode ID in `userPrefs`
- On mount, if last-played exists and has a position, show a "Continue listening?" banner above the player
- Banner auto-dismisses after 10 seconds if ignored

### Step 6: Virtual Scrolling

**New hook `src/hooks/useVirtualList.ts`:**
```typescript
function useVirtualList<T>({
  items: T[],
  itemHeight: number,       // fixed card height (e.g. 80px)
  containerRef: RefObject,
  overscan?: number,        // extra items above/below viewport
}): {
  virtualItems: { item: T, index: number, offsetTop: number }[],
  totalHeight: number,
  containerProps: { onScroll: handler, style: { height, overflow } },
}
```

**Apply to TimelineView:**
- Replace flat map with virtual slice
- Year headers become part of the virtual list (different item type with different height)
- Maintain sticky header behavior by detecting which year group is visible

**Apply to SearchPanel results:**
- Same hook, simpler (no year grouping)

### Step 7: Keyboard Navigation

**Library arrow-key navigation:**
- Up/Down arrows move selection through episode list
- Enter plays selected episode
- Delete key triggers delete confirmation
- Escape clears selection

**Global shortcuts (add to existing):**
- `N` — next track
- `P` — previous track (or `Shift+N`)
- `M` — mute/unmute toggle
- `Ctrl+F` or `/` — focus library search bar

**Update Keyboard Shortcuts dialog** to show all new shortcuts.

### Step 8: Robustness

**Categorization retry:**
- On failure, wait 2s, retry once
- On second failure, mark episode with `aiStatus: "failed"` field
- Show "AI unavailable" badge on failed episodes
- "Re-categorize" in context menu retries

**Batch limit:**
- `/api/categorize` accepts max 10 episodes per request
- `useArchiveSearch.addAllToLibrary` chunks into batches of 10
- 1-second delay between batches

**Archive search sanitization:**
- Strip quotes and special characters from query before sending
- Enforce minimum 2-character query
- Debounce search input (300ms)

**Network retry utility `src/lib/utils/retry.ts`:**
```typescript
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  { retries = 2, delay = 1000, backoff = 2 } = {}
): Promise<Response>
```
- Apply to archive search, metadata fetch, and categorization calls

### Step 9: Accessibility Pass

**Player controls:**
- Add `aria-label` to all transport buttons
- Add `role="slider"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow` to seek/volume bars
- Add `aria-live="polite"` to NowPlaying for screen reader announcements

**Library:**
- Add `role="listbox"` to episode list
- Add `role="option"` + `aria-selected` to episode cards
- Add `aria-label` describing episode (title + date)

**Dialogs:**
- Add `role="alertdialog"` to confirmation dialogs
- Focus trap inside open dialogs
- Return focus to trigger element on close

**Canvas:**
- Add `aria-label="Audio waveform visualization"` + `role="img"` to oscilloscope

---

## File Summary

### New Files (8)
1. `src/lib/audio/cache.ts` — OPFS audio blob cache
2. `src/components/win98/ContextMenu.tsx` — right-click context menu
3. `src/hooks/useContextMenu.ts` — context menu state hook
4. `src/hooks/useVirtualList.ts` — lightweight virtual scrolling
5. `src/lib/utils/retry.ts` — fetch with retry/backoff
6. `src/components/player/QueuePanel.tsx` — queue display/management
7. `src/components/library/RecentlyPlayed.tsx` — horizontal recent row
8. `src/components/library/ContinueBanner.tsx` — resume listening prompt

### Modified Files (14)
1. `src/stores/player-store.ts` — queue state + actions
2. `src/hooks/useAudioPlayer.ts` — next/previous, auto-advance on ended
3. `src/components/player/PlaybackControls.tsx` — prev/next buttons
4. `src/components/player/AudioPlayer.tsx` — queue panel toggle, ARIA
5. `src/components/player/NowPlaying.tsx` — ARIA labels
6. `src/components/player/Oscilloscope.tsx` — ARIA role
7. `src/app/(desktop)/layout.tsx` — OPFS cache integration, new keyboard shortcuts
8. `src/app/(desktop)/library/page.tsx` — virtual scrolling, multi-select, recently played, continue banner
9. `src/components/library/EpisodeCard.tsx` — context menu, progress bar, selection modes
10. `src/components/library/TimelineView.tsx` — virtual scrolling integration
11. `src/components/search/SearchPanel.tsx` — virtual scrolling, debounced input
12. `src/components/search/ArchiveResultCard.tsx` — context menu
13. `src/components/desktop/DesktopShell.tsx` — cache management menu item, updated shortcuts dialog
14. `src/app/api/categorize/route.ts` — batch size limit, response validation
15. `src/hooks/useArchiveSearch.ts` — batched categorization, retry, debounce
16. `src/lib/db/schema.ts` — add `aiStatus` field
17. `src/lib/db/index.ts` — version 3 migration

---

## Execution Order

The steps above are ordered by dependency. Rough grouping:

**Week 1: Core mechanics**
- Step 1 (Queue) — unlocks multi-episode listening
- Step 2 (OPFS Cache) — unlocks seamless local replay
- Step 8 (Robustness) — fixes silent failures

**Week 2: Interaction layer**
- Step 3 (Context Menu) — unlocks episode management UX
- Step 4 (Episode Management) — delete, re-categorize, multi-select
- Step 7 (Keyboard Navigation) — full keyboard experience

**Week 3: Polish**
- Step 5 (Continue Listening) — recently played, resume, progress indicators
- Step 6 (Virtual Scrolling) — performance at scale
- Step 9 (Accessibility) — ARIA, focus management, screen reader support

---

## What This Phase Does NOT Include

These are intentional deferrals for Phase 4+:

- **Saved playlists** — requires Dexie schema for playlists table, playlist editor UI
- **Cloud sync** — would need auth, server-side DB, conflict resolution
- **Mobile layout** — the Win98 desktop metaphor is desktop-first by design
- **Equalizer** — Web Audio API supports it but it's a cosmetic feature
- **Waveform scrubbing** — replacing the seek bar with a visual waveform preview
- **Show-specific browsing** — filtering by Coast to Coast vs Dreamland vs Special
- **Statistics dashboard** — hours listened, episodes per year, most-played guests
- **Theme switching** — light mode, classic Win98 gray, high contrast
