# High Desert, 2026-10-15: Search Console setup, and checks moved to the VPS

## What you asked for

1. Confirm `sitemap.xml` lists every show, guest, topic and Tonight page plus
   the Request Line, and that `robots.txt` points to it.
2. A `highdesert-status` line that WARNs if the google-site-verification
   TXT record disappears.
3. A digest reminder in two weeks to check Search Console's Pages report.

Later the same day you asked for two more things:

- Deploy now instead of waiting for 08:30 UTC.
- A standing rule: no GitHub Actions. Checks run on the VPS through `heavy`.

## What I found

- `robots.txt` already had `Sitemap: https://highdesert.space/sitemap.xml`.
- The sitemap already listed every show (1,413), guest (175), topic (70),
  `/topics` and `/request-line`.
- **It listed only the last 14 Tonight days.** The station has a frozen
  program for every day since 2026-09-11, and each of those pages is a 200.
  So 21 real pages were missing from the sitemap.

## What changed

- **Sitemap:** every station day from `FIRST_STATION_DAY` (2026-09-11) to
  today. The list grows by one each day (`tonightSitemapDays`,
  `src/lib/tonight/tonight.ts`).
- **`check:seo`:** fails on a gap in the Tonight days, or if the newest day
  isn't today. Against production it also fetches the oldest day.
- **Status line `search`:**
  - The token is recorded in `deploy/google-site-verification.txt`.
  - The line runs `dig TXT highdesert.space`.
  - OK when the record is there.
  - WARN if it's gone, carries a different token, or DNS can't be read.
- **Digest reminder:** the digests of **2026-11-02 and 2026-11-09** start
  with a line asking you to open Indexing > Pages and paste me a
  screenshot (`REMINDERS` in `scripts/digest.mjs`). It shows on no other
  week.
- Tests and mutations cover all of it, and the mutations go red.

## Deploy and checks (19:26 UTC, at your request)

- `bash scripts/deploy.sh` on 1992a1b ran clean.
- The returning visitor came back fine in Chromium and WebKit.
- `highdesert-status`:
  - `deploy` OK.
  - `search` OK: "google-site-verification TXT record on highdesert.space
    (…lFzS_s), Search Console stays verified".
  - `failures` WARN (3.5% of starts lost in 7 days), the same as before.
- **Live sitemap:** 35 Tonight days, 2026-09-11 to 2026-10-15, with no gap.
- `npm run check:seo -- https://highdesert.space`:
  - 46 pages, 779 internal links and 92 share images checked;
  - no findings;
  - `/tonight/2026-09-11` fetched fine.

## The new standing rule: checks run on the VPS

- **Both CLAUDE.md files** now say: never run, trigger or wait on GitHub
  Actions. Run lint, typecheck, the suite, the mutations, the build,
  `check:csp`, `check:seo` and e2e on the VPS through `heavy`, before
  pushing or deploying. The project CLAUDE.md lists the commands.
- **Both High Desert workflows are manual only** (`workflow_dispatch`).
  - Nothing pushed, opened or scheduled runs them. That includes the
    09:30 UTC nightly mutation run.
  - A test holds the triggers, and two new mutations go red if a push or
    pull request trigger comes back.
  - The commit that made the change (21eb3a9) started no run on GitHub.
- **It was checked on the VPS and redeployed:**
  - the workflow test passed;
  - all 10 workflow mutations went red;
  - 21eb3a9 deployed clean, and `deploy` reads OK.
- **SoGoJet is unchanged.** Its runner is already self-hosted on this box
  and takes the `heavy` slot.

## Needs a decision from you

- **The status `mutations` line will turn WARN around 2026-10-17 02:00
  UTC.**
  - It reads the newest *scheduled* GitHub mutation run, and there won't be
    any more of those. The last one (2026-10-15) had every mutation red.
  - Either it reads a full mutation run on the VPS, or the line is dropped.
  - A full run here means about 630 Vitest runs, at least half an hour of
    the `heavy` slot (it took 25 minutes on GitHub's runners). That's why I didn't put it on a timer without asking you
    first: the box was CPU-capped before.
  - Until you decide, each session runs the mutations its own change
    touches.
- **Disk is 13.2 GB free** (status WARN under 15 GB), down from 16.4 GB this
  afternoon.
  - My build folders and scratchpad are small, so it's probably other
    sessions' output.
  - `disk-sweep --dry-run` lists what can go, and the weekly sweep runs
    Sunday.

## Blocks hit

- **The pipefail hook refused piped commands without `set -o pipefail`.**
  - Two in the setup work (a trailing `| head` and an edit followed by a
    pipe; the refused edit was rerun on its own).
  - One more at the end, while reading the workflow files.
  - Each was rerun with `set -o pipefail;` in front.
- **The safety check flagged an `rm -rf` on a shell variable.** It was
  rerun with the literal scratchpad path.
- **CI failed on 0ca65e9.** `check:seo` fetched `/tonight/2026-09-11`
  against CI's fresh database, which has only the last 14 days, so that
  page was a 404. Fixed in 1992a1b: only the production check fetches the
  oldest day. That was the last time anything waited on GitHub Actions.
- No other hook or permission check blocked anything.
