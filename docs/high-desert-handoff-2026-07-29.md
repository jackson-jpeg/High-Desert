# High Desert — session handoff, 2026-07-29

**Project:** `/root/High-Desert` on the Hostinger VPS (this *is* the production
directory). Live at [highdesert.space](https://highdesert.space).

**Branch:** `main`, clean working tree, pushed to origin.
**Deployed build:** `57a06bf` — the two commits after it are docs only.
**Service:** `highdesert.service`, active.
**Tests:** 141 passing across 16 files. Typecheck and lint clean.

---

## Where this session started

Two reports of the same defect:

- **Jackson:** "leave the site and come back, it remembers my last episode, but
  if I hit play nothing happens."
- **A listener:** "sometimes when I go to play a show it doesn't start… I
  usually will find another show and put it on when that happens… it is a bit
  consistent for me."

One bug, not two. The listener's workaround — picking a *different* show — was
the code path that worked, which is why it always rescued them and why they
blamed themselves.

Standing constraints for this work, still in force:

- Treat "no visible error state" as a bug of equal severity to the failure itself.
- State which machine every command runs on (MacBook vs. VPS) before running it.
- Work autonomously through diagnosis and implementation; batch questions at the end.
- No IP or PII logging.
- Report re-encoding candidates, never re-encode without approval.

---

## Commits shipped this session

Newest first. All on `main`, all pushed.

| SHA | What |
|---|---|
| `da49bf2` | docs: record synthetic play rows from re-verification |
| `57a06bf` | refactor(player): starting a listen is one thing, not a list of steps |
| `d0a22fb` | fix(stats): a show you are listening to belongs on the air |
| `986a734` | fix(deploy): look for the build id where it actually lives |
| `f0ae923` | feat(library): show how big a show is, not just how long |
| `76028f1` | fix(audit): a file that stops at its own tag is empty, not unreachable |
| `ccf5cc3` | fix(player): an episode with no audio in it now says so |
| `d31e393` | fix(player): a remembered show would not start, and never said why |

---

## What was actually wrong, in order of discovery

### 1. The restore path never assigned `audio.src` (`d31e393`)

`loadEpisode()` is a pure Zustand setter and never touches the media element.
The restore effect called only that, so the player rendered a live ▶ over an
`<audio>` with no source, and `togglePlay()` returned at `if (!audio.src)` —
no sound, no error, no console log. Space bar, scrub bar and the iOS lock-screen
button were dead the same way.

`primeEpisode()` now points the element at the restored episode with
`preload="none"` so it costs no network until someone presses play.

Shipped alongside it, all found while tracing:

- **Service worker intercepted every archive.org audio byte** through a
  catch-all `networkFirst`. It never cached audio, so `respondWith()` bought
  nothing while defeating native byte-range handling and flattening failures
  into a body-less 504 that the element reports as "source not supported".
  Media now bypasses the worker entirely.
- **`useAudioPlayer` is mounted twice** (layout + `AudioPlayer`, whose
  `return null` sits after the hooks), so every listener, timer and interval ran
  doubled — the queue advanced by two at the end of a track. Globals are now
  ref-counted via `withGlobals()` and install once.
- A **playback watchdog** (`src/audio/playback-watchdog.ts`): 12s of silence or
  8s stuck waiting buys one silent retry, then a Win98 "Transmission Interrupted"
  dialog offering *Try Again* and *Play Something Else*. Its deadline resets on
  every `progress` event, so it catches silence, not slowness.
- `togglePlay`'s catch was silent; `buffering` never reset; the error banner was
  missing from the ultra-mini layout; `stopPlayback` set `src = ""` (which
  resolves against the document URL and makes the browser decode the HTML page
  as audio); retrying re-counted the play.
- New `/api/playback-event` + `/api/stats/failures` — episode, failure kind,
  whether the retry rescued it, and a coarse platform bucket. **No session id,
  no IP, no raw user-agent.**

### 2. One catalogued episode contains no audio at all (`ccf5cc3`, `76028f1`)

`2002-03-19 — Climate Change (Prof. Christina Hulbe)`: 77,380 bytes of ID3v2 tag
wrapping a JPEG cover, **zero decodable MPEG frames**. Its own tag header
declares the tag ends 394 bytes past EOF; `GET bytes=77774-` returns `416`.
Archive.org serves it with a clean `206` and a plausible `Content-Length`, so
every HTTP-level check passes it.

- `scripts/audit-durations.mjs` is the catalog sweep. It **must** seek past the
  ID3 tag first — the tags on this collection carry cover art and run ~77KB, so
  a window from byte zero lands entirely inside the artwork. The first draft
  reported 10 of the first 12 working shows as empty.
- `src/audio/duration-sanity.ts` is the runtime guard, deliberately timid. Only
  the absolute floor (<5s) is judged at `loadedmetadata`; the "much shorter than
  catalogued" comparison waits for `ended`, when the number is a measurement.
- `empty-media` is the one `FailureKind` never retried.
- **Full sweep: 1313 checked, 1308 ok, 1 no-audio (pulled), 4 longer than
  catalogued.** The Hulbe episode was removed; recorded in
  `docs/broken-episodes.md` with its full original JSON.
- **Two other short episodes were kept.** They were on the pull list, but full
  decode proved they contain real audio (5m25s / 5m29s). Jackson confirmed:
  "I'd rather have a guard that under-flags than one that deletes real content."

### 3. Build id could repeat its predecessor (`986a734`, in `next.config.ts`)

`NEXT_PUBLIC_BUILD_ID` names the service-worker cache, and `activate` only
purges caches whose name *differs*. A build from a dirty tree inherited HEAD's
SHA, so a deploy could ship stamped with its predecessor and leave that deploy's
shell cached for offline visitors. `next.config.ts` now hashes the working tree
(including untracked files) into the id when the tree is dirty.

`scripts/deploy.sh` is the safe deploy: refuses a dirty tree, `npm ci` only when
`package-lock.json` is newer than `node_modules`, builds, restarts, walks every
`/_next/static/chunks/*.js` on four routes, then confirms the deployed commit is
baked into the chunk that registers the service worker.

### 4. On-air was silently empty (`d0a22fb`) — a regression from `d31e393`

**Two defects, one symptom.** The episode playing right now was missing from
the on-air list on `/stats`.

**(a) The regression, mine.** `primeEpisode()` gives the restored element a
`src`. That changes what `togglePlay()` does: instead of dispatching
`hd:play-episode` it plays the element in place, and that path never goes near
`playEpisode()` — the sole caller of `reportPlay()`. So a listen started from
the restored player ran the audio and recorded **nothing**: no `episode_plays`,
no `weekly_plays`, no `recent_plays`, no permanent `play_events` row, and no
`active_sessions.episode_id`, which is the column the on-air query reads.

Invisible from the player, which is why earlier testing missed it — that testing
correctly verified *does the show start*, and it does.

**(b) An older defect hiding behind it.** `onAir` filters on
`listening_at >= now() - 5 min`, and `listening_at` was written once by
`recordPlay` and never renewed. So **every** listener fell off the air five
minutes after pressing play and stayed off for the remaining two hours and
fifty-five minutes of a Coast to Coast broadcast. The live table showed it
plainly: sessions with a current `seen_at`, an `episode_id`, and a
`listening_at` 17 and 28 minutes stale. "On air" had degraded into "started
something recently".

Fix: the 60-second heartbeat every tab already sends now carries the episode
while playback is running, which renews the mark. Sent only while actually
playing; an omitted id leaves the mark alone rather than clearing it, so pausing
does not yank the show off the air. Same allowlist gate as `/api/stats/play`,
except a bad id drops the mark instead of failing the beat.

**No schema change.** The four update semantics were checked against the live
database with a throwaway session and the probe row removed.

### 5. The shape behind the regression (`57a06bf`)

`playEpisode` had accumulated side effects over time and `togglePlay`'s in-place
branch inherited none of them, silently, one at a time. Rather than patch each
symptom, the shared side effects are consolidated into three module functions
that **both** paths call:

- `openListen(episode, objectUrl)` — clear the last attempt's error banner,
  drop the cached archive.org health verdict about to be re-tested, establish
  queue context.
- `armListen(episode, audio, startAt)` — hand the attempt to the watchdog,
  after there is a source to watch.
- `countListen(episode)` — report the play, after `play()` resolves.

`openListen` skips `loadEpisode` when the episode is already current and has
queue context, because `loadEpisode` resets position from the stored row and
running it mid-listen would rewind a listener who had scrubbed.

**Correction made during this work:** of the three asymmetries originally
claimed, only two were real. `clearHealthCache` and `setError` were genuinely
missing. **Queue context was not** — the restore effect calls `restoreQueue()`
then `loadEpisode()`, so `queueIndex` was already correct. `openListen` asserts
it anyway, but no bug was fixed there.

**Required store fix:** `loadEpisode` revoked the previous object URL
unconditionally, so calling it twice for the same source freed the blob and then
stored the dead handle — a local file would have stopped playing the moment
anything re-established queue context. It now only revokes when the URL is
genuinely being replaced.

---

## Also shipped: duration and file size on the episode card

Jackson declined re-encoding the 89 high-bitrate shows ("they're archive.org's
files and self-hosting 59 GB isn't worth it"), and asked instead for the wait to
read as expected rather than broken.

- `formatFileSize()` + `LARGE_EPISODE_BYTES` (150 MB) in `src/lib/utils/format.ts`.
- Size shown in a dedicated lg-only grid column on `EpisodeCard`, **not stacked
  under the duration** — `ITEM_HEIGHT_DESKTOP` is 34px and two ~15px lines would
  overflow the fixed virtual-list row.
- `useLoadingHint` warns earlier on anything over 150 MB: *"Tuning in… this is a
  big recording, give it a moment."*

---

## Verification performed

**Automated:** 141 tests, 16 files. `npx tsc --noEmit` clean. `npm run lint` clean.

**Deploy:** `scripts/deploy.sh` — 74 chunk references across 4 routes, 0 non-200,
build id `57a06bf` confirmed baked into the service-worker registration chunk.

**Live database (VPS, Postgres `highdesert`):** the three-step sequence through
real HTTP — press play → on air; backdate `listening_at` 20 minutes → drops off;
heartbeat with the episode → back on air.

**Real browser against the live site (Playwright, headless Chromium):** loaded
`/library`, played a show, reloaded so the player restored, pressed ▶ →
`POST /api/stats/play` fired (it did not before), the episode appeared in
`onAir` immediately, and 65 seconds later the heartbeat went out carrying
`episodeId` and it was still on air.

**Production telemetry is flowing.** `/api/stats/failures?days=7` returned real
user failures across `ios-safari`, `desktop-chromium` and `desktop-safari` —
mostly `timeout`, `recovered: 0` on all of them. That means there is a **second
cause of "shows don't start" beyond the restore bug**, and it is now observable
on `/stats` in admin mode. This is the most useful open thread.

---

## Still needs a human — two physical checks

These could not be done from the VPS.

### 1. iPhone — does a remembered show actually resume?

1. On the iPhone, open **highdesert.space** in Safari.
2. Tap any episode, let it play **~30 seconds** so the position is saved.
3. **Force-close Safari entirely** — swipe up and flick the card away. Switching
   apps is not enough; it won't reset the page and tests nothing.
4. Reopen Safari, return to highdesert.space. The show should be in the player
   bar, paused, roughly where you left off.
5. **Press ▶.**

**Correct:** audio starts within a couple of seconds, from where you left off,
not the beginning. On a big file you may briefly see *"Tuning in… this is a big
recording, give it a moment."* — that text is the fix working.

**Broken (the old bug):** press ▶ and *nothing happens* — no sound, no spinner,
no error, the button just sits there.

Then check three more ways to start it, each of which dead-ended separately
before: **drag the scrub bar**, **press ▶ on the lock screen**, and **press
Space** if a keyboard is attached.

### 2. Mac Safari — is the service worker out of the way of audio?

Enable dev tools first: Safari → Settings → **Advanced** → tick **"Show features
for web developers"**.

**Part A:** Develop → Show Web Inspector (⌥⌘I) → **Sources** tab. Look for
**highdesert.space — Service Worker** in the sidebar.
**Correct:** exactly one, showing `sw.js`, URL ending `?v=57a06bf`.
If the id differs or there are two, hard-reload (⇧ + reload) and look again.

**Part B, the important one:** **Network** tab → Clear → play an episode →
find the row ending in **`.mp3`** (by far the largest).
**Correct, both:** Status is **206** (not 200), and the row is **not** sourced
from the service worker — the Source/Transfer column must not say
*Service Worker*.

---

## Open items, ranked

### A. Test-suite mirror audit — reported, not yet fixed

Two files re-implement the logic they claim to test.

1. **`src/hooks/__tests__/restore-play.test.ts`** — ~4 of 7 tests pretending.
   The file named for the reported bug declares its own `primeEpisode` and
   inlines its own copy of `togglePlay`'s no-source branch. **Production
   `useAudioPlayer.ts` is never imported.** It has *already* drifted: the real
   `primeEpisode` calls `notifySourceChanged()` and sets `playbackRate`; the
   mirror does neither, so `notifySourceChanged()` could be deleted today and
   the suite stays green. Mitigated by `play-reporting.test.ts`, which now
   exercises the real hook. **Fix: delete the mirrors, move surviving
   assertions onto the real hook. ~30 min.**

2. **`src/services/episodes/__tests__/clear-field.test.ts`** — 4 of 4 pretending.
   Hand-copy of `applyEpisodeFields`, which is not exported from
   `management.ts` and so is untestable by construction. Faithful right now,
   but it guards the un-favouriting / un-rating data bug, and **all user data
   lives only in the visitor's IndexedDB with no server backup**. It also
   cannot catch the actual historical failure mode, which was `.update()` vs
   `.modify()` at the *call* site. **Fix: export the function, or add
   `fake-indexeddb` and test `toggleFavorite`/`rateEpisode` end to end. ~1 hr.**

The other 14 test files are clean — they import and exercise real modules.
`makeEpisode`/`fakeAudio` helpers are fixtures, not reimplementations.

### B. Coverage blank spots

41 production modules have no test at all, concentrated in the layer where all
of this session's bugs lived. Every Zustand store except `player-store` is
untested. `useAudioPlayer.ts` (900 lines) had zero coverage until this session.
Highest consequence, in order: **`lib/utils/rate-limit.ts`** (68 lines, the only
thing between the public API routes and abuse) and
**`services/episodes/management.ts`** (154 lines, the data-loss surface). Then
`useRadioDial.ts` (354), `useFileScanner.ts` (287), `useCollectionImport.ts` (231).

### C. The second cause of playback failure

Real telemetry shows `timeout` failures with `recovered: 0` across three
platform buckets. The one silent retry is not rescuing them. Worth reading
`/api/stats/failures?days=7` after a few days of data and deciding whether the
12s deadline, the retry policy, or archive.org itself is the problem.

### D. Housekeeping

- Four stale unrelated remote branches: `agent/audit-and-update-dependencies-for-next-j`,
  `agent/review-and-update-phase-3-plan-md-implem`, `eevee/high-desert`,
  `fix/responsive-resize-dvh`. Noted, not deleted.
- `phase1-foundation` was merged fast-forward into `main` and deleted local and
  remote. `fix-episode-playback-restore` **never existed as a git ref** — it is
  not a branch and never was.

---

## Things to know before touching this code again

Most of this is now in `CLAUDE.md`, which was updated this session. The
non-obvious ones:

- **There are two start paths.** Anything a play must do has to happen on both.
  `openListen` / `armListen` / `countListen` exist precisely so a new side
  effect cannot be added to one caller only. Regression test:
  `src/hooks/__tests__/play-reporting.test.ts`, which mounts the real hook
  because a test that re-implements `togglePlay` would reproduce the omission
  and pass.
- **On air is a renewed mark, not a play timestamp.** Anything that changes the
  heartbeat must keep renewing `listening_at`, and `ACTIVE_WINDOW_MS` must stay
  comfortably above the heartbeat interval.
- **Never `rm -rf .next` or `node_modules` in `/root/High-Desert` while the
  service is running.** Every route keeps returning 200 while browsers cannot
  load the app. Use `scripts/deploy.sh`.
- **Commit before you build** — the build id names the service-worker cache.
- **`Table.update()` ignores keys whose value is `undefined`.** Use
  `applyEpisodeFields()`, which goes through `.modify()`.
- **`reconcileLibrary()` is `bulkAdd`-only** and must stay that way.
- Tailwind v4's font-size namespace is `--text-*`, not `--font-size-*`.

### Synthetic rows in the permanent log

`docs/synthetic-stats.md` records six `play_events` rows written by verification
rather than by a listener — **ids 56, 57, 58, 61, 66, 68**. Left in place by
Jackson's decision: unwinding the counters `recordPlay` bumps in the same atomic
statement is a larger risk to a never-pruned table than six rows of noise.
Ids 65 and 67 land in the same minute and are a **real listener**, not the check.

Row 61 is the first play ever recorded from the restored player.
