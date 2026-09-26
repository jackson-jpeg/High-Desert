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
| Signal Traffic peaks, busiest at, plays in range | `/api/stats/traffic`: raw `listener_samples` (90 days), `traffic_daily.peak_*` past that | `store.db.test.ts` (seeded raw samples; see finding 12) |
| Signal Traffic chart lines, scale label | the same, bucketed: per-bucket max and mean | `traffic.test.ts` (geometry), `signal-traffic.test.tsx` (render), `e2e/signal-traffic.spec.ts` (label position) |
| Signal Traffic hour profile | `getHourlyActivity()` — an average by design | `store.db.test.ts` |
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
`play_events` in 24 h = `recent_plays`; 7 d 349 = 349; ~~peaks equal the maxima of the points~~
(**that check was circular** — the peaks *were* the maxima of the points, by construction, and
the points were averages; see finding 12);
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

12. **Signal Traffic peaks shrank as the window grew — fixed** (2026-09-25, branch
    `stats/peaks`). `peakOnline`/`peakListening` were the maximum of the chart's *averaged*
    buckets (15 min for 24 h, 2 h for 7 d, 6 h for 30 d), so a wider bucket flattened the same
    spike further and the 30-day peak read lower than the 24-hour one it contains. Production,
    read-only, at 2026-09-25 ~21:00 UTC:

    | 24 h / 7 d / 30 d | online | listening |
    |---|---|---|
    | max of averaged buckets (what shipped) | 14 / 12 / 10 | 8 / 6 / 5 |
    | max of raw 2-minute samples | 15 / 19 / 19 | 8 / 8 / 8 |

    ```sql
    -- raw:     SELECT max(online), max(listening) FROM listener_samples WHERE sampled_at >= now() - interval '7 days';
    -- shipped: SELECT max(o), max(l) FROM (SELECT round(avg(online)) o, round(avg(listening)) l FROM listener_samples
    --          WHERE sampled_at >= now() - interval '7 days' GROUP BY floor(extract(epoch FROM sampled_at) / 7200)) b;
    ```

    The raw 7-day peak, 19 at 2026-09-21 18:35 UTC, predates client counting (2026-09-24) and so
    counts sessions; it is still what the table says. "Busiest at" was the start of the busiest
    *bucket*, not a moment. **Now:** peaks and `peakAt` are their own query over the raw
    samples (`listener_samples` is kept 90 days, covering every range); each point carries
    `onlineMax`/`listeningMax` beside the mean; `traffic_daily`, which already kept
    `peak_online`/`peak_listening`, gains `peak_at` (`scripts/schema.sql`, idempotent) so the
    "when" outlives the sample prune, filled for past days by
    `scripts/backfill-traffic-peaks.sql` (idempotent; writes a day only while its raw maximum
    still equals the stored peak). The chart draws the maxima as its lines and the means dashed
    and faint. `highdesert-status` has a `peaks` line that FAILs unless
    peak(30 d) ≥ peak(7 d) ≥ peak(24 h) for online and listening.
13. **The 30-day chart's "10" covered its first point — fixed.** The scale label sat absolutely
    positioned at the plot's top-left, which is where the first point lands whenever a window
    opens on its busiest bucket. Measured on production (fixture traffic, first point = peak):
    desktop first point (116, 544), label box x 122–132, y 542–557; at 390 wide point (35, 499),
    label 41–51 × 498–513 — the digits sat on the line. The label now has its own row above the
    plot; `e2e/signal-traffic.spec.ts` measures label and point on desktop and mobile.
14. **The listening milestone counted position, not time heard. Fixed 2026-09-26.**
    `MilestoneDialog` summed `progress.playbackPosition`, the mistake the "Listened"
    tile once made. On the live station that is where the show is, so a first-time visitor
    who tuned in more than two hours into a broadcast and then reloaded was shown "2 Hours in
    the High Desert" and a Venmo ask, over the page, three seconds later. Found because it
    covered the Leave button in `e2e/live-qa.spec.ts` whenever the show on air was past its
    second hour: 4 of 8 runs late in a show. It now sums `history.duration`. Test:
    `src/components/desktop/__tests__/milestone-dialog.test.tsx` (the real dialog over
    fake-indexeddb); mutation `milestone-time-heard`.

## Recompute sweep — is any check circular? (2026-09-25)

Each test in the Sources table was read for the pattern in finding 12: an expectation derived
from the chart's points or from the function under test rather than from raw rows or an
independent fixture.

| Test | Verdict |
|---|---|
| `library-stats.test.ts` | **Independent.** Recomputes every figure by filtering the shipped seed rows directly (`seed.filter(...)`), never through `computeLibraryStats`. |
| `stats-page.test.tsx` | **Independent.** Fixed fixture constants (3.5 h, 2 episodes, 7 / 3 / 1); holds the page to `computeLibraryStats`, whose arithmetic the test above proves. |
| `listen-time.test.ts` | **Independent.** Fixture ticks against constant expected seconds. |
| `community-leaderboard.test.tsx` | **Independent.** Fixture plays (132, 41, …) asserted as rendered. |
| `presence-surfaces.test.tsx` | **Independent.** One fixture snapshot; asserts every surface renders its constants. |
| `presence-clients.db.test.ts` | **Independent.** Seeds sessions and asserts constant client counts. |
| `scripts/presence-check.mjs` | A consistency check (surfaces agree on the live site), not a recompute; listed as such. |
| `signal-traffic.test.tsx` | **Was mislabelled** as recomputing the peaks — it renders fixture props. Its role is now the render (max line above mean, label outside the plot); the recompute moved to `store.db.test.ts`. |
| `store.db.test.ts` traffic | **Was circular, fixed.** Nothing recomputed the peaks from raw rows, and the audit's own "peaks equal the maxima of the points" compared the function with itself. Now seeds raw samples (a 40/25 spike in a 1/0 trickle) and expects 40/25 and the spike's time in all three ranges, the nesting invariant, and `traffic_daily`'s `peak_*` after rollup. |
| `store.db.test.ts` plays in range | **Was unrecomputed, fixed.** Only the audit-time 88 = 88, which summed the same points. The seeded counter rises by one per sample, so `playsInRange` must equal `rows − 1` in every range. |

## Mutations added

`notable-seed-row-drop`, `notable-refresh-gate`, `notable-refresh-noop`,
`stats-listened-positions`, `stats-decade-sum`, `stats-page-listened-fork`,
`stats-my-plays-drill`, `stats-leaderboard-drill`, `listen-time-tick-wire`,
`listen-time-seek` — plus Part 1A's `presence-*` and Part 1B's sort/rail/layout set.

Findings 12–13: `traffic-peak-from-points`, `traffic-peak-listening-raw`,
`traffic-peak-at-sample`, `traffic-bucket-max`, `traffic-rollup-peak-at`,
`traffic-backfill-guard`, `traffic-client-max-fallback`, `traffic-geometry-max-line`,
`traffic-geometry-listening-max`, `traffic-scale-from-max`, `traffic-scale-label-in-plot`,
`status-peaks-online-30-7`, `status-peaks-listening-7-24`.
