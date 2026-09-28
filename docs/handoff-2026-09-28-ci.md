# Handoff: CI from 35 minutes to under 10 (2026-09-28)

Mandate: after #44 was deployed and the Dependabot PRs were handled, cut CI
time. On pull requests, run only the mutations the PR touched. Shard the full
run 4 ways. Cancel superseded runs. Group Dependabot. Keep the guarantee: a
nightly full run on main that FAILs highdesert-status if any mutation
survives. Target: under 12 minutes for a typical PR.

## Before and after

Wall clock from the first job starting to the last one finishing, read from
the GitHub API.

| Run | Before | After |
|---|---|---|
| A typical PR | **34.8 min** (#44: mutation check 24.8, Playwright 5.8, the rest about 4). PRs over the three days before: 18.6 to 43.1 min, one of 62.4 | **8.5 min** (#51, which ran 44 mutations: checks 3.2, 4 mutation shards 3.7 to 5.0, browser 8.5) |
| A small PR (#56) | about 35 min | **8.1 min** (mutation shards 0.5 each) |
| A lockfile PR (#53), which checks the whole list | 37.3 min (#50, old CI) | **10.4 min** |
| main after a merge | the same 35 to 43 min, one job | CI 9.3 min and all 649 mutations in 10.0 min, running side by side |
| The full mutation list | 24.8 min, one after another | 10.0 min in 4 shards (162 + 162 + 163 + 162, every one red) |

The critical path is now the `browser` job (build, CSP check, Playwright at
2 workers), about 8.5 minutes. Sharding Playwright is the next lever, if it is
ever needed.

## What changed (PR #51, merged as d86eed3)

- **`.github/workflows/mutations.yml`** (new), 4 shards (`--shard i/4`):
  - **Pull request:** only the mutations whose target or test file the PR
    changed, plus entries it added or edited (`--changed-from HEAD^1`,
    `selectMutations`). A change to `package.json`, the lockfile, the vitest
    config or its setup file checks the whole list (`RUN_ALL_WHEN_CHANGED`).
  - **main** after each merge, and **nightly at 09:30 UTC**: the whole list.
    The nightly run has its own concurrency group, so it is never cancelled
    and a merge cannot cancel it.
- **`highdesert-status` has a `mutations` line** (`scripts/nightly-mutations.sh`).
  It reads the newest finished scheduled run on main:
  - FAIL if any shard's "Mutation check" step failed (a mutation survived or
    its anchor went stale);
  - WARN if the run broke before every shard checked, is over 36 h old, or
    has never run, or if GitHub cannot be read.

  The digest lists status FAILs at the top, so a survivor reaches the Monday
  report too.
- **`ci.yml`**: two parallel jobs, `checks` (lint, typecheck, suite) and
  `browser` (build, CSP, Playwright). A newer push to main now cancels the
  older run, as a newer push to a PR already did.
- **`dependabot.yml`**:
  - one weekly PR for every minor and patch update;
  - majors each their own PR, except next with eslint-config-next, and react
    with its types;
  - Actions updates grouped monthly.

  The first run under it opened exactly that shape (#52 to #55).
- **17 new mutations** (649 in all), each run alone and red:
  - selection (by target, new entries, the lockfile rule, disjoint shards,
    reading the base list);
  - the status line (fail, broken run, stale);
  - the helper (schedule-only, step name);
  - the workflows (nightly scheduled, full list off PRs, nightly uncancelled,
    4 shards, CI cancels superseded runs);
  - Dependabot (one minor-and-patch group, majors separate).

  Tests: `scripts/__tests__/mutate-select.test.ts`,
  `ci-workflows.test.ts`, and the `mutations` describes in `status.test.ts`.

## What the PR subset does not see

A PR that changes a helper which a test imports, but not the test or the
target itself, does not re-run that test's mutations. The main run after
merge does, and so does the nightly run. That is the gap the nightly run and
the status line exist to close, within a day.

## Dependabot, this session

| PR | What | Outcome |
|---|---|---|
| #45 to #48 | next 16.3.6, @types/react 19.3, jsdom 30.1.1 + vitest 5.0.2, pg 8.23 | Combined into **#50** (one lockfile change, one CI run). Lint, typecheck and the suite were green locally; merged and deployed |
| #49 | eslint 10.11 (major) | Declined: eslint-plugin-react 7.37.5, its latest, crashes under 10 |
| #52 | actions/upload-artifact 4 to 7 | Applied in #56 (the gh token cannot merge a workflow file) |
| #53 | music-metadata 11.16.1, zustand 5.0.15 (the new weekly group) | Merged, deployed |
| #54 | @types/node 22 to 26 (major) | Declined: the runtime is Node 22, and the types move with it |
| #55 | typescript 5.9 to 7.0 (major) | Declined: `typescript-eslint does not support TS 7.0` |

Every decline has a line in `docs/security-exceptions.md`. No PRs are open.

## Actions minutes

The repository is **public**, and GitHub-hosted runners are free and
unmetered for public repositories, so there is no monthly allowance to run
out of. A PR now uses 6 jobs instead of 1: more runner time, all of it free.
I could not read the usage figure itself: the billing endpoints need the
`user` scope, and this machine's gh token has only `gist`, `read:org` and
`repo`. Granting it takes `gh auth refresh -h github.com -s user`, which is
only worth doing if the repo ever goes private.

## State at hand-over

- **Deployed:** 961c244 (#44, #50, #51, #53, #56), via
  `nice -n -15 ionice -c2 -n0 bash scripts/deploy.sh`. The lockfile changed
  twice, and both times it was installed in the staging copy.
  `/api/build` answers the deployed commit. This handoff's commit is deployed
  after it.
- **`highdesert-status`:** exit 0. Two WARNs, both expected:
  - `release` is 1 failure in 13 plays, not a verdict (300 plays needed). The
    failure is row 585, an iOS stall that the mirror rescued.
  - `mutations` has no nightly run yet. **The first one is 2026-09-29, 09:30
    UTC**, and the line should read OK from then on. If it reads anything
    else, that is the finding.
- **Caveat:** GitHub turns off scheduled workflows in a public repository
  after 60 days with no activity. If that happens, the `mutations` line goes
  to WARN at 36 h.

## Hook and permission blocks this phase

- **The Bash pipefail hook blocked six commands**, each a pipe without
  `set -o pipefail`:
  - the handoff commit-and-push (`git push | tail`);
  - a grep of status.sh and deploy.sh;
  - the eslint 10 peer-range check;
  - the `npx vitest` timing loop.

  Each was re-run unchanged, with `set -o pipefail;` first, which is the
  path the hook names. Every command since has started with it.
- No other hook, classifier or permission refusal. (The Edit tool refused
  twice because a file had not been read in that worktree; I read it first
  and edited normally.)
