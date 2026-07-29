# High Desert — session handoff, 2026-07-29 (watchdog / test mirrors)

Picking up items **A** (test mirrors) and **C** (second cause of playback
failure) from the previous session. Both are closed. They turned out to be the
same disease at two altitudes, which is the short version of this entire
document: *a test that supplies its own copy of the thing it is testing cannot
fail, and neither can a detector that supplies its own idea of what it is
detecting.*

Deployed: `b7d48e4` (docs) on top of `50dd320` (the fix). Both verified live.

---

## Note first: the handoff file you named does not exist

The brief said to read `high-desert-handoff-2026-07-29.md`. It is not on disk.
Looked in `/root/High-Desert/`, `/root/High-Desert/docs/` (including
`docs/plans/` and `docs/superpowers/`), `/root/`, and then a filesystem-wide
`find` by name. Nothing. Best guess: it was written to the previous session's
output rather than to a file. Your brief specified A and C in full, so nothing
was blocked — but if that file has content beyond A and C, I never saw it.

This one is committed to the repo, at `docs/handoff-2026-07-29-watchdog.md`.

---

## Item C — the answer is none of (a)–(d)

You asked which of four hypotheses the failure data supported. It supports none
of them, and the reason is that **the data was not measuring playback**.

### What the telemetry actually said

33 rows, all 2026-07-29. `timeout` ×30, `play-rejected` ×3. `retried` true on
all 33, `recovered` false on all 33, and the timeouts clustered at
**12000–12013 ms** — mean 12004. Zero `stall`, zero `network-error`, zero
`decode-error`, zero `empty-media`.

### Ruling the four out

- **(a) file size** — failing episodes: median 40.0 MB, 32 kbps. Catalog: p50
  40.8 MB, 32 kbps. Dead centre. No correlation.
- **(b) specific episodes** — 21 distinct episodes, worst offender 5 hits.
- **(c) platform** — all five buckets, roughly proportional to traffic.
- **(d) archive.org / time-clustered** — spread over 11 hours, and I measured
  the origin from the VPS: 13 files spanning 12–282 MB and 24–128 kbps, every
  one a clean `206`, **TTFB 0.65–1.13 s**, 256 KB in ~1.0–1.3 s, no size
  correlation. `access-control-allow-origin: *` present on the redirect target
  node. The `?hd_retry=1` cache-buster survives the 302 intact. The origin is
  healthy and the 12 s deadline is ~13× the observed TTFB.

### The actual cause

`withGlobals()` in `src/hooks/useAudioPlayer.ts` ref-counted with **one
module-level counter shared across all five of its call sites**. Five call sites
× two hook instances = ten calls; only the first increments 0→1. So exactly one
subsystem was ever installed — the position timer, which happens to be declared
first — and the other four **never ran, in any browser, since `d31e393`**, the
commit that introduced both `withGlobals` and the watchdog.

Dead the whole time: the media element listeners, `setFailureHandler`, the 5 s
position persist, and the unload beacon. `releaseGlobals` was the same mistake
twice — one variable for five cleanups.

Every column of the telemetry follows from that. `noteProgress()` comes from a
`progress` listener that did not exist, so the deadline could never reset → the
full 12 000 ms, every time. `noteReady()` comes from `canplay` → `recovered`
could not be `true` on any row, no matter how well the retry worked. `stall`,
`network-error` and `decode-error` all arrive via listeners → zero of each. The
watchdog's own `setTimeout` was the only thing in the system that could fire.

**And it was not passive.** 44 plays and 33 failures in the same window — a 73 %
failure rate against an origin answering in 0.9 s. What a listener got: press
play, hear twelve seconds, then `retry()` calls `resetElement()` on an element
that is *streaming perfectly*, so the show cuts out and restarts from the
beginning. On iOS the re-issued `play()` runs in a timer callback, outside the
user-activation chain, is refused, and the broadcast **stops dead** — with no
dialog, because `setFailureHandler` had never been installed. That is the
original "sometimes when I go to play a show it doesn't start… it is a bit
consistent for me", and the 3 `play-rejected` rows at 1–4 ms elapsed are it.

Two more consequences worth knowing, both now fixed by the same change:
`loadState` never left `"loading"`, so the hourglass and *"Still trying — the
signal is weak tonight"* sat over audible playback for whole episodes; and the
queue never advanced at the end of a show, because `ended` was never listened
for.

### What I changed

