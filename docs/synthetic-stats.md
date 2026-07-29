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

## Adding to this file

Verification that writes to the permanent log should be recorded here in the
same shape: ids, timestamps, and what was being checked. Prefer a throwaway
`session_id` prefix that says so — `verify-…` — so the rows are identifiable
later even if nobody thought to write them down.
