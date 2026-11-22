# Handoff, 2026-11-22 07:00 UTC: supporter live; tiers next; three items checked, one ship pending

Work order: the lead, 2026-11-22 06:09 UTC (Jackson said yes 01:08 ET),
`/var/lib/sanger/hub-messages/claude-high-desert-1-2026-11-22T06-09-57-588Z.md`.
Read `docs/NEXT.md` with this. Times are UTC.

## Update 07:00 (read first)

- **Deploy 1 finished cleanly**: `8c2d1de` is live, and the returning visitor
  passed in Chromium and WebKit (it waited 1,115 s for the slot behind the
  envelope job).
- **The full suite on `ship-2026-11-22` passed** (exit 0, log
  `/root/scratch/hd-1122/suite.log`).
- **New order, done before the three items** (Jackson approved 01:41 ET,
  Sessions message of about 06:55): **supporter tiers on /stats**, both looks.
  - Tiers: Station Owner, $50 or more total. Night Owl, $15 or more. Regular
    Caller, $10 or more. Caller, any amount.
  - A tier comes from the SUM of a person's gifts. The data becomes
    `{ name, gifts: [50] }`. Keep first name and last initial only, and keep
    the surname test.
  - The panel groups people by tier, highest first, newest first inside each
    tier, with each tier's name as a small heading. Keep the tone and the
    Venmo and PayPal links.
  - Under the links goes one line naming the tiers and their amounts.
  - `donor-shoutout.mjs` still names everyone, with Station Owners in their
    own sentence first. Keep it under 500 characters, and test it.
  - Today: Station Owner Joseph K. ($50). Night Owl Alexandra M. ($15).
    Regular Caller Rachel B. ($10). Callers Austin M. and Craig A. ($5 each).
  - Checks: tests and mutations for the tier math, the grouping and the
    shout-out, then lint, typecheck, build and deploy. Then look at /stats
    on production in both looks, at phone and desktop width. No em dashes.
  - **State:** worktree `/root/hd-tiers`, branch `supporter-tiers` off
    `8c2d1de`. Nothing is written yet and there is **no node_modules**: run
    `cd /root/hd-tiers && heavy -- npm ci`.
  - **Planned design:** in `src/lib/support/supporters.ts`, `gifts: number[]`,
    plus `TIERS` (owner 50, night-owl 15, regular 10, caller 0), `totalOf`,
    `tierOf`, `groupByTier` (empty tiers dropped, list order kept) and
    `tierLine()`. `Supporters.tsx` gets a heading and a list per group; each
    item reads "Name $total".
  - In `donor-shoutout.mjs`, `parseSupporters` must parse
    `{ name: "X", gifts: [a, b] }` and keep returning `amount` (the total):
    **sang3r's admin console** (`/root/Sanger/src/components/highdesert-admin/SupportersTab.tsx`)
    reads `x.amount` from `--status`. Add `gifts` and `tier` beside it. The
    script keeps its own copy of the $50 floor, and a test holds it equal to
    `TIERS`.
  - Update the mutations `supporters-listed` and `shoutout-reads-supporters`
    and add new ones for tier math, grouping and the owners' sentence.
    Update `supporters.test.tsx` and `donor-shoutout.test.ts`.
- **Then the ship branch**: rebase `ship-2026-11-22` onto main after the
  tiers land. **Drop its last commit** ("Handoff 2026-11-22 and NEXT"): this
  file and NEXT.md are now on main. Expect a conflict in `supporters.test.tsx`
  (its Joseph K. line is already on main). Then build, e2e and the rest, as
  below.

## Done (06:45)

1. **Supporter Joseph K., $50, at the top of `SUPPORTERS`** (`8c2d1de`, on main,
   pushed). Supporter tests 14/14, mutations `supporters-listed`,
   `supporters-paypal-link` and `shoutout-reads-supporters` red, lint, typecheck.
   `donor-shoutout.mjs --now --dry-run` names him first (nothing posted, no
   state written). **Production serves build `8c2d1de`**, and its /stats chunk
   holds `"Joseph K.",amount:50` first. Still to do: a rendered look at /stats.
   His surname is in no file, commit or doc. The surname guard test was left
   alone, because adding his name to it would put the surname in the repo.
