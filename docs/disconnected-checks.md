# Disconnected checks

Four defects in this project have had the same shape, and it is worth naming
once rather than rediscovering a fifth time.

> **A check with no connection to the thing it checks reports success.**
> It cannot distinguish *"nothing is wrong"* from *"I cannot see"*, and it does
> not say which one it means. So it says the reassuring one, indefinitely.

Each of these was, at the time, believed to be working. Each was passing, or
green, or written down as fact. None of them was observing anything.

---

## The four

### 1. A watchdog with no inputs — `docs/phantom-failures.md`

`playback-watchdog.ts` supervises a load attempt. Every input it has —
`noteProgress`, `noteReady`, `noteWaiting`, `noteError` — arrives from a media
element listener installed by `useAudioPlayer`. A ref-counting bug meant those
listeners were **never attached**, in any browser, for four months.

The watchdog did not notice. Its own `setTimeout` was the only thing that could
fire, so it fired: every load ran the full twelve seconds and was recorded as a
timeout, against audio that was streaming perfectly. `recovered` was `false` on
all 33 rows because the only thing that can set it is `noteReady()`, reached from
a listener that did not exist.

It also *acted*: the retry tore down an element that was playing, so the show cut
out and restarted, or on iOS stopped for good.

**Closed by:** `noteListenersAttached()` / `noteListenersDetached()` bracket the
listener install, and `armWatchdog()` refuses to arm without them — logging
loudly rather than supervising blind. It fails closed now.

### 2. A test that re-implemented its subject — item A, `docs/handoff-2026-07-29-watchdog.md`

`restore-play.test.ts` was named for a reported bug and declared **its own**
`primeEpisode`, plus an inline copy of `togglePlay`'s no-source branch.
Production `useAudioPlayer.ts` was never imported.

It had already drifted: the real `primeEpisode` calls `notifySourceChanged()` and
applies the stored playback rate, and the copy did neither. Either could have
been deleted and the suite would have stayed green.

**Closed by:** rewritten onto the real hook, mounted the way production mounts it
(twice). Proven by deleting `notifySourceChanged()` and confirming red.

### 3. A test that asserted a belief against a model of the library — `docs/dexie-update-semantics.md`

`clear-field.test.ts` guarded the un-favouriting / un-rating data path. Its
commit message said it would "fail loudly if Dexie ever changes".

It could not. It never called Dexie. The "test that documents the Dexie
behaviour" was a hand-written model of what the author believed Dexie did,
asserted against itself — so it agreed by construction, and would have gone on
agreeing through any Dexie release, including a breaking one.

The belief was also **false on the day it was written**: `Table.prototype.update`
delegates to `.where(":id").equals(key).modify(mods)`, which deletes keys set to
`undefined`. Nobody checked, because the test said it was fine.

**Closed by:** rewritten on `fake-indexeddb`, driving the real functions against
the real database. One of its six tests now calls `db.episodes.update()` directly,
so the claim is pinned to Dexie rather than to a belief about it.

### 4. A handoff that asserted its own success — this file's occasion

`docs/high-desert-handoff-2026-07-29.md` states, in its header:

> **Branch:** `main`, clean working tree, **pushed to origin**.

It was not pushed. Nothing had run `git push`, and nothing checked. The
statement was written because it was *usually* true and it was what the author
intended to be true.

It sat there for a day, was read as fact, and a whole session was planned on that
document — which makes it the same failure at one level up: **a status line is a
check, and a check that reports intent rather than observation is disconnected.**
Eight commits, including the entire watchdog fix and the phantom-row deletion,
existed only on one machine that whole time.

**Closed by:** a standing rule — if committed work exists only on the VPS, push
it; that is not a decision to queue. And by preferring, in these documents, a
command's output over a sentence about what should have happened.

---

## What they have in common

- **All four were confident.** None reported uncertainty, and none had a way to.
- **All four were cheap to disprove** — one command, one mutation, one `git
  status`. Nobody ran it, because nothing suggested it was worth running.
- **Three of four were *worse* than having no check at all.** The watchdog wrote
  33 false rows and interrupted working audio; the two tests occupied the slot a
  real test would have taken and made the gap invisible. The absent check would
  at least have been counted as absent.

That last point is the whole reason this file exists. `docs/` can count modules
with **no** test — the handoff lists 41. A test that cannot observe its subject
does not appear on that list, or on any coverage report. It reads as done.

---

## The instrument

`scripts/mutate-check.mjs` — `npm run test:mutations`, and a CI step.

For each test file, it breaks **one real line** of the production module and
requires the suite to go red. A mutation that survives means the test cannot see
its subject.

The mutation list is hand-curated rather than generated, deliberately. A
generated mutant tells you a *line* is unobserved. A chosen one tells you a
*behaviour* is — and several entries are the exact line of an incident this
project has already had:

| mutation | the incident it re-stages |
|---|---|
| `dedup-key` | keying on `archiveIdentifier` alone deleted 1,312 of 1,313 episodes |
| `global-install` | one shared ref counter left four of five installs never running |
| `restored-play-count` | a listen from the restored player reported nothing and never went on air |
| `reconcile-tombstones` | a deliberately deleted episode being resurrected |

**First run: 16 of 17 red, one survivor.** `filename-parser.test.ts` could not
see the "with Art Bell" strip — every fixture named one of the six recognised
shows, so `showName` was always overwritten with a clean label and the line under
test never executed. All 1,312 catalog filenames match a pattern too, but the
parser also serves the local-file scanner and the archive.org import, where the
filename is whatever someone else named it. Reachable, and unobserved. Now
covered; 18 of 18 red.

That is one genuine finding out of seventeen, which is roughly the hit rate worth
expecting — and it cost minutes.

## If you are adding a test

Ask the question this file is about: **if I delete the line I am testing, does
this fail?** If you cannot answer without running it, run it. If the answer is
no, the test is decoration, however carefully it is written.

Then add a mutation to `scripts/mutate-check.mjs` so the answer stays no.
