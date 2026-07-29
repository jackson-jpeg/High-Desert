# High Desert — session handoff, 2026-07-29 (second session)

**Project:** `/root/High-Desert` on the Hostinger VPS (this *is* the production
directory). Live at [highdesert.space](https://highdesert.space).

**Branch:** `main`, clean working tree. **Not pushed** — see the open items.
**Deployed build:** `778b320`.
**Service:** `highdesert.service`, active.
**Tests:** 176 passing across 17 files. Typecheck and lint clean.

Continues [`handoff-2026-07-29-watchdog.md`](./handoff-2026-07-29-watchdog.md).
This session was the seven follow-ups Jackson raised from it.

---

## The handoff that could not be found, was found

Last session reported that `high-desert-handoff-2026-07-29.md` was not on the
VPS — not in the repo, not in `docs/`, not in `/root/`, not anywhere a
filesystem-wide `find` could reach. That was accurate and the reason is simple:
it was on the MacBook, in `~/Downloads`, and had never been on the VPS at all.

Retrieved over Tailscale and committed as
[`docs/high-desert-handoff-2026-07-29.md`](./high-desert-handoff-2026-07-29.md)
(`f3d6b82`), so the next session reads it from the repo rather than from a
machine it cannot reach.

It contained two items that had never been seen. Both are now in the queue and
neither was started — see **Open items** below.

---

## Commits shipped this session

Newest first. All on `main`, **none pushed**.

| SHA | What |
|---|---|
| `778b320` | test(player): pin the episode boundary, and correct the Dexie record |
| `c6b5816` | fix(player): don't attempt a `play()` that cannot succeed, and say what broke |
| `f3d6b82` | docs: recover the 2026-07-29 handoff from the MacBook |

---

## What changed, and why

### 1. The silent retry is gated on user activation (`c6b5816`)

The open question from last session was one post-fix row:
`id 36 | play-rejected | retried=t | elapsed_ms=0 | ios-safari`. The proposal was
to stop auto-retrying on iOS. Jackson's answer was better and is what shipped:
check for user activation before the retry calls `play()`, on **every** platform.

The retry runs from a `setTimeout`, twelve seconds after the tap that started the
load. Transient activation lasts about five seconds, so by the time the retry
fires the authorisation that permitted the original `play()` has almost always
expired. The old path did not discover this until it was too late to matter: it
called `resetElement()` first — `removeAttribute("src")` then `load()` — assigned
a fresh source, and only then found out it could not start it. The listener was
left with no audio, no buffer, and (before `setFailureHandler` was wired up)
nothing on screen.

So `retry()` now checks `navigator.userActivation.isActive` **before touching the
element**. No activation and a `play()` would be needed → skip the retry
entirely, `giveUp`, raise `PlaybackErrorDialog`. Its *Try Again* button runs
inside a real gesture and is the only thing that can succeed from there.

Three details worth keeping:

- **Not an iOS special case.** Safari refuses loudest, but a `play()` that cannot
  succeed should not be attempted anywhere, and the current behaviour turned that
  into a silent death on every engine.
- **Unsupported means permitted.** Safari below 16.4 and Firefox below 121 do not
  implement `navigator.userActivation`. Guessing "no activation" would disable the
  retry on browsers where it may well work; guessing "yes" costs at worst a
  rejected `play()`, which is terminal and raises the same dialog a few seconds
  later. The permissive fallback is the cheaper mistake.
- **Skipped retries record `retried: false`.** They are distinguishable in the
  data from retries that ran and did not help — which matters, because
  `recovered: false` on a `retried: true` row is what started the last
  investigation.

A retry that was never going to call `play()` — a primed-but-paused element — is
not gated. It needs no activation, so an expired one must not cost it its retry.

### 2. `MediaError` is carried onto the report (`c6b5816`)

The other open question was whether an empty `empty-media-suspected` dataset
after a week would mean anything. Jackson's answer: it would not, and the reason
is structural.

`empty-media-suspected` can only fire where the element reports a duration under
the five-second floor. **Chromium never does.** It errors on the missing MPEG
frames instead, so the advisory dataset is blind on that engine — an empty result
would have been ambiguous between "no empty files remain in the catalog" and "the
probe cannot see them here", and those two are not distinguishable from a null.

So the floor stays exactly as timid as it was, and the Chromium side was added
instead. `MediaError.code`, plus `message` where the browser supplies one, now
rides along in the existing `detail` column on `decode-error`, `network-error`
and `empty-media`. Chromium writes a real diagnostic there; it is the only thing
that separates an empty file from an unreachable one on that engine.

Confirmed live in production, not inferred:

```
detail: "code=4 MEDIA_ELEMENT_ERROR: Format error"
```

`detail` was previously documented as advisory-only. It is not any more, and
`CLAUDE.md` says so. `ADVISORY_KINDS` is unchanged and still keyed on `kind`, so
real failures stay in the `/api/stats/failures` ranking.

**No PII.** The message is a browser pipeline diagnostic — nothing the listener
typed, nothing that identifies them — truncated to 200 characters and whitespace-
normalised at both ends of the wire.

### 3. The episode boundary, forced and pinned (`778b320`)

The queue advance at the end of a show is the path that ran *doubled* before
`withGlobals` was keyed, and then did not run *at all*: `ended` arrives on a media
listener that was never attached. It had never executed in production. Jackson
asked for it proven rather than reasoned about, by seek rather than by waiting
out a broadcast.

Forced live against `c6b5816`, from a three-episode queue at index 1, seeking to
`duration - 10`. All four checks:

| | |
|---|---|
| queue advances by exactly one | `ended` fired **once**, `play()` **once**, element moved to index 2 — not index 3, which does not exist and would have stopped playback instead |
| the next episode's play is counted once | one `/api/stats/play`, one `play_events` row (id 99) |
| `listening_at` renews for the new episode | `active_sessions.episode_id` = the new show, `listening_at` = 17:09:58, the moment of the boundary; it appeared in the on-air list |
| the watchdog arms against the new source | see below |

The fourth is the one a live check cannot see — `armWatchdog` is module-internal,
and inducing a stall at the exact moment of a boundary is not reproducible. It is
pinned by a test instead, which is the better home for it anyway:
`global-listeners.test.ts` now mounts the hook twice, wires `hd:play-episode`
back to `playEpisode` the way `(desktop)/layout.tsx` does, dispatches `ended`,
and asserts `armWatchdog` received the **next** episode's `url` and
`communityKey` — and not the finished one's. A watchdog holding the old url would
re-request a show the listener has already heard, and report the failure against
the wrong episode.

Two things this found on the way:

- **A library click builds a queue of one.** The first attempt looked like a
  broken boundary — `ended` fired, nothing advanced. It was correct: `next()`
  returned `null` because the queue held a single episode. A real queue needs
  select-then-`Q`, or the queue panel. Not a bug, but it will look like one again.
- **The fixture gave every episode the same `sourceUrl`,** so "armed against the
  new source" was not decidable. It is per-episode now.

### 4. `PlaybackErrorDialog` renders in ultra-mini (`c6b5816`, verified)

Asked for because the error *banner* went missing from that layout once. Verified
live: a source pointed at a 404 raised the dialog at **360×193** over the **27px**
ultra-mini bar, titled *Transmission Interrupted*, with both **Try Again** and
**Play Something Else**.

It renders there because it is mounted in `(desktop)/layout.tsx` as a sibling of
`DesktopShell`, not inside `AudioPlayer`. Keep it there — it must also appear on
pages that draw no player chrome at all. `CLAUDE.md` now says so.

### 5. The Dexie record is corrected (`778b320`)

[`docs/dexie-update-semantics.md`](./dexie-update-semantics.md), in the style of
`phantom-failures.md`. Git history is left alone.

`b88378d` claimed `Table.update()` ignores keys whose value is `undefined`.
**It deletes them.** And not by accident of a version:

```js
Table.prototype.update = function (keyOrObject, modifications) {
    ...
    return this.where(":id").equals(keyOrObject).modify(modifications);
};
```

`update()` **is** `.modify()` — the exact call `applyEpisodeFields` makes by
hand. There was never a difference to work around. `dexie` resolves to 4.3.0 in
every commit that has ever touched `package-lock.json`, back to the initial
commit, so the premise was false the day it was written.

It survived because the regression test asserted it against a hand-written model
of Dexie rather than Dexie, and so agreed with itself by construction — the same
shape as the watchdog with no inputs. The real defect in that commit was the
stale `useState` snapshot in the library detail panel, which accounts for the
reported symptom on its own, including the "clearing does nothing" half.

`applyEpisodeFields` stays: it states the intent, and all user data lives only in
the visitor's IndexedDB with no server backup, so a future major version changing
its mind about `undefined` is not something to learn from a bug report. It is
**not load-bearing**, and nothing should be written down as if it were.

The false claim is gone from `CLAUDE.md` and from the `management.ts` docblock.
It remains in `high-desert-handoff-2026-07-29.md`, which is a historical record.

---

## Verification performed

**Automated:** 176 tests across 17 files (was 174). `npx tsc --noEmit` clean.
`npm run lint` clean.

**Red/green, both new bindings:**

| mutation | result |
|---|---|
| delete `describeMediaError(audio.error)` from `onError` | **1 red**, restore → green |
| neuter the activation check in `retry()` | **2 red**, restore → green |

**Deploy:** `scripts/deploy.sh` — 74 chunk references across 4 routes, 0 non-200,
build id `778b320` baked into the service-worker registration chunk.

**Live database (VPS, Postgres `highdesert`):** the six synthetic `play_events`
rows from the previous sessions — **56, 57, 58, 61, 66, 68** — are present and
unmodified. Verified rather than argued from schema: `playback_failures` and
`play_events` are different tables, but the deletion was worth confirming
directly.

**`playback_failures` still holds exactly one row** — the genuine post-fix
`play-rejected | ios-safari` from 16:15:35 — and nothing this session added to
it. The ultra-mini dialog check needs a real failure, so the
`/api/playback-event` POST was intercepted in the page and answered locally. That
dataset exists to decide whether the five-second floor is safe to promote, and
hand-made rows have polluted it once already.

**Service worker id, from the MacBook** (Tailscale, independent fetch of the live
site): the chunk that registers the worker carries `778b320`, matching the
deployed commit — so any browser on the Mac registers `sw.js?v=778b320`. The
Network-tab half (206 status, Source not reading *Service Worker*) is not
scriptable in Safari and was left for a human, as agreed.

**Synthetic rows written:** four `play_events` — **97, 98, 99, 100** — recorded in
[`synthetic-stats.md`](./synthetic-stats.md). Eleven in that file in total now.

---

## Open items, ranked

### A. Push `main` — seven commits behind origin

`main` is **7 ahead of `origin/main`** and has been since before this session.
The previous handoff stated the branch was "pushed to origin"; it was not. The
unpushed range is `50dd320..778b320` — the entire watchdog fix, the phantom-row
deletion and everything from this session.

Everything is deployed and live, so this is not a production risk. It is a
single-copy risk: the only copy of two sessions' work is this VPS. Left unpushed
because pushing is outward-facing and was not asked for.

### B. 41 untested production modules — from the recovered handoff, not started

Ranked there, and the ranking still holds. Concentrated in the layer where every
bug of the last two sessions lived. Every Zustand store except `player-store` is
untested.

Highest consequence, in order:

1. **`lib/utils/rate-limit.ts`** (68 lines) — the only thing between the public
   API routes and abuse. Note it is an in-memory `Map`, which is *correct* here
   (one long-lived process) and depends on nginx setting `X-Forwarded-For` to
   `$remote_addr` by overwrite, not append.
2. **`services/episodes/management.ts`** (154 lines) — the data-loss surface.
   Partially covered now: `clear-field.test.ts` drives `toggleFavorite`,
   `rateEpisode` and `toggleFlag` end to end against `fake-indexeddb`. The
   delete/cascade paths are still untested, and `deleteEpisode` touches five
   tables.
3. `useRadioDial.ts` (354), `useFileScanner.ts` (287), `useCollectionImport.ts` (231).

### C. Four stale remote branches — from the recovered handoff, not started

Named there: `agent/audit-and-update-dependencies-for-next-j`,
`agent/review-and-update-phase-3-plan-md-implem`, `eevee/high-desert`,
`fix/responsive-resize-dvh`.

**There are six, not four.** `origin` also carries `fix/library-wipe-recovery`
and `self-host`, neither of which appears in that list. `fix/library-wipe-recovery`
sounds like it relates to the dedup incident that deleted 1,312 of 1,313
episodes; check whether it holds anything not already on `main` before deleting.

### D. What to watch over the next day

1. **`playback_failures` shape.** One row since the watchdog fix, sixteen hours
   ago, against ~30/day before it. Watch for `retried: false` rows arriving —
   those are the new activation-gated path choosing the dialog over a doomed
   `play()`, and they are the intended behaviour, not a regression. A rise in
   `play-rejected` with `retried: true` would mean the gate is reading activation
   as present when it is not.
2. **`detail` on `network-error` / `decode-error`.** These should start carrying
   `code=N …` immediately. If they come back empty on Safari that is expected —
   `MediaError.message` is Chromium-flavoured — but the `code=` half must be
   there on every engine. An empty `detail` on a Chromium row means `audio.error`
   was null at the moment `onError` ran, which would be worth understanding.
3. **`empty-media-suspected` may legitimately stay at zero forever.** The sweep
   found one empty file in 1,313 and it was pulled from the catalog. The guard's
   job is future catalog additions. Zero is not evidence the guard is broken.

---

## Things to know before touching this code again

Most of this is in `CLAUDE.md`, updated again this session. The ones added here:

- **A `play()` that cannot succeed must not be attempted.** The retry checks
  `navigator.userActivation.isActive` before touching the element, on every
  platform, and skips the whole retry rather than tearing down and failing.
  Unsupported is treated as permitted.
- **`PlaybackErrorDialog` lives in `(desktop)/layout.tsx`,** not inside
  `AudioPlayer`. Moving it inside would lose it in ultra-mini and on pages with
  no player chrome.
- **`detail` on `playback_failures` is no longer advisory-only.** It carries
  `MediaError.code` and message on real failures too. Still ≤200 chars, still
  nothing about the listener.
- **`update()` is `.modify()` in Dexie.** See `docs/dexie-update-semantics.md`
  before writing anything else down about `undefined` keys.
- **A library click builds a queue of one,** so `ended` correctly advances to
  nothing. Use select-then-`Q` to build a real queue when testing boundaries.
- **Do not write to `playback_failures` by hand,** even to verify. Intercept the
  POST in the page instead. Two hand-made rows have already had to be deleted
  from a dataset whose entire purpose is deciding a threshold from real traffic.
