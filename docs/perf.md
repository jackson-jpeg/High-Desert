# Query performance notes

## HD-020 — the daily traffic rollup

`rollUpTraffic()` runs every two minutes, from `highdesert-sample.timer`. It
recomputes a 3-day trailing window of `traffic_daily` from `listener_samples`
(pruned at 90 days) and `play_events`, which is **never pruned** and grows
forever by design.

**Before:** the window predicates wrapped the column in an expression.

```sql
WHERE (played_at  AT TIME ZONE 'UTC')::date >= (now() AT TIME ZONE 'UTC')::date - ($1::int - 1)
WHERE (sampled_at AT TIME ZONE 'UTC')::date >= (now() AT TIME ZONE 'UTC')::date - ($1::int - 1)
```

**After:** the bare column is compared against a computed UTC midnight. The rows
are identical, since "the UTC date is at least D" is the same as "the instant is
at or after D 00:00 UTC". The `::date` conversion stays in the `GROUP BY`, where
it belongs.

```sql
WHERE played_at  >= ((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))::timestamp AT TIME ZONE 'UTC'
WHERE sampled_at >= ((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))::timestamp AT TIME ZONE 'UTC'
```

The statement is now exported as `ROLLUP_TRAFFIC_SQL` from
`src/services/stats/db/traffic.ts` (re-exported by `src/services/stats/store.ts`), so the test and this document EXPLAIN the exact
text that production runs.

### Measured on production, 2026-09-21

Both runs were `EXPLAIN (ANALYZE, BUFFERS)` against the live `highdesert`
database, with `$1 = 3` (`ROLLUP_DAYS`). Each ran inside `BEGIN … ROLLBACK`,
because ANALYZE executes the upsert. At the time `play_events` held 2,058 rows
and `listener_samples` 39,903.

| | Before | After |
|---|---|---|
| `play_events` | **Seq Scan**: 109 rows kept, 1,949 read and discarded, 55 buffers, 0.43 ms | **Index Scan** using `play_events_played_at_idx`: 110 rows, 6 buffers, 0.04 ms |
| `listener_samples` | **Seq Scan**: 1,861 rows kept, 38,051 discarded, 255 buffers, 5.08 ms | **Index Scan** using `listener_samples_pkey`: 1,861 rows, 411 buffers, 0.94 ms |
| Whole statement | 6.505 ms | 1.555 ms |

`listener_samples` touches *more* buffers under the index: it fetches 1,861
heap rows one at a time instead of reading 255 pages in sequence. It is still
about 5× faster. The number that matters is the one that grows: a sequential
scan reads the whole table, and the index reads the window.

The absolute time is small today. The problem was the shape: a scan that grows
with the whole event log, every two minutes, forever. After the change, the
work is proportional to three days of data no matter how old the log gets.

#### Before

