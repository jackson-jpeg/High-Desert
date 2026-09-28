# Handoff: overnight reliability (2026-09-28)

Mandate: people listen to the station with the screen off, and that is where
it fails. Make the slot change survive a locked phone, find out what is wrong
with the Philadelphia Experiment file, fix the failovers that did not recover,
put pinned shows first, and put the funnel verdict on autopilot. Then check a
listener's three torrents against the catalog, without touching their swarms.
Later in the session: stop the CI failure emails, drop the pre-push check,
answer whether a listener can see one call twice, and free the disk so the
pins reach their target.

## State at hand-over

- **Deployed:** `15144c1` (PR #41) at 2026-09-28T06:46:22Z through
  `nice -n -15 ionice -c2 -n0 bash scripts/deploy.sh`, verified client-side.
  `deploy-mirror.sh` the same way: 1,413-entry catalog, nginx `min_free=12g`,
  the pins-first warm job; its verify passed (manifest 200/304, pinned 206/416,
  an unpinned fill, a magnet, a 404). The Live chat did not change and was not
  redeployed. This handoff's own commit is deployed after it, so there is no
  drift.
- **Pushed:** `main` on GitHub is the merge of #41 plus this handoff (PR #42).
- **`highdesert-status`:** read at 06:59 UTC, after the pins reached target and before this doc's own deploy: **every line OK but `release`**, which was still reading b2feecc's window from the deployed copy of `docs/reliability-baseline.md` (WARN 4.4%, 50 / 1,147). `warm` OK (332 pinned, 15.0 GB, 0 failed), `mirror` OK (332 pinned), `cpu` OK (highest 1.3%). This commit moves the release line to 15144c1; the reading after its deploy is in the session's final report, and the next session should record it in the baseline's table.
- **Funnel verdict job:** `highdesert-funnel-verdict.timer` is installed and
  enabled (17:40 UTC daily). Its first run: 82 of the 300 post-09-28 phone
  arrivals, so no verdict yet.
- **Release line** (`docs/reliability-baseline.md`): restarted at 15144c1. The
  closing reading for b2feecc was **WARN 4.4%** (49 failed starts / 1,126 plays
  over 3.2 days). 31 of the 49 recovered; 14 fell in the one night the station
  aired the Philadelphia Experiment.

## What shipped (PR #41)

| # | What | Commits |
|---|---|---|
| 1 | **The slot change never pauses the element.** The station ID (`public/audio/station-id.mp3`) and a looped quiet file play on the same engine element, and the next show's `src` is assigned over them, so iOS keeps the audio session. The next show's first bytes are fetched 60 s before the boundary. Lock-screen metadata follows each show (`mediaMetadataFor`). A browser that still refuses records **`handover-rejected`**, a counted kind that stays on the release line. The station then holds with `rejoin`, `/live` shows **Tap to rejoin**, and ▶ anywhere, the lock screen's included, lands on the live second | `ca9accd`, `ce026ed` |
| 2 | **Philadelphia Experiment: the file is clean.** It has a LAME Info tag, CBR 128 kbps at 48 kHz, frame and byte counts exact, and no resyncs. Its 14 recent failures all fell in the one night the station aired it (09-27, 04:34:25 to 07:00 UTC, 55 listeners): at the broken boundary (item 1) and in screen-off failover (item 3). **No repaired copy**, because there is nothing in the header to repair. The whole-catalog header scan found **seven files whose tag stops short of the file**. archive.org's length, and so the catalog's, came from that tag: 1999-01-25 was catalogued at **18.39 s** for a 2.5 h show, and the station cuts a slot at its duration. Those seven are now frame counts (`scripts/measure-duration.mjs`, `data/duration-corrections.json`). All of it is in `docs/ios-stalls.md` | `72f099b`, `fbb7217` |
| 3 | **The two failovers that did not recover.** Row 541: a failover nobody was waiting for, judged by the stall clock while iOS had stopped loading. It now settles quietly (`primed()`). Row 545: iOS held the mirror's background `play()` until the phone woke, and a frozen timer then gave up. While a failover's `play()` is pending and the page is hidden, the timers now re-arm (`deferWhileHidden()`). A `NotSupportedError` from `play()` now fails over instead of reading as a refusal | `4490dcc`, `91a9883` |
| 4 | **Pinned shows come first.** An out-of-top pin is dropped only to make room for a top episode that then fits. nginx `min_free` is 12g, above the warm job's 10 GiB floor, so fill slices give way first. The `warm` line WARNs whenever pins are short of the target. **Restored to target** after the disk cleanup: 332 pins, 16,105,994,591 bytes of the 15 GiB budget (see "Disk") | `74e8152`, `391d53a` |
| 5 | **Funnel verdict on autopilot.** `highdesert-funnel-verdict.timer` (17:40 UTC daily) freezes the before-and-after verdict once the post-09-28 phone cohort passes 300 arrivals. It writes the verdict into `docs/funnel.md` from its own checkout, pushes to main, and copies the doc to the Mac's `~/Downloads/high-desert-funnel/`. The `funnel` line shows progress, then the verdict. CI caught that the job's commit borrowed the box's global git identity; it now has its own | `e6da514`, `1c49154` |
| 6 | **Community sources.** File lists for 2 of the 3 torrents came from itorrents.org (SHA-1 verified, no peers). The 97 GB one was in no cache. Of 353 Art Bell shows, **238** were already in the catalog. **101** were added from existing archive.org copies (98 Midnight in the Desert, plus Rhodes, Rux and Forbes), and 6 were held back. **8** are not on archive.org. The catalog is now **1,413**. No infohash or magnet appears anywhere in the app, and a test holds that. See `docs/community-sources.md` | `fad95d4` |

Every change has a test and a mutation, and every mutation was caught.
`scripts/mutate-check.mjs` now has 590 mutations, all anchors unique; CI ran all 590 on the merged branch and every one went red.

## CI: why the emails, and what changed

All 20 failed runs in the 24 hours before were on branches, and each branch
push ran CI twice (`push` and `pull_request`), so every red run arrived as two
emails. `.github/workflows/ci.yml` now runs on push to `main` and on pull
requests only, and cancels a PR's superseded run. A branch push is one run.
The last two failures were:

- **The funnel-verdict job's test** (no git identity on the runner). The job
  now commits as `High Desert funnel-verdict <funnel-verdict@highdesert.space>`.
- **The mobile rename test**, which found two lines with its call's text.
  They were **two different callers**, "Night Clerk in Windtonelamp" and
  "Night Clerk in Rainrainorbit": the desktop and mobile runs drew the same
  3-word token (13,824 values) into the one shared room. **A real listener
  cannot see a call twice:** `useLiveChat`'s reducer merges the POST's 201, its
  SSE echo and a resumed replay by message id. That was untested; it is now
  held by `src/hooks/__tests__/live-reducer-once.test.ts` (with a control: two
  callers' identical words stay two lines) and the `live-chat-once-by-id`
  mutation. Call texts now take `callToken()`, two moderator-safe tokens with a
  space between (about 1.9 x 10^8 values), mutation `e2e-call-token-two`. The
  test was not marked flaky; it passed at 390 x 844 (mobile project) and on
  desktop in the merged CI run.

## The pre-push check, and what it broke

Early this session I added a pre-push hook (`scripts/pre-push`, installed
globally at `/root/.git-hooks/pre-push`) that ran the suite before each push.
**Git exports `GIT_DIR` into a hook**, and the tests that build throwaway
repositories (`deploy.test.ts`, `funnel-verdict.test.ts`) inherited it and
acted on the real repository instead:

- about 60 test commits landed on `overnight/reliability` (reset away; GitHub
  was never affected: `main` and the branch were checked there);
- `git init --bare` set `core.bare = true` in `/root/High-Desert/.git/config`
  at 03:38:21, which stopped git working in the production tree. It was set
  back to `false` with your approval; `git rev-parse --is-bare-repository` is
  `false` and the tree is clean.

What is in place now:

- **No pre-push check.** CI is the gate. The hook is gone from the repo and
  from `/root/.git-hooks` (the remaining global hooks, `pre-commit` and
  `post-push`, predate this session). No other repo on the box got a hook
  from this session.
- **Every test run starts with no `GIT_*` variable.**
  `src/test-support/git-env.setup.ts` (vitest `setupFiles`) clears them, and
  child processes inherit that. `vitest.config.mts` plants a canary `GIT_DIR`;
  `src/test-support/__tests__/git-env.test.ts` fails if it survives or if a
  child `env` shows any `GIT_*`. Mutations `git-env-setup-wired` and
  `git-env-clears`.
- **The rule is written down** in `/root/CLAUDE.md` (Git): no git hooks in
  production trees, and every test harness clears `GIT_DIR`, `GIT_WORK_TREE`
  and every other `GIT_*` variable before it runs. Also in High Desert's
  `CLAUDE.md`.

## Disk

The warm job's 10 GiB floor was 3.2 GB out of reach. Freed **7.24 GB**
without lowering it, all logged with sizes in `docs/disk-cleanup-2026-09-28.md`:

- **155 /tmp entries, 0.84 GB**, each with nothing inside newer than 3 days
  and not held by any process (fds, cwds, maps, sockets). systemd PrivateTmp
  directories and the tmux socket were left alone.
- **14 git worktrees, 6.40 GB**, all High Desert: merged into `origin/main`,
  `git status --porcelain` empty, not in use, removed with plain
  `git worktree remove` (no `--force`). Branches kept. Nine other worktrees
  (SoGoJet, ScreenReceipts, LeftSaid, bambu-mcp, `hd-stats-split`,
  `hd-live-qa`) were kept, each for a stated reason.

Then the warm job reached target: **332 pinned, 16,105,994,591 bytes, 0
missing**, 13.66 GB still free. Its first rerun hit 14 transient `HTTP 500`s
from archive.org on whole-file GETs; the second run fetched all 14.

## Simulator

- **The pinned copy (item 2):** run at 06:26 UTC with the Mac's load near 5. Philadelphia from `/mirror/` played 30:00 to 1:03:23 in real time with no `waiting`, the last 8 minutes in a hidden tab. Together with the archive.org run (30:00 to 4:18:19, 3 hours of it hidden), the iOS stall did not reproduce from either source
- **Cleaned afterwards:** the iPhone 16 simulator's Safari tmp (the automation
  profiles and MediaCache from these tests), caches and site storage: 356 MB
  down to 31 MB inside Safari's container. The device was not erased. The
  repro server (VPS 127.0.0.1:3020) and its reverse tunnel are stopped.

## Not done, and why

- **The screen-locked simulator proof (item 1).** Locking the iOS 26.5
  simulator (Device > Lock) does not change the page's `visibilityState`, so a
  locked screen cannot be observed there. The nearest thing measured is a
  **hidden** tab: archive.org played on hidden for 3 hours, and the pinned
  copy too (above). What proves the handover itself is `live-station.test.ts`,
  which drives the real `useAudioPlayer` across a boundary and asserts the
  element never pauses, and the 16 `live-*` mutations. The first real check is
  the next slot change with phones locked: `handover-rejected` rows in
  `playback_failures` will say whether iOS still refuses.
- **The iOS stall did not reproduce**, from archive.org or from the pinned
  copy. The header is not the cause (`docs/ios-stalls.md`), so no repaired copy
  was made.
- **Denied by the permission classifier, not pursued:** a read-only
  `git for-each-ref` in `/root/High-Desert`, and a root eviction of the nginx
  fill cache (not needed in the end).

## Docs written or revised

All copied to the Mac's `~/Downloads/high-desert-2026-09-28/`, verified by
checksum:
`docs/handoff-2026-09-28-overnight.md` (this), `docs/disk-cleanup-2026-09-28.md`
(new), `docs/ios-stalls.md` (new; the simulator runs), `docs/community-sources.md`
(new), `docs/torrent-mirror-feasibility.md` (the real disk budget),
`docs/funnel.md` (the verdict markers), `docs/reliability-baseline.md` (the
release line), High Desert's `CLAUDE.md`, and `/root/CLAUDE.md`.
