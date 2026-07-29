# Handoff — the sleep-timer fade, rate-limit and the stores

**Date:** 2026-07-29
**Branch:** `main`. Push and deploy state recorded at the bottom from command output.

Follows `docs/handoff-2026-07-29-delete-episode.md`. Three items, and a defect that fell
out of the third.

---

## 1. The stale snapshot in `deleteEpisode`

`deleteEpisode` captured `usePlayerStore.getState()` once, called `store.stop()` — which
clears the queue — then computed a queue index from that now-stale snapshot.

It produced the right answer, but only because `removeFromQueue` bounds-checks against the
*live* queue that `stop()` had already emptied and returns early. That is a coincidence
holding up a correct outcome, not a property, and the previous session had put a test
around the coincidence.

Now it re-reads state after `stop()`. **No existing test went red**, which is the expected
result and worth stating plainly: the behaviour was already correct on both paths, and
what changed is that it is now correct for a reason. All 31 mutations still red.

---

## 2. Dependency floors, applied directly

Not by merging `agent/audit-and-update-dependencies-for-next-j`, which would also have
reintroduced `@anthropic-ai/sdk` — see the previous handoff.

| package | was | now |
|---|---|---|
| `zustand` | `^5.0.11` (5.0.11 installed) | `^5.0.14` (5.0.14) |
| `@types/node` | `^20` (20.19.33) | `^22` (22.20.1) |

`@types/node` was the one with real risk — the VPS runs Node v22.23.1, so the types were
two majors behind the runtime they described. `npx tsc --noEmit` is clean and the full
suite passes, so the mismatch had not yet surfaced as an error; it was a latent one.

---

## 3. `rate-limit.ts` — item B

`src/lib/utils/__tests__/rate-limit.test.ts`, 10 tests, fake timers set before the import
so `lastCleanup` (initialised at module scope) starts from a known point.

The test worth naming is **"frees one slot as the oldest request ages out, not all of them
at once"**. That is the property separating a sliding window from a fixed bucket, and a
fixed bucket hands back the whole allowance at the boundary — which is how a documented
"30/min" limit quietly becomes 60 requests in a two-second span. Two mutations:
`rate-limit-boundary` (the `>=`/`>` off-by-one) and `rate-limit-sliding` (expiry removed).

`getClientIp` is covered including the empty-header case: an empty `x-forwarded-for` must
fall through to `x-real-ip` rather than yield `""` as the key, since an empty key puts
every such caller into one shared bucket — a denial of service against all of them.

### One hazard found, not fixed, because it is not live

`cleanup(windowMs)` prunes **every** entry in the store using the *calling* route's window:

```js
const cutoff = now - windowMs;
for (const [key, entry] of store) {
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
```

Every route today passes `windowMs: 60_000` — verified across all 14 call sites — so all
entries share one window and the pruning is correct. **The first route added with a longer
window would be silently under-limited**: a cleanup triggered by any 60s route would drop
its older timestamps, resetting its count. Cleanup runs at most every 5 minutes, so it
would be intermittent and invisible.

Not fixed here because changing limiter behaviour was not the task and the fix needs a
decision (store the window per entry, or prune by the maximum window seen). **Flagged for
whoever adds a non-60s window.** Left as a comment-free hazard deliberately — a comment in
`rate-limit.ts` saying "don't do this" is the kind of check that reports nothing; if this
is worth defending it should be a test that fails.

---

## 4. The stores — and the defect the tests found

All eight previously-untested stores now have a test file and one mutation each:
`admin`, `context-menu`, `radio-dial`, `scanner`, `scraper`, `search`, `sleep-timer`,
`toast`. (`player-store` was already covered via the hook tests.)

Two of these tests failed on first run. **They were right and the code was wrong.**

### `setVolume()` writes `preMuteVolume`, and the sleep timer read it back

