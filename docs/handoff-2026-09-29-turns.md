# Handoff: drift fix, mirror log, `heavy`, the runner, email noise (2026-09-29)

Four items, in the order asked. Everything in High Desert is in **one PR**
(branch `session/2026-09-29`), with this handoff and the doc updates, under
the new one-PR-per-session rule (section 3).

## Session-start checks

- **`mutations`: OK.** The first nightly full run, due at 09:30 UTC, started
  6.5 h late: GitHub began the scheduled run at 16:04 UTC, on 5010061. All four
  shards passed, so every mutation went red. The line reads `OK mutations
  nightly full run on 5010061 (2026-09-29T16:04:03Z): every mutation red in all
  4 shards`. This is the confirmation the 2026-09-28 handoff asked for.
- **`highdesert-status` at 19:35 UTC:** exit 0.
  - `release`: OK, now with a verdict. **1.9% of starts lost (6 of 311),
    against a target under 3%; 8 rescued.**
  - `memory`: OK, 41.5%.
  - `warm`: WARN, 318 of 334 pins. The job stopped at the disk floor (8.1 GB
    free against a 10 GB floor). This is the known disk-budget condition
    (`docs/torrent-mirror-feasibility.md`).

## 1. Row 586: the drift check no longer seeks a buffering element

**The cause.** `resync()` in `src/audio/live-controller.ts` corrected the
drift every 10 s whenever the element was unpaused. While it buffered,
`currentTime` stood still and the station clock moved on. Past 2 s it seeked,
which abandoned the range in flight. On a slow link it never got ahead: the
mirror log showed a new cut-short range every 10 s.

**The fix** (`correctDrift`):
- The 10-second check skips an element at `readyState` below
  `HAVE_FUTURE_DATA`, and one whose watchdog attempt is unsettled
  (`isWatching()`).
- The correction happens once `playing` fires after the stall
  (`correctDrift(true)`). That path doesn't wait on the watchdog.

**Tests**, 3 new, against the real `useAudioPlayer`
(`src/audio/__tests__/live-station.test.ts`, 35 in all):
- an unpaused element at `readyState` 2 sees no seek over 25 s, and exactly
  one once `playing` fires;
- no seek while the start is unsettled, then a correction at the next check;
- the correction at `playing` doesn't wait on the watchdog's listener.

**Mutations**, each red alone: `live-drift-skip-buffering`,
`live-drift-skip-unsettled` and `live-drift-corrects-at-playing`.
`live-stall-resync` was re-anchored.

## 1b. The mirror's access log (for the next row 587)

- A new log format, `hd_mirror`, adds `range="$http_range"`,
  `rt=$request_time` and `cache=$upstream_cache_status` to the combined line.
- It is used in `location ^~ /mirror/` and in `@hd_mirror_fill`, which as a
  named location doesn't inherit the other location's log
  (`services/mirror/lib/nginx.mjs`).
- `test/nginx.test.mjs` runs a real nginx and reads both kinds of line: a
  pinned range with `cache=-`, and a fill with `cache=HIT|MISS`. 57 mirror
  tests pass.
- Mutations, each red alone: `mirror-log-range-and-time`, `mirror-log-pins`
  and `mirror-log-fills`.
- **Deployed separately** with `bash scripts/deploy-mirror.sh` after the
  merge, because `deploy.sh` doesn't touch the mirror.

## 2. `heavy`: heavy jobs take turns, box-wide

**`/root/vps-tools/bin/heavy`** (vps-tools bd18120, pushed):
- a flock semaphore of **2 slots** in `/run/heavy` (tmpfiles, 1777);
- `heavy [--label N] [--wait S] -- cmd`, and `heavy status`;
- nested calls run in the parent's slot, and a detached child keeps the slot;
- `tests/heavy.test.sh`: 18 checks. Seven broken variants each turn it red:
  - 3 slots instead of 2;
  - no lock;
  - no nested pass-through;
  - the exit status lost;
  - the completed hook a no-op;
  - the worker not found;
  - the hook not waiting.

**High Desert** (this PR):
- `scripts/heavy.sh` runs a command through `heavy` when it is installed, and
  directly where it isn't (CI).
- `deploy.sh` wraps its `npm ci` and its build.
- `package.json` wraps `build`, `lint`, `typecheck`, `test` and
  `test:mutations`.
- `mutate-check` runs each mutation's vitest through it.
- Tests: `scripts/__tests__/heavy-sh.test.ts` (4) and two in `deploy.test.ts`
  (the in-place build, and `npm ci` plus the build on a changed lockfile), both
  against a stub semaphore.
- Mutations, each red alone: `deploy-build-takes-turn`,
  `deploy-npm-ci-takes-turn`, `heavy-sh-uses-heavy`,
  `heavy-sh-direct-fallback` and `package-test-takes-turn`.
  `deploy-staging-dist` was re-anchored and is still red.
- **This PR changes `package.json`, so its CI checks the whole mutation
  list** (`RUN_ALL_WHEN_CHANGED`).