```
                                                                                                             QUERY PLAN                                                                                                              
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Insert on traffic_daily td  (cost=2437.10..2491.58 rows=0 width=0) (actual time=6.013..6.016 rows=0 loops=1)
   Conflict Resolution: UPDATE
   Conflict Arbiter Indexes: traffic_daily_pkey
   Tuples Inserted: 0
   Conflicting Tuples: 3
   Buffers: shared hit=329
   ->  Hash Left Join  (cost=2437.10..2491.58 rows=124813 width=92) (actual time=5.917..5.927 rows=3 loops=1)
         Hash Cond: ((((generate_series(((((now() AT TIME ZONE 'UTC'::text))::date - 2))::timestamp with time zone, (((now() AT TIME ZONE 'UTC'::text))::date)::timestamp with time zone, '1 day'::interval)))::date) = s.day)
         Filter: ((COALESCE(s.samples, 0) > 0) OR (COALESCE(p.plays, '0'::bigint) > 0))
         Buffers: shared hit=316
         ->  Hash Left Join  (cost=181.42..226.64 rows=3425 width=16) (actual time=0.532..0.539 rows=3 loops=1)
               Hash Cond: ((((generate_series(((((now() AT TIME ZONE 'UTC'::text))::date - 2))::timestamp with time zone, (((now() AT TIME ZONE 'UTC'::text))::date)::timestamp with time zone, '1 day'::interval)))::date) = p.day)
               Buffers: shared hit=61
               ->  Result  (cost=0.00..42.54 rows=1000 width=4) (actual time=0.007..0.012 rows=3 loops=1)
                     ->  ProjectSet  (cost=0.00..5.04 rows=1000 width=8) (actual time=0.007..0.011 rows=3 loops=1)
                           ->  Result  (cost=0.00..0.01 rows=1 width=0) (actual time=0.000..0.000 rows=1 loops=1)
               ->  Hash  (cost=172.86..172.86 rows=685 width=16) (actual time=0.515..0.516 rows=3 loops=1)
                     Buckets: 1024  Batches: 1  Memory Usage: 9kB
                     Buffers: shared hit=61
                     ->  Subquery Scan on p  (cost=147.17..172.86 rows=685 width=16) (actual time=0.495..0.505 rows=3 loops=1)
                           Buffers: shared hit=61
                           ->  GroupAggregate  (cost=147.17..166.01 rows=685 width=16) (actual time=0.494..0.504 rows=3 loops=1)
                                 Group Key: (((play_events.played_at AT TIME ZONE 'UTC'::text))::date)
                                 Buffers: shared hit=61
                                 ->  Sort  (cost=147.17..148.89 rows=685 width=40) (actual time=0.482..0.486 rows=109 loops=1)
                                       Sort Key: (((play_events.played_at AT TIME ZONE 'UTC'::text))::date), play_events.session_ref
                                       Sort Method: quicksort  Memory: 32kB
                                       Buffers: shared hit=61
                                       ->  Seq Scan on play_events  (cost=0.00..114.91 rows=685 width=40) (actual time=0.380..0.428 rows=109 loops=1)
                                             Filter: (((played_at AT TIME ZONE 'UTC'::text))::date >= (((now() AT TIME ZONE 'UTC'::text))::date - 2))
                                             Rows Removed by Filter: 1949
                                             Buffers: shared hit=55
         ->  Hash  (cost=2091.69..2091.69 rows=13119 width=80) (actual time=5.327..5.328 rows=3 loops=1)
               Buckets: 16384  Batches: 1  Memory Usage: 129kB
               Buffers: shared hit=255
               ->  Subquery Scan on s  (cost=1599.73..2091.69 rows=13119 width=80) (actual time=5.306..5.320 rows=3 loops=1)
                     Buffers: shared hit=255
                     ->  HashAggregate  (cost=1599.73..1960.50 rows=13119 width=80) (actual time=5.305..5.318 rows=3 loops=1)
                           Group Key: ((listener_samples.sampled_at AT TIME ZONE 'UTC'::text))::date
                           Batches: 1  Memory Usage: 409kB
                           Buffers: shared hit=255
                           ->  Seq Scan on listener_samples  (cost=0.00..1402.94 rows=13119 width=12) (actual time=3.838..5.075 rows=1861 loops=1)
                                 Filter: (((sampled_at AT TIME ZONE 'UTC'::text))::date >= (((now() AT TIME ZONE 'UTC'::text))::date - 2))
                                 Rows Removed by Filter: 38051
                                 Buffers: shared hit=255
 Planning:
   Buffers: shared hit=254
 Planning Time: 1.116 ms
 Execution Time: 6.505 ms
```

#### After

