# The 33 phantom rows in `playback_failures`

Every row this table held before 2026-07-29 16:08:53 UTC was instrument error.
None of them recorded a real playback failure. They were deleted; the full dump
is in [`phantom-failures-2026-07-29.csv`](./phantom-failures-2026-07-29.csv),
taken before the `DELETE`, so this is auditable and reversible.

## What wrote them

`withGlobals()` in `src/hooks/useAudioPlayer.ts` ref-counted with a single
module-level counter shared across all five of its call sites, so exactly one
install ever ran — the position timer, which happens to be declared first. The
media element listeners were therefore never attached, from `d31e393` (the
commit that introduced both `withGlobals` and the watchdog) until `50dd320`.

The watchdog's only inputs are those listeners. With none of them attached it
could see neither `progress` nor `canplay`, so:

- nothing ever reset the load deadline → every attempt ran the full 12 000 ms;
- nothing ever settled the attempt → the retry fired, ran its own 12 000 ms, and
  the attempt was reported as a `timeout`;
- `noteReady()` was unreachable → `recovered` could not be `true` on any row.

The data says exactly that, and says nothing else:

| | |
|---|---|
| kinds | `timeout` ×30, `play-rejected` ×3. **Zero** `stall`, `network-error`, `decode-error`, `empty-media` — every one of those arrives via a listener |
| `elapsed_ms` on the timeouts | 12000–12013, mean 12004 |
| `retried` / `recovered` | `true` / `false` on all 33 |
| spread | 21 distinct episodes, all 5 platform buckets, 11 hours of the day |
| failing-episode size | median 40.0 MB / 32 kbps, against a catalog median of 40.8 MB / 32 kbps |

Meanwhile 44 plays were recorded in the same window — a 73 % "failure" rate
against an origin measured from the VPS at 0.65–1.13 s TTFB across 12–282 MB
with no correlation to file size. The 12 s deadline was never the problem.

These rows are not merely noise: the retry that produced them tore down an
element that was streaming fine, so the show cut out and restarted twelve
seconds in, or on iOS stopped for good. See the playback notes in `CLAUDE.md`.

## The cutoff, proved per row

Lower bound `2026-07-29 03:00:46 UTC` — `d31e393`, which introduced the
watchdog and this table's only writer. Nothing could have written it earlier.
Upper bound `2026-07-29 16:08:53 UTC` — the `highdesert.service` restart onto
`50dd320`, from `systemctl show highdesert -p ActiveEnterTimestamp`.

```
 total | clears_phantom | before_broken_code | after_fix_ambiguous | verification_rows
    35 |             33 |                  0 |                   0 |                 2
```

Every row fell strictly inside the window. **No row was ambiguous**, so none was
kept back. Oldest phantom `id 1` at 03:14:27 (13 minutes after the commit);
newest `id 33` at 15:14:48 (54 minutes before the fix deployed).

The two remaining rows (`id 34`, `35`) were written by hand while verifying that
the new `empty-media-suspected` kind and its `detail` column work end to end —
`detail: "duration=3.187 (VERIFY 50dd320)"`, a duration never actually observed.
Deleted for the same reason: they would corrupt the advisory dataset that exists
to answer whether the five-second floor is safe to make authoritative. Recorded
in [`synthetic-stats.md`](./synthetic-stats.md) as well.

## Why deleting was safe here

`playback_failures` is diagnostic and self-pruning at 90 days — it is not part of
the permanent record. `play_events` and `traffic_daily` are, and neither was
touched. Nothing was deleted from either.

## Why it cannot recur

Cleaning the data was the smaller half. The watchdog now requires positive
evidence that it is wired — `noteListenersAttached()` / `noteListenersDetached()`
bracket the media-events install — and `armWatchdog()` refuses to arm without it,
logging loudly instead. A detector with no inputs cannot distinguish "nothing
happened" from "I cannot see"; this one failed open and invented telemetry for
four months. It fails closed now.

Pinned by `src/audio/__tests__/playback-watchdog.test.ts` ("a watchdog with no
inputs must not report") and `src/hooks/__tests__/global-listeners.test.ts`,
which mounts the hook twice — the way production does — and asserts each of the
five subsystems installs exactly once.
