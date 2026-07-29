# High Desert — session handoff, 2026-07-29 (third session)

**Project:** `/root/High-Desert` on the Hostinger VPS (this *is* the production
directory). Live at [highdesert.space](https://highdesert.space).

**Branch:** `main`, clean working tree, **pushed to origin** — verified with
`git status -sb`, not asserted. See the note at the bottom about why that
sentence is phrased that way.
**Deployed build:** `f04faa0`.
**Service:** `highdesert.service`, active.
**Tests:** 183 passing across 18 files. **Mutations: 18 of 18 red.** Typecheck
and lint clean.

Continues [`handoff-2026-07-29-retry-gate.md`](./handoff-2026-07-29-retry-gate.md).

---

## The push, first

`main` was 8 commits ahead of `origin/main` and had been since the previous
session. Pushed as the first action: `da49bf2..97119db`.

**Standing rule from Jackson, recorded here so it survives the session:** if
committed work exists only on the VPS, push it. That is not a decision to queue.

---

## Commits shipped this session

| SHA | What |
|---|---|
| `f04faa0` | test(ci): prove each test observes its subject, and surface the telemetry |

One commit, because the four pieces are one idea: a check that cannot observe its
subject reports success, and the fix is instruments you can actually read.

---

## 1. `scripts/mutate-check.mjs` — and the audit

For each test file, break **one real line** of the production module it claims to
cover, run only that file, and require it to go red. A mutation that survives
means the test cannot see its subject.

Run it with `npm run test:mutations`. **It is wired into CI** — a step after
`npm run test` in `.github/workflows/ci.yml` — which was cheap because the
workflow was already a plain lint/typecheck/test/build sequence.

### Results — 16 of 17 red on the first run, one survivor

| # | mutation | test file | verdict |
|---|---|---|---|
| 1 | `duration-sanity` — disable the 5s floor | `audio/duration-sanity.test.ts` | red |
| 2 | `watchdog-activation` — remove the activation gate | `audio/playback-watchdog.test.ts` | red |
| 3 | `viz-cycle` — stop advancing to the next visualization | `visualizations/registry.test.ts` | red |
| 4 | `dedup-key` — key on `archiveIdentifier` alone | `db/deduplicate.test.ts` | red |
| 5 | `reconcile-tombstones` — ignore tombstones | `db/reconcile.test.ts` | red |
| 6 | `global-install` — never install a global | `hooks/global-listeners.test.ts` | red |
| 7 | `heartbeat-playing` — carry the episode while paused | `hooks/listening-heartbeat.test.ts` | red |
| 8 | `restored-play-count` — stop counting the restored listen | `hooks/play-reporting.test.ts` | red |
| 9 | `prime-preload` — `preload="metadata"` on prime | `hooks/restore-play.test.ts` | red |
| 10 | `file-size-floor` — drop the `<1 MB` case | `utils/format-size.test.ts` | red |
| 11 | `retry-429` — stop retrying a rate-limited response | `utils/retry.test.ts` | red |
| 12 | `search-operator-strip` — leave operators in the text | `utils/search-parser.test.ts` | red |
| 13 | `streak-today` — break a streak for not listening yet today | `utils/streak.test.ts` | red |
| 14 | `filename-show-name` — stop stripping "with Art Bell" | `archive/filename-parser.test.ts` | **GREEN** |
| 15 | `clear-field-delete` — store `undefined` instead of deleting | `episodes/clear-field.test.ts` | red |
| 16 | `allowlist-gate` — accept any episode id | `stats/allowlist.test.ts` | red |
| 17 | `catalog-key` — key the catalog differently from the allowlist | `stats/catalog.test.ts` | red |

Four of these deliberately re-stage an incident this project has already had —
`dedup-key` (deleting 1,312 of 1,313 episodes), `global-install`,
`restored-play-count` and `reconcile-tombstones`. That is the argument for a
hand-curated list over a generated one: a generated mutant tells you a *line* is
unobserved, a chosen one tells you a *behaviour* is.

### The finding, loudly

> **`src/services/archive/__tests__/filename-parser.test.ts` could not see
> `showName = showName.replace(/\s+with\s+Art\s+Bell/i, "").trim();`**
>
> Deleting that line left all nine tests green.

**Why.** Every fixture in that file names one of the six shows in
`SHOW_PATTERNS` — Coast to Coast AM, Dark Matter, Dreamland, Gabcast. When a
pattern matches, `showName` is *overwritten* with a clean label from the table,
so the strip is a no-op. It only ever runs for a filename whose first segment
matches **no** pattern.

**Is the line dead, or untested?** Untested. I checked the shipped catalog: **0
of 1,312** filenames fail to match a pattern, so the line is unreachable from the
seed data — but `parseArtBellFilename` also serves the **local-file scanner** and
the **archive.org import**, where the filename is whatever someone else named it.
Reachable in the paths that matter, and unobserved.

**Closed.** One test added — an unrecognised show name carrying "with Art Bell" —
and the mutation now goes red. **18 of 18 red** on the current tree, including a
new mutation for the marker guard below.

That is one genuine finding out of seventeen, at a cost of minutes. Roughly the
hit rate worth expecting, and worth having.

### Safety properties of the script

It edits production source, so it is built to be interrupted:

- **Refuses to run** if any file it would mutate has uncommitted changes. This
  fired for real during the session and was correct — a crash mid-run would
  otherwise have lost work. `git checkout --` is then always a valid recovery.
- Restores in a `finally`, and again on `SIGINT`/`SIGTERM`.
- **Asserts each anchor string appears exactly once.** A mutation that silently
  became a no-op, or hit a second call site as the code moved, would report
  GREEN and read as a finding. Those come back as `STALE` instead.

---

## 2. Telemetry surfaced

The activation gate shipped last session, and its correctness is measured by
numbers that were only reachable by `psql`. That is the exact condition that let
33 phantom rows sit unexamined for four months.

**`/api/stats/failures` now returns** `{days, summary, entries}`, with entries
gaining `details` and `skippedRetries`.

- **`details`** — up to 3 distinct browser diagnostics per episode, newest first.
  `MediaError.code` plus its message. Already being stored; only readable by hand.
- **`skippedRetries`** — retries not attempted for want of a user gesture, so the
  listener got the dialog instead of a silent teardown. **`empty-media` is
  excluded**: it is never retried by design and would swamp the number this
  exists to measure.
- **`summary`** — site-wide, and deliberately **not a sum of `entries`**, which is
  capped at 50 episodes. Summing it would under-report from the 51st episode
  onward with nothing to say so.

The admin panel renders both: a summary strip (`total · episodes · recovered ·
retried, still failed · retry skipped, dialog shown`) and, per row, the
diagnostics in monospace.

Live now:

```
1 total · 1 episodes · 0 recovered · 1 retried, still failed · 0 retry skipped, dialog shown
```

**`skippedRetries` is the instrument for the activation gate.** Rising is the
intended behaviour becoming visible, not a regression. What would be a regression
is `play-rejected` with `retried: true` climbing — that would mean the gate is
reading activation as present when it is not.

---

## 3. `docs/disconnected-checks.md`

The pattern named once, pointing at all four instances:

1. the watchdog with no listeners attached (`phantom-failures.md`)
2. `restore-play.test.ts` re-implementing its subject (item A)
3. `clear-field.test.ts` asserting a belief against a model of Dexie
   (`dexie-update-semantics.md`)
4. **the previous handoff asserting "pushed to origin" without checking**

The fourth is Jackson's addition and it is the sharpest one, because it is the
same failure one level up: a status line is a check, and a check that reports
*intent* rather than *observation* is disconnected. That sentence was read as
fact and a session was planned on the document. Eight commits lived on one
machine for a day.

What the four share: all were confident, all were cheap to disprove, and **three
of four were worse than having no check at all** — the watchdog wrote 33 false
rows and interrupted working audio, and the two tests occupied the slot a real
test would have taken. An absent check is at least counted as absent.

---

## 4. The verification marker

`/api/playback-event` now **rejects with 400** any payload whose `detail`
contains `HD-VERIFY`, in any case, checked *after* the 200-character truncation
so it cannot be padded past the cut.

Verified live over real HTTP against production:

```
HTTP 400
{"error":"Verification payload refused. Intercept the POST in the page instead —
 this table is the instrument, not a place to test the instrument."}
```

`playback_failures` still holds exactly one row afterwards.

It returns an explanatory 400 rather than dropping the row silently — a guard
that quietly does nothing is how the previous three defects stayed hidden, and
whoever trips this needs to learn what to do instead.

Pinned by `src/app/api/playback-event/__tests__/verification-marker.test.ts`
(6 tests — the first API route test in the project), which also asserts the guard
does not cost us the thing the column exists for: a real
`code=4 MEDIA_ELEMENT_ERROR: Format error` still returns 200 and reaches the
store.

---

## Verification performed

**Automated:** 183 tests / 18 files. `npx tsc --noEmit` clean. `npm run lint`
clean. **`node scripts/mutate-check.mjs` — 18 of 18 red.**

**SQL run against the live schema before deploying,** both the rewritten
`getFailureRates` and the new `getFailureSummary`. A `WITH` clause with a new CTE
and a `DISTINCT ON` subquery is not something to discover is malformed from a
503 in production.

**Deploy:** `scripts/deploy.sh` — 74 chunk references across 4 routes, 0 non-200,
build id `f04faa0` in the service-worker registration chunk.

**Live API:** `/api/stats/failures?days=7` returns the new shape with `summary`,
`details` and `skippedRetries`.

**Live UI:** the admin panel renders the summary strip and, with an injected
response, the per-row diagnostics in monospace. The injection tested the one
unproven link — the pipeline (browser → `detail` column → API) was proven live
last session and the API shape by `curl` above; what had never been seen was the
component rendering `details` at all.

**Nothing written to `playback_failures`.** Still exactly one row, the genuine
`play-rejected | ios-safari` from 16:15:35. No new synthetic `play_events`
either — this session's live checks were reads and one rejected POST.

---

## Answers carried forward

- **Activation gate stays.** The desktop-visible tradeoff is intended. **Do not
  make the deadline adaptive now** — revisit the 12s constant after a week of
  clean data, with `skippedRetries` as the instrument.
- **Item B is re-ranked:** `deleteEpisode` above `rate-limit.ts`. It has incident
  history; `rate-limit.ts` does not.
- **All six stale branches left in place.**

---

## Open items, ranked

### A. `fix/library-wipe-recovery` is fully merged — safe to delete

Investigated, not deleted, per instruction. `git merge-base --is-ancestor` says
its tip `3cbb38c` ("chore: remove dead code, de-triplicate streak logic, fix doc
drift", 2026-07-27) is an ancestor of `main`. **0 commits ahead, 0 files
different.** Nothing unique on it.

The full picture, since item D undercounted:

| branch | status | ahead | files |
|---|---|---|---|
| `agent/review-and-update-phase-3-plan-md-implem` | merged | 0 | 0 |
| `fix/responsive-resize-dvh` | merged | 0 | 0 |
| `fix/library-wipe-recovery` | merged | 0 | 0 |
| `agent/audit-and-update-dependencies-for-next-j` | **unique** | 1 | 1 |
| `self-host` | **unique** | 1 | 2 |
| `eevee/high-desert` | **unique** | **292** | **99** |

Three are safe deletions. Three hold work not on `main` and want a look first —
`eevee/high-desert` especially, which at 292 commits and 99 files is a divergent
line of development, not a stale fix branch.

### B. 41 untested production modules — not started, re-ranked

1. **`services/episodes/management.ts` → `deleteEpisode`** — five tables,
   cascades into history/bookmarks/playlists, and a tombstone write that stops
   `reconcileLibrary()` restoring the row. The data-loss surface with incident
   history. (`toggleFavorite`/`rateEpisode`/`toggleFlag` are covered.)
2. **`lib/utils/rate-limit.ts`** (68 lines) — the only thing between the public
   API routes and abuse. In-memory `Map`, correct here, depends on nginx setting
   `X-Forwarded-For` by overwrite.
3. `useRadioDial.ts` (354), `useFileScanner.ts` (287), `useCollectionImport.ts` (231).

**Add a mutation to `scripts/mutate-check.mjs` alongside each new test file.**
That is now the convention, and `CLAUDE.md` says so.

### C. The 12-second deadline — revisit after a week

Explicitly deferred. It has never been evaluated against real traffic with
working inputs, because until `50dd320` the inputs were disconnected. The
instrument now exists. Do not tune it before there is a week of data.

### D. What to watch

1. **`skippedRetries` climbing.** Expected, and it is the gate working. What is
   *not* expected is `play-rejected` with `retried: true` rising.
2. **`details` on Safari.** The `code=N` half must appear on every engine; the
   message half is Chromium-flavoured and its absence on Safari is fine. An empty
   `detail` on a *Chromium* row means `audio.error` was null when `onError` ran,
   which would be worth understanding.
3. **`empty-media-suspected` may correctly stay at zero forever.** The guard's job
   is future catalog additions. Zero is not evidence it is broken.

---

## Things to know before touching this code again

- **`npm run test:mutations` before you believe a test.** If deleting the line
  under test does not make it fail, the test is decoration. Read
  `docs/disconnected-checks.md`. Add a mutation with every new test file.
- **Do not write to `playback_failures` by hand.** The route now rejects
  `HD-VERIFY` payloads. Intercept the POST in the page.
- **`summary` on `/api/stats/failures` is not a sum of `entries`.** Do not
  "simplify" it into one.
- **A status line is a check.** This handoff says "pushed to origin" because
  `git status -sb` was run after pushing and printed `## main...origin/main` with
  no ahead-count — not because pushing was intended. The previous handoff made
  the other choice and it cost a day.