- **`withGlobals(key, install)` counts per key**, with one release per key.
- **The watchdog requires proof it is wired.** `noteListenersAttached()` /
  `noteListenersDetached()` bracket the media-events install; `armWatchdog()`
  refuses to arm without them and `console.error`s. A detector with no inputs
  cannot tell "nothing happened" from "I cannot see" — this one failed open and
  invented telemetry for four months. It fails closed now. Your instruction, and
  the right one.
- **It stands down over audible playback.** Before the deadline or stall clock
  acts it checks `!paused && readyState >= HAVE_CURRENT_DATA`. `paused` alone is
  not enough — `play()` clears it synchronously, so a dead load also reports
  unpaused; `readyState` is what makes it mean "sound is coming out".
- **The retry only re-issues `play()` if the element was unpaused**, and a
  refused retry is terminal and raises the dialog rather than stopping silently.
- **`loadedmetadata` is advisory** — records `empty-media-suspected` with the
  duration it saw in a new `detail` column, and lets the show run. `ended` keeps
  sole authority to fail.

### What I deliberately did **not** change

**The 12 s deadline stays, and is not adaptive on file size.** You pre-committed
to that conditional on the evidence. The evidence is the other way: the origin
answers in under 1.2 s regardless of size, and the failing episodes sit at the
catalog median. `LOAD_TIMEOUT_MS` was never the problem — `noteProgress()` never
being called was. Making it adaptive would have tuned a mechanism whose input
signal was disconnected, and buried the real fix.

**No re-encoding candidates.** Nothing in this data implicates any file. Size
outliers for the record: 85 episodes ≥128 kbps, largest 281.5 MB, catalog p90
71.7 MB. Separately, and not a re-encode — 6 catalog rows carry an implausible
`duration` (4 undefined; `1999-01-25…` claims 18.39 s for 74.2 MB;
`2000-03-31…` claims 2045.78 s for 150.2 MB). All err toward *understating*
runtime, and the `ended` check only flags `actual < expected × 0.5`, so none
will be falsely called `truncated` now that `onEnded` is alive. Checked before
deploying, precisely because that path had never run.

---

## Item A — the mirrors are gone

### `restore-play.test.ts`

Declared its own `primeEpisode` and inlined `togglePlay`'s no-source branch;
never imported `useAudioPlayer.ts`. Both copies had drifted from the real ones,
which had since gained `notifySourceChanged()` and a `playbackRate` assignment.

Now mounts the real hook, via a shared harness extracted to
`src/hooks/__tests__/support/mount-player.ts` (`play-reporting.test.ts` uses it
too). Every surviving assertion runs against `api.primeEpisode` /
`api.togglePlay`, plus the two the drift proved were missing.

**Red/green, as asked.** Deleting `notifySourceChanged()` from `primeEpisode`
turns exactly one test red ("tells the engine the source changed"); restoring it
goes green. Honest caveat: `notifySourceChanged()` is a **no-op** in
`src/audio/engine.ts`, so that binding is via the mock spy rather than observable
behaviour — which is also why nobody noticed the copy had dropped it. So I ran a
second, behavioural proof on the same file: deleting `audio.preload = "none"`
turns "costs no network" red, restoring it goes green. The proof does not rest on
a spy alone.

### `clear-field.test.ts` — and a correction you should read

Rewritten on `fake-indexeddb` (new devDependency), driving
`toggleFavorite`/`rateEpisode`/`toggleFlag` end to end against real Dexie and
asserting on the stored row — because the historical defect was `.update()` vs
`.modify()` at the *call site*, which only an end-to-end test catches.

**In doing so it disproved the premise the original fix was built on.** The old
test asserted that Dexie's `Table.update()` ignores keys whose value is
`undefined`. **Dexie 4.3.0 deletes the key**, exactly as `.modify()` does. I
verified it directly against the installed library, and `dexie` has been pinned
`^4.3.0` since the project's first commit and never upgraded — so the premise was
never true here. The belief survived for one reason: the test asserted it against
a hand-written model of Dexie instead of Dexie, so it could not fail.

`applyEpisodeFields()` stays — it is explicit and does not depend on a third
party's treatment of `undefined` staying put — but it is **not load-bearing**,
and `CLAUDE.md` has been corrected. Whatever made ratings and favourites appear
uncleared, it was not `update()`; the other half of that fix (the detail panel
rendering a stale `useState` snapshot rather than the live query) is real,
independently confirmed, and the likelier culprit.

