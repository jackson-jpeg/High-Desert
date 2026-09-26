# Handoff: Live listener fixes and Signal Traffic peaks, deployed (2026-09-26)

**Deployed:** `16a8f49` (PR #29 merged onto #27 and #28), app via `scripts/deploy.sh`,
phone lines via `scripts/deploy-live.sh`, both at 00:11 UTC. `highdesert-status`: every
line OK, including the new `peaks` line.

## What shipped

- **Signal Traffic peaks** (PR #28). Peaks come from the raw samples, never from the
  chart's averaged buckets, so a longer window can no longer read lower than a shorter one
  it contains. Account: `docs/stats-audit.md`, findings 12 and 13.
- **The six Live bugs you hit** (PR #29): change name, the live count, station controls
  (Leave, pause holds, rejoin), line labels, the Studio heading, the placeholder. Plus
  seven findings from a first-time listener walk. Each was reproduced as a failing e2e
  test first. Account: `docs/live-qa.md`.
- **Copy:** the welcome page's live link reads "Or tune in live. The station is on the
  air." A second em dash on the same page ("rare specials, all from...") went too.
  `/root/CLAUDE.md` now has a no em dashes rule for user-facing copy.
- **Service worker update policy under test.** It already did the right thing: install
  calls `skipWaiting()`, activate deletes every other build's cache and calls
  `clients.claim()`, and page loads are network-first. Four tests and four mutations now
  hold it there (`sw-skip-waiting`, `sw-clients-claim`, `sw-activate-purges-old-build`,
  `sw-navigation-network-first`).

## Verified on production

**A returning visitor gets the new build after one reload.** Chromium: a persistent
profile made on the old build (`1455126`), with a name and past calls, was reopened
after the deploy.

| Moment | Controlling worker | Waiting worker |
|---|---|---|
| First load after the deploy | `1455126` | `16a8f49` |
| After one reload | `16a8f49` | none |

That load also showed the new Studio heading. WebKit (the same kind of profile, made on
`1455126`) was already controlled by `16a8f49` on its first load after the deploy, since
the update check, skipWaiting and claim finished inside the page's first three seconds.
It stayed on `16a8f49` after the reload. It logged one page error, "Service Worker context
closed", as the old worker was replaced. Nothing on the page broke.

**Rename as a returning caller.**

| Browser | Save | Header | Next call | After refresh |
|---|---|---|---|---|
| Chromium | 200 | new name | carries it | new name |
| WebKit | 200 | new name | carries it | new name |

**Peaks nest.** `/api/stats/traffic`, online 24h / 7d / 30d = 12 / 19 / 19; listening
= 8 / 8 / 8. `highdesert-status` `peaks` line OK.

**`e2e/live-qa.spec.ts` against https://highdesert.space**, stats writes answered in the
page by the fixture, `--workers=1`:
- desktop: 11 passed;
- mobile: 9 passed, 2 skipped (desktop-only by design);
- the rename test, run alone per project ten minutes apart (the rename limit): desktop
  passed, mobile passed.

The presence test ("join, refresh, resume") now skips itself on production: its
heartbeats are real presence writes, and the sampler would record them into Signal
Traffic's history. It passes on the local one-origin stack and in CI.

The QA calls posted to the public phone lines were hidden afterwards with the admin API
(8 calls). One visible call in that window, "TEST: Wahoo" at 00:37 UTC, was not
from any QA run and was left alone.

## Worth knowing

- **Every browser on one connection is one caller.** The caller id is an HMAC of the
  client address (no cookies, no stored IP). WebKit on the same machine opened as "QA
  Returning Chrome", the name Chromium had just set, and its own rename got **429 "Names
  can change once every 10 minutes."** Your phone and laptop on home Wi-Fi share a name
  and that 10-minute limit. That is the likeliest remaining reason a rename "does
  nothing" for you: before this deploy the refusal was easy to miss, and it now shows
  under the name box.
- On the first load after a deploy, the page still runs the old build while the new
  worker installs. The next load or reload runs the new one. There is no in-page
  "update available" prompt; with skipWaiting and claim it is not needed for correctness.
- Other user-facing em dashes remain elsewhere in the app from before the rule. The rule
  says to fix them when a screen is touched; they were not swept in bulk.

## Left open

Nothing from the mandate.