```
                                                                                                             QUERY PLAN                                                                                                              
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Insert on traffic_daily td  (cost=44.83..92.76 rows=0 width=0) (actual time=1.360..1.364 rows=0 loops=1)
   Conflict Resolution: UPDATE
   Conflict Arbiter Indexes: traffic_daily_pkey
   Tuples Inserted: 0
   Conflicting Tuples: 3
   Buffers: shared hit=436
   ->  Hash Left Join  (cost=44.83..92.76 rows=733 width=92) (actual time=1.280..1.291 rows=3 loops=1)
         Hash Cond: ((((generate_series(((((now() AT TIME ZONE 'UTC'::text))::date - 2))::timestamp with time zone, (((now() AT TIME ZONE 'UTC'::text))::date)::timestamp with time zone, '1 day'::interval)))::date) = s.day)
         Filter: ((COALESCE(s.samples, 0) > 0) OR (COALESCE(p.plays, '0'::bigint) > 0))
         Buffers: shared hit=423
         ->  Hash Left Join  (cost=9.39..54.61 rows=1000 width=16) (actual time=0.133..0.142 rows=3 loops=1)
               Hash Cond: ((((generate_series(((((now() AT TIME ZONE 'UTC'::text))::date - 2))::timestamp with time zone, (((now() AT TIME ZONE 'UTC'::text))::date)::timestamp with time zone, '1 day'::interval)))::date) = p.day)
               Buffers: shared hit=12
               ->  Result  (cost=0.00..42.54 rows=1000 width=4) (actual time=0.007..0.011 rows=3 loops=1)
                     ->  ProjectSet  (cost=0.00..5.04 rows=1000 width=8) (actual time=0.006..0.010 rows=3 loops=1)
                           ->  Result  (cost=0.00..0.01 rows=1 width=0) (actual time=0.000..0.001 rows=1 loops=1)
               ->  Hash  (cost=9.26..9.26 rows=11 width=16) (actual time=0.119..0.121 rows=3 loops=1)
                     Buckets: 1024  Batches: 1  Memory Usage: 9kB
                     Buffers: shared hit=12
                     ->  Subquery Scan on p  (cost=8.84..9.26 rows=11 width=16) (actual time=0.094..0.107 rows=3 loops=1)
                           Buffers: shared hit=12
                           ->  GroupAggregate  (cost=8.84..9.15 rows=11 width=16) (actual time=0.093..0.105 rows=3 loops=1)
                                 Group Key: (((play_events.played_at AT TIME ZONE 'UTC'::text))::date)
                                 Buffers: shared hit=12
                                 ->  Sort  (cost=8.84..8.87 rows=11 width=40) (actual time=0.081..0.086 rows=110 loops=1)
                                       Sort Key: (((play_events.played_at AT TIME ZONE 'UTC'::text))::date), play_events.session_ref
                                       Sort Method: quicksort  Memory: 32kB
                                       Buffers: shared hit=12
                                       ->  Index Scan using play_events_played_at_idx on play_events  (cost=0.29..8.65 rows=11 width=40) (actual time=0.011..0.037 rows=110 loops=1)
                                             Index Cond: (played_at >= (((((now() AT TIME ZONE 'UTC'::text))::date - 2))::timestamp without time zone AT TIME ZONE 'UTC'::text))
                                             Buffers: shared hit=6
         ->  Hash  (cost=32.14..32.14 rows=264 width=80) (actual time=1.134..1.135 rows=3 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 9kB
               Buffers: shared hit=411
               ->  Subquery Scan on s  (cost=22.24..32.14 rows=264 width=80) (actual time=1.126..1.128 rows=3 loops=1)
                     Buffers: shared hit=411
                     ->  HashAggregate  (cost=22.24..29.50 rows=264 width=80) (actual time=1.125..1.127 rows=3 loops=1)
                           Group Key: ((listener_samples.sampled_at AT TIME ZONE 'UTC'::text))::date
                           Batches: 1  Memory Usage: 37kB
                           Buffers: shared hit=411
                           ->  Index Scan using listener_samples_pkey on listener_samples  (cost=0.30..18.28 rows=264 width=12) (actual time=0.036..0.941 rows=1861 loops=1)
                                 Index Cond: (sampled_at >= (((((now() AT TIME ZONE 'UTC'::text))::date - 2))::timestamp without time zone AT TIME ZONE 'UTC'::text))
                                 Buffers: shared hit=411
 Planning:
   Buffers: shared hit=283
 Planning Time: 0.990 ms
 Execution Time: 1.555 ms
```

### Guarded by

`src/services/stats/__tests__/store.db.test.ts` runs against a real Postgres
(`TEST_DATABASE_URL`):

- **Index use.** With `enable_seqscan = off` it EXPLAINs `ROLLUP_TRAFFIC_SQL` and
  requires an index scan on both tables. An expression-wrapped predicate has no
  usable index, so it still seq-scans. The `rollup-plays-index` and
  `rollup-samples-index` mutations put the old predicates back and require this
  test to fail.
- **Day boundaries.** Rows are inserted at exactly UTC midnight, one millisecond
  before it, and at the first and last instants either side of the 3-day
  window. The test asserts each lands on the right `traffic_daily` day, and
  that the day before the window is not rolled up.

## HD-031 — statement timeout

The pool (`max: 8`) now sets `statement_timeout = 10s`. Every query in the store
is an index lookup or a small aggregate that finishes in milliseconds. A
statement still running after 10 seconds is a bug or a lock pile-up, and
without a cap it would hold one of eight connections for as long as it ran.
`store.db.test.ts` checks `SHOW statement_timeout` through the store's own pool,
and the `pool-statement-timeout` mutation removes the setting.