**Red/green.** Changing `applyEpisodeFields` to store `undefined` instead of
deleting turns 5 of 6 red; restoring goes green. Routing it through
`db.episodes.update` stays **green** — which is the finding above, not a weak
test, since the first mutation already proved the binding.

### The new one

`src/hooks/__tests__/global-listeners.test.ts` mounts the hook **twice**, the way
production does, and asserts each of the five subsystems installs exactly once —
`canplay` reaching the watchdog, `progress` reaching it, the failure handler
installed and raising `failed`, the queue advancing by exactly one, one unload
beacon, one position write per tick, and clean teardown/remount.

**Reverting `withGlobals` to the shared counter turns 9 of its 10 tests red.**
That is the test that would have caught this on day one.

---

## Verification

- Full suite **164 passed** (was 141), `npx tsc --noEmit` clean, `npm run lint`
  clean. All four red/green proofs run and reported above.
- `psql -f scripts/schema.sql` applied on the VPS (idempotent; adds `detail`).
- `bash scripts/deploy.sh` twice, both clean — every chunk on four routes 200,
  build id present in the service-worker registration.
- **Live, against highdesert.space** (headless Chromium on the VPS):
  - *Known-good long show* — `1996-01-19 Alien and Immortal Open Lines`, the
    worst phantom offender (5 timeouts), 39.9 MB / 32 kbps / 2h45m. `canplay` at
    **1333 ms**, four `progress` events, and at 39.6 s wall clock
    `currentTime = 38.32`, `readyState = 4`, `paused = false`. **No `hd_retry` in
    the src, no `abort`, no `error`, no teardown at 12 s.** Player showed
    `0:50 / 2:45:49`, no hourglass, no loading hint, no dialog. Before the fix
    this would have cut out and restarted at twelve seconds.
  - *Known-empty file* — the 77,380-byte Hulbe episode from
    `broken-episodes.md`. It never reaches `loadedmetadata` in Chromium; it
    errors, retries, errors again, and **`PlaybackErrorDialog` appears**
    ("Transmission Interrupted", with Try Again). The dialog had been
    unreachable since `d31e393`. Its failure report was correctly **rejected 400**
    by the allowlist, because that episode was pulled from the catalog.
  - *Advisory path* — verified by hand against a real catalog id: kind accepted,
    `detail` stored, unknown kinds still rejected 400, and confirmed it does
    **not** leak into `/api/stats/failures` ranking.
  - *Unload beacon* — the verification session vanished from `active_sessions`
    on tab close, while a real listener's row stayed and remained correctly
    on-air. That subsystem had never run either.

## The phantom rows

33 rows, all instrument error, **deleted**. Dumped first to
`docs/phantom-failures-2026-07-29.csv` (committed) so it is auditable and
reversible. Cutoff proved per row against `d31e393` (03:00:46, the commit that
shipped the broken code and this table's only writer) and the service restart
onto `50dd320` (16:08:53): **33 of 35 inside the window, 0 before, 0 after, 0
ambiguous** — so nothing had to be held back. It was 33 rather than the 32 I
first quoted you; one more arrived while I was working. The other 2 were my own
hand-written rows proving the `detail` column, deleted too because a fabricated
duration would corrupt the advisory dataset they were testing. Full write-up in
`docs/phantom-failures.md`. `play_events` and `traffic_daily` were not touched.

## Files

`src/hooks/useAudioPlayer.ts` · `src/audio/playback-watchdog.ts` ·
`src/services/stats/{client,store}.ts` · `src/app/api/playback-event/route.ts` ·
`scripts/schema.sql` · `CLAUDE.md` · four test files plus
`src/hooks/__tests__/support/mount-player.ts` and
`src/hooks/__tests__/global-listeners.test.ts` · `docs/phantom-failures*.md|csv`
· `docs/synthetic-stats.md`.

## What to watch over the next day

1. `playback_failures` should stay at or near **zero**. It is currently empty. If
   it starts accruing timeouts again at ~12 s, something has re-broken the
   wiring — and the `armWatchdog` refusal message in the console will say so.
2. `empty-media-suspected` rows: this is the dataset that decides whether the 5 s
   floor is safe to make authoritative. **Zero so far** — Chromium errors on the
   empty file rather than reporting a short duration, so this may only ever fire
   on Safari/iOS. If it stays empty for a week, that is itself the answer.
3. `active_sessions` should now drain on tab close rather than only by decay.
   Presence counts may read slightly *lower* than they used to, and that is the
   correct number, not a regression.
4. Queue advance at the end of a show now actually runs, in production, for the
   first time. Worth one listen through an episode boundary.