`usePlayerStore.setVolume(v)` sets `preMuteVolume = v` whenever `v > 0`, so `preMuteVolume`
tracks the volume rather than remembering a value from before some change. The sleep
timer's fade did this every tick:

```ts
player.setVolume(Math.min(player.volume, fadeVolume * player.preMuteVolume));
```

`player.preMuteVolume` on tick *n* is what `setVolume` wrote on tick *n−1*. The ramp was
multiplying its own output:

| seconds remaining | intended | actual |
|---|---|---|
| 30 | 100% | 100% |
| 15 | 50% | **0.7%** |
| 0 | — restore — | restores **~2.7%** as the listener's setting |

So the fade collapsed to inaudible about halfway through, and then the "restore volume to
pre-fade level" line at the end assigned that same collapsed number. The listener woke up
to an app at a couple of percent volume.

**Muting and unmuting could not fix it**, which is what makes this bad rather than merely
annoying: `toggleMute` restores from `preMuteVolume`, and `preMuteVolume` had been
overwritten along the way too. The only recovery was to find the volume slider and drag it
back, with nothing anywhere indicating what had happened. No error, no toast, no log —
the "no visible error state" class, on a feature people use precisely when they are not
watching the screen.

**Fixed** by capturing the starting volume once into new store state `fadeFrom`, ramping
from that fixed value, and handing exactly it back. Also fixed, in the same shape:

- **Cancelling mid-fade now restores the volume.** Previously a listener who changed their
  mind at 0:10 was left at a third of their volume, with the control that did it already
  gone from the UI.
- **A timer that expires without ever fading no longer touches the volume.** The old code
  assigned `preMuteVolume` unconditionally at zero, which could move a slider the timer had
  never touched.

The mutation `sleep-fade-source` re-stages the exact defect — it swaps `fadeFrom` back for
`player.volume` — so it cannot come back quietly.

### Smaller things pinned along the way

- **`scanner-store` keeps the LAST 100 error messages; `scraper-store` keeps the FIRST
  200.** Both are defensible (a scan's recent failures are the useful ones; a scrape
  usually fails the same way from the start) and neither was written down anywhere. Both
  now have a test and a mutation, in their own files, so the difference is deliberate
  rather than accidental.
- **`toast.error` is not mirrored to the status bar**, unlike every other toast type. The
  status bar is a one-line ticker overwritten by the next message; putting an error there
  would let a failure look acknowledged and then scroll away.
- **`useSearchStore` replaces its `Set`s rather than mutating them.** Mutating in place
  leaves the reference unchanged, Zustand's default equality sees no change, and an import
  row's spinner never clears even though the import succeeded. The test asserts identity,
  not just contents.
- **`useAdminStore.isAdmin` starts `false` even when localStorage says otherwise.** Reading
  it during render was a hydration mismatch that made React discard the server HTML for
  that subtree. `hydrate()` only ever promotes; it never demotes.
- The admin tests do **not** attempt the positive login path — the password is not in the
  repo and is not recoverable from the hash. What they do assert is that pasting the
  published hash as the password fails, which is the one login claim provable without it.

---

## State

- **276 tests, 28 files** — all passing
- **31 of 31 mutations red** (18 + 3 `deleteEpisode` + 10 new)
- `npx tsc --noEmit` clean, `npm run lint` clean
- Mutation run is now ~5 minutes. Still serial, still well under the fifteen-minute
  revisit threshold.

**Correction to the previous handoff:** it recorded "22 of 22 mutations red". The count was
21 (18 + 3). Fixed in that file.

## Deferred to ~2026-08-05, when a week of clean data exists — do not touch before then

- Re-evaluating the 12s watchdog load deadline
- Reading `retried: false` to judge whether the activation gate is too noisy
- The position-persistence and unload-beacon numbers

## Also not done

- Item B continues: 30-odd modules still untested
- `eevee/high-desert` (292 commits) needs a decision
- The `rate-limit.ts` mixed-window hazard above, if a non-60s window is ever added