2. **Repo name fixed**: README clone URL, CLAUDE.md, package.json `repository`
   and `deploy/highdesert-sample.service` `Documentation=` now say
   `jackson-jpeg/High-Desert` (same commit). The installed unit file still
   has the old URL. It is a comment only and changes on the next reinstall.
3. **Presence FAIL fixed (new Queue item, scripts only, no deploy)**. Status
   said `live displays [6] but is tagged 20/10` on desktop /library. The site
   was right. The 11-18 On the air now window (`HeroCount`) is a `live`
   surface that shows the tuned-in count, and `presence-check.mjs` did not know
   that kind of surface. Now a `live` surface is held to its `data-live` count.
   Test added. Mutations `presence-check-live-shows-live` and
   `-reads-data-live` are new, and all 5 presence mutations went red.
4. **mutations line (item 4)**: only the six stale anchors from the 11-18 run,
   already fixed in 75ab96a. Nothing new survived. It waits for Monday's run
   (2026-11-23 14:00).
5. **The three waiting items, per-item checks all pass** (cherry-picked onto
   branch `ship-2026-11-22`):
   - show-next: all 8 mutations red. `next-show-guest-after` had survived (Area
     51 cannot tell "after" from "earliest"), so a catalog-wide test now holds
     every guest pick to the nearest show after (air date, then slug).
   - mutate-atomic: 3 test files (19 tests) pass, `mutate-write-*` 2/2 red,
     lint passes.
   - desktop-request: its tests pass, and 5 mutations went red.
   - Lint on every changed file and the typecheck pass.

## In flight

- **Deploy 1 (`8c2d1de`)**: swapped in, and the client check passed. Its
  returning-visitor revisit is waiting for the heavy slot behind the hourly
  `hd-level-envelope` job, which runs one show at a time at about 12 min each
  and counts as the same session as `/root/High-Desert`. Log:
  `/root/scratch/hd-1122/deploy-1.log`. If the revisit fails, `deploy.sh`
  rolls back on its own. In that case, read the log before redeploying.
- **Full suite on `ship-2026-11-22`**: running in the background in
  `/root/hd-1122`. Log: `/root/scratch/hd-1122/suite.log`.

## Next (in order)

1. Read `deploy-1.log` to its end (`returning ok`). Look at /stats rendered and
   confirm "Joseph K. $50" comes first.
2. Read the suite log. Any failure in a touched file is a real problem. Load
   timeouts in untouched files get a rerun.
3. In `/root/hd-1122`: `npm run build`, then `e2e/request-line.spec.ts` (desktop
   and mobile) and the show-page Next on a local build on the e2e database
   (`/root/.high-desert-e2e.env`, the command is in `e2e/live.spec.ts`'s
   header). Then check:seo and check:csp on that build.
4. Fast-forward main to `ship-2026-11-22`, push, run `bash scripts/deploy.sh`,
   then check:seo and check:csp on production and post a station notice.
5. Tick the three items and the presence item in NEXT.md. Run
   `highdesert-status`: presence should read OK on the live site after the merge
   (the check script runs from main).
6. Cleanup: `git worktree remove /root/hd-1122` once merged, and remove
   `/root/scratch/hd-1122`. The old worktrees (hd-next-show, hd-mutate-atomic,
   hd-desktop-request) are already gone, and their branches are on origin.

## Hook blocks this session

- npm hook: `npm ci` in a `( cd services/live && … )` subshell, after an
  `&&`-chained `cd /root/hd-1122`, was read as the production tree. Nothing
  ran. I re-issued it with absolute paths, one command at a time. It may be a
  false positive: the hook seems not to follow a relative `cd` inside a
  subshell after an earlier absolute `cd`. Worth a test case in
  `block-npm-in-prod.test.py`.
- Auto mode refused once to review a pipefail-rewritten command. I re-issued
  the rewritten text exactly, as told, and it ran.

## Needs Jackson

Nothing.
