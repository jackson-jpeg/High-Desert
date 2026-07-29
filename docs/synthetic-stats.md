# Synthetic rows in the community stats

`play_events` and `traffic_daily` are never pruned — they are the permanent
record, and `/api/stats/export` serves them to sang3r.com as fact. A few rows in
them were written by verification rather than by a listener. They are recorded
here rather than deleted: unwinding the counters `recordPlay` bumps in the same
atomic statement (`episode_plays`, `weekly_plays`, `recent_plays`) by hand is a
larger risk to a never-pruned table than the noise itself.

If these numbers are ever audited, subtract these.

## 2026-07-29 — verifying the on-air fix (`d0a22fb`)

Four plays, all between 04:28 and 04:38 UTC, from the VPS. One from a `curl`
probe of `/api/stats/play`, three from a headless browser genuinely streaming
the episodes while checking that the restored player reports a play at all.

| `play_events.id` | Episode | `played_at` (UTC) | Source |
|---|---|---|---|
| 56 | `…1992-12-12_-_Coast_to_Coast_AM…Area_51_-_John_Lear_-_Bob_Lazar` | 04:28:11 | `curl`, session `verify-1785299291-abcd` |
| 57 | `…1996…Captain_Crunch_-_Telephone_Hacking` | 04:28:46 | Playwright, session `064d42e7-…` |
| 58 | `…1998-07-29_-_Coast_to_Coast_AM…Time_Traveler_Line` | 04:29:09 | Playwright, session `064d42e7-…` |
| 61 | `…1998-07-29_-_Coast_to_Coast_AM…Time_Traveler_Line` | 04:37:56 | Playwright, session `613c376d-…` |

Row 61 is the one that matters: it is the first play ever recorded from the
restored player, and its absence before `d0a22fb` was the bug being fixed.

## 2026-07-29 — re-verifying after the consolidation (`57a06bf`)

Two more, from the same browser check run against the redeployed build.

| `play_events.id` | Episode | `played_at` (UTC) | Source |
|---|---|---|---|
| 66 | `…1998-07-29_-_Coast_to_Coast_AM…Time_Traveler_Line` | 04:50:37 | Playwright, session `9b09b159-…` (library click, to establish a remembered show) |
| 68 | `…1998-07-29_-_Coast_to_Coast_AM…Time_Traveler_Line` | 04:50:53 | Playwright, session `cc7accd4-…` (restored player) |

Ids 65 and 67, in the same minute, are **not** synthetic — session
`a58c5d3b-…` is a real listener who happened to be on the site at the time.
Six synthetic plays in total, then: 56, 57, 58, 61, 66, 68.

The corresponding `active_sessions` rows were deleted at the time, so none of
this affected presence or the on-air list beyond the few minutes it took to
check. `session_ref` on all four expires at 90 days like any other.

## 2026-07-29 — verifying the watchdog fix (`50dd320`)

One play, from a headless browser on the VPS, checking that a show streams for
its first forty seconds without the watchdog tearing it down at twelve — the
behaviour `50dd320` fixes.

| `play_events.id` | Episode | `played_at` (UTC) | Source |
|---|---|---|---|
| 94 | `…1996-01-19_-_Coast_to_Coast_AM…Alien_and_Immortal_Open_Lines` | 16:10:10 | Playwright, session `957b35bd-…` |

Id 95, two minutes later, is **not** synthetic — session `211b9526-…` is a real
listener who put on the Gabcast episode while the check was running. Seven
synthetic plays in total across this file, then: 56, 57, 58, 61, 66, 68, 94.

The episode was chosen deliberately: it was the worst offender in
`playback_failures`, five phantom timeouts against it, and it played through
without incident.

The same run also attempted the known-empty Hulbe file from
`broken-episodes.md`. It wrote nothing — the episode was pulled from the catalog,
so its community key is not in the allowlist and `/api/playback-event` returned
400, which is the gate behaving correctly. No `play_events` row either.

Two rows *were* written to `playback_failures` by hand in the same session, to
prove the new `empty-media-suspected` kind and its `detail` column work end to
end. Both were deleted afterwards and are recorded in
[`phantom-failures.md`](./phantom-failures.md) — they carried a duration
(`3.187`) that was never observed, and would have corrupted the very dataset
they were testing.

## 2026-07-29 — forcing an episode boundary (`c6b5816`)

Four plays, from a headless browser on the VPS, proving the queue advance at the
end of a show. That path had **never executed in production** before `50dd320` —
`ended` arrives on a media listener that was never attached — and before
`withGlobals` was keyed it would have run *doubled*, skipping a show. Forced by
seeking to `duration - 10` rather than by waiting out a broadcast.

| `play_events.id` | Episode | `played_at` (UTC) | Source |
|---|---|---|---|
| 97 | `…2001-03-30…Richard_Hoagland_(hour_1)` | 17:06:54 | Playwright, session `897a245d-…` (5m11s show, queue of one) |
| 98 | `…1999-11-04…Mystery_Objects_(hour_1)` | 17:08:38 | Playwright, same session — reached by queue advance |
| 99 | `…1997-06-18…Mars_Pathfinder_(hour_1)` | 17:09:58 | Playwright, same session — **the deliberate boundary** |
| 100 | `…1997-06-18…Mars_Pathfinder_(hour_1)` | 17:14:37 | Playwright, session after reload, first attempt at the dialog check |

Row 99 is the one that matters. From a three-episode queue at index 1, `ended`
fired **once**, `play()` was called **once**, one `/api/stats/play` was recorded,
and the element moved to index 2 — not index 3, which does not exist and would
have stopped playback instead. `active_sessions` then showed `episode_id` on the
*new* episode with `listening_at` renewed at 17:09:58, and it appeared in the
on-air list.

Row 100 is the discarded first attempt at the ultra-mini dialog check: the
episode's `sourceUrl` had been repointed at a 404 in IndexedDB, but React still
held the pre-edit object, so the real file played. The check was redone after a
reload.

Eleven synthetic plays in total across this file: 56, 57, 58, 61, 66, 68, 94,
97, 98, 99, 100.

**Nothing was written to `playback_failures` by this session.** The dialog check
needs a real failure, so the `/api/playback-event` POST was intercepted in the
page and answered locally — the advisory dataset exists to decide whether the
five-second floor is safe to promote, and two hand-made rows have polluted it
once already (see [`phantom-failures.md`](./phantom-failures.md)). Verified after
the fact: the table still holds exactly the one genuine post-fix row from 16:15:35.

## Adding to this file

Verification that writes to the permanent log should be recorded here in the
same shape: ids, timestamps, and what was being checked. Prefer a throwaway
`session_id` prefix that says so — `verify-…` — so the rows are identifiable
later even if nobody thought to write them down.
