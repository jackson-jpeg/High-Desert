# High Desert, 2026-10-14: the owed incident items, and the Request Line

One PR, as asked. Read `docs/incident-2026-10-13/handoff.md` first; this
closes its "Still owed" list.

## Before anything: the pending deploy

The nightly-fix deploy left in the incident handoff ran at **00:50:45 UTC**
(`bash scripts/deploy.sh`, ccab204). `highdesert-status` read `deploy OK, live
= HEAD = ccab204` afterwards.

The same status run showed `mutations FAIL` on c8e07f0. That is the nightly
run from **before** the fix (738b144). The 09:30 UTC nightly is the first one
on the fix; see "Deploy" below for what it read.

## 1. The three owed items

- **Nothing spins forever.**
  - Every screen that waits on IndexedDB now uses `useTimedLiveQuery`:
    the Library list, Stats, the status bar's count and Mel's Hole.
  - Past 10 s the screen says it is taking too long, names the likely cause
    (another tab or the installed app holding the database) and offers Retry.
  - Retry reads again. A late answer clears the error by itself.
- **The returning visitor** (`scripts/returning-visitor.mjs`):
  - It keeps a real browser profile on disk, in Chromium and in WebKit.
  - The profile is primed by the build still serving (library in IndexedDB,
    that build's service worker in control), then revisited.
  - `deploy.sh` primes before the swap and revisits after the restart.
    A failed revisit rolls back.
  - `highdesert-status` has a new `returning` line: it checks the live site
    and reports the last deploy's revisit.
  - The control (`--hold`, a second tab holding the database) **failed on
    today's production build, as it had to.** That is the 2026-10-13 hang,
    reproduced in a real browser on demand. On this release the same hold
    shows the error with Retry instead of gray rows.
- **Another tab holds a write transaction, and Retry recovers.** Three tests:
  - a unit test with a second raw IndexedDB connection keeping a readwrite
    open;
  - the same for Stats;
  - `e2e/db-hold.spec.ts`, with a real second tab.

  Each has a control where nothing is held. The e2e passed on desktop and
  phone against a local build of the branch.

## 2. The Request Line

Full account: `docs/request-line.md`. In short:

- **What listeners can do:**
  - **Request it** on every show page and in the Library's episode panel
    (both looks). One pick per listener per Pacific day. Requesting a show
    already up counts as a vote for it.
  - **Vote** on `/request-line` with one tap: one vote per listener per show,
    and at most 10 counted per address per show.
  - **Admin Veto** on the same page, or `POST /live-api/admin/request-veto`.
- **What can't be nominated:** shows the station played in the last 30 days,
  known-broken files, and anything outside the catalog. Notes go through the
  phone lines' word filter.
- **The lock:** voting closes at **6 PM Pacific**, when the winner is locked
  by one SQL function, `live_request_night()`. Ties go to the earliest pick.
  Votes cast after 6 PM never count.
- **The schedule:**
  - Every new day ends a show by 10 PM and marks the show on the hour.
  - The winner airs at **10 PM**. The rest of the night moves after it and is
    cut at midnight.
  - Nobody nominated: the day plays exactly as frozen, a fan favorite at 10.
  - Today's day was frozen before this release. The request still applies to
    it: the show running at 10 PM is cut there.
- **When the pick airs,** the phone lines post one From the station card:
  "Tonight's request, from <name>, calling from <place>."
- **Where it shows:**
  - Live: under the phone strip and in the desktop console, both looks.
  - Tonight's log: "Requested by ...".
  - `/tonight`.
  - `/request-line`: server-rendered, in the sitemap, with its own share card
    ("Vote for my pick on High Desert"), checked by `check:seo` and
    `check:csp`.

### Things to know

- **A pick over two hours runs to midnight**, and the show that held 10 PM
  doesn't air that night. That is the shift, by design.
- **`/tonight` caches for up to an hour**, so after 6 PM the locked pick can
  take that long to appear there. Live and the station have it at once.
- **The chat service now polls the app's schedule every 30 s** for the
  herald, in addition to the archive voice's poll. Both are loopback and
  trivial.
- **Admin veto uses the existing admin sign-in.** There is no new credential.

## Tests and checks (all on the branch, before merge)

- **Unit and DB suite:** 2,828 tests, all passing.
  - `npm run lint` and `npm run typecheck` are clean.
  - The chat service's 16 files (303 tests) are included, against the test
    database.
- **Mutations:** 18 new `request-*` mutations and the 8 Phase A ones all go
  red.
  - The PR's first Mutations run found five old anchors STALE: the code
    they named had moved (`live-midnight-cut`, `live-station-id-gap`,
    `live-schedule-reads-overrides`, `live-station-notice-event`,
    `status-bar-episode-count-label`). They were re-anchored with the same
    intent, and all five go red locally.
  - One survived at first. A second pick a day was also refused by the
    database's unique index, so the test could not tell the friendly check
    from the race fallback.
  - The test now holds the friendly wording, and the mutation goes red.
- **E2E against a local build** (e2e database, the chat behind one origin):
  `db-hold.spec.ts` and `request-line.spec.ts`, 11 passed and 1 skipped (by
  design), on desktop and phone.
  - `request-line.spec.ts` skips itself on anything but loopback, because it
    writes real nominations.
  - Screenshots are in this folder.

## Timing

- **You asked for about 4:30 AM Eastern,** so the deploy is set for
  **08:30 UTC** (04:30 EDT).
- **The play data's quietest hour is actually 14 UTC** (7 AM Pacific).
  4:30 Eastern is 1:30 AM Pacific, still in the late-night tail. It is a
  quiet time, but not the quietest.

## Deploy

- **Merged:** PR #78, as 563fd00, after CI and Mutations both passed on
  29818b3. Main is bc0e8fc (this handoff's first commit on main).
- **Site, 08:31 to 08:33 UTC:** `bash scripts/deploy.sh` on bc0e8fc
  deployed cleanly (deployed 08:32:40Z).
  - Schema unchanged.
  - Returning visitor primed on ccab204 in Chromium and WebKit (1,413
    episodes, worker in control).
  - After the swap, both came back on bc0e8fc with the old worker still in
    control: Library 0.9 s and Stats 1.5 s in Chromium, 0.8 s and 0.7 s in
    WebKit.
- **Chat, 08:33 UTC:** `bash scripts/deploy-live.sh` dumped the database
  first (`/root/backups/highdesert/pre-live-20261014T083307Z.dump`),
  applied the Request Line's tables and function, and verified health, the
  SSE hello and a POST round trip.
- **Station notice, 08:33:29 UTC,** after the chat restart: "The station
  just got an update, so the phone lines may have reconnected. New tonight:
  the Request Line. Pick a show or vote by 6 PM Pacific, and the winner
  plays at 10 PM. highdesert.space/request-line"
- **`highdesert-status` after the deploy:**
  - `deploy` OK, live = HEAD = bc0e8fc.
  - New `returning` line OK: Chromium and WebKit both ok, and "after the
    last deploy: ok in 2".
  - Two WARNs, unchanged from before the deploy: `failures` (3.8% of
    starts lost in 7 days) and `warm` (330 of 331 pinned).
  - `mutations` still FAILed on c8e07f0, the nightly from before the fix.
    The full mutation list on `main` after the merge (563fd00, run
    38501095961, all four shards) passed: every mutation went red,
    including your nightly fix and the five re-anchored ones. GitHub had
    not started the 09:30 UTC nightly by 09:37 (yesterday's started at
    17:04). `highdesert-status` reads only the nightly, so its `mutations`
    line turns OK once that run lands.
- **Production checks:**
  - `/request-line` is 200, its share card is a PNG, and it is in the
    sitemap.
  - `/live-api/requests` answers: day 2026-10-14, no nominations yet.
  - `npm run check:seo -- https://highdesert.space`: 46 pages, no findings.
  - `npm run check:csp -- https://highdesert.space`: 8 routes clean on a
    second run. The first run had five 429s on `/library` from
    `/api/live/time` (60 a minute per client). All five came from the
    VPS's own address, right after the deploy's and the status's own
    headless page loads. No listener was involved.
- **Tonight (Oct 14 Pacific) was frozen before this release,** so its
  program has no 10 PM mark. A pick locked at 6 PM still airs at 10 PM
  through the legacy cut (the show running then is cut there). From Oct 15
  on, every new day is built around the 10 PM slot.

## Visibility pass (same day, after you asked)

You couldn't find the note on Live. It was there, but on a phone it sat
below the calls and the clock. Shipped at **14:27 UTC** (1f55649), straight
to `main` (no second PR), after CI and Mutations passed.

- **On a phone the note sits right under the Listen live card,** both looks,
  with its own **Pick a show** button to the Request Line. Desktop is
  unchanged (one link in the console).
- **Once there are picks it counts them:** "Tonight's request at 10 PM. 1
  show in the running, vote by 6 PM Pacific." The count comes from
  `/live-api/requests`, asked on load, every 2 minutes on screen and on
  coming back. After 6 PM picks are for tomorrow, so they are never shown as
  tonight's.
- **In the menus:**
  - Win98's Start menu, after Phone Lines (shortcut Q, since R is Run;
    Run... `requestline` too);
  - the top of Night's More sheet, under Surprise Me. The first try put it
    under Navigate, and the screenshot showed it below eight sort options,
    off the sheet's first screen, so it moved up.
- **Tests:**
  - unit tests for the order on a phone (hero, note, Call in, strip), the
    count (one, several, another day's) and both menus;
  - `e2e/request-line.spec.ts` on a local build, phone, both looks: the note
    within one gap under the hero, the button on the first screen and at
    least 44 px, both menu items on screen without scrolling, and each tap
    lands on `/request-line`. 11 passed;
  - six new mutations, all red.
- **Two backup tests fail locally only:** `backup-db.test.ts` assumes the
  shared test database dumps to under 1 MB, and it is now 1,073,814 bytes.
  CI starts from a fresh database and passed.
- **The deploy:** clean. The returning visitor was ok in Chromium and WebKit
  (bc0e8fc to 1f55649). `highdesert-status`: `deploy` OK on 1f55649,
  `returning` OK. No chat restart, so no station notice.
- **On production** (headless phone and desktop, kept out of the stats):
  - the note is 12 px under the hero on a phone in both looks, with the
    button;
  - a listener's real pick is already up: "1 show in the running".
- **Screenshots:** `~/Downloads/high-desert-2026-10-14-request-line-visibility/`
  on the Mac. They are the e2e's phone shots in both looks (first screen,
  menu, the Request Line after Pick a show) and two from production.

## Blocks hit this session

- **The pipefail hook blocked piped commands without `set -o pipefail`,
  many times over the session.** Examples:
  - `cmd | head` and `grep | head` reads;
  - a heredoc file write followed by a `| grep` (the whole command was
    refused, so the file was written again on its own);
  - a `gh run list | jq` CI poll and a `grep -c | head` read, after the
    first Mutations run;
  - during the merge and cleanup, a `ps | grep -c` check and a `grep | cut
    | tr` read of the admin token's env file (the token was never printed).

  Each was re-run with `set -o pipefail;` in front.
- **The harness refused a foreground `sleep 90`** before the CSP rerun.
  Enough time had already passed, so I ran the check at once, in the
  background.
- **During the visibility pass, the pipefail hook refused three more piped
  commands:** two `grep | head` reads and an edit followed by a `| head`.
  The edit was refused whole and run again on its own. Each was re-run with
  `set -o pipefail;` or without the pipe.
- **One e2e run failed on the stack, not the code:** killing `npx next
  start` left its `next-server` child holding :3091, serving the deleted
  chunks of the build before. I found it by its port, checked its working
  directory was my worktree, killed it, and the rerun passed.
- No other hook or permission check blocked anything.

## Left for you

- Nothing needs a decision.
- **Optional:** if you'd rather the request slot sit at a different hour,
  change one constant, `REQUEST_HOUR` in `src/lib/live/pacific.ts`, along
  with the copy that says 10 PM.
