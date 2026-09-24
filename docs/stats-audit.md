# /stats audit — every number, where it comes from, and what was wrong

2026-09-24, branch `stats/truth` (Part 1 of the stats-correctness mandate). Each figure on
/stats was traced to its source, recomputed independently from raw rows (Dexie for local
figures, Postgres read-only for server ones), and checked against invariants. Everything
below marked **fixed** has a test and a mutation in `scripts/mutate-check.mjs` that turns
that test red.

## Sources

| Card | Source | Test that recomputes it |
|---|---|---|
| On Air, Signal Traffic "Right now", tab badge, status bar, mobile sheet | `getPresence()` via `/api/stats/now`, one shared 20 s feed | `presence-surfaces.test.tsx`, `presence-clients.db.test.ts`, live `scripts/presence-check.mjs` |
| Signal Traffic chart, peaks, plays in range, hour profile | `/api/stats/traffic` (`listener_samples`, `play_events`) | `signal-traffic.test.tsx`, `store.db.test.ts` |
| Plays all time | `sum(episode_plays)` | `signal-traffic.test.tsx` (the era note) |
| Community Top 20 | `/api/stats/leaderboard?period=` (`episode_plays` / `weekly_plays`) | `community-leaderboard.test.tsx` |
| Your Listening: Listened, Favorites, Avg Rating, Streak | Dexie `history`, `episodes` → `computeLibraryStats()` | `library-stats.test.ts`, `stats-page.test.tsx`, `listen-time.test.ts` |
| The Archive: Episodes, Runtime, Notable, Series | Dexie `episodes` → `computeLibraryStats()` | `library-stats.test.ts` (real catalog), `stats-page.test.tsx` |
| Broadcast Log (years, decades), Program Guide, Subject Breakdown, Most-Featured Guests, Topic Index | same | `library-stats.test.ts` (real catalog) |
| My Most Played | Dexie `playCount` | `library-stats.test.ts`, `stats-page.test.tsx` |

## Invariants (real catalog, 1,312 rows)

All hold, and `library-stats.test.ts` now asserts each against the shipped seed:

- Decades 1990s 626 + 2000s 649 + 2010s 37 = **1,312** = dated rows; undated 0.
- Show types: coast 1,189 + dreamland 81 + special 42 = 1,312.
- 16 categories sum to 1,312.
- 18 series across 152 rows, none with a single part.
- 657 distinct guests, 1,019 unique tags, runtime 3,302.1 h (4 rows carry no duration).
- Library rail/group counts equal list counts: the property tests in
  `src/lib/library/__tests__/sort-properties.test.ts` (150 random libraries × every sort).

Server figures matched Postgres at audit time: 24 h plays in range 88 = sum of chart points =
`play_events` in 24 h = `recent_plays`; 7 d 349 = 349; peaks equal the maxima of the points;
Plays all time 7,422 = `sum(episode_plays)`; the all-time leaderboard is `episode_plays`
in order.

## Findings

1. **Notable read 0 — fixed.** The flag was never populated: no seed commit carried
   `aiNotable`, `categorize-library.py` never wrote it, and its only writer was a runtime
   route since deleted. Now a curated, cited list (`data/notable.md`, 9 broadcasts), set in
   the seed and brought to returning visitors by `refreshCatalogFlags()`. The chip is
   "Notable". Tests: `src/db/__tests__/notable.test.ts`.
2. **Listened hours and "N episodes" went *down* when you finished a show — fixed.** They
   summed `playbackPosition`, which `ended` resets to 0 (and a seek to the last hour added
   an hour nobody heard). The alternative definition in the old ListeningStats banner summed
   `history.duration` — but the only writer of history rows always wrote `0` and nothing
   updated it, so that was 0 for everyone. Listened is now *measured*: the 250 ms position
   tick accumulates forward steps ≤ 2 s into the episode's newest history row, flushed when
   position is saved. **Consequence:** existing visitors' Listened restarts from 0h at this
   deploy — no stored field ever held the real figure, so there is nothing to backfill.
3. **"Most Listened" ranked by your own plays but showed progress % — fixed.** Now "My Most
   Played", showing the play count it ranks by, with a drill-down to `?sort=my-plays`.
4. **Presence differed by surface — fixed** (Part 1A). Sessions were counted as people, the
   badge subtracted one, and two endpoints polled on two clocks. One server function counts
   distinct clients; one feed serves every surface; `highdesert-status` checks the live site.
   No bogus rows were found to purge.
5. **Episodes can read 1,313 for returning visitors — documented, not changed.** Reconcile
   is bulkAdd-only, so a library seeded before the removal in `docs/broken-episodes.md`
   keeps that row. Deleting it unattended is exactly what the data-safety rules forbid. The
   page comment that claimed the Archive is "identical for every visitor" was false and is
   corrected; the Broadcast Log now shows undated rows instead of silently omitting them.
6. **Plays all time exceeds any range — explained on the page.** `episode_plays` (7,422)
   predates `play_events` (2,252, from 2026-07-28), so 5,170 plays have no timestamp. By
   design; the tile now carries a one-line note. `traffic_daily` sums 85 above
   `play_events` — the approximate backfill at midnight boundaries (see
   `scripts/backfill-traffic-daily.sql`), and rollup never revises downward. Left as is.
7. **Runtime "days" — tidied.** Rounded from rounded hours; now `≈ N days` from seconds.
8. **Drill-downs — fixed.** Community Top 20 → `?sort=played` (community plays, the same
   numbers); My Most Played → `?sort=my-plays`; Avg Rating → `?sort=my-rating`. Flagged
   Episodes no longer `setTimeout`s after a navigation: it plays through the bus (heard on
   every route) and opens `?scroll=current`.
9. **Stats rendered with history still loading — fixed.** Listened and Streak showed 0 for
   a frame, then jumped. The page now waits for both queries.
10. **`?period=` on the leaderboard was undocumented — fixed** in CLAUDE.md's route table.
11. **No test recomputed any /stats card — fixed.** The page's 130-line `useMemo` is now
    `computeLibraryStats()`; see the table above.

## Mutations added

`notable-seed-row-drop`, `notable-refresh-gate`, `notable-refresh-noop`,
`stats-listened-positions`, `stats-decade-sum`, `stats-page-listened-fork`,
`stats-my-plays-drill`, `stats-leaderboard-drill`, `listen-time-tick-wire`,
`listen-time-seek` — plus Part 1A's `presence-*` and Part 1B's sort/rail/layout set.