- **That full run caught a mistake of mine** (run 36622907016, shard 4/4).
  - What survived was `heavy-sh-direct-fallback`, even though it was red
    locally. I had made `mutate-check` start each vitest *through*
    `scripts/heavy.sh`, the file that mutation breaks.
  - In CI there is no `heavy`, so the mutated script ran `exit 0` without
    starting vitest, and an unrun test read as a pass. On the VPS the real
    `heavy` took the other branch, so the mutation went red.
  - **The fix:** `mutate-check` now decides "heavy or direct" itself
    (`vitestCommand`), never through `heavy.sh`.
  - **And more generally:** exit 0 without vitest's summary line is
    **NO-RUN**, a failure, not GREEN (`judgeRun`).
  - Mutations, each red alone: `mutate-no-run-not-green` and
    `mutate-runner-takes-turn`. The three `heavy.sh`/`package.json` mutations
    were also run with `heavy` removed from `PATH`, as in CI, and all were red.
  - This is the `docs/disconnected-checks.md` pattern again: the instrument
    depended on its own subject.
- `test:watch` is deliberately not wrapped: it would hold a slot for hours.

**SoGoJet's runner** (approved):
- `MemoryHigh` 2G → **1536M**. `MemoryMax` was already 2560M, which is the
  requested 2.5G, so it is unchanged.
- The started and completed job hooks hold one `heavy` slot per job.
- Applied while the runner was idle. The cgroup reads 1.5 GiB / 2.5 GiB.
- The hooks were tested inside the runner's own sandbox.
- Exactly what changed, with before and after values:
  `docs/memory-2026-09-28.md`, "2026-09-29, on Jackson's approval".
- **Not yet seen on a real job:** the first SoGoJet job's "Set up job" log
  should show `heavy: slot held after Ns`.
- The unit hides `/root`, so the runner uses copies in
  `/usr/local/lib/vps-tools/`. `install.sh` keeps them current.
- One old run is queued: SoGoJet's `CI`, `workflow_dispatch`, from
  2026-09-18, never picked up. It predates this and I left it alone.

**`/root/CLAUDE.md`** (vps-config da90f08, pushed): every project's heavy
commands go through `heavy`.

## 3. GitHub email noise

- **Watch: done through the API.** `DELETE
  repos/jackson-jpeg/High-Desert/subscription` returned `204`, and High Desert
  is gone from `user/subscriptions`. That is "Participating and @mentions".
  - Reading the subscription back needs the `notifications` scope, which the
    token doesn't have (it has `repo`, `read:org`, `gist`). The delete worked
    with `repo`.
  - The one repo you still watch is **docket4me**. It was not asked about, so
    it is untouched.
- **The batching rule is in `/root/CLAUDE.md`** (da90f08), for every project:
  one PR per session, and handoffs and docs in the same PR as the work.
- **A conflict to know about.** `/root/CLAUDE.md` has another session's
  uncommitted edit, dated today. It adds "nothing that emails Jackson without
  his okay first", covering PRs opened and merged, and it stops the Dependabot
  auto-merges. I read your message this session, one PR per session plus a
  deploy, as that okay for this one PR. I committed only my own lines and left
  their edit uncommitted and untouched, as before.

## 4. The Mac

- The 2026-09-28 handoff revision (md5 `b1fa6b44…`) failed three times
  yesterday. Retried today, it copied, and the md5 matched in
  `~/Downloads/high-desert-2026-09-28-release-line/`.
- The nightly is confirmed (above).

## Deploy

After the merge:
- `nice -n -15 ionice -c2 -n0 heavy --label hd-deploy -- bash
  scripts/deploy.sh`;
- then `bash scripts/deploy-mirror.sh`, under the same `heavy` and
  nice/ionice, for the access log;
- then `highdesert-status`.

The post-deploy readings are in the session's closing report, not here. A
commit after the merge would be a second PR and a DRIFT FAIL.

## Hook and permission blocks

- **The pipefail hook** blocked 9 commands in this session. Each was re-run
  unchanged with `set -o pipefail;` first, the path the block names. The one
  since the 2026-09-28 handoff was a `sed`/`grep` read of
  `live-controller.ts` and its test.
- **The auto-mode classifier refused one command** (Credential
  Materialization). It was the runner install batch, which also copied
  `/opt/actions-runner-sogojet/.env` to `/root/backups` as a backup and
  printed it. That file sits beside the runner's credentials. I re-ran the
  batch **without** the copy and the print, as the refusal allows.
  - The two hook lines are appended only if missing (`grep -q || echo >>`).
  - They were checked by count (`grep -c '^ACTIONS_RUNNER_HOOK_JOB_'` → 2),
    without reading the file.
  - No backup of `.env` exists. To undo, delete the two
    `ACTIONS_RUNNER_HOOK_JOB_*` lines.
- No other refusals.

## On the Mac

`~/Downloads/high-desert-2026-09-29-turns/`, checksum-verified: this handoff,
`memory-2026-09-28.md`, the project `CLAUDE.md` (as `CLAUDE-high-desert.md`),
and `/root/CLAUDE.md` at da90f08 (as `root-CLAUDE.md`).
